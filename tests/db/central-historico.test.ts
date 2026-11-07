import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { setCentralEnabled } from "../../src/lib/data/central";
import { processHistoryEvents } from "../../src/lib/data/whatsapp/media";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";

// CN8 — histórico do app na conexão (decisão 10, R3, cliente, 05/nov/2026): o webhook só guarda o evento bruto; a
// rotina grava as mensagens com a hora original, sem duplicar e sem criar conversa; os anexos que a Meta manda depois
// viram pendentes. Com a Central desligada, nada é guardado.

const PATIENT = "5584944440001";
const OTHER = "5584944440002";
const BUSINESS = "558430000000";
let clinicId: string;
let offClinic: string;
let admin: TestUser;
let offAdmin: TestUser;
const phoneNumberId = `pn-cn8-${Date.now()}`;
const offPhoneNumberId = `pn-cn8-off-${Date.now()}`;
const asDb = (user: TestUser) => user.client as unknown as DbClient;
const db = () => adminClient();
const service = (id: string) => clinicServiceClient(id) as unknown as DbClient;
const ts = (daysAgo: number) => String(Math.floor((Date.now() - daysAgo * 86_400_000) / 1000));

const deps: WebhookDeps = {
  resolveClinic: async (id) => (id === phoneNumberId ? clinicId : id === offPhoneNumberId ? offClinic : null),
  clientFor: (id) => service(id),
};
const envelope = (pnid: string, value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba-cn8", changes: [{ field: "history", value: { messaging_product: "whatsapp", metadata: { phone_number_id: pnid }, ...value } }] }],
});
const chunk = (pnid: string, chunkOrder: number, threads: unknown[]) => envelope(pnid, { history: [{ metadata: { phase: 1, chunk_order: chunkOrder, progress: 50 }, threads }] });
const usage = async () =>
  (await db().from("clinic_usage_monthly").select("messages_sent").eq("clinic_id", clinicId)).data?.reduce((sum, row) => sum + row.messages_sent, 0) ?? 0;

beforeAll(async () => {
  [clinicId, offClinic] = await Promise.all([createClinic("Clínica CN8"), createClinic("Clínica CN8 desligada")]);
  [admin, offAdmin] = await Promise.all([createUser("cn8-admin"), createUser("cn8-admin-off")]);
  await Promise.all([addMember(clinicId, admin.id, ["admin"]), addMember(offClinic, offAdmin.id, ["admin"])]);
  await setCentralEnabled(asDb(admin), clinicId, true);
  // Conversa que já existe (OTHER): o histórico entra nela sem mudar a situação.
  await db().from("conversation_state").insert({ clinic_id: clinicId, contact_phone: `+${OTHER}`, human_handoff: false });
});

afterAll(async () => {
  await deleteClinics([clinicId, offClinic]);
  await deleteUsers([admin, offAdmin]);
});

