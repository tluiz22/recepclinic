import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { reminderButtonPayload } from "../../src/lib/data/whatsapp/reminders";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, at, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// F6.4 — Bot II: cancelar, remarcar, botões do lembrete, encaixe (lista de
// espera), recepção e pausa pelo eco. Conversas pelo webhook com a Meta
// simulada, no relógio real (a conversa guarda a hora com now()).

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "f64-numero";
type Sent = { to: string; kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string }[] };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Bot F64",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body, options: [] }), { sent: true, messageId: `wamid.f64.out.${++seq}`, body }),
  list: async (to: string, body: string, _b: string, sections: ListSection[]) => (
    sent.push({ to, kind: "list", body, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }),
    { sent: true, messageId: `wamid.f64.out.${++seq}` }
  ),
  buttons: async (to: string, body: string, buttons: ReplyButton[]) => (
    sent.push({ to, kind: "buttons", body, options: buttons }),
    { sent: true, messageId: `wamid.f64.out.${++seq}` }
  ),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

const webhook = async (value: Record<string, unknown>) => {
  const summary = await processWebhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, ...value } }] }] }, deps(), new Date());
  expect(summary.errors).toBe(0);
};

/** O paciente digita, toca numa opção (`{ id }`) ou num botão de template (`{ payload }`). */
async function say(phone: string, input: string | { id: string } | { payload: string }): Promise<Sent[]> {
  sent = [];
  const id = `wamid.f64.in.${++seq}`;
  const from = phone.slice(1);
  const message =
    typeof input === "string"
      ? { id, from, type: "text", text: { body: input } }
      : "payload" in input
        ? { id, from, type: "button", button: { payload: input.payload, text: "botão" } }
        : { id, from, type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } };
  await webhook({ messages: [message] });
  return sent;
}

const titles = (reply: Sent[]) => reply.at(-1)!.options.map((o) => o.title);
/** "1. seg, 10/03 às 08:00" (linha da lista) → "segunda, 10/03 às 08:00" (texto). */
const full = (title: string) => title.slice(3).replace(/^seg,/, "segunda,");

async function appointment(id: string) {
  const { data } = await adminClient().from("appointments").select("status, canceled_via, patient_confirmed_at, reminder_response").eq("id", id).single();
  return data!;
}

const P1 = "+5584991226401"; // contato do Paciente Um
const P2 = "+5584991226402"; // contato do Paciente Dois
const P3 = "+5584991226403"; // contato do Paciente Três

let consultP1: string;
let consultP2: string;
let examP3: string;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Bot F64", "+55849912264");
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "f64-waba", status: "connected" });
  const book = async (patientId: string, serviceId: string, agendaId: string, date: string, time: string) =>
    (
      await bookAppointment(
        asDb(f.reception),
        f.clinicId,
        { patientId, serviceId, agendaId, start: at(date, time), locationId: f.ids.office, channel: "admin", actorId: null },
        NOW,
      )
    ).appointment.id;
  consultP1 = await book(f.ids.p1, f.ids.consulta, f.ids.agendaDra, MON1, "08:00");
  consultP2 = await book(f.ids.p2, f.ids.consulta, f.ids.agendaDra2, MON1, "08:00");
  examP3 = await book(f.ids.p3, f.ids.exame, f.ids.agendaExams, MON2, "08:00");
  // Lembrete já enviado (os botões só valem com ele).
  await adminClient().from("appointments").update({ reminder_sent_at: new Date().toISOString() }).in("id", [consultP1, consultP2]);
});

afterAll(async () => f.cleanup());

