import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { listConversationMedia, listConversationMessages, setCentralEnabled } from "../../src/lib/data/central";
import { setWhatsappAccessToken } from "../../src/lib/data/whatsapp/connection";
import { processPendingMedia } from "../../src/lib/data/whatsapp/media";
import { recordInboundMessage } from "../../src/lib/data/whatsapp/messages";
import { processWebhook } from "../../src/lib/data/whatsapp/webhook";
import type { WaMessage } from "../../src/lib/data/whatsapp/meta";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// CN5 — mídia recebida (seção 6, decisões 8b e 8c, cliente, 05/nov/2026): guardada só com a Central; a rotina baixa
// foto, áudio e documento; vídeo e arquivo grande ficam só com o aviso; a tela lê pela função da conversa.

const PHONE = "+5584933330001";
let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let support: TestUser;
const asDb = (user: TestUser) => user.client as unknown as DbClient;
const service = () => clinicServiceClient(clinicId) as unknown as DbClient;
const db = () => adminClient();
let seq = 0;
const inbound = (type: string, media: Record<string, unknown>): WaMessage => ({
  id: `wamid.cn5.${Date.now()}.${seq++}`,
  from: PHONE.slice(1),
  type,
  timestamp: String(Math.floor(Date.now() / 1000)),
  [type]: media,
});
const mediaOfMessage = async (messageId: string) => {
  const { data } = await db().from("whatsapp_messages").select("media_id").eq("id", messageId).single();
  if (!data?.media_id) return null;
  return (await db().from("whatsapp_media").select("status, mime_type, size_bytes, storage_path, sha256, file_name").eq("id", data.media_id).single()).data;
};

// Meta de mentira: GET /{media-id} devolve os dados; a URL devolve o arquivo.
const files: Record<string, { mime: string; size: number }> = {};
const fakeMeta: typeof fetch = async (input) => {
  const url = String(input);
  const download = url.match(/^https:\/\/lookaside\.test\/(.+)$/);
  if (download) return new Response(new Uint8Array(files[download[1]].size).fill(7));
  const id = decodeURIComponent(url.split("/").pop()!);
  return Response.json({ url: `https://lookaside.test/${id}`, mime_type: files[id].mime, file_size: files[id].size, sha256: "x" });
};

beforeAll(async () => {
  clinicId = await createClinic("Clínica CN5");
  [admin, reception, support] = await Promise.all([createUser("cn5-admin"), createUser("cn5-recepcao"), createUser("cn5-suporte")]);
  await Promise.all([addMember(clinicId, admin.id, ["admin"]), addMember(clinicId, reception.id, ["reception"]), makePlatformStaff(support.id)]);
  await db().from("whatsapp_connections").insert({ clinic_id: clinicId, phone_number_id: `pn-cn5-${Date.now()}`, waba_id: "cn5-waba", status: "connected", coexistence: true });
  await setWhatsappAccessToken(asDb(support), clinicId, "token-cn5");
});

afterAll(async () => {
  const { data } = await db().storage.from("whatsapp-media").list(`${clinicId}/${PHONE.slice(1)}`);
  if (data?.length) await db().storage.from("whatsapp-media").remove(data.map((f) => `${clinicId}/${PHONE.slice(1)}/${f.name}`));
  await deleteClinics([clinicId]);
  await deleteUsers([admin, reception, support]);
});

