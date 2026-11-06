import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { listConversationMedia, setCentralEnabled } from "../../src/lib/data/central";
import { retryFromCentral, sendMediaFromCentral, type SendDeps } from "../../src/lib/data/centralSend";
import { createOutboundUploadUrl, MEDIA_BUCKET, outboundPath } from "../../src/lib/data/whatsapp/media";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import type { SendOutcome } from "../../src/lib/data/whatsapp/messages";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";

// CN6 — enviar foto e PDF pela Central (seção 6 e decisão 8b, cliente, 05/nov/2026): as regras da resposta em texto,
// o arquivo conferido pelo conteúdo e o "Tentar de novo" subindo o arquivo de novo.

const WAITING = "+5584966660001";
const OLD = "+5584966660002";
let clinicId: string;
let admin: TestUser;
let professional: TestUser;
const asDb = (user: TestUser) => user.client as unknown as DbClient;
const db = () => adminClient();
const service = () => clinicServiceClient(clinicId) as unknown as DbClient;
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%teste\n");

let nextOutcome: SendOutcome = { sent: true, messageId: "wamid.cn6" };
const calls: { kind: string; to: string; caption: string | null; filename?: string; mimeType?: string }[] = [];
let uploads = 0;
const sender = {
  uploadDocument: async (file: { filename: string; mimeType?: string }) => {
    uploads++;
    calls.push({ kind: "upload", to: "", caption: null, filename: file.filename, mimeType: file.mimeType });
    return `meta-media-${uploads}`;
  },
  image: async (to: string, _image: { mediaId: string }, caption: string | null) => {
    calls.push({ kind: "image", to, caption });
    return nextOutcome;
  },
  document: async (to: string, document: { mediaId: string; filename: string }, caption: string) => {
    calls.push({ kind: "document", to, caption, filename: document.filename });
    return nextOutcome;
  },
} as unknown as ClinicSender;
const deps = (user: TestUser): SendDeps => ({ db: asDb(user), serviceDb: service(), sender });

/** Sobe como o navegador: link de envio de uso único gerado pelo servidor. */
const upload = async (phone: string, key: string, mime: string, bytes: Uint8Array) => {
  const path = outboundPath(clinicId, phone, key, mime);
  const url = await createOutboundUploadUrl(service(), path);
  const token = new URL(url).searchParams.get("token")!;
  const { error } = await db().storage.from(MEDIA_BUCKET).uploadToSignedUrl(path, token, new Blob([new Uint8Array(bytes)], { type: mime }));
  if (error) throw error;
  return path;
};
const send = (user: TestUser, phone: string, key: string, mime: string, extra: { caption?: string | null; fileName?: string } = {}) =>
  sendMediaFromCentral(deps(user), clinicId, {
    phone,
    clientKey: key,
    path: outboundPath(clinicId, phone, key, mime),
    fileName: extra.fileName ?? "arquivo",
    caption: extra.caption ?? null,
    expectedAssigned: null,
  });
const messageByKey = async (key: string) =>
  (await db().from("whatsapp_messages").select("id, status, author, sent_by, message_type, body, media_id").eq("clinic_id", clinicId).eq("client_key", key).maybeSingle()).data;

beforeAll(async () => {
  clinicId = await createClinic("Clínica CN6");
  [admin, professional] = await Promise.all([createUser("cn6-admin"), createUser("cn6-prof")]);
  await Promise.all([addMember(clinicId, admin.id, ["admin"]), addMember(clinicId, professional.id, ["professional"])]);
  await setCentralEnabled(asDb(admin), clinicId, true);
  const inbound = (phone: string, minutesAgo: number) => ({
    clinic_id: clinicId,
    contact_phone: phone,
    direction: "inbound",
    message_type: "text",
    body: "Oi",
    status: "received",
    created_at: at(minutesAgo),
  });
  await db().from("whatsapp_messages").insert([inbound(WAITING, 10), inbound(OLD, 25 * 60)]);
  await db()
    .from("conversation_state")
    .insert([
      { clinic_id: clinicId, contact_phone: WAITING, human_handoff: true, handoff_status: "waiting_clinic", handoff_status_at: at(10) },
      { clinic_id: clinicId, contact_phone: OLD, human_handoff: true, handoff_status: "waiting_clinic", handoff_status_at: at(25 * 60) },
    ]);
});

afterAll(async () => {
  for (const phone of [WAITING, OLD]) {
    const folder = `${clinicId}/${phone.slice(1)}`;
    const { data } = await db().storage.from(MEDIA_BUCKET).list(folder);
    if (data?.length) await db().storage.from(MEDIA_BUCKET).remove(data.map((f) => `${folder}/${f.name}`));
  }
  await deleteClinics([clinicId]);
  await deleteUsers([admin, professional]);
});