describe("cancelar pelo menu", () => {
  it("um atendimento só: pede confirmação, \"não\" mantém, \"sim\" cancela", async () => {
    await say(P2, "oi");
    await say(P2, "1");
    let reply = await say(P2, { id: "manage_cancel" });
    expect(reply[0].body).toBe("Confirma o cancelamento da consulta de *Paciente Dois* em segunda, 10/03 às 08:00? Responda Sim ou Não.");
    reply = await say(P2, "não");
    expect(reply[0].body).toBe("Ok, mantivemos sua consulta marcada.");
    expect((await appointment(consultP2)).status).toBe("scheduled");

    await say(P2, "oi");
    await say(P2, "1");
    await say(P2, { id: "manage_cancel" });
    reply = await say(P2, "sim");
    expect(reply[0].body).toBe(
      "Prontinho, cancelamos a consulta de Paciente Dois que estava marcada para segunda, 10/03 às 08:00. Se precisar marcar uma nova consulta, é só me chamar de novo.",
    );
    expect(await appointment(consultP2)).toMatchObject({ status: "canceled", canceled_via: "whatsapp_bot" });
  });

  it("nunca mistura consulta e exame; número sem cadastro é avisado", async () => {
    await say(P3, "oi");
    await say(P3, "1");
    const reply = await say(P3, { id: "manage_cancel" });
    expect(reply[0].body).toBe("Não encontramos nenhuma consulta futura para cancelar neste número. Se precisar de ajuda, fale com a clínica.");

    const stranger = "+5584991226499";
    await say(stranger, "oi");
    await say(stranger, "2");
    expect((await say(stranger, { id: "manage_cancel" }))[0].body).toBe(
      "Não encontramos nenhum cadastro associado a este número. Se você já é paciente, fale com a clínica.",
    );
  });
});

describe("remarcar pelo menu", () => {
  it("exame único: confirma que é ele e manda o link de remarcação com o mesmo serviço e agenda", async () => {
    await say(P3, "oi");
    await say(P3, "2");
    let reply = await say(P3, { id: "manage_reschedule" });
    expect(reply[0].body).toBe("Encontramos o exame Exame de *Paciente Três* em segunda, 17/03 às 08:00: é esse que você quer remarcar? Responda Sim ou Não.");
    reply = await say(P3, "sim");
    expect(reply[0].body).toMatch(/^Prontinho! Escolha o novo dia e horário para o exame Exame de Paciente Três neste link:\nhttps:\/\/app\.exemplo\.test\/agendar\/[0-9a-f-]{36}/);
    const { data: link } = await adminClient().from("booking_links").select("mode, appointment_id, service_id, agenda_id").eq("contact_phone", P3).eq("mode", "reschedule").single();
    expect(link).toEqual({ mode: "reschedule", appointment_id: examP3, service_id: f.ids.exame, agenda_id: f.ids.agendaExams });
  });
});

describe("botões do lembrete", () => {
  it("Confirmar presença confirma em qualquer ponto da conversa", async () => {
    await say(P1, "oi");
    const reply = await say(P1, { payload: reminderButtonPayload("confirm", consultP1) });
    expect(reply[0].body).toBe("Presença confirmada ✓\n\n👤 Paciente: Paciente Um\n📅 segunda, 10/03 às 08:00\n\nObrigado! Qualquer dúvida, é só chamar por aqui.");
    expect((await appointment(consultP1)).patient_confirmed_at).not.toBeNull();
    expect((await say(P1, { payload: reminderButtonPayload("confirm", consultP1) }))[0].body).toBe(
      "A presença de Paciente Um em segunda, 10/03 às 08:00 já estava confirmada ✓",
    );
  });

  it("Cancelar pelo lembrete: \"não\" sem presença confirmada pergunta se confirma", async () => {
    await adminClient().from("appointments").update({ patient_confirmed_at: null }).eq("id", consultP1);
    let reply = await say(P1, { payload: reminderButtonPayload("cancel", consultP1) });
    expect(reply[0].body).toContain("Confirma o cancelamento da consulta de *Paciente Um*");
    reply = await say(P1, "não");
    expect(reply[0]).toMatchObject({ kind: "buttons", body: "Ok, mantivemos sua consulta marcada.\n\nDeseja confirmar sua presença?" });
    reply = await say(P1, { id: "yes" });
    expect(reply[0].body).toContain("Presença confirmada ✓");
    expect(await appointment(consultP1)).toMatchObject({ status: "scheduled", reminder_response: "confirmed" });
  });

  it("toque de atendimento cancelado: não está mais ativo", async () => {
    const reply = await say(P2, { payload: reminderButtonPayload("reschedule", consultP2) });
    expect(reply[0].body).toBe("Esse agendamento não está mais ativo.");
  });
});

