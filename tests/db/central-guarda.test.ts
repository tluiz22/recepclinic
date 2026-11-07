import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { setCentralEnabled } from "../../src/lib/data/central";
import { anonymizePatient } from "../../src/lib/data/patients";
import { applyConversationRetention, MEDIA_BUCKET, purgeDeletedMedia } from "../../src/lib/data/whatsapp/media";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, withDatabase, type TestUser } from "./helpers";

// CN7 — prazo de guarda (texto 5 anos, anexo 12 meses) e anonimização apagando texto e anexos (decisão 8, cliente,
// 05/nov/2026). O arquivo sai do bucket pela rotina de cada minuto.

const PHONE = "+5584977770001";
const OTHER = "+5584977770002";
let clinicId: string;
let admin: TestUser;
const asDb = (user: TestUser) => user.client as unknown as DbClient;
const db = () => adminClient();
const service = () => clinicServiceClient(clinicId) as unknown as DbClient;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const folder = (phone: string) => `${clinicId}/${phone.slice(1)}`;

/** Mensagem com anexo guardado (arquivo de verdade no bucket). */
const withMedia = async (phone: string, days: number, name: string, contactId: string | null = null) => {
  const path = `${folder(phone)}/${name}`;
  await db().storage.from(MEDIA_BUCKET).upload(path, new Blob([new Uint8Array([1, 2, 3])]), { contentType: "image/png" });
  const { data: media } = await db()
    .from("whatsapp_media")
    .insert({ clinic_id: clinicId, direction: "inbound", status: "stored", storage_path: path, mime_type: "image/png", size_bytes: 3, file_name: name })
    .select("id")
    .single();
  const { data: message } = await db()
    .from("whatsapp_messages")
    .insert({
      clinic_id: clinicId,
      contact_phone: phone,
      contact_id: contactId,
      direction: "inbound",
      message_type: "image",
      body: "legenda",
      status: "received",
      media_id: media!.id,
      created_at: daysAgo(days),
      sort_at: daysAgo(days),
    })
    .select("id")
    .single();
  return { mediaId: media!.id, messageId: message!.id, path };
};
const mediaRow = async (id: string) => (await db().from("whatsapp_media").select("status, storage_path, file_name").eq("id", id).single()).data!;
const exists = async (path: string) => {
  const [dir, file] = [path.slice(0, path.lastIndexOf("/")), path.slice(path.lastIndexOf("/") + 1)];
  const { data } = await db().storage.from(MEDIA_BUCKET).list(dir);
  return !!data?.some((f) => f.name === file);
};

beforeAll(async () => {
  clinicId = await createClinic("Clínica CN7");
  admin = await createUser("cn7-admin");
  await addMember(clinicId, admin.id, ["admin"]);
  await setCentralEnabled(asDb(admin), clinicId, true);
});

afterAll(async () => {
  for (const phone of [PHONE, OTHER]) {
    const { data } = await db().storage.from(MEDIA_BUCKET).list(folder(phone));
    if (data?.length) await db().storage.from(MEDIA_BUCKET).remove(data.map((f) => `${folder(phone)}/${f.name}`));
  }
  await deleteClinics([clinicId]);
  await deleteUsers([admin]);
});