describe("mídia recebida", () => {
  it("com a Central desligada, o anexo não é guardado", async () => {
    const result = await recordInboundMessage(service(), clinicId, inbound("image", { id: "meta-off", mime_type: "image/jpeg" }));
    expect(result.recorded && (await mediaOfMessage(result.id))).toBeNull();
  });

  it("com a Central: foto e PDF baixados e guardados; vídeo e arquivo grande, só o aviso", async () => {
    await setCentralEnabled(asDb(admin), clinicId, true);
    files["meta-foto"] = { mime: "image/jpeg", size: 2048 };
    files["meta-pdf"] = { mime: "application/pdf", size: 4096 };
    files["meta-video"] = { mime: "video/mp4", size: 35 * 1024 * 1024 };
    files["meta-grande"] = { mime: "application/pdf", size: 20 * 1024 * 1024 };
    const ids: Record<string, string> = {};
    for (const [key, msg] of Object.entries({
      foto: inbound("image", { id: "meta-foto", mime_type: "image/jpeg", caption: "minha carteirinha" }),
      pdf: inbound("document", { id: "meta-pdf", mime_type: "application/pdf", filename: "exame.pdf" }),
      video: inbound("video", { id: "meta-video", mime_type: "video/mp4" }),
      grande: inbound("document", { id: "meta-grande", mime_type: "application/pdf", filename: "laudo.pdf" }),
      figurinha: inbound("sticker", { id: "meta-sticker", mime_type: "image/webp" }),
    })) {
      const result = await recordInboundMessage(service(), clinicId, msg);
      if (!result.recorded) throw new Error("não gravou");
      ids[key] = result.id;
    }
    expect((await mediaOfMessage(ids.foto))?.status).toBe("pending");
    expect((await mediaOfMessage(ids.figurinha))?.status).toBe("unsupported");

    expect(await processPendingMedia(service(), clinicId, { fetcher: fakeMeta })).toEqual({ stored: 2, skipped: 2, failed: 0 });
    const foto = await mediaOfMessage(ids.foto);
    expect(foto).toMatchObject({ status: "stored", mime_type: "image/jpeg", size_bytes: 2048, storage_path: `${clinicId}/${PHONE.slice(1)}/${ids.foto}.jpg` });
    expect(foto!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await mediaOfMessage(ids.pdf)).toMatchObject({ status: "stored", file_name: "exame.pdf" });
    expect(await mediaOfMessage(ids.video)).toMatchObject({ status: "unsupported", size_bytes: 35 * 1024 * 1024, storage_path: null });
    expect(await mediaOfMessage(ids.grande)).toMatchObject({ status: "too_large", storage_path: null });
    // A legenda da foto é o texto da mensagem.
    const { data: text } = await db().from("whatsapp_messages").select("body").eq("id", ids.foto).single();
    expect(text!.body).toBe("minha carteirinha");
  });

  it("a tela lê os anexos da conversa; o arquivo, só pela função que registra", async () => {
    const { data: rows } = await db().from("whatsapp_messages").select("media_id").eq("clinic_id", clinicId).not("media_id", "is", null);
    const ids = rows!.map((r) => r.media_id!);
    const media = await listConversationMedia(asDb(reception), clinicId, PHONE, ids);
    expect([...media.values()].map((m) => m.status).sort()).toEqual(["stored", "stored", "too_large", "unsupported", "unsupported"]);
    const stored = [...media.values()].find((m) => m.status === "stored")!;
    const { data: access } = await reception.client.rpc("central_media_access", { p_clinic_id: clinicId, p_media_id: stored.id });
    expect(access![0].storage_path).toMatch(new RegExp(`^${clinicId}/`));
    const { count } = await db().from("conversation_access_log").select("*", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("action", "media");
    expect(count).toBe(1);
    // O login não lê a tabela nem o bucket direto.
    expect((await reception.client.from("whatsapp_media").select("id")).data ?? []).toEqual([]);
    const { data: signed } = await reception.client.storage.from("whatsapp-media").createSignedUrl(access![0].storage_path, 60);
    expect(signed).toBeNull();
  });

  it("falha da Meta: tenta de novo; na 3ª, Não foi possível receber", async () => {
    const result = await recordInboundMessage(service(), clinicId, inbound("audio", { id: "meta-quebrado", mime_type: "audio/ogg" }));
    if (!result.recorded) throw new Error("não gravou");
    const broken: typeof fetch = async () => Response.json({ error: { code: 131052, message: "Media download error" } }, { status: 400 });
    for (let i = 0; i < 3; i++) await processPendingMedia(service(), clinicId, { fetcher: broken });
    expect(await mediaOfMessage(result.id)).toMatchObject({ status: "failed" });
  });

  it("áudio pelo webhook: baixado na hora, sem esperar a rotina (correção de 07/nov)", async () => {
    files["meta-audio"] = { mime: "audio/ogg; codecs=opus", size: 3000 };
    const msg = inbound("audio", { id: "meta-audio", mime_type: "audio/ogg; codecs=opus", voice: true });
    const deferred: Promise<unknown>[] = [];
    await processWebhook(
      { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "pn-cn5-webhook" }, messages: [msg] } }] }] },
      { resolveClinic: async () => clinicId, clientFor: () => service(), defer: (work) => deferred.push(work), mediaFetcher: fakeMeta },
    );
    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
    const { data } = await db().from("whatsapp_messages").select("id").eq("clinic_id", clinicId).eq("wa_message_id", msg.id!).single();
    expect(await mediaOfMessage(data!.id)).toMatchObject({ status: "stored", storage_path: `${clinicId}/${PHONE.slice(1)}/${data!.id}.ogg` });
  });

  it("mensagem de texto pelo webhook não pede download", async () => {
    const deferred: Promise<unknown>[] = [];
    await processWebhook(
      { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "pn-cn5-webhook" }, messages: [{ id: `wamid.cn5.texto.${Date.now()}`, from: PHONE.slice(1), type: "text", text: { body: "Oi" } }] } }] }] },
      { resolveClinic: async () => clinicId, clientFor: () => service(), defer: (work) => deferred.push(work) },
    );
    expect(deferred).toHaveLength(0);
  });

  it("EC (cliente, 07/nov/2026): foto e localização enviadas pelo app: o tipo à parte, a foto baixada, a localização em texto", async () => {
    files["meta-eco-foto"] = { mime: "image/jpeg", size: 1500 };
    const echo = (type: string, content: Record<string, unknown>): WaMessage => ({
      id: `wamid.ec.${Date.now()}.${seq++}`,
      from: "558430000000",
      to: PHONE.slice(1),
      type,
      timestamp: String(Math.floor(Date.now() / 1000)),
      [type]: content,
    });
    const foto = echo("image", { id: "meta-eco-foto", mime_type: "image/jpeg" });
    const local = echo("location", { latitude: -5.8, longitude: -35.2, name: "Clínica CN5", address: "Rua X, 123" });
    const desconhecida = echo("poll", { name: "?" });
    const deferred: Promise<unknown>[] = [];
    await processWebhook(
      { entry: [{ changes: [{ field: "smb_message_echoes", value: { metadata: { phone_number_id: "pn-cn5-webhook" }, message_echoes: [foto, local, desconhecida] } }] }] },
      { resolveClinic: async () => clinicId, clientFor: () => service(), defer: (work) => deferred.push(work), mediaFetcher: fakeMeta },
    );
    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
    const rows = (await db().from("whatsapp_messages").select("id, wa_message_id, message_type, content_type, body, author").eq("clinic_id", clinicId).in("wa_message_id", [foto.id!, local.id!, desconhecida.id!])).data!;
    const of = (id: string) => rows.find((r) => r.wa_message_id === id)!;
    // (Segundos depois do paciente, a regra IS4 pode marcar como mensagem automática do app: o tipo à parte vale igual.)
    expect(of(foto.id!)).toMatchObject({ content_type: "image", body: null });
    expect(["agent_reply", "app_auto_reply"]).toContain(of(foto.id!).message_type);
    expect(of(local.id!)).toMatchObject({ content_type: "location", body: "Localização: Clínica CN5, Rua X, 123 (-5.800000, -35.200000)" });
    expect(of(desconhecida.id!)).toMatchObject({ content_type: "poll", body: null });
    expect(await mediaOfMessage(of(foto.id!).id)).toMatchObject({ status: "stored" });
    const { data: media } = await db().from("whatsapp_media").select("direction").eq("message_id", of(foto.id!).id).single();
    expect(media!.direction).toBe("outbound");
    // A tela recebe o tipo e se foi gravada com a Central ligada.
    const { messages } = await listConversationMessages(asDb(admin), clinicId, PHONE);
    expect(messages.find((m) => m.id === of(foto.id!).id)).toMatchObject({ contentType: "image", centralOn: true });
    expect(messages.find((m) => m.id === of(desconhecida.id!).id)).toMatchObject({ contentType: "poll", centralOn: true, body: null });
  });

  it("EC: com a Central desligada, o eco do app não guarda texto nem anexo, e a tela diz \"anterior\"", async () => {
    await setCentralEnabled(asDb(admin), clinicId, false);
    // A troca usa a hora do banco e a mensagem, a do servidor: espera a diferença entre os relógios passar.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const msg: WaMessage = { id: `wamid.ec.off.${Date.now()}`, from: "558430000000", to: PHONE.slice(1), type: "image", image: { id: "meta-eco-off", mime_type: "image/jpeg", caption: "legenda" } };
    await processWebhook(
      { entry: [{ changes: [{ field: "smb_message_echoes", value: { metadata: { phone_number_id: "pn-cn5-webhook" }, message_echoes: [msg] } }] }] },
      { resolveClinic: async () => clinicId, clientFor: () => service(), defer: () => {}, mediaFetcher: fakeMeta },
    );
    const { data } = await db().from("whatsapp_messages").select("id, body, content_type, media_id").eq("clinic_id", clinicId).eq("wa_message_id", msg.id!).single();
    expect(data).toMatchObject({ body: null, content_type: "image", media_id: null });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await setCentralEnabled(asDb(admin), clinicId, true);
    const { messages } = await listConversationMessages(asDb(admin), clinicId, PHONE);
    expect(messages.find((m) => m.id === data!.id)?.centralOn).toBe(false);
  });
});
