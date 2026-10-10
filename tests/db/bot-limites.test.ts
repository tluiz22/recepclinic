import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { updateClinicSettings } from "../../src/lib/data/config/clinic";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { listContactLimitEvents, listContactsToReview } from "../../src/lib/data/whatsapp/botLimits";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, at, codeOf, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient, clinicServiceClient, createClinic, deleteClinics } from "./helpers";

// F9.6a — Limites do bot por contato: atendimentos futuros (com os links
// ainda válidos), cadastros pelo bot em 30 dias e faltas em 90 dias. Conversas
// inteiras pelo webhook, com a Meta simulada. Sem coexistência o bot avisa e
// não pausa; com ela, passa a conversa para a recepção.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "f96-numero";
const PHONE = "+5584991229699";
const NEUTRAL_HANDOFF = "Para esse agendamento, vou passar sua conversa para a recepção, que responde por aqui assim que possível.";
const NEUTRAL_NO_RECEPTION = "Para esse agendamento, a recepção vai entrar em contato com você.";
const MAIN_MENU = ["1. Consultas", "2. Exames", "3. Informações"];

type Sent = { to: string; kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string }[] };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Bot F96",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body, options: [] }), { sent: true, messageId: `wamid.f96.out.${++seq}`, body }),
  list: async (to: string, body: string, _button: string, sections: ListSection[]) => (
    sent.push({ to, kind: "list", body, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }),
    { sent: true, messageId: `wamid.f96.out.${++seq}` }
  ),
  buttons: async (to: string, body: string, buttons: ReplyButton[]) => (
    sent.push({ to, kind: "buttons", body, options: buttons }),
    { sent: true, messageId: `wamid.f96.out.${++seq}` }
  ),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

async function say(input: string | { id: string }): Promise<Sent[]> {
  sent = [];
  const message =
    typeof input === "string"
      ? { id: `wamid.f96.in.${++seq}`, from: PHONE.slice(1), type: "text", text: { body: input } }
      : { id: `wamid.f96.in.${++seq}`, from: PHONE.slice(1), type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } };
  const summary = await processWebhook(
    { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [message] } }] }] },
    deps(),
    new Date(),
  );
  expect(summary.errors).toBe(0);
  return sent;
}

const titles = (reply: Sent[]) => reply.at(-1)!.options.map((o) => o.title);

/** Menu › Consultas › Marcar consulta: devolve a resposta do bot ao "Marcar consulta". */
async function startConsultation(): Promise<Sent[]> {
  await say("oi");
  await say("1");
  return say("1");
}

/** Do "Marcar consulta" até o "para outra pessoa" (Dr. Segundo: só consultório). */
async function upToForOther(): Promise<Sent[]> {
  const reply = await startConsultation();
  expect(reply.at(-1)!.body).toBe("Qual consulta você quer marcar?");
  const agendas = await say("1");
  await say({ id: agendas.at(-1)!.options.find((o) => o.title.includes("Dr. Segundo"))!.id });
  return say({ id: "for_other" });
}

async function setLimits(values: { bot_max_future_appointments?: number; bot_max_new_patients?: number; bot_max_no_shows?: number }) {
  await adminClient().from("clinic_settings").update(values).eq("clinic_id", f.clinicId);
}

async function contactId(): Promise<string> {
  const { data } = await adminClient().from("contacts").select("id").eq("clinic_id", f.clinicId).eq("phone", PHONE).single();
  return data!.id;
}

async function events() {
  const { data } = await adminClient()
    .from("bot_limit_events")
    .select("reason, limit_value, current_value, paused")
    .eq("clinic_id", f.clinicId)
    .order("id");
  return data!;
}

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Bot F96", "+55849912296");
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "f96-waba", status: "connected" });
  await setLimits({ bot_max_future_appointments: 2, bot_max_new_patients: 2, bot_max_no_shows: 0 });
});

afterAll(async () => f.cleanup());

