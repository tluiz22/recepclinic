import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { closeIdleConversations } from "../../src/lib/data/whatsapp/bot/router";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, at, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// F6.3 — Bot I (marcar): conversas inteiras pelo webhook, com a Meta simulada
// (quem envia guarda as mensagens). Clínica da agenda (perfil Mista): duas
// agendas de consulta (Dra. Agenda com consultório e domiciliar, Dr. Segundo
// só consultório), exames, retorno.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "f63-numero";
type Sent = { to: string; kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string }[] };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;
// Relógio real: o banco grava a hora da conversa com now() (a pausa de 15 minutos compara com ela).
let now = new Date();

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Bot F63",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body, options: [] }), { sent: true, messageId: `wamid.f63.out.${++seq}`, body }),
  list: async (to: string, body: string, _button: string, sections: ListSection[]) => (
    sent.push({ to, kind: "list", body, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }),
    { sent: true, messageId: `wamid.f63.out.${++seq}` }
  ),
  buttons: async (to: string, body: string, buttons: ReplyButton[]) => (
    sent.push({ to, kind: "buttons", body, options: buttons }),
    { sent: true, messageId: `wamid.f63.out.${++seq}` }
  ),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

/** O paciente manda um texto (ou toca numa opção, `{ id }`); devolve o que o bot respondeu. */
async function say(phone: string, input: string | { id: string; title?: string }): Promise<Sent[]> {
  sent = [];
  now = new Date();
  const message =
    typeof input === "string"
      ? { id: `wamid.f63.in.${++seq}`, from: phone.slice(1), type: "text", text: { body: input } }
      : { id: `wamid.f63.in.${++seq}`, from: phone.slice(1), type: "interactive", interactive: { list_reply: { id: input.id, title: input.title ?? "" } } };
  const summary = await processWebhook(
    { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [message] } }] }] },
    deps(),
    now,
  );
  expect(summary.errors).toBe(0);
  return sent;
}

const titles = (reply: Sent[]) => reply.at(-1)!.options.map((o) => o.title);
const optionId = (reply: Sent[], titleStart: string) => reply.at(-1)!.options.find((o) => o.title.includes(titleStart))!.id;

async function conversation(phone: string) {
  const { data } = await adminClient().from("conversation_state").select("state, contact_id, context").eq("clinic_id", f.clinicId).eq("contact_phone", phone).single();
  return data!;
}

async function lastLink(phone: string) {
  const { data } = await adminClient()
    .from("booking_links")
    .select("patient_id, service_id, agenda_id, location_category, home_visit_address, origin_appointment_id, funnel_session_id, expires_at")
    .eq("clinic_id", f.clinicId)
    .eq("contact_phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data!;
}

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Bot F63", "+55849912263");
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "f63-waba", status: "connected" });
  await adminClient().from("clinic_settings").update({ bot_payment_info: "PIX ou cartão", bot_notes: "Chegue 10 minutos antes." }).eq("clinic_id", f.clinicId);
});

afterAll(async () => f.cleanup());

