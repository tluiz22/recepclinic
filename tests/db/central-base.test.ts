import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { getCentralSwitch, listConversationMessages, setCentralEnabled } from "../../src/lib/data/central";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// CN1 — base da Central de Atendimento (cliente, 05/nov/2026): liga/desliga pelo Administrador com registro, autor e
// ordem das mensagens, responsável e eventos, leitura com a regra do Profissional, registro de acesso e não lidas.

const PHONE = "+5584977770001";
const OTHER_PHONE = "+5584977770002";
let clinicId: string;
let noFeatureClinicId: string;
let admin: TestUser;
let reception: TestUser;
let professional: TestUser;
let support: TestUser;
const asDb = (client: unknown) => client as DbClient;
const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "erro";
  }
};
const db = () => adminClient();
const state = (phone: string) =>
  db().from("conversation_state").select("human_handoff, handoff_status, assigned_to, assigned_at").eq("clinic_id", clinicId).eq("contact_phone", phone).single();
const events = async (phone: string) =>
  (await db().from("handoff_events").select("kind, from_status, to_status, assigned_from, assigned_to").eq("clinic_id", clinicId).eq("contact_phone", phone).order("id")).data ?? [];

beforeAll(async () => {
  [clinicId, noFeatureClinicId] = await Promise.all([createClinic("Clínica CN1"), createClinic("Clínica CN1 sem Central", ["whatsapp_bot"])]);
  [admin, reception, professional, support] = await Promise.all([
    createUser("cn1-admin"),
    createUser("cn1-recepcao"),
    createUser("cn1-profissional"),
    createUser("cn1-suporte"),
  ]);
  await Promise.all([
    addMember(clinicId, admin.id, ["admin"]),
    addMember(clinicId, reception.id, ["reception"]),
    addMember(clinicId, professional.id, ["professional"]),
    addMember(noFeatureClinicId, admin.id, ["admin"]),
    makePlatformStaff(support.id),
  ]);
  const base = { clinic_id: clinicId, contact_phone: PHONE };
  const { error } = await db()
    .from("whatsapp_messages")
    .insert([
      { ...base, direction: "inbound", message_type: "text", body: "Oi, quero falar com a recepção", status: "received", created_at: "2026-11-05T12:00:00Z" },
      { ...base, direction: "outbound", message_type: "bot_reception_offer", body: "Já chamo a recepção.", status: "sent", created_at: "2026-11-05T12:00:05Z" },
      { ...base, direction: "outbound", message_type: "appointment_reminder", template_name: "lembrete", status: "delivered", created_at: "2026-11-05T12:01:00Z" },
      { ...base, direction: "outbound", message_type: "agent_reply", body: "Bom dia! Como posso ajudar?", status: "sent", created_at: "2026-11-05T12:02:00Z" },
      // Histórico importado: chega depois, com a hora original.
      { ...base, direction: "inbound", message_type: "text", body: "Mensagem antiga", status: "received", source: "history", wa_timestamp: "2026-10-01T09:00:00Z", created_at: "2026-11-05T12:04:00Z" },
      { ...base, direction: "inbound", message_type: "text", body: "apagada", status: "received", revoked_at: "2026-11-05T12:03:00Z", created_at: "2026-11-05T12:03:00Z" },
    ]);
  if (error) throw error;
  await db().from("conversation_state").insert([
    { clinic_id: clinicId, contact_phone: PHONE, human_handoff: true, handoff_status: "waiting_clinic", handoff_id: crypto.randomUUID() },
    { clinic_id: clinicId, contact_phone: OTHER_PHONE, human_handoff: false },
  ]);
});

afterAll(async () => {
  await deleteClinics([clinicId, noFeatureClinicId]);
  await deleteUsers([admin, reception, professional, support]);
});