describe("prazo de guarda (CN7)", () => {
  it("texto com mais de 5 anos fica nulo; anexo com mais de 12 meses fica apagado e o arquivo sai do bucket", async () => {
    const { data: texts } = await db()
      .from("whatsapp_messages")
      .insert([
        { clinic_id: clinicId, contact_phone: OTHER, direction: "inbound", message_type: "text", body: "antigo", status: "received", created_at: daysAgo(5 * 366), sort_at: daysAgo(5 * 366) },
        { clinic_id: clinicId, contact_phone: OTHER, direction: "inbound", message_type: "text", body: "recente", status: "received", created_at: daysAgo(4 * 365), sort_at: daysAgo(4 * 365) },
      ])
      .select("id, body");
    const old = await withMedia(OTHER, 400, "velha.png");
    const fresh = await withMedia(OTHER, 200, "nova.png");

    const result = await applyConversationRetention(service(), clinicId);
    expect(result.texts).toBeGreaterThanOrEqual(1);
    expect(result.media).toBe(1);
    const { data: after } = await db().from("whatsapp_messages").select("id, body").in("id", texts!.map((t) => t.id));
    expect(Object.fromEntries(after!.map((m) => [m.id, m.body]))).toEqual({ [texts![0].id]: null, [texts![1].id]: "recente" });
    expect((await mediaRow(old.mediaId)).status).toBe("deleted");
    expect((await mediaRow(fresh.mediaId)).status).toBe("stored");

    expect(await purgeDeletedMedia(service(), clinicId)).toBe(1);
    expect(await mediaRow(old.mediaId)).toMatchObject({ status: "deleted", storage_path: null });
    expect(await exists(old.path)).toBe(false);
    expect(await exists(fresh.path)).toBe(true);
    expect(await purgeDeletedMedia(service(), clinicId)).toBe(0);
  });

  it("arquivo enviado pela Central que não virou mensagem: sai depois de 1 hora", async () => {
    const recent = `${folder(OTHER)}/env-${crypto.randomUUID()}.png`;
    const stale = `${folder(OTHER)}/env-${crypto.randomUUID()}.png`;
    for (const path of [recent, stale]) await db().storage.from(MEDIA_BUCKET).upload(path, new Blob([new Uint8Array([1])]));
    await withDatabase((pg) => pg.query("update storage.objects set created_at = now() - interval '2 hours' where bucket_id = $1 and name = $2", [MEDIA_BUCKET, stale]));
    expect(await purgeDeletedMedia(service(), clinicId)).toBe(1);
    expect(await exists(stale)).toBe(false);
    expect(await exists(recent)).toBe(true);
  });

  it("só a rotina da própria clínica", async () => {
    const { error } = await asDb(admin).rpc("central_retention", { p_clinic_id: clinicId });
    expect(error?.code).toBeTruthy();
  });
});

describe("anonimização (CN7)", () => {
  it("apaga texto, anexos (o arquivo sai na rotina), leituras, conversa e o telefone dos registros", async () => {
    const { data: contact } = await db().from("contacts").insert({ clinic_id: clinicId, full_name: "Paciente CN7", phone: PHONE }).select("id").single();
    const { data: patient } = await db()
      .from("patients")
      .insert({ clinic_id: clinicId, contact_id: contact!.id, full_name: "Paciente CN7", birthdate: "1990-01-01" })
      .select("id")
      .single();
    const sent = await withMedia(PHONE, 1, "exame.png", contact!.id);
    await db().from("conversation_state").insert({ clinic_id: clinicId, contact_phone: PHONE, contact_id: contact!.id, human_handoff: true, profile_name: "Paciente" });
    await db().from("conversation_reads").insert({ clinic_id: clinicId, contact_phone: PHONE, user_id: admin.id });
    await db().from("conversation_access_log").insert({ clinic_id: clinicId, contact_phone: PHONE, user_id: admin.id, action: "open" });

    await anonymizePatient(asDb(admin), clinicId, patient!.id);

    const { data: message } = await db().from("whatsapp_messages").select("body, contact_phone").eq("id", sent.messageId).single();
    expect(message!.body).toBeNull();
    expect(message!.contact_phone).not.toBe(PHONE);
    expect(await mediaRow(sent.mediaId)).toMatchObject({ status: "deleted", file_name: null });
    const count = async (table: "conversation_state" | "conversation_reads" | "conversation_access_log") =>
      (await db().from(table).select("*", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("contact_phone", PHONE)).count;
    expect(await count("conversation_state")).toBe(0);
    expect(await count("conversation_reads")).toBe(0);
    expect(await count("conversation_access_log")).toBe(0);

    expect(await purgeDeletedMedia(service(), clinicId)).toBe(1);
    expect(await exists(sent.path)).toBe(false);
  });
});