describe("enviar foto e PDF (CN6)", () => {
  it("foto com legenda: sobe à Meta, envia como imagem, grava o anexo e quem envia assume", async () => {
    const key = crypto.randomUUID();
    await upload(WAITING, key, "image/png", PNG);
    calls.length = 0;
    expect(await send(admin, WAITING, key, "image/png", { caption: " Resultado ", fileName: "exame.png" })).toEqual({ kind: "sent" });
    expect(calls.map((c) => c.kind)).toEqual(["upload", "image"]);
    expect(calls[0]).toMatchObject({ filename: "exame.png", mimeType: "image/png" });
    expect(calls[1]).toMatchObject({ to: WAITING, caption: "Resultado" });

    const message = (await messageByKey(key))!;
    expect(message).toMatchObject({ status: "sent", author: "agent_panel", sent_by: admin.id, message_type: "panel_reply", body: "Resultado" });
    const { data: media } = await db().from("whatsapp_media").select("direction, status, mime_type, size_bytes, file_name, message_id, sha256").eq("id", message.media_id!).single();
    expect(media).toMatchObject({ direction: "outbound", status: "stored", mime_type: "image/png", size_bytes: PNG.byteLength, file_name: "exame.png", message_id: message.id });
    expect(media!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const { data: conv } = await db().from("conversation_state").select("assigned_to, handoff_status").eq("clinic_id", clinicId).eq("contact_phone", WAITING).single();
    expect(conv).toEqual({ assigned_to: admin.id, handoff_status: "in_progress" });

    // A tela lê o anexo pela função da conversa.
    const shown = await listConversationMedia(asDb(admin), clinicId, WAITING, [message.media_id!]);
    expect(shown.get(message.media_id!)).toMatchObject({ status: "stored", mimeType: "image/png" });

    // O mesmo envio (mesma chave) não sai de novo.
    calls.length = 0;
    expect(await send(admin, WAITING, key, "image/png")).toEqual({ kind: "duplicate" });
    expect(calls).toEqual([]);
  });

  it("PDF sem legenda: envia como documento com .pdf no nome", async () => {
    const key = crypto.randomUUID();
    await upload(WAITING, key, "application/pdf", PDF);
    calls.length = 0;
    expect(await send(admin, WAITING, key, "application/pdf", { fileName: "pedido" })).toEqual({ kind: "sent" });
    expect(calls[1]).toMatchObject({ kind: "document", filename: "pedido.pdf", caption: "" });
    expect((await messageByKey(key))!.body).toBeNull();
  });

  it("arquivo que não é foto nem PDF (pelo conteúdo): recusa, apaga e não grava", async () => {
    const key = crypto.randomUUID();
    const path = await upload(WAITING, key, "image/png", new TextEncoder().encode("<svg onload=alert(1)>"));
    const result = await send(admin, WAITING, key, "image/png");
    expect(result).toEqual({ kind: "bad_file", message: "Envie uma foto (JPG ou PNG) ou um PDF." });
    expect(await messageByKey(key)).toBeNull();
    const { data } = await db().storage.from(MEDIA_BUCKET).list(path.split("/").slice(0, 2).join("/"));
    expect(data?.some((f) => path.endsWith(f.name))).toBe(false);
  });

  it("arquivo que não chegou: avisa", async () => {
    expect(await send(admin, WAITING, crypto.randomUUID(), "application/pdf")).toEqual({ kind: "bad_file", message: "O arquivo não chegou. Tente anexar de novo." });
  });

  it("fora das 24 h: não sai", async () => {
    const key = crypto.randomUUID();
    await upload(OLD, key, "image/png", PNG);
    expect(await send(admin, OLD, key, "image/png")).toEqual({ kind: "window_closed" });
    expect(await messageByKey(key)).toBeNull();
  });

  it("Profissional sem a conversa: recusa", async () => {
    const key = crypto.randomUUID();
    await upload(OLD, key, "image/png", PNG);
    await expect(send(professional, OLD, key, "image/png")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("caminho fora da conversa: o banco recusa", async () => {
    const { error } = await asDb(admin).rpc("central_media_send_prepare", {
      p_clinic_id: clinicId,
      p_contact_phone: WAITING,
      p_client_key: crypto.randomUUID(),
      p_caption: "",
      p_storage_path: `${clinicId}/5500000000000/env-x.png`,
      p_mime_type: "image/png",
      p_size_bytes: 10,
      p_file_name: "x.png",
      p_sha256: "a".repeat(64),
      p_expected_assigned: admin.id,
    });
    expect(error?.code).toBe("22023");
  });

  it("não saiu: Tentar de novo sobe o arquivo à Meta de novo e envia", async () => {
    const key = crypto.randomUUID();
    await upload(WAITING, key, "image/png", PNG);
    nextOutcome = { sent: false, reason: "falha de teste" };
    expect(await send(admin, WAITING, key, "image/png", { caption: "Segue" })).toMatchObject({ kind: "failed" });
    const failed = (await messageByKey(key))!;
    expect(failed.status).toBe("failed");

    nextOutcome = { sent: true, messageId: "wamid.cn6.retry" };
    calls.length = 0;
    expect(await retryFromCentral(deps(admin), clinicId, failed.id)).toEqual({ kind: "sent" });
    expect(calls.map((c) => c.kind)).toEqual(["upload", "image"]);
    expect(calls[1].caption).toBe("Segue");
    expect((await messageByKey(key))!.status).toBe("sent");
  });
});