describe("bot: limites do contato, sem coexistência", () => {
  it("dois cadastros pelo bot com link: os links ainda válidos contam como atendimentos", async () => {
    // Número novo: nome do contato, paciente, link.
    let reply = await upToForOther();
    expect(reply[0].body).toBe("Antes de continuar, qual é o seu nome completo?");
    await say("Rita Lima");
    await say("sim");
    await say("Ana Lima");
    await say("10/03/2015");
    reply = await say("sim");
    expect(reply[0].body).toContain("Prontinho!");

    // Contato conhecido: outra pessoa, pela data (não acha) e o nome.
    reply = await upToForOther();
    expect(reply[0].body).toBe("Qual a data de nascimento do paciente? (formato dd/mm/aaaa)");
    reply = await say("11/04/2016");
    expect(reply[0].body).toBe("Qual é o nome completo do paciente?");
    await say("Bia Lima");
    reply = await say("sim");
    expect(reply[0].body).toContain("Prontinho!");

    const { data: patients } = await adminClient().from("patients").select("full_name, created_via").eq("contact_id", await contactId()).order("full_name");
    expect(patients).toEqual([
      { full_name: "Ana Lima", created_via: "whatsapp" },
      { full_name: "Bia Lima", created_via: "whatsapp" },
    ]);
  });

  it("limite de atendimentos: avisa neutro, não pausa e volta ao menu", async () => {
    const reply = await startConsultation();
    expect(reply[0]).toMatchObject({ kind: "text", body: NEUTRAL_NO_RECEPTION });
    expect(titles(reply)).toEqual(MAIN_MENU);
    const { data: convo } = await adminClient().from("conversation_state").select("state, human_handoff").eq("clinic_id", f.clinicId).eq("contact_phone", PHONE).single();
    expect(convo).toEqual({ state: "MENU", human_handoff: false });
    expect(await events()).toEqual([{ reason: "future_appointments", limit_value: 2, current_value: 2, paused: false }]);

    const { data: blocked } = await adminClient()
      .from("bot_funnel_events")
      .select("metadata")
      .eq("clinic_id", f.clinicId)
      .eq("contact_phone", PHONE)
      .eq("step", "blocked")
      .single();
    expect(blocked!.metadata).toEqual({ reason: "limit_future_appointments" });
  });

  it("cancelar segue pelo bot com o limite atingido", async () => {
    await say("oi");
    await say("1");
    const reply = await say("4"); // Cancelar
    expect(reply.at(-1)!.body).not.toBe(NEUTRAL_NO_RECEPTION);
    expect(await events()).toHaveLength(1);
  });

  it("limite de cadastros: ao pedir para cadastrar outra pessoa", async () => {
    await setLimits({ bot_max_future_appointments: 10 });
    await upToForOther();
    const reply = await say("12/05/2017");
    expect(reply[0].body).toBe(NEUTRAL_NO_RECEPTION);
    expect((await events()).at(-1)).toEqual({ reason: "new_patients", limit_value: 2, current_value: 2, paused: false });
  });

  it("paciente já cadastrado continua: o limite de cadastros não barra", async () => {
    await upToForOther();
    const reply = await say("10/03/2015");
    expect(reply[0].body).toContain("*Ana Lima*");
    expect((await say("sim"))[0].body).toContain("Prontinho!");
  });

  it("faltas nos últimos 90 dias, somando os pacientes do contato; 0 desliga", async () => {
    const { data: ana } = await adminClient().from("patients").select("id").eq("contact_id", await contactId()).eq("full_name", "Ana Lima").single();
    const booked = await bookAppointment(
      asDb(f.reception),
      f.clinicId,
      { patientId: ana!.id, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra, start: at("2031-03-10", "09:00"), locationId: f.ids.office, channel: "admin", actorId: null },
      NOW,
    );
    await adminClient()
      .from("appointments")
      .update({ scheduled_at: new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString(), status: "no_show" })
      .eq("id", booked.appointment.id);

    // Desligado (0): marca normalmente.
    expect((await startConsultation()).at(-1)!.body).toBe("Qual consulta você quer marcar?");
    await say("0"); // volta ao menu

    await setLimits({ bot_max_no_shows: 1 });
    const reply = await startConsultation();
    expect(reply[0].body).toBe(NEUTRAL_NO_RECEPTION);
    expect((await events()).at(-1)).toEqual({ reason: "no_shows", limit_value: 1, current_value: 1, paused: false });
  });
});