describe("bot: marcar consulta (número novo)", () => {
  const phone = "+5584991226399";

  it("boas-vindas e menu só com o que funciona", async () => {
    const reply = await say(phone, "Oi");
    expect(reply[0]).toMatchObject({ kind: "text", body: "Olá! 👋 Aqui é da Clínica Bot F63." });
    expect(titles(reply)).toEqual(["1. Consultas", "2. Exames", "3. Informações"]);
    expect(titles(await say(phone, "1"))).toEqual(["1. Marcar consulta", "2. Marcar retorno", "3. Voltar ao menu"]);
  });

  it("qual consulta (mesmo com uma só), com quem? (dois profissionais), local, para quem, cadastro, link", async () => {
    let reply = await say(phone, "1");
    expect(reply.at(-1)!.body).toBe("Qual consulta você quer marcar?");
    expect(titles(reply)).toEqual(["1. Consulta", "2. Voltar ao menu"]);
    reply = await say(phone, "1");
    expect(reply.at(-1)!.body).toBe("Com qual profissional?");
    expect(titles(reply)).toEqual(["1. Primeiro horário", "2. Dr. Segundo", "3. Dra. Agenda", "4. Voltar ao menu"]);

    reply = await say(phone, { id: optionId(reply, "Dra. Agenda") });
    expect(reply.at(-1)!.body).toBe("Prefere consultório ou atendimento domiciliar?");
    reply = await say(phone, "1");
    // Perfil Mista: a consulta pergunta para quem.
    expect(reply.at(-1)).toMatchObject({ kind: "buttons", body: "É para você ou para outra pessoa?" });
    reply = await say(phone, { id: "for_other" });
    expect(reply[0].body).toBe("Antes de continuar, qual é o seu nome completo?");
    reply = await say(phone, "Maria Souza");
    expect(reply[0].body).toContain("*Maria Souza*");
    reply = await say(phone, "sim");
    expect(reply[0].body).toBe("Qual é o nome completo do paciente?");
    await say(phone, "Joana Souza");
    reply = await say(phone, "31/02/2015");
    expect(reply[0].body).toContain("Não consegui entender essa data");
    reply = await say(phone, "10/03/2015");
    expect(reply[0].body).toContain("Nome: *Joana Souza*\nData de nascimento: *10/03/2015*");
    reply = await say(phone, "Sim");
    expect(reply[0].body).toMatch(/^Prontinho! Escolha o melhor dia e horário para \*Consulta\* de Joana Souza neste link:\nhttps:\/\/app\.exemplo\.test\/agendar\/[0-9a-f-]{36}\n\nO link vale por 30 minutos\.$/);

    const link = await lastLink(phone);
    expect(link).toMatchObject({ service_id: f.ids.consulta, agenda_id: f.ids.agendaDra, location_category: "clinic", home_visit_address: null });
    expect(link.funnel_session_id).not.toBeNull();
    const convo = await conversation(phone);
    expect(convo.state).toBe("WELCOME");
    const { data: contact } = await adminClient().from("contacts").select("id, full_name").eq("clinic_id", f.clinicId).eq("phone", phone).single();
    expect(contact).toMatchObject({ full_name: "Maria Souza", id: convo.contact_id });

    const { data: steps } = await adminClient()
      .from("bot_funnel_events")
      .select("step")
      .eq("clinic_id", f.clinicId)
      .eq("session_id", link.funnel_session_id!)
      .order("occurred_at");
    expect(steps!.map((s) => s.step)).toEqual([
      "started",
      "BOOK_SERVICE",
      "BOOK_AGENDA",
      "BOOK_LOCATION",
      "BOOK_FOR_WHOM",
      "for_whom",
      "BOOK_PATIENT_NEW",
      "BOOK_PATIENT_NEW",
      "BOOK_PATIENT_NEW",
      "BOOK_PATIENT_NEW",
      "BOOK_PATIENT_NEW",
      "patient_identified",
      "link_sent",
    ]);

    // Respostas registradas com o texto que o paciente vê.
    const { data: outbound } = await adminClient()
      .from("whatsapp_messages")
      .select("message_type, body")
      .eq("clinic_id", f.clinicId)
      .eq("contact_phone", phone)
      .eq("direction", "outbound")
      .eq("message_type", "bot_booking_link");
    expect(outbound).toHaveLength(1);
  });

  it("domiciliar: pede o endereço, confirma e guarda como padrão do contato", async () => {
    await say(phone, "oi");
    await say(phone, "1");
    await say(phone, "1");
    let reply = await say(phone, "1");
    reply = await say(phone, { id: optionId(reply, "Dra. Agenda") });
    reply = await say(phone, "2");
    expect(reply[0].body).toContain("Qual é o endereço para o atendimento domiciliar?");
    reply = await say(phone, "Rua das Flores, 10");
    expect(reply[0].body).toContain("*Rua das Flores, 10*");
    reply = await say(phone, "sim");
    reply = await say(phone, { id: "for_other" });
    // Joana não tem atendimento futuro: paciente novo pela data (acha o cadastro).
    expect(reply[0].body).toBe("Qual a data de nascimento do paciente? (formato dd/mm/aaaa)");
    reply = await say(phone, "10/03/2015");
    expect(reply[0].body).toBe("Encontramos *Joana Souza*, nascido(a) em 10/03/2015: é esse o paciente? Responda Sim ou Não.");
    reply = await say(phone, "sim");
    expect(reply[0].body).toContain("Prontinho!");
    expect(await lastLink(phone)).toMatchObject({ location_category: "home_visit", home_visit_address: "Rua das Flores, 10" });
    const { data: contact } = await adminClient().from("contacts").select("default_home_address").eq("clinic_id", f.clinicId).eq("phone", phone).single();
    expect(contact!.default_home_address).toBe("Rua das Flores, 10");
  });
});