describe("encaixe ou antecipar", () => {
  it("com horário livre antes: mostra até 3; \"Nenhum desses\" pergunta da lista; já na lista, pergunta se continua ou sai", async () => {
    await say(P1, "oi");
    await say(P1, "1");
    let reply = await say(P1, { id: "manage_waitlist" });
    expect(reply[0]).toMatchObject({
      kind: "list",
      body: "Encontramos horários livres antes da consulta de *Paciente Um*, marcada para segunda, 10/03 às 08:00. Quer antecipar para um destes?",
    });
    // Horários da agenda da Dra. às segundas, no consultório, a partir de hoje.
    expect(titles(reply)).toEqual([
      expect.stringMatching(/^1\. seg, \d\d\/\d\d às \d\d:\d\d$/),
      expect.stringMatching(/^2\. seg, /),
      expect.stringMatching(/^3\. seg, /),
      "4. Nenhum desses",
      "5. Voltar ao menu",
    ]);

    reply = await say(P1, { id: "waitlist_none" });
    expect(reply[0]).toMatchObject({ kind: "buttons", body: "Quer entrar na lista de espera? Se abrir outra vaga antes de segunda, 10/03 às 08:00, eu aviso por aqui." });
    reply = await say(P1, "não");
    expect(reply[0].body).toBe("Ok, mantivemos o horário de *Paciente Um* (segunda, 10/03 às 08:00).");

    await say(P1, "oi");
    await say(P1, "1");
    await say(P1, { id: "manage_waitlist" });
    await say(P1, "4");
    reply = await say(P1, { id: "yes" });
    expect(reply[0].body).toBe("Pronto! *Paciente Um* está na lista de espera para antecipar a consulta marcada para segunda, 10/03 às 08:00.");

    // Já na lista: os horários livres vêm antes; sem escolha, continua ou sai.
    await say(P1, "oi");
    await say(P1, "1");
    reply = await say(P1, { id: "manage_waitlist" });
    expect(reply[0].kind).toBe("list");
    reply = await say(P1, { id: "waitlist_none" });
    expect(reply[0].kind).toBe("buttons");
    expect(titles(reply)).toEqual(["Sair da lista", "Continuar na lista"]);
    reply = await say(P1, { id: "waitlist_leave" });
    expect(reply[0].body).toBe("Pronto, *Paciente Um* saiu da lista de espera. A consulta continua marcada para segunda, 10/03 às 08:00.");
  });

  it("escolhe um horário: \"Não\" volta à lista; ocupado no meio procura de novo; \"Sim\" antecipa e tira da fila", async () => {
    await adminClient().from("waitlist_entries").insert({ clinic_id: f.clinicId, appointment_id: consultP1, created_via: "whatsapp_bot" });
    await say(P1, "oi");
    await say(P1, "1");
    let reply = await say(P1, { id: "manage_waitlist" });
    const [first] = reply[0].options;
    reply = await say(P1, { id: first.id });
    expect(reply[0]).toMatchObject({ kind: "buttons" });
    expect(reply[0].body).toBe(`Confirma antecipar a consulta de *Paciente Um* de segunda, 10/03 às 08:00 para ${full(first.title)}?`);
    reply = await say(P1, "não");
    expect(reply[0].kind).toBe("list");
    expect(reply[0].options[0].id).toBe(first.id);

    // Outra pessoa marca o horário antes do "Sim".
    await say(P1, { id: first.id });
    const start = new Date(first.id.split("_")[1]);
    await bookAppointment(
      asDb(f.reception),
      f.clinicId,
      { patientId: f.ids.p3, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra, start, locationId: f.ids.office, channel: "admin", actorId: null },
      new Date(),
    );
    reply = await say(P1, "sim");
    expect(reply[0].body).toBe("Que pena, esse horário acabou de ser ocupado.");
    expect(reply[1].kind).toBe("list");
    const next = reply[1].options[0];
    expect(next.id).not.toBe(first.id);

    reply = await say(P1, "1");
    reply = await say(P1, { id: "yes" });
    expect(reply[0].body).toBe(`Pronto! ✓ O atendimento de *Paciente Um* foi antecipado para ${full(next.title)}. Os detalhes seguem na mensagem de remarcação.`);
    const { data } = await adminClient().from("appointments").select("scheduled_at, rescheduled_via").eq("id", consultP1).single();
    expect(new Date(data!.scheduled_at).toISOString()).toBe(new Date(next.id.split("_")[1]).toISOString());
    expect(data!.rescheduled_via).toBe("whatsapp_bot");
    const { data: entries } = await adminClient().from("waitlist_entries").select("status").eq("appointment_id", consultP1).order("created_at");
    expect(entries!.at(-1)!.status).toBe("advanced");
  });

  it("sem horário livre antes: entra direto na lista", async () => {
    await adminClient()
      .from("schedule_blocks")
      .insert({ clinic_id: f.clinicId, agenda_id: f.ids.agendaExams, starts_at: new Date().toISOString(), ends_at: at(MON2, "08:00").toISOString(), reason: "Teste" });
    await say(P3, "oi");
    await say(P3, "2");
    const reply = await say(P3, { id: "manage_waitlist" });
    expect(reply[0].body).toBe("Pronto! *Paciente Três* está na lista de espera para antecipar o exame Exame marcado para segunda, 17/03 às 08:00.");
  });

  it("sem nada marcado: oferece marcar; o link leva o pedido de entrar na lista", async () => {
    await say(P2, "oi");
    await say(P2, "1");
    let reply = await say(P2, { id: "manage_waitlist" });
    expect(titles(reply)).toEqual(["Marcar consulta", "Marcar retorno", "Voltar ao menu"]);
    reply = await say(P2, { id: "waitlist_book_consultation" });
    expect(reply.at(-1)!.body).toBe("Qual consulta você quer marcar?");
  });
});