describe("bot: limites do contato, com coexistência", () => {
  it("passa a conversa para a recepção (pausa) e o funil conta a pausa", async () => {
    await adminClient().from("whatsapp_connections").update({ coexistence: true }).eq("clinic_id", f.clinicId);
    const reply = await startConsultation();
    expect(reply).toHaveLength(1);
    expect(reply[0].body).toBe(NEUTRAL_HANDOFF);
    const { data: convo } = await adminClient().from("conversation_state").select("state, human_handoff").eq("clinic_id", f.clinicId).eq("contact_phone", PHONE).single();
    expect(convo).toEqual({ state: "HUMAN_HANDOFF", human_handoff: true });
    expect((await events()).at(-1)).toMatchObject({ reason: "no_shows", paused: true });
    const { count } = await adminClient()
      .from("bot_funnel_events")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", f.clinicId)
      .eq("flow", "handoff")
      .eq("step", "bot_limit");
    expect(count).toBe(1);

    // Pausado: o bot fica calado.
    expect(await say("oi")).toEqual([]);
  });
});

describe("limites: telas, Uso e acesso", () => {
  it("tela do contato e Painel (Contatos para revisar), pela equipe", async () => {
    const db = asDb(f.reception);
    const id = await contactId();
    const list = await listContactLimitEvents(db, f.clinicId, id);
    expect(list.map((e) => e.reason)).toEqual(["no_shows", "no_shows", "new_patients", "future_appointments"]);
    expect(list[0].paused).toBe(true);
    const review = await listContactsToReview(db, f.clinicId);
    expect(review).toEqual([expect.objectContaining({ contactId: id, name: "Rita Lima", hits: 4 })]);
    expect(review[0].last.reason).toBe("no_shows");
  });

  it("Uso: conta cada limite atingido no mês", async () => {
    const { data } = await adminClient().from("clinic_usage_monthly").select("bot_limit_hits").eq("clinic_id", f.clinicId);
    expect(data!.reduce((sum, row) => sum + row.bot_limit_hits, 0)).toBe(4);
  });

  it("a equipe não grava limites; outra clínica não lê", async () => {
    const { error } = await f.reception.client
      .from("bot_limit_events")
      .insert({ clinic_id: f.clinicId, contact_id: await contactId(), reason: "no_shows", limit_value: 1, current_value: 1, paused: false });
    expect(error).not.toBeNull();

    const other = await createClinic("Clínica Outra F96");
    try {
      const { data } = await clinicServiceClient(other).from("bot_limit_events").select("id").eq("clinic_id", f.clinicId);
      expect(data).toEqual([]);
    } finally {
      await deleteClinics([other]);
    }
  });

  it("Configurações › Clínica: faixas dos limites", async () => {
    const db = asDb(f.admin);
    expect(await codeOf(() => updateClinicSettings(db, f.clinicId, { botMaxFutureAppointments: 0 }))).toBe("invalid");
    expect(await codeOf(() => updateClinicSettings(db, f.clinicId, { botMaxNewPatients: 11 }))).toBe("invalid");
    expect(await codeOf(() => updateClinicSettings(db, f.clinicId, { botMaxNoShows: Number.NaN }))).toBe("invalid");
    const saved = await updateClinicSettings(db, f.clinicId, { botMaxFutureAppointments: 10, botMaxNewPatients: 1, botMaxNoShows: 0 });
    expect(saved).toMatchObject({ botMaxFutureAppointments: 10, botMaxNewPatients: 1, botMaxNoShows: 0 });
    // A recepção não altera a configuração (RLS).
    expect(await codeOf(() => updateClinicSettings(asDb(f.reception), f.clinicId, { botMaxNoShows: 3 }))).not.toBe("ok");
  });
});
