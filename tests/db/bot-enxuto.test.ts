import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { portalLinkTarget } from "../../src/lib/data/portal/links";
import { reminderButtonPayload } from "../../src/lib/data/whatsapp/reminders";
import { closeIdleConversations } from "../../src/lib/data/whatsapp/bot/router";
import type { ClinicSender, LinkButton, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, at, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// Bot enxuto (F3f, seção 15.6; cliente, 11/nov/2026): o menu numa mensagem (BE-2), o link do portal com o botão
// (BE-3), a recepção numa mensagem com o horário fora dele (BE-4), os botões do lembrete com o portal na ação e, sem o
// portal, a recepção (F3-5/F3-7).

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "be-numero";
const PREFIX = "+55849912474";
const PATIENT = `${PREFIX}01`; // responsável do Paciente Um (agendaFixture)
const NEW = `${PREFIX}55`;
type Sent = { to: string; kind: "text" | "list" | "buttons" | "link"; body: string; header?: string; options: { id: string; title: string }[]; link?: LinkButton };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;
let slug: string;
let consult: string;

const ok = () => ({ sent: true as const, messageId: `wamid.be.out.${++seq}` });
const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Enxuta",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body, options: [] }), { ...ok(), body }),
  list: async (to: string, body: string, _b: string, sections: ListSection[], header?: string) => (
    sent.push({ to, kind: "list", body, header, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }), ok()
  ),
  buttons: async (to: string, body: string, buttons: ReplyButton[]) => (sent.push({ to, kind: "buttons", body, options: buttons }), ok()),
  link: async (to: string, body: string, link: LinkButton) => (sent.push({ to, kind: "link", body, options: [], link }), ok()),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

async function say(phone: string, input: string | { id: string } | { payload: string }): Promise<Sent[]> {
  sent = [];
  const id = `wamid.be.in.${++seq}`;
  const from = phone.slice(1);
  const message =
    typeof input === "string"
      ? { id, from, type: "text", text: { body: input } }
      : "payload" in input
        ? { id, from, type: "button", button: { payload: input.payload, text: "botão" } }
        : { id, from, type: "interactive", interactive: { list_reply: { id: input.id, title: "" } } };
  const summary = await processWebhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [message] } }] }] }, deps(), new Date());
  expect(summary.errors).toBe(0);
  return sent;
}

const restart = (phone: string) =>
  adminClient().from("conversation_state").update({ state: "WELCOME", context: {}, human_handoff: false }).eq("clinic_id", f.clinicId).eq("contact_phone", phone);
const conversation = async (phone: string) =>
  (await adminClient().from("conversation_state").select("state, human_handoff").eq("clinic_id", f.clinicId).eq("contact_phone", phone).single()).data!;
const lastLink = async (phone: string) =>
  (await adminClient().from("portal_links").select("id, purpose, appointment_id").eq("clinic_id", f.clinicId).eq("phone", phone).order("created_at", { ascending: false }).limit(1).single()).data!;
const setPortal = (on: boolean) => adminClient().from("clinics").update({ portal_slug: on ? slug : null }).eq("id", f.clinicId);
const setCoexistence = (on: boolean) => adminClient().from("whatsapp_connections").update({ coexistence: on }).eq("clinic_id", f.clinicId);
/** A recepção sempre aberta ou sempre fechada (seg. a sex., 8h às 18h, num horário de fim de semana não serve). */
const setReceptionHours = (hours: unknown) => adminClient().from("clinic_settings").update({ reception_hours: hours as never }).eq("clinic_id", f.clinicId);
const ALL_DAY = Array.from({ length: 7 }, () => ({ open: "00:00", close: "23:59" }));
const CLOSED = Array.from({ length: 7 }, () => null);

const MENU_TITLES = ["📅 Agendar", "🗓 Minhas consultas", "👥 Profissionais", "🎧 Falar com a recepção"];

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Enxuta", PREFIX, { oneBotProfessional: true });
  slug = `be-${Date.now()}`;
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "be-waba", status: "connected" });
  await setPortal(true);
  await setReceptionHours(ALL_DAY);
  consult = (
    await bookAppointment(
      asDb(f.reception),
      f.clinicId,
      { patientId: f.ids.p1, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra, start: at(MON1, "08:00"), locationId: f.ids.office, channel: "admin", actorId: null },
      NOW,
    )
  ).appointment.id;
  await adminClient().from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", consult);
});

afterAll(async () => f.cleanup());