describe("recepção e pausa", () => {
  it("\"Falar com a recepção\" só com coexistência; pausa o bot até o eco \"#bot\"", async () => {
    const phone = "+5584991226404";
    expect(titles(await say(phone, "oi"))).not.toContain("4. Falar com a recepção");

    await adminClient().from("whatsapp_connections").update({ coexistence: true }).eq("clinic_id", f.clinicId);
    let reply = await say(phone, "oi");
    expect(titles(reply)).toContain("4. Falar com a recepção");
    reply = await say(phone, "4");
    expect(reply[0].body).toContain("Vou te transferir para a recepção");
    expect(await say(phone, "alô?")).toEqual([]);

    // A recepção devolve ao bot pelo app.
    await webhook({ message_echoes: [{ id: `wamid.f64.echo.${++seq}`, from: "5584000000000", to: phone.slice(1), type: "text", text: { body: "#bot" } }] });
    expect(titles(await say(phone, "oi"))).toContain("1. Consultas");
    await adminClient().from("whatsapp_connections").update({ coexistence: false }).eq("clinic_id", f.clinicId);
  });

  it("a recepção responde pelo app: o bot fica em silêncio, mas o Confirmar do lembrete responde", async () => {
    await webhook({ message_echoes: [{ id: `wamid.f64.echo.${++seq}`, from: "5584000000000", to: P1.slice(1), type: "text", text: { body: "Oi, aqui é a recepção" } }] });
    expect(await say(P1, "oi")).toEqual([]);
    // Antecipado no encaixe: o lembrete da data nova também foi enviado.
    await adminClient().from("appointments").update({ patient_confirmed_at: null, reminder_sent_at: new Date().toISOString() }).eq("id", consultP1);
    const reply = await say(P1, { payload: reminderButtonPayload("confirm", consultP1) });
    expect(reply[0].body).toContain("Presença confirmada ✓");
    expect(await say(P1, { payload: reminderButtonPayload("cancel", consultP1) })).toEqual([]);
  });
});
