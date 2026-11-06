import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { setCentralEnabled } from "../../src/lib/data/central";
import { releaseIdleConversations, resumeFromCentral, retryFromCentral, type SendDeps } from "../../src/lib/data/centralSend";
import type { SendOutcome } from "../../src/lib/data/whatsapp/messages";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";

// CN4b — "Retomar conversa" fora das 24 h (decisão 7, texto aprovado em 05/nov) e a liberação em 30 min no horário
// da clínica (decisão 5 e R1).

const OLD = "+5584944440001";
const FAILS = "+5584944440002";
const IDLE = "+5584944440003";
const RECENT = "+5584944440004";
const TZ = "America/Fortaleza";
let clinicId: string;
let admin: TestUser;
let reception: TestUser;
const asDb = (user: TestUser) => user.client as unknown as DbClient;
const db = () => adminClient();
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const localDay = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toLocaleDateString("en-CA", { timeZone: TZ });

let templateOutcome: SendOutcome = { sent: true, messageId: "wamid.resume1" };
const templates: { to: string; params: string[] }[] = [];
const sender = {
  clinicLabel: "da Clínica CN4b",
  text: async () => ({ sent: true, messageId: "wamid.text" }),
  template: async (to: string, _key: string, _template: unknown, params: string[]) => {
    templates.push({ to, params });
    return templateOutcome;
  },
  resend: async () => ({ sent: true, messageId: "wamid.resend" }),
} as unknown as ClinicSender;
const deps = (user: TestUser): SendDeps => ({ db: asDb(user), serviceDb: clinicServiceClient(clinicId) as unknown as DbClient, sender });
const service = () => clinicServiceClient(clinicId) as unknown as DbClient;
const input = (phone: string) => ({ phone, clientKey: crypto.randomUUID(), expectedAssigned: null });
const stateOf = async (phone: string) =>
  (await db().from("conversation_state").select("handoff_status, assigned_to").eq("clinic_id", clinicId).eq("contact_phone", phone).single()).data!;

beforeAll(async () => {
  clinicId = await createClinic("Clínica CN4b");
  [admin, reception] = await Promise.all([createUser("cn4b-admin"), createUser("cn4b-recepcao")]);
  await Promise.all([addMember(clinicId, admin.id, ["admin"]), addMember(clinicId, reception.id, ["reception"])]);
  await setCentralEnabled(asDb(admin), clinicId, true);
  await db().from("clinic_settings").update({ timezone: TZ }).eq("clinic_id", clinicId);
  await db().from("whatsapp_templates").insert({ clinic_id: clinicId, template_key: "conversation_resume", name: "rc_retomar_conversa_v1", status: "approved" });
  const inbound = (phone: string, minutesAgo: number) => ({
    clinic_id: clinicId,
    contact_phone: phone,
    direction: "inbound",
    message_type: "text",
    body: "Oi",
    status: "received",
    created_at: at(minutesAgo),
  });
  await db().from("whatsapp_messages").insert([inbound(OLD, 25 * 60), inbound(FAILS, 26 * 60), inbound(IDLE, 40), inbound(RECENT, 20)]);
  await db().from("conversation_state").insert([
    { clinic_id: clinicId, contact_phone: OLD, human_handoff: true, handoff_status: "waiting_clinic", handoff_status_at: at(25 * 60) },
    { clinic_id: clinicId, contact_phone: FAILS, human_handoff: true, handoff_status: "waiting_clinic", handoff_status_at: at(26 * 60) },
    {
      clinic_id: clinicId,
      contact_phone: IDLE,
      human_handoff: true,
      handoff_status: "waiting_clinic",
      handoff_status_at: at(40),
      assigned_to: reception.id,
      assigned_at: at(45),
    },
    {
      clinic_id: clinicId,
      contact_phone: RECENT,
      human_handoff: true,
      handoff_status: "waiting_clinic",
      handoff_status_at: at(20),
      assigned_to: reception.id,
      assigned_at: at(50),
    },
  ]);
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers([admin, reception]);
});