describe("bot: exame para o contato já cadastrado", () => {
  it("lista os exames, para quem, acha o paciente pela data e manda o link", async () => {
    const phone = "+5584991226301"; // contato do Paciente Um
    await say(phone, "Bom dia");
    let reply = await say(phone, "2");
    expect(titles(reply)).toEqual(["1. Marcar exame", "2. Voltar ao menu"]);
    reply = await say(phone, "1");
    expect(reply.at(-1)!.body).toBe("Qual exame você quer marcar?");
    expect(titles(reply)).toEqual(["1. Exame", "2. Turma", "3. Voltar ao menu"]);
    reply = await say(phone, "1");
    expect(reply.at(-1)!.body).toBe("É para você ou para outra pessoa?");
    reply = await say(phone, "2");
    reply = await say(phone, "01/01/2020");
    expect(reply[0].body).toContain("*Paciente Um*");
    reply = await say(phone, "s");
    expect(reply[0].body).toContain("para *Exame* de Paciente Um");
    expect(await lastLink(phone)).toMatchObject({ service_id: f.ids.exame, agenda_id: f.ids.agendaExams });
  });

  it("\"0\" no meio do fluxo volta ao menu", async () => {
    const phone = "+5584991226302";
    await say(phone, "oi");
    await say(phone, "2");
    const reply = await say(phone, "0");
    expect(titles(reply)).toEqual(["1. Consultas", "2. Exames", "3. Informações"]);
    expect((await conversation(phone)).state).toBe("MENU");
  });
});

describe("bot: retorno e idade limite", () => {
  it("sem consulta anterior: explica e encerra", async () => {
    const phone = "+5584991226303";
    await say(phone, "oi");
    await say(phone, "1");
    const reply = await say(phone, "2");
    expect(reply[0].body).toContain("Não encontramos consulta nos últimos 30 dias");
    expect((await conversation(phone)).state).toBe("WELCOME");
  });

  it("com consulta realizada: lista quem tem direito e o link leva a consulta de origem e a mesma agenda", async () => {
    const phone = "+5584991226302"; // contato do Paciente Dois
    const consult = await bookAppointment(
      asDb(f.reception),
      f.clinicId,
      { patientId: f.ids.p2, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra, start: at("2031-03-10", "08:00"), locationId: f.ids.office, channel: "admin", actorId: null },
      NOW,
    );
    // A consulta já aconteceu (2 dias atrás) e foi realizada.
    await adminClient()
      .from("appointments")
      .update({ scheduled_at: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(), status: "completed" })
      .eq("id", consult.appointment.id);
    await say(phone, "oi");
    await say(phone, "1");
    let reply = await say(phone, "2");
    expect(reply.at(-1)!.body).toBe("O retorno não tem custo.\n\nO retorno deve ser feito em até 30 dias após a consulta. Para qual paciente é o retorno?");
    expect(titles(reply)).toEqual(["1. Paciente Dois", "2. Voltar ao menu"]);
    reply = await say(phone, "1");
    expect(reply[0].body).toContain("para *Retorno* de Paciente Dois");
    expect(await lastLink(phone)).toMatchObject({
      service_id: f.ids.retorno,
      agenda_id: f.ids.agendaDra,
      origin_appointment_id: consult.appointment.id,
      location_category: "clinic",
    });
  });

  it("consulta acima da idade limite: avisa e pergunta se é para outra pessoa", async () => {
    await adminClient().from("clinic_settings").update({ consultation_age_limit_years: 5 }).eq("clinic_id", f.clinicId);
    const phone = "+5584991226303"; // contato do Paciente Três (2020)
    await say(phone, "oi");
    await say(phone, "1");
    await say(phone, "1");
    let reply = await say(phone, "1");
    reply = await say(phone, { id: optionId(reply, "Dr. Segundo") });
    reply = await say(phone, { id: "for_other" });
    reply = await say(phone, "01/01/2020");
    expect(reply.at(-1)).toMatchObject({ kind: "buttons", body: "Consulta é para pacientes até 4 anos.\n\nDeseja agendar para outra pessoa?" });
    reply = await say(phone, { id: "no" });
    expect(titles(reply)).toEqual(["1. Consultas", "2. Exames", "3. Informações"]);
    await adminClient().from("clinic_settings").update({ consultation_age_limit_years: null }).eq("clinic_id", f.clinicId);
  });
});

