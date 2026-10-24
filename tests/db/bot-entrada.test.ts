import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import type { DbClient } from "../../src/lib/data/clients";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { registerPatient } from "../../src/lib/data/patients";
import { reminderButtonPayload } from "../../src/lib/data/whatsapp/reminders";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, at, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// Entrada da conversa com atendimento marcado no número (cliente, 23/out/2026):
// a pergunta antes do menu, a data de nascimento antes de qualquer detalhe e
// as ações do atendimento escolhido. Conversas pelo webhook com a Meta simulada.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "entrada-numero";
const NUMBER_B = "entrada-numero-b";
type Sent = { to: string; kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string }[] };

let f: AgendaFixture;
let g: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;
/** Simula a falha do Supabase na leitura dos atendimentos. */
let failAppointments = false;
/** Simula a Meta recusando listas (erro 131000). */
let failLists = false;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Bot Entrada",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body, options: [] }), { sent: true, messageId: `wamid.ent.out.${++seq}`, body }),
  list: async (to: string, body: string, _b: string, sections: ListSection[]) =>
    failLists ? { sent: false, reason: "(#131000) Something went wrong" } : (
    sent.push({ to, kind: "list", body, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }),
    { sent: true, messageId: `wamid.ent.out.${++seq}` }
  ),
  buttons: async (to: string, body: string, buttons: ReplyButton[]) => (
    sent.push({ to, kind: "buttons", body, options: buttons }),
    { sent: true, messageId: `wamid.ent.out.${++seq}` }
  ),
};

/** Qualquer encadeamento da consulta termina no erro. */
function failingQuery(): unknown {
  const result = Promise.resolve({ data: null, error: { message: "falha simulada", code: "XX000" }, count: null });
  const chain: object = new Proxy(() => chain, {
    get: (_target, prop) => (prop === "then" ? result.then.bind(result) : () => chain),
  });
  return chain;
}

function withFailures(db: DbClient): DbClient {
  return new Proxy(db, {
    get: (target, prop, receiver) =>
      prop === "from" ? (table: string) => (failAppointments && table === "appointments" ? failingQuery() : target.from(table as never)) : Reflect.get(target, prop, receiver),
  });
}

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => withFailures(createClinicServiceClient(clinicId, env())),
  senderFor: async () => sender,
});

async function send(number: string, message: Record<string, unknown>) {
  return processWebhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: number }, messages: [message] } }] }] }, deps(), new Date());
}

/** O paciente digita, toca numa opção (`{ id }`) ou num botão de template (`{ payload }`). */
async function say(phone: string, input: string | { id: string } | { payload: string }, number = NUMBER): Promise<Sent[]> {
  sent = [];
  const id = `wamid.ent.in.${++seq}`;
  const from = phone.slice(1);
  const message =
    typeof input === "string"
      ? { id, from, type: "text", text: { body: input } }
      : "payload" in input
        ? { id, from, type: "button", button: { payload: input.payload, text: "botão" } }
        : { id, from, type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } };
  const summary = await send(number, message);
  expect(summary.errors).toBe(0);
  return sent;
}

const titles = (reply: Sent[]) => reply.at(-1)!.options.map((o) => o.title);
const bodies = (reply: Sent[]) => reply.map((m) => m.body).join("\n");

async function conversation(phone: string, clinicId = f.clinicId) {
  const { data } = await adminClient().from("conversation_state").select("state, human_handoff").eq("clinic_id", clinicId).eq("contact_phone", phone).single();
  return data!;
}

const fresh = (phone: string) =>
  adminClient().from("conversation_state").update({ state: "WELCOME", context: {}, human_handoff: false }).eq("clinic_id", f.clinicId).eq("contact_phone", phone);