describe("Retomar conversa", () => {
  it("fora das 24 h: o modelo sai (sem variáveis); quem retoma assume", async () => {
    expect(await resumeFromCentral(deps(reception), clinicId, input(OLD))).toEqual({ kind: "sent" });
    expect(templates.at(-1)).toEqual({ to: OLD, params: [] });
    const { data } = await db().from("whatsapp_messages").select("message_type, author, sent_by, template_name, status, body").eq("clinic_id", clinicId).eq("contact_phone", OLD).eq("direction", "outbound").single();
    expect(data).toMatchObject({ message_type: "conversation_resume", author: "agent_panel", sent_by: reception.id, template_name: "rc_retomar_conversa_v1", status: "sent" });
    expect(data!.body).toBe("Olá! Vi que a nossa conversa ficou pendente. Quer continuar de onde paramos?");
    expect(await stateOf(OLD)).toEqual({ handoff_status: "in_progress", assigned_to: reception.id });
  });

  it("um por vez: sem resposta do paciente, não sai outro; com a resposta, é texto", async () => {
    const before = templates.length;
    expect(await resumeFromCentral(deps(reception), clinicId, input(OLD))).toEqual({ kind: "pending" });
    expect(templates.length).toBe(before);
    await db().from("whatsapp_messages").insert({ clinic_id: clinicId, contact_phone: OLD, direction: "inbound", message_type: "text", body: "Oi!", status: "received" });
    expect(await resumeFromCentral(deps(reception), clinicId, input(OLD))).toEqual({ kind: "window_open" });
  });

  it("não saiu: Tentar de novo reenvia o mesmo pedido à Meta", async () => {
    templateOutcome = { sent: false, reason: "falha", request: { to: "5584944440002", type: "template" } };
    expect((await resumeFromCentral(deps(admin), clinicId, input(FAILS))).kind).toBe("failed");
    const { data } = await db().from("whatsapp_messages").select("id, status").eq("clinic_id", clinicId).eq("contact_phone", FAILS).eq("direction", "outbound").single();
    expect(data!.status).toBe("failed");
    expect(await retryFromCentral(deps(admin), clinicId, data!.id)).toEqual({ kind: "sent" });
    const after = await db().from("whatsapp_messages").select("status, wa_message_id").eq("id", data!.id).single();
    expect(after.data).toEqual({ status: "sent", wa_message_id: "wamid.resend" });
  });
});

describe("liberação em 30 min", () => {
  beforeAll(async () => {
    // Agenda aberta o dia todo, todos os dias.
    const { data: agenda } = await db().from("agendas").insert({ clinic_id: clinicId, name: "Sala 1", kind: "resource" }).select("id").single();
    const { data: location } = await db().from("locations").insert({ clinic_id: clinicId, name: "Consultório", type: "clinic" }).select("id").single();
    await db()
      .from("availability_windows")
      .insert([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ clinic_id: clinicId, agenda_id: agenda!.id, location_id: location!.id, weekday, start_time: "00:00", end_time: "23:59" })));
  });

  it("só a rotina da clínica libera", async () => {
    const { error } = await reception.client.rpc("central_release_idle", { p_clinic_id: clinicId });
    expect(error).not.toBeNull();
  });

  it("feriado não conta: ninguém é liberado", async () => {
    await db().from("clinic_holidays").insert([...new Set([localDay(0), localDay(60)])].map((date) => ({ clinic_id: clinicId, date, description: "Feriado" })));
    expect(await releaseIdleConversations(service(), clinicId)).toBe(0);
    await db().from("clinic_holidays").delete().eq("clinic_id", clinicId);
  });

  it("paciente esperando 30 min no horário da clínica: volta para Sem responsável, com o evento", async () => {
    expect(await releaseIdleConversations(service(), clinicId)).toBe(1);
    expect((await stateOf(IDLE)).assigned_to).toBeNull();
    expect((await stateOf(RECENT)).assigned_to).toBe(reception.id);
    const { data } = await db().from("handoff_events").select("kind, assigned_from, origin").eq("clinic_id", clinicId).eq("contact_phone", IDLE).eq("kind", "released").single();
    expect(data).toEqual({ kind: "released", assigned_from: reception.id, origin: "system" });
  });
});