describe("menu enxuto (BE-2)", () => {
  it("1ª mensagem: uma só, com o nome da clínica no cabeçalho, as boas-vindas e os 3 atalhos (sem a recepção no app)", async () => {
    const reply = await say(NEW, "oi");
    expect(reply).toHaveLength(1);
    expect(reply[0]).toMatchObject({ kind: "list", header: "Clínica Enxuta", body: "Olá! Seja bem-vindo(a). Como podemos ajudar?" });
    expect(reply[0].options.map((o) => o.title)).toEqual(MENU_TITLES.slice(0, 3));
  });

  it("número com consulta marcada: direto o menu, com o primeiro nome e sem perguntar pela consulta; com a recepção no app, 4 itens", async () => {
    await setCoexistence(true);
    try {
      await restart(PATIENT);
      const reply = await say(PATIENT, "Bom dia");
      expect(reply).toHaveLength(1);
      expect(reply[0].body).toMatch(/^Olá, .+! Seja bem-vindo\(a\)\. Como podemos ajudar\?$/);
      expect(reply[0].options.map((o) => o.title)).toEqual(MENU_TITLES);
    } finally {
      await setCoexistence(false);
    }
  });
});

describe("links do portal (BE-3)", () => {
  it("Agendar: uma mensagem com o botão do link; o funil fecha com link enviado e a conversa volta ao começo", async () => {
    await restart(NEW);
    await say(NEW, "oi");
    const reply = await say(NEW, "1");
    expect(reply).toEqual([
      expect.objectContaining({
        kind: "link",
        body: "Para agendar sua consulta ou exame, toque no botão abaixo. Você escolhe o profissional, o dia e o horário.",
        link: { text: "Agendar no portal", url: expect.stringMatching(/^https:\/\/.+\/s\//) },
      }),
    ]);
    expect((await lastLink(NEW)).purpose).toBe("book");
    expect((await conversation(NEW)).state).toBe("WELCOME");
    const { data: steps } = await adminClient().from("bot_funnel_events").select("step").eq("clinic_id", f.clinicId).eq("contact_phone", NEW).eq("flow", "booking");
    expect(steps!.map((s) => s.step)).toContain("link_sent");
  });

  it("Minhas consultas e Profissionais: o link de cada um; Profissionais abre /medicos", async () => {
    await say(NEW, "oi");
    let reply = await say(NEW, { id: "menu_mine" });
    expect(reply[0]).toMatchObject({ kind: "link", body: "Para ver, remarcar ou cancelar suas consultas, toque no botão abaixo.", link: { text: "Minhas consultas" } });
    expect((await lastLink(NEW)).purpose).toBe("my_appointments");
    await say(NEW, "oi");
    reply = await say(NEW, { id: "menu_professionals" });
    expect(reply[0]).toMatchObject({ kind: "link", body: "Veja os profissionais, valores e convênios aceitos. Se quiser, já agenda por lá.", link: { text: "Ver profissionais" } });
    const link = await lastLink(NEW);
    expect(link.purpose).toBe("professionals");
    expect(portalLinkTarget({ purpose: "professionals", professionalId: null, serviceId: null, appointmentId: null }, { professionals: [], exams: [] } as never, "/portal/x")).toBe("/portal/x/medicos");
    expect(portalLinkTarget({ purpose: "cancel", professionalId: null, serviceId: null, appointmentId: "a1" }, { professionals: [], exams: [] } as never, "/portal/x")).toBe(
      "/portal/x/minhas-consultas/cancelar?a=a1",
    );
  });

  it("sem o botão de link (Meta recusou ou envio sem suporte): o mesmo texto com o endereço", async () => {
    const link = sender.link;
    sender.link = undefined;
    try {
      await say(NEW, "oi");
      const reply = await say(NEW, { id: "menu_mine" });
      expect(reply).toEqual([expect.objectContaining({ kind: "text", body: expect.stringMatching(/toque no botão abaixo\.\nhttps:\/\/.+\/s\//) })]);
    } finally {
      sender.link = link;
    }
  });

  it("portal fechado (F3-5/F3-7): sem a recepção no app, o aviso de que a clínica responde; com ela, a recepção", async () => {
    await setPortal(false);
    try {
      await say(NEW, "oi");
      let reply = await say(NEW, { id: "menu_book" });
      expect(reply.map((m) => m.body)).toEqual([expect.stringMatching(/responderá sua mensagem em breve\.$/)]);
      await setCoexistence(true);
      await say(NEW, "oi");
      reply = await say(NEW, { id: "menu_book" });
      expect(reply.map((m) => m.body)).toEqual(["Certo! A recepção vai te atender por aqui. Escreva sua dúvida, por favor."]);
      expect(await conversation(NEW)).toMatchObject({ human_handoff: true });
    } finally {
      await setPortal(true);
      await setCoexistence(false);
      await restart(NEW);
    }
  });
});

describe("Falar com a recepção (BE-4)", () => {
  it("uma mensagem; a primeira resposta vira o assunto, sem a pergunta à parte; fora do horário, o horário da recepção", async () => {
    await setCoexistence(true);
    try {
      await restart(NEW);
      await say(NEW, "oi");
      let reply = await say(NEW, { id: "menu_reception" });
      expect(reply.map((m) => m.body)).toEqual(["Certo! A recepção vai te atender por aqui. Escreva sua dúvida, por favor."]);
      expect(await say(NEW, "Quero saber do resultado do exame")).toEqual([]);
      const { data } = await adminClient().from("conversation_state").select("handoff_subject").eq("clinic_id", f.clinicId).eq("contact_phone", NEW).single();
      expect(data!.handoff_subject).toBe("Quero saber do resultado do exame");

      await restart(NEW);
      await setReceptionHours([null, { open: "08:00", close: "18:00" }, { open: "08:00", close: "18:00" }, { open: "08:00", close: "18:00" }, { open: "08:00", close: "18:00" }, { open: "08:00", close: "18:00" }, null].map((d) => d && { ...d, open: "00:00", close: "00:01" }));
      await say(NEW, "oi");
      reply = await say(NEW, { id: "menu_reception" });
      expect(reply[0].body).toBe(
        "Certo! A recepção vai te atender por aqui. Escreva sua dúvida, por favor.\n\nA recepção atende de seg. a sex., 0h às 0h01, e responde assim que abrir.",
      );
      await restart(NEW);
      await setReceptionHours(CLOSED);
      await say(NEW, "oi");
      reply = await say(NEW, { id: "menu_reception" });
      expect(reply[0].body).toContain("A recepção está fora do horário de atendimento e responde assim que abrir.");
    } finally {
      await setReceptionHours(ALL_DAY);
      await setCoexistence(false);
      await restart(NEW);
    }
  });
});

describe("botões do lembrete atual (rc_lembrete_v1)", () => {
  it("Remarcar e Cancelar: o portal já na ação, numa mensagem com o botão", async () => {
    await restart(PATIENT);
    let reply = await say(PATIENT, { payload: reminderButtonPayload("reschedule", consult) });
    expect(reply).toEqual([expect.objectContaining({ kind: "link", body: "Para remarcar a consulta de *Paciente Um*, toque no botão abaixo.", link: expect.objectContaining({ text: "Remarcar" }) })]);
    expect(await lastLink(PATIENT)).toMatchObject({ purpose: "reschedule", appointment_id: consult });
    reply = await say(PATIENT, { payload: reminderButtonPayload("cancel", consult) });
    expect(reply).toEqual([expect.objectContaining({ kind: "link", body: "Para cancelar a consulta de *Paciente Um*, toque no botão abaixo.", link: expect.objectContaining({ text: "Cancelar" }) })]);
    expect(await lastLink(PATIENT)).toMatchObject({ purpose: "cancel", appointment_id: consult });
    const { data } = await adminClient().from("appointments").select("status").eq("id", consult).single();
    expect(data!.status).toBe("scheduled");
  });

  it("sem o portal: a recepção (com ela no app) e a consulta segue marcada", async () => {
    await setPortal(false);
    await setCoexistence(true);
    try {
      await restart(PATIENT);
      const reply = await say(PATIENT, { payload: reminderButtonPayload("cancel", consult) });
      expect(reply.map((m) => m.body)).toEqual(["Certo! A recepção vai te atender por aqui. Escreva sua dúvida, por favor."]);
      expect(await conversation(PATIENT)).toMatchObject({ human_handoff: true });
    } finally {
      await setPortal(true);
      await setCoexistence(false);
      await restart(PATIENT);
    }
  });
});

describe("conversa parada há 15 minutos", () => {
  it("no menu: recebe o aviso e volta ao começo", async () => {
    const phone = `${PREFIX}66`;
    await say(phone, "oi");
    const db = createClinicServiceClient(f.clinicId, env());
    const now = new Date();
    sent = [];
    expect(await closeIdleConversations(db, f.clinicId, sender, new Date(now.getTime() + 10 * 60_000))).toBe(0);
    expect(await closeIdleConversations(db, f.clinicId, sender, new Date(now.getTime() + 16 * 60_000))).toBeGreaterThanOrEqual(1);
    expect(sent.filter((m) => m.to === phone).map((m) => m.body)).toEqual([
      "Como não tivemos resposta nos últimos minutos, encerramos este atendimento. Quando quiser, é só mandar uma mensagem que começamos de novo. 😊",
    ]);
    expect((await conversation(phone)).state).toBe("WELCOME");
  });
});