const WELCOME = "Olá! 👋 Aqui é da Clínica Bot Entrada.";
const MENU = "Como podemos ajudar? Escolha uma opção abaixo (ou digite o número).";
const ASK_ONE = "Como podemos ajudar? Identificamos um agendamento associado a este número. Você deseja tratar desse agendamento?";
const ASK_MANY = "Como podemos ajudar? Encontramos mais de um agendamento associado a este número. Você deseja consultar ou alterar algum deles?";
const ASK_BIRTHDATE = "Para sua segurança, antes de mostrar o agendamento precisamos confirmar a identidade.\n\nQual a data de nascimento do paciente? (formato dd/mm/aaaa)";
const RETRY = "Não foi possível confirmar a identidade com essa data. Confira e envie de novo (ex.: 15/03/2018).";
const FAILED = "Não foi possível confirmar a identidade com essa data.";

const P1 = "+5584991226501"; // Paciente Um e Paciente Quatro (irmão): vários atendimentos
const P2 = "+5584991226502"; // Paciente Dois: um atendimento
const P3 = "+5584991226503"; // Paciente Três: só passado, cancelado e realizado
const P5 = "+5584991226505"; // Paciente Cinco: tentativas erradas
const STRANGER = "+5584991226599";

let consultP1: string;
let examP1: string;
let consultP4: string;
let consultP2: string;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Bot Entrada", "+55849912265");
  g = await setupAgendaClinic("Clínica Bot Entrada B", "+55849912265");
  await adminClient().from("whatsapp_connections").insert([
    { clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "entrada-waba", status: "connected" },
    { clinic_id: g.clinicId, phone_number_id: NUMBER_B, waba_id: "entrada-waba-b", status: "connected" },
  ]);
  const a = asDb(f.reception);
  const { data: contact } = await adminClient().from("patients").select("contact_id").eq("id", f.ids.p1).single();
  const sibling = await registerPatient(a, f.clinicId, { fullName: "Paciente Quatro", birthdate: "2018-05-05", contact: { mode: "existing", contactId: contact!.contact_id } }, "2031-03-09");
  const p5 = await registerPatient(a, f.clinicId, { fullName: "Paciente Cinco", birthdate: "2015-07-07", contact: { mode: "new", fullName: "Resp. Cinco", phone: P5 } }, "2031-03-09");
  if (sibling.status !== "created" || p5.status !== "created") throw new Error("cadastro");

  const book = async (patientId: string, serviceId: string, agendaId: string, date: string, time: string) =>
    (await bookAppointment(a, f.clinicId, { patientId, serviceId, agendaId, start: at(date, time), locationId: f.ids.office, channel: "admin", actorId: null }, NOW)).appointment.id;
  consultP1 = await book(f.ids.p1, f.ids.consulta, f.ids.agendaDra, MON1, "08:00");
  examP1 = await book(f.ids.p1, f.ids.exame, f.ids.agendaExams, MON2, "08:00");
  consultP4 = await book(sibling.patient.id, f.ids.consulta, f.ids.agendaDra, MON1, "09:00");
  consultP2 = await book(f.ids.p2, f.ids.consulta, f.ids.agendaDra2, MON1, "08:00");
  await book(p5.patient.id, f.ids.consulta, f.ids.agendaDra, MON1, "10:00");
  await adminClient().from("appointments").update({ reminder_sent_at: new Date().toISOString() }).in("id", [consultP2]);

  // Paciente Três: nada relevante (já passou, cancelado, realizado).
  const base = { clinic_id: f.clinicId, patient_id: f.ids.p3, service_id: f.ids.consulta, agenda_id: f.ids.agendaDra2, location_id: f.ids.office, duration_minutes: 30, booking_channel: "admin" as const };
  const { error } = await adminClient()
    .from("appointments")
    .insert([
      { ...base, scheduled_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), status: "scheduled" as const },
      { ...base, scheduled_at: at("2031-03-24", "08:00").toISOString(), status: "canceled" as const },
      { ...base, scheduled_at: new Date(Date.now() - 86_400_000).toISOString(), status: "completed" as const },
    ]);
  if (error) throw error;
});