describe("bot: informações", () => {
  it("valores com as formas de pagamento, endereço com o mapa e outras informações", async () => {
    const phone = "+5584991226304";
    await say(phone, "oi");
    let reply = await say(phone, "3");
    expect(titles(reply)).toEqual(["1. Valores", "2. Endereço", "3. Outras informações", "4. Voltar ao menu"]);
    reply = (await say(phone, "1")).map((m) => ({ ...m, body: m.body.replace(/\u00a0/g, " ") }));
    expect(reply[0].body).toContain("*Consulta*\nConsultório: R$ 300,00\nAtendimento domiciliar: R$ 450,00");
    expect(reply[0].body).toContain("*Retorno*\nConsultório: Sem custo");
    expect(reply[0].body).toContain("*Formas de pagamento*\nPIX ou cartão");
    reply = await say(phone, "2");
    expect(reply[0].body).toContain("*Consultório*\nRua A, 1\nhttps://www.google.com/maps/search/?api=1&query=Rua%20A%2C%201");
    reply = await say(phone, "3");
    expect(reply[0].body).toBe("Chegue 10 minutos antes.");
  });
});

describe("conversa parada há 15 minutos", () => {
  it("recebe o aviso, volta ao começo e o funil registra a desistência", async () => {
    const phone = "+5584991226305";
    await say(phone, "oi");
    await say(phone, "1");
    await say(phone, "1"); // Qual consulta?
    await say(phone, "1"); // Com qual profissional?
    const db = createClinicServiceClient(f.clinicId, env());

    sent = [];
    expect(await closeIdleConversations(db, f.clinicId, sender, new Date(now.getTime() + 10 * 60_000))).toBe(0);
    // As conversas dos outros testes também ficaram paradas no meio (menu, informações).
    expect(await closeIdleConversations(db, f.clinicId, sender, new Date(now.getTime() + 16 * 60_000))).toBeGreaterThanOrEqual(1);
    expect(sent.filter((m) => m.to === phone)).toEqual([
      {
        to: phone,
        kind: "text",
        body: "Como não tivemos resposta nos últimos minutos, encerramos este atendimento. Quando quiser, é só mandar uma mensagem que começamos de novo. 😊",
        options: [],
      },
    ]);
    expect((await conversation(phone)).state).toBe("WELCOME");
    const { data: abandoned } = await adminClient()
      .from("bot_funnel_events")
      .select("metadata")
      .eq("clinic_id", f.clinicId)
      .eq("contact_phone", phone)
      .eq("step", "abandoned")
      .single();
    expect(abandoned!.metadata).toEqual({ reason: "timeout", last_step: "BOOK_AGENDA" });
    // Só uma vez.
    expect(await closeIdleConversations(db, f.clinicId, sender, new Date(now.getTime() + 20 * 60_000))).toBe(0);
  });
});