describe("ligar e desligar a Central", () => {
  it("só o Administrador liga; exige o item da matriz; cada troca fica registrada", async () => {
    expect(await getCentralSwitch(asDb(admin.client), clinicId)).toEqual({ enabled: false, at: null });
    expect(await codeOf(() => setCentralEnabled(asDb(reception.client), clinicId, true))).toBe("forbidden");
    expect(await codeOf(() => setCentralEnabled(asDb(admin.client), noFeatureClinicId, true))).toBe("not_enabled");
    expect(await setCentralEnabled(asDb(admin.client), clinicId, true)).toBe(true);
    expect(await setCentralEnabled(asDb(admin.client), clinicId, true)).toBe(false);
    expect(await getCentralSwitch(asDb(admin.client), clinicId)).toMatchObject({ enabled: true });
    const { data } = await admin.client.from("central_switches").select("enabled, actor_id").eq("clinic_id", clinicId);
    expect(data).toEqual([{ enabled: true, actor_id: admin.id }]);
    expect((await reception.client.from("central_switches").select("id").eq("clinic_id", clinicId)).data).toEqual([]);
    const direct = await admin.client.from("central_switches").insert({ clinic_id: clinicId, enabled: false });
    expect(direct.error).not.toBeNull();
  });
});

describe("mensagens", () => {
  it("autor pelo tipo, ordem pela hora da Meta e o tipo do app automático muda o autor", async () => {
    const { data } = await db().from("whatsapp_messages").select("id, message_type, author, sort_at, created_at, source").eq("clinic_id", clinicId).order("sort_at");
    expect(data!.map((m) => [m.message_type, m.author, m.source])).toEqual([
      ["text", "patient", "history"],
      ["text", "patient", "live"],
      ["bot_reception_offer", "bot", "live"],
      ["appointment_reminder", "system", "live"],
      ["agent_reply", "agent_app", "live"],
      ["text", "patient", "live"],
    ]);
    expect(new Date(data![0].sort_at).toISOString()).toBe("2026-10-01T09:00:00.000Z");
    const echo = data!.find((m) => m.message_type === "agent_reply")!;
    await db().from("whatsapp_messages").update({ message_type: "app_auto_reply" }).eq("id", echo.id);
    expect((await db().from("whatsapp_messages").select("author").eq("id", echo.id).single()).data!.author).toBe("system");
    await db().from("whatsapp_messages").update({ message_type: "agent_reply" }).eq("id", echo.id);
  });

  it("o login não lê o texto nem a prévia pela API", async () => {
    expect((await reception.client.from("whatsapp_messages").select("body").eq("clinic_id", clinicId)).error).not.toBeNull();
    expect((await reception.client.from("conversation_state").select("last_message_preview").eq("clinic_id", clinicId)).error).not.toBeNull();
    const { data, error } = await reception.client.from("conversation_state").select("contact_phone, assigned_to, last_message_at").eq("clinic_id", clinicId);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });
});

describe("responsável e eventos", () => {
  it("assumir, transferir, liberar e finalizar viram eventos; de volta ao bot o responsável sai", async () => {
    await db().from("conversation_state").update({ assigned_to: reception.id, handoff_changed_by: "reception" }).eq("clinic_id", clinicId).eq("contact_phone", PHONE);
    expect((await state(PHONE)).data).toMatchObject({ assigned_to: reception.id, assigned_at: expect.any(String) });
    await db().from("conversation_state").update({ assigned_to: professional.id }).eq("clinic_id", clinicId).eq("contact_phone", PHONE);
    await db().from("conversation_state").update({ assigned_to: null, handoff_changed_by: "system" }).eq("clinic_id", clinicId).eq("contact_phone", PHONE);
    await db().from("conversation_state").update({ assigned_to: professional.id, handoff_status: "in_progress", handoff_status_at: new Date().toISOString() }).eq("clinic_id", clinicId).eq("contact_phone", PHONE);
    expect((await events(PHONE)).map((e) => [e.kind, e.from_status, e.to_status, e.assigned_from, e.assigned_to])).toEqual([
      ["status", "bot", "waiting_clinic", null, null],
      ["assigned", "waiting_clinic", "waiting_clinic", null, reception.id],
      ["transferred", "waiting_clinic", "waiting_clinic", reception.id, professional.id],
      ["released", "waiting_clinic", "waiting_clinic", professional.id, null],
      ["status", "waiting_clinic", "in_progress", null, professional.id],
    ]);
  });
});