afterAll(async () => {
  await f.cleanup();
  await g.cleanup();
});

describe("sem atendimento relevante", () => {
  it("1. número sem atendimento (ou sem cadastro): o menu direto, sem pedir a data de nascimento", async () => {
    const reply = await say(STRANGER, "oi");
    expect(reply.map((m) => m.body)).toEqual([WELCOME, MENU]);
    expect(titles(reply)).toContain("1. Consultas");
    expect((await conversation(STRANGER)).state).toBe("MENU");
  });

  it("10. passado, cancelado e realizado não contam: o menu direto", async () => {
    const reply = await say(P3, "oi");
    expect(reply.map((m) => m.body)).toEqual([WELCOME, MENU]);
  });
});

describe("um atendimento", () => {
  it("2 e 3. pergunta sem detalhes; \"Não, outro assunto\" leva ao menu", async () => {
    let reply = await say(P2, "oi");
    expect(reply.map((m) => m.body)).toEqual([WELCOME, ASK_ONE]);
    expect(titles(reply)).toEqual(["Sim, quero", "Não, outro assunto"]);
    expect(bodies(reply)).not.toMatch(/Paciente|10\/03/);
    reply = await say(P2, { id: "entry_no" });
    expect(reply.map((m) => m.body)).toEqual([MENU]);
    expect((await conversation(P2)).state).toBe("MENU");
  });

  it("4 e 5. \"Sim, quero\" pede a data; com a data certa, o atendimento e só as ações permitidas", async () => {
    await fresh(P2);
    await say(P2, "oi");
    let reply = await say(P2, { id: "entry_yes" });
    expect(reply.map((m) => m.body)).toEqual([ASK_BIRTHDATE]);
    reply = await say(P2, "01/01/2020");
    expect(reply[0].body).toBe("A consulta de *Paciente Dois* está marcada para segunda, 10/03 às 08:00.\n\nO que você deseja fazer?");
    // Sem coexistência, sem "Falar com a recepção".
    expect(titles(reply)).toEqual(["1. Confirmar presença", "2. Remarcar", "3. Cancelar", "4. Encaixe ou antecipar", "5. Voltar ao menu"]);
    reply = await say(P2, { id: "entry_confirm" });
    expect(reply[0].body).toContain("Presença confirmada ✓");
    // Já confirmada: some a opção e o detalhe avisa.
    await say(P2, "oi");
    await say(P2, "sim");
    reply = await say(P2, "01/01/2020");
    expect(reply[0].body).toContain("Presença confirmada ✓");
    expect(titles(reply)).not.toContain("1. Confirmar presença");
    expect((await adminClient().from("appointments").select("patient_confirmed_at").eq("id", consultP2).single()).data!.patient_confirmed_at).not.toBeNull();
    await say(P2, "menu");
  });

  it("6. data errada: não revela nada; pede de novo uma vez e, na segunda, o menu", async () => {
    await fresh(P2);
    await say(P2, "oi");
    await say(P2, { id: "entry_yes" });
    let reply = await say(P2, "02/02/2002");
    expect(reply.map((m) => m.body)).toEqual([RETRY]);
    reply = await say(P2, "03/03/2003");
    expect(reply.map((m) => m.body)).toEqual([FAILED, MENU]);
    expect(bodies(reply)).not.toMatch(/Paciente|10\/03|Consulta de/);
    expect((await conversation(P2)).state).toBe("MENU");
  });

  it("6b. 4 datas erradas no número em 24h: a pergunta deixa de aparecer (contra tentativa e erro)", async () => {
    for (let round = 0; round < 2; round++) {
      await fresh(P5);
      expect((await say(P5, "oi")).at(-1)!.body).toBe(ASK_ONE);
      await say(P5, { id: "entry_yes" });
      await say(P5, "02/02/2002");
      await say(P5, "03/03/2003");
    }
    await fresh(P5);
    expect((await say(P5, "oi")).map((m) => m.body)).toEqual([WELCOME, MENU]);
  });
});