describe("histórico do app (CN8)", () => {
  it("o webhook guarda o bloco; a rotina grava as mensagens com a hora original, sem criar conversa nem contar no uso", async () => {
    const before = await usage();
    const summary = await processWebhook(
      chunk(phoneNumberId, 2, [
        {
          id: PATIENT,
          messages: [
            { from: PATIENT, id: "wamid.cn8.1", timestamp: ts(30), type: "text", text: { body: "Tem horário amanhã?" }, history_context: { status: "READ" } },
            { from: BUSINESS, id: "wamid.cn8.2", timestamp: ts(30), type: "text", text: { body: "Temos às 10h." }, history_context: { status: "DELIVERED" } },
            { from: BUSINESS, id: "wamid.cn8.3", timestamp: ts(29), type: "media_placeholder", history_context: { status: "READ" } },
          ],
        },
        { id: OTHER, messages: [{ from: OTHER, id: "wamid.cn8.4", timestamp: ts(100), type: "text", text: { body: "Antigo" } }] },
      ]),
      deps,
    );
    expect(summary.history).toBe(1);
    // Nada de mensagem "ao vivo" ainda: só o evento.
    expect((await db().from("whatsapp_messages").select("id").eq("clinic_id", clinicId)).data).toEqual([]);

    expect(await processHistoryEvents(service(clinicId), clinicId)).toEqual({ events: 1, messages: 4, media: 0 });
    const { data: rows } = await db()
      .from("whatsapp_messages")
      .select("wa_message_id, direction, author, source, body, status, message_type, sort_at, contact_phone")
      .eq("clinic_id", clinicId)
      .order("wa_message_id");
    expect(rows!.map((r) => [r.wa_message_id, r.direction, r.author, r.source, r.body, r.status, r.message_type])).toEqual([
      ["wamid.cn8.1", "inbound", "patient", "history", "Tem horário amanhã?", "received", "text"],
      ["wamid.cn8.2", "outbound", "agent_app", "history", "Temos às 10h.", "delivered", "text"],
      ["wamid.cn8.3", "outbound", "agent_app", "history", null, "read", "media_placeholder"],
      ["wamid.cn8.4", "inbound", "patient", "history", "Antigo", "received", "text"],
    ]);
    expect(new Date(rows![0].sort_at!).getTime()).toBe(Number(ts(30)) * 1000);
    expect(await usage()).toBe(before);
    // R3: sem conversa nova; a que existia continua com o bot e não ganha "última do paciente" (não conta para as 24 h).
    const { data: states } = await db().from("conversation_state").select("contact_phone, human_handoff, last_patient_at").eq("clinic_id", clinicId);
    expect(states).toEqual([{ contact_phone: `+${OTHER}`, human_handoff: false, last_patient_at: null }]);
    const { data: event } = await db().from("whatsapp_history_events").select("status, phase, chunk_order, progress").eq("clinic_id", clinicId).single();
    expect(event).toEqual({ status: "done", phase: 1, chunk_order: 2, progress: 50 });
  });

  it("o mesmo bloco de novo não duplica", async () => {
    await processWebhook(chunk(phoneNumberId, 2, [{ id: PATIENT, messages: [{ from: PATIENT, id: "wamid.cn8.1", timestamp: ts(30), type: "text", text: { body: "Tem horário amanhã?" } }] }]), deps);
    expect(await processHistoryEvents(service(clinicId), clinicId)).toEqual({ events: 1, messages: 0, media: 0 });
  });

  it("anexo que a Meta manda depois: vira anexo pendente da mensagem; antes do bloco, espera", async () => {
    const image = (id: string) => ({ from: PATIENT, id, timestamp: ts(2), type: "image", image: { id: `meta-${id}`, mime_type: "image/jpeg", caption: "Pedido" } });
    // Chegou antes do bloco com a mensagem: fica pendente.
    await processWebhook(envelope(phoneNumberId, { messages: [image("wamid.cn8.5")] }), deps);
    expect(await processHistoryEvents(service(clinicId), clinicId)).toEqual({ events: 1, messages: 0, media: 0 });
    // O bloco chega: a mensagem entra e, na mesma execução, o anexo se liga a ela.
    await processWebhook(chunk(phoneNumberId, 3, [{ id: PATIENT, messages: [{ from: PATIENT, id: "wamid.cn8.5", timestamp: ts(2), type: "media_placeholder" }] }]), deps);
    expect(await processHistoryEvents(service(clinicId), clinicId)).toEqual({ events: 2, messages: 1, media: 1 });
    const { data: message } = await db().from("whatsapp_messages").select("message_type, body, author, media_id").eq("wa_message_id", "wamid.cn8.5").single();
    expect(message).toMatchObject({ message_type: "image", body: "Pedido", author: "patient" });
    const { data: media } = await db().from("whatsapp_media").select("status, meta_media_id, mime_type").eq("id", message!.media_id!).single();
    expect(media).toEqual({ status: "pending", meta_media_id: "meta-wamid.cn8.5", mime_type: "image/jpeg" });
  });

  it("recusa da clínica (2593109): guarda o aviso, sem mensagens", async () => {
    await processWebhook(
      { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, history: [{ errors: [{ code: 2593109, title: "History sync is turned off" }] }] },
      deps,
    );
    const { data } = await db().from("whatsapp_history_events").select("kind").eq("clinic_id", clinicId).eq("kind", "declined");
    expect(data).toHaveLength(1);
  });

  it("Central desligada: nada é guardado", async () => {
    await processWebhook(chunk(offPhoneNumberId, 1, [{ id: PATIENT, messages: [{ from: PATIENT, id: "wamid.cn8.off", timestamp: ts(1), type: "text", text: { body: "Oi" } }] }]), deps);
    expect((await db().from("whatsapp_history_events").select("id").eq("clinic_id", offClinic)).data).toEqual([]);
  });

  it("só a rotina da própria clínica", async () => {
    const { error } = await asDb(admin).rpc("central_history_process", { p_clinic_id: clinicId });
    expect(error).toBeTruthy();
  });
});