describe("leitura da conversa", () => {
  it("Profissional só com a conversa dele; Recepção e Suporte sempre; registra a abertura e marca como lida", async () => {
    const page = await listConversationMessages(asDb(professional.client), clinicId, PHONE, { limit: 3 });
    expect(page.messages.map((m) => m.body)).toEqual([null, "Bom dia! Como posso ajudar?", null]);
    expect(page.messages[0].revokedAt).not.toBeNull();
    expect(page.next).not.toBeNull();
    const rest = await listConversationMessages(asDb(professional.client), clinicId, PHONE, { before: page.next!, limit: 10 });
    expect(rest.messages.map((m) => m.body)).toEqual(["Já chamo a recepção.", "Oi, quero falar com a recepção", "Mensagem antiga"]);
    expect(rest.next).toBeNull();

    await listConversationMessages(asDb(reception.client), clinicId, PHONE);
    await listConversationMessages(asDb(support.client), clinicId, PHONE);
    expect(await codeOf(() => listConversationMessages(asDb(professional.client), clinicId, OTHER_PHONE))).toBe("forbidden");
    expect(await codeOf(() => listConversationMessages(asDb(reception.client), clinicId, OTHER_PHONE))).toBe("ok");

    const { data: log } = await admin.client.from("conversation_access_log").select("user_id, action").eq("clinic_id", clinicId).eq("contact_phone", PHONE).order("id");
    expect(log).toEqual([
      { user_id: professional.id, action: "open" },
      { user_id: reception.id, action: "open" },
      { user_id: support.id, action: "open" },
    ]);
    expect((await reception.client.from("conversation_access_log").select("id").eq("clinic_id", clinicId)).data).toEqual([]);
    // Não lidas por pessoa: cada um vê só a própria linha; o Suporte não marca.
    expect((await reception.client.from("conversation_reads").select("user_id").eq("clinic_id", clinicId)).data).toEqual(
      expect.arrayContaining([{ user_id: reception.id }]),
    );
    expect((await reception.client.from("conversation_reads").select("user_id").eq("clinic_id", clinicId).eq("user_id", professional.id)).data).toEqual([]);
    expect((await db().from("conversation_reads").select("user_id").eq("clinic_id", clinicId).eq("user_id", support.id)).data).toEqual([]);

    // Finalizada, o Profissional deixa de ver (inclusive o histórico).
    await db().from("conversation_state").update({ human_handoff: false, handoff_status: null }).eq("clinic_id", clinicId).eq("contact_phone", PHONE);
    expect((await state(PHONE)).data).toMatchObject({ assigned_to: null, assigned_at: null });
    expect((await events(PHONE)).at(-1)).toMatchObject({ kind: "finished", to_status: "bot", assigned_from: professional.id, assigned_to: null });
    expect(await codeOf(() => listConversationMessages(asDb(professional.client), clinicId, PHONE))).toBe("forbidden");
  });

  it("anexo: só pela função, com registro; o login não lê whatsapp_media nem o bucket", async () => {
    const service = clinicServiceClient(clinicId);
    const { data: media, error } = await service
      .from("whatsapp_media")
      .insert({ clinic_id: clinicId, direction: "inbound", mime_type: "application/pdf", file_name: "exame.pdf", status: "stored", storage_path: `${clinicId}/5584977770001/x.pdf` })
      .select("id")
      .single();
    expect(error).toBeNull();
    await db().from("whatsapp_messages").insert({ clinic_id: clinicId, contact_phone: PHONE, direction: "inbound", message_type: "document", status: "received", media_id: media!.id });
    expect((await reception.client.from("whatsapp_media").select("id")).data ?? []).toEqual([]);
    const { data: access } = await reception.client.rpc("central_media_access", { p_clinic_id: clinicId, p_media_id: media!.id });
    expect(access).toEqual([{ storage_path: `${clinicId}/5584977770001/x.pdf`, mime_type: "application/pdf", file_name: "exame.pdf", size_bytes: null }]);
    expect((await professional.client.rpc("central_media_access", { p_clinic_id: clinicId, p_media_id: media!.id })).error).not.toBeNull();
    const { data: log } = await admin.client.from("conversation_access_log").select("action, media_id").eq("clinic_id", clinicId).eq("action", "media");
    expect(log).toEqual([{ action: "media", media_id: media!.id }]);
  });

  it("Central desligada: ninguém lê o histórico", async () => {
    expect(await setCentralEnabled(asDb(admin.client), clinicId, false)).toBe(true);
    expect(await codeOf(() => listConversationMessages(asDb(reception.client), clinicId, OTHER_PHONE))).toBe("not_enabled");
    await setCentralEnabled(asDb(admin.client), clinicId, true);
  });
});