describe("vários atendimentos", () => {
  it("7 e 8. pergunta sem detalhes; \"Não, outro assunto\" leva ao menu", async () => {
    let reply = await say(P1, "oi");
    expect(reply.map((m) => m.body)).toEqual([WELCOME, ASK_MANY]);
    expect(titles(reply)).toEqual(["Sim, consultar", "Não, outro assunto"]);
    reply = await say(P1, "2");
    expect(reply.map((m) => m.body)).toEqual([MENU]);
  });

  it("9. \"Sim\" pede a data antes da lista; a lista mostra só os atendimentos do paciente validado", async () => {
    await fresh(P1);
    await say(P1, "oi");
    let reply = await say(P1, { id: "entry_yes" });
    expect(reply.map((m) => m.body)).toEqual([ASK_BIRTHDATE]);
    reply = await say(P1, "01/01/2020");
    expect(reply[0]).toMatchObject({ kind: "list", body: "Qual agendamento você quer consultar ou alterar?" });
    expect(titles(reply)).toEqual(["1. seg, 10/03 às 08:00", "2. seg, 17/03 às 08:00", "3. Voltar ao menu"]);
    expect(reply[0].options.map((o) => o.id)).not.toContain(`entry_appointment_${consultP4}`);
    reply = await say(P1, { id: `entry_appointment_${examP1}` });
    expect(reply[0].body).toBe("O exame Exame de *Paciente Um* está marcado para segunda, 17/03 às 08:00.\n\nO que você deseja fazer?");
    reply = await say(P1, { id: "entry_reschedule" });
    expect(reply[0].body).toMatch(/^Prontinho! Escolha o novo dia e horário para o exame Exame de Paciente Um neste link:\nhttps:\/\/app\.exemplo\.test\/agendar\//);
    expect((await conversation(P1)).state).toBe("WELCOME");
  });

  it("9b. a data do irmão leva direto ao único atendimento dele", async () => {
    await say(P1, "oi");
    await say(P1, { id: "entry_yes" });
    const reply = await say(P1, "05/05/2018");
    expect(reply[0].body).toBe("A consulta de *Paciente Quatro* está marcada para segunda, 10/03 às 09:00.\n\nO que você deseja fazer?");
    await say(P1, "0");
  });

  it("confirmar presença sem lembrete enviado: confirma e não conta como resposta ao lembrete", async () => {
    await fresh(P1);
    await say(P1, "oi");
    await say(P1, "sim");
    await say(P1, "01/01/2020");
    await say(P1, { id: `entry_appointment_${consultP1}` });
    const reply = await say(P1, { id: "entry_confirm" });
    expect(reply[0].body).toBe("Presença confirmada ✓\n\n👤 Paciente: Paciente Um\n📅 segunda, 10/03 às 08:00\n\nObrigado! Qualquer dúvida, é só chamar por aqui.");
    const { data } = await adminClient().from("appointments").select("patient_confirmed_at, reminder_sent_at, reminder_response").eq("id", consultP1).single();
    expect(data).toMatchObject({ reminder_sent_at: null, reminder_response: null });
    expect(data!.patient_confirmed_at).not.toBeNull();
    const { data: trail } = await adminClient().from("appointment_events").select("event_type, channel").eq("appointment_id", consultP1).eq("event_type", "presence_confirmed");
    expect(trail).toEqual([{ event_type: "presence_confirmed", channel: "whatsapp_bot" }]);
    await adminClient().from("appointments").update({ patient_confirmed_at: null }).eq("id", consultP1);
  });

  it("cancelar pela entrada: confirma e cancela pelo fluxo de sempre", async () => {
    await fresh(P1);
    await say(P1, "oi");
    await say(P1, { id: "entry_yes" });
    await say(P1, "05/05/2018");
    let reply = await say(P1, { id: "entry_cancel" });
    expect(reply[0].body).toBe("Confirma o cancelamento da consulta de *Paciente Quatro* em segunda, 10/03 às 09:00? Responda Sim ou Não.");
    reply = await say(P1, "sim");
    expect(reply[0].body).toContain("Prontinho, cancelamos a consulta de Paciente Quatro");
    expect((await adminClient().from("appointments").select("status, canceled_via").eq("id", consultP4).single()).data).toEqual({ status: "canceled", canceled_via: "whatsapp_bot" });
  });
});

describe("robustez", () => {
  it("11. resposta inválida em cada passo: orienta e continua no mesmo passo", async () => {
    await fresh(P1);
    await say(P1, "oi");
    let reply = await say(P1, "talvez");
    expect(reply.map((m) => m.body)).toEqual(["Não entendi 🙏 Toque em uma das opções abaixo.", ASK_MANY]);
    expect((await conversation(P1)).state).toBe("ENTRY_ASK");
    await say(P1, "sim");
    reply = await say(P1, "ontem");
    expect(reply[0].body).toBe("Não consegui entender essa data. Por favor, digite no formato dd/mm/aaaa (ex.: 10/03/2020).");
    expect((await conversation(P1)).state).toBe("ENTRY_BIRTHDATE");
    await say(P1, "01/01/2020");
    reply = await say(P1, "qualquer coisa");
    expect(reply[1]).toMatchObject({ kind: "list", body: "Qual agendamento você quer consultar ou alterar?" });
    await say(P1, "1");
    reply = await say(P1, "xyz");
    expect(reply[1].body).toContain("O que você deseja fazer?");
    expect((await conversation(P1)).state).toBe("ENTRY_ACTIONS");
    reply = await say(P1, "menu");
    expect(reply.map((m) => m.body)).toEqual([MENU]);
  });

  it("12. \"Falar com a recepção\" nas ações (com coexistência): pausa o bot como no menu", async () => {
    await adminClient().from("whatsapp_connections").update({ coexistence: true }).eq("clinic_id", f.clinicId);
    try {
      await fresh(P1);
      await say(P1, "oi");
      await say(P1, "sim");
      await say(P1, "01/01/2020");
      let reply = await say(P1, { id: `entry_appointment_${consultP1}` });
      expect(titles(reply)).toContain("5. Falar com a recepção");
      reply = await say(P1, { id: "entry_reception" });
      expect(reply[0].body).toContain("Vou te transferir para a recepção");
      expect((await conversation(P1)).human_handoff).toBe(true);
      expect(await say(P1, "alô?")).toEqual([]);
    } finally {
      await fresh(P1);
      await adminClient().from("whatsapp_connections").update({ coexistence: false }).eq("clinic_id", f.clinicId);
    }
  });

  it("13. toque no lembrete no meio da entrada: segue o fluxo do lembrete", async () => {
    await adminClient().from("appointments").update({ patient_confirmed_at: null }).eq("id", consultP2);
    await fresh(P2);
    await say(P2, "oi");
    await say(P2, { id: "entry_yes" });
    let reply = await say(P2, { payload: reminderButtonPayload("confirm", consultP2) });
    expect(reply[0].body).toContain("Presença confirmada ✓");
    reply = await say(P2, { payload: reminderButtonPayload("cancel", consultP2) });
    expect(reply[0].body).toBe("Confirma o cancelamento da consulta de *Paciente Dois* em segunda, 10/03 às 08:00? Responda Sim ou Não.");
    expect((await conversation(P2)).state).toBe("CANCEL_CONFIRM");
    await say(P2, "não");
  });

  it("14. falha ao ler os atendimentos: nada é revelado e o menu segue disponível", async () => {
    await fresh(P1);
    failAppointments = true;
    try {
      let reply = await say(P1, "oi");
      expect(reply.map((m) => m.body)).toEqual([WELCOME, MENU]);
      failAppointments = false;
      await fresh(P1);
      await say(P1, "oi");
      await say(P1, "sim");
      failAppointments = true;
      reply = await say(P1, "01/01/2020");
      expect(reply.map((m) => m.body)).toEqual(["Não conseguimos consultar os agendamentos agora. Você pode seguir pelas opções do menu.", MENU]);
    } finally {
      failAppointments = false;
    }
  });

  it("15. mensagem repetida pela Meta: não responde nem age de novo", async () => {
    await fresh(P1);
    await say(P1, "oi");
    await say(P1, "sim");
    await say(P1, "01/01/2020");
    await say(P1, { id: `entry_appointment_${consultP1}` });
    await say(P1, { id: "entry_cancel" });
    const message = { id: `wamid.ent.in.dup.${++seq}`, from: P1.slice(1), type: "text", text: { body: "não" } };
    sent = [];
    expect((await send(NUMBER, message)).duplicates).toBe(0);
    expect(sent.map((m) => m.body)).toEqual(["Ok, mantivemos sua consulta marcada."]);
    sent = [];
    expect((await send(NUMBER, message)).duplicates).toBe(1);
    expect(sent).toEqual([]);
    expect((await adminClient().from("appointments").select("status").eq("id", consultP1).single()).data!.status).toBe("scheduled");
  });

  it("lista recusada pela Meta: as opções vão em texto e o número digitado vale", async () => {
    await fresh(P1);
    await say(P1, "oi");
    await say(P1, "sim");
    await say(P1, "01/01/2020");
    failLists = true;
    try {
      let reply = await say(P1, { id: `entry_appointment_${consultP1}` });
      expect(reply.map((m) => m.kind)).toEqual(["text"]);
      expect(reply[0].body).toBe(
        "A consulta de *Paciente Um* está marcada para segunda, 10/03 às 08:00.\n\nO que você deseja fazer?\n\n" +
          "1. Confirmar presença\n2. Remarcar\n3. Cancelar\n4. Encaixe ou antecipar (Lista de espera para um horário mais cedo)\n5. Voltar ao menu\n\n" +
          "Responda com o número da opção.",
      );
      reply = await say(P1, "3");
      expect(reply[0].body).toContain("Confirma o cancelamento da consulta de *Paciente Um*");
      await say(P1, "não");
    } finally {
      failLists = false;
    }
  });

  it("toque numa lista antiga: não vira a opção do passo atual", async () => {
    await fresh(P1);
    await say(P1, "oi");
    await say(P1, "sim");
    await say(P1, "01/01/2020");
    await say(P1, { id: `entry_appointment_${consultP1}` });
    // A linha "2." da lista anterior (o outro atendimento), tocada nas ações.
    sent = [];
    await send(NUMBER, { id: `wamid.ent.in.${++seq}`, from: P1.slice(1), type: "interactive", interactive: { list_reply: { id: `entry_appointment_${examP1}`, title: "2. seg, 17/03 às 08:00" } } });
    expect(sent[0].body).toMatch(/^Não entendi sua resposta 🙏/);
    expect(sent[1].body).toContain("O que você deseja fazer?");
    expect((await conversation(P1)).state).toBe("ENTRY_ACTIONS");
    const { count } = await adminClient().from("booking_links").select("id", { count: "exact", head: true }).eq("contact_phone", P1).eq("appointment_id", consultP1);
    expect(count).toBe(0);
    await say(P1, "menu");
  });

  it("16. isolamento entre clínicas: o mesmo telefone na outra clínica não vê estes atendimentos", async () => {
    const reply = await say(P1, "oi", NUMBER_B);
    expect(reply.map((m) => m.body)).toEqual([WELCOME, MENU]);
    expect((await conversation(P1, g.clinicId)).state).toBe("MENU");
    // O cliente do bot da outra clínica não lê o atendimento daqui (RLS).
    const { data } = await createClinicServiceClient(g.clinicId, env()).from("appointments").select("id").eq("id", consultP1);
    expect(data).toEqual([]);
  });
});
