import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { reminderButtonPayload } from "../../src/lib/data/whatsapp/reminders";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, at, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// F6.4 — Bot II: botões do lembrete, recepção e pausa pelo eco. Bot enxuto (F3f): cancelar, remarcar e o encaixe
// saíram do chat (portal; bot-enxuto.test.ts). Conversas pelo webhook com a Meta simulada, no relógio real.

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

/** "oi" até o menu: com atendimento marcado no número, responde "Não, outro assunto" à pergunta da entrada. */
async function hello(phone: string): Promise<Sent[]> {
  const reply = await say(phone, "oi");
  return reply.at(-1)?.options.some((o) => o.id === "entry_no") ? say(phone, { id: "entry_no" }) : reply;
}

const titles = (reply: Sent[]) => reply.at(-1)!.options.map((o) => o.title);
async function appointment(id: string) {
  const { data } = await adminClient().from("appointments").select("status, canceled_via, patient_confirmed_at, reminder_response").eq("id", id).single();
  return data!;
}

const P1 = "+5584991226401"; // contato do Paciente Um
const P2 = "+5584991226402"; // contato do Paciente Dois

let consultP1: string;
let consultP2: string;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Bot F64", "+55849912264", { oneBotProfessional: true });
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
  consultP2 = await book(f.ids.p2, f.ids.consulta2, f.ids.agendaDra2, MON1, "08:00");
  // Lembrete já enviado (os botões só valem com ele).
  await adminClient().from("appointments").update({ reminder_sent_at: new Date().toISOString() }).in("id", [consultP1, consultP2]);
});

afterAll(async () => f.cleanup());

describe("botões do lembrete", () => {
  it("Confirmar presença confirma em qualquer ponto da conversa", async () => {
    await hello(P1);
    const reply = await say(P1, { payload: reminderButtonPayload("confirm", consultP1) });
    expect(reply[0].body).toBe("Presença confirmada ✓\n\n👤 Paciente: Paciente Um\n📅 segunda, 10/03 às 08:00\n\nObrigado! Qualquer dúvida, é só chamar por aqui.");
    // Depois da presença: o local com o link do Maps, numa mensagem à parte (cliente, 02/nov/2026).
    expect(reply[1].body).toBe("📍 *Consultório*\nRua A, 1\n\nComo chegar: https://www.google.com/maps/search/?api=1&query=Rua%20A%2C%201");
    expect((await appointment(consultP1)).patient_confirmed_at).not.toBeNull();
    expect((await say(P1, { payload: reminderButtonPayload("confirm", consultP1) }))[0].body).toBe(
      "A presença de Paciente Um em segunda, 10/03 às 08:00 já estava confirmada ✓",
    );
  });

  it("toque de atendimento cancelado: não está mais ativo", async () => {
    await adminClient().from("appointments").update({ status: "canceled", canceled_at: new Date().toISOString() }).eq("id", consultP2);
    const reply = await say(P2, { payload: reminderButtonPayload("reschedule", consultP2) });
    expect(reply[0].body).toBe("Esse agendamento não está mais ativo.");
  });
});

describe("recepção e pausa", () => {
  it("\"Falar com a recepção\" só com coexistência; pausa o bot até o eco \"#bot\"", async () => {
    const phone = "+5584991226404";
    expect(titles(await hello(phone))).not.toContain("🎧 Falar com a recepção");

    await adminClient().from("whatsapp_connections").update({ coexistence: true }).eq("clinic_id", f.clinicId);
    // Recepção aberta o dia todo (fora do horário, o aviso leva o horário: bot-enxuto.test.ts).
    await adminClient().from("clinic_settings").update({ reception_hours: Array.from({ length: 7 }, () => ({ open: "00:00", close: "23:59" })) as never }).eq("clinic_id", f.clinicId);
    let reply = await hello(phone);
    expect(titles(reply)).toContain("🎧 Falar com a recepção");
    // Bot enxuto (BE-4): uma mensagem, que já pede a dúvida.
    reply = await say(phone, "4");
    expect(reply.map((m) => m.body)).toEqual(["Certo! A recepção vai te atender por aqui. Escreva sua dúvida, por favor."]);
    // Assunto da transferência (cliente, 31/out/2026): a 1ª resposta é o assunto; depois, o bot fica calado.
      expect((await say(phone, "alô?")).map((m) => m.body)).toEqual([]);
      expect(await say(phone, "tem alguém aí?")).toEqual([]);

    // A recepção devolve ao bot pelo app.
    await webhook({ message_echoes: [{ id: `wamid.f64.echo.${++seq}`, from: "5584000000000", to: phone.slice(1), type: "text", text: { body: "#bot" } }] });
    expect(titles(await hello(phone))).toContain("📅 Agendar");
    await adminClient().from("whatsapp_connections").update({ coexistence: false }).eq("clinic_id", f.clinicId);
  });

  it("em recesso da clínica: a mensagem de recesso substitui o aviso, com a data do retorno", async () => {
    const phone = "+5584991226405";
    await adminClient().from("whatsapp_connections").update({ coexistence: true }).eq("clinic_id", f.clinicId);
    const end = new Date(Date.now() + 10 * 24 * 60 * 60_000);
    const { data: block } = await adminClient()
      .from("schedule_blocks")
      .insert({ clinic_id: f.clinicId, agenda_id: f.ids.agendaExams, starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: end.toISOString(), reason: "Recesso", recess_message: "Em recesso até {data}." })
      .select("id")
      .single();
    await hello(phone);
    const reply = await say(phone, "4");
    expect(reply[0].body).toMatch(/^Em recesso até \d{2}\/\d{2}\/\d{4}\.$/);
    await adminClient().from("schedule_blocks").delete().eq("id", block!.id);
    await webhook({ message_echoes: [{ id: `wamid.f64.echo.${++seq}`, from: "5584000000000", to: phone.slice(1), type: "text", text: { body: "#bot" } }] });
    await adminClient().from("whatsapp_connections").update({ coexistence: false }).eq("clinic_id", f.clinicId);
  });

  it("a recepção responde pelo app: o bot fica em silêncio, mas o Confirmar do lembrete responde", async () => {
    await webhook({ message_echoes: [{ id: `wamid.f64.echo.${++seq}`, from: "5584000000000", to: P1.slice(1), type: "text", text: { body: "Oi, aqui é a recepção" } }] });
    expect(await hello(P1)).toEqual([]);
    await adminClient().from("appointments").update({ patient_confirmed_at: null, reminder_sent_at: new Date().toISOString() }).eq("id", consultP1);
    const reply = await say(P1, { payload: reminderButtonPayload("confirm", consultP1) });
    expect(reply[0].body).toContain("Presença confirmada ✓");
    expect(await say(P1, { payload: reminderButtonPayload("cancel", consultP1) })).toEqual([]);
  });
});

