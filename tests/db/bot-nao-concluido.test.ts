import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { listClinicsWithIdleConversations, resolveClinicByPhoneNumberId } from "../../src/lib/data/platform";
import { closeIdleConversations } from "../../src/lib/data/whatsapp/bot/router";
import type { ClinicSender, ListSection, ReplyButton } from "../../src/lib/data/whatsapp/send";
import { processWebhook, type WebhookDeps } from "../../src/lib/data/whatsapp/webhook";
import { asDb, at, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// PN2 — Pedido não concluído (cliente, 03/nov/2026; docs/pedido-nao-concluido.md): link do bot vencido sem uso e
// cancelamento sem resposta recebem "Não concluímos…" com Novo link (Cancelar agora) · Falar com a recepção ·
// Desistir, uma vez. Conversas pelo webhook com a Meta simulada; a rotina é a da conversa parada.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

const NUMBER = "pn2-numero";
type Sent = { to: string; kind: "text" | "list" | "buttons"; body: string; options: { id: string; title: string }[] };

let f: AgendaFixture;
let sent: Sent[] = [];
let seq = 0;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Bot PN2",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "sem template no teste" }),
  text: async (to, body) => (sent.push({ to, kind: "text", body, options: [] }), { sent: true, messageId: `wamid.pn2.out.${++seq}`, body }),
  list: async (to: string, body: string, _b: string, sections: ListSection[]) => (
    sent.push({ to, kind: "list", body, options: sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))) }),
    { sent: true, messageId: `wamid.pn2.out.${++seq}` }
  ),
  buttons: async (to: string, body: string, buttons: ReplyButton[]) => (
    sent.push({ to, kind: "buttons", body, options: buttons }),
    { sent: true, messageId: `wamid.pn2.out.${++seq}` }
  ),
};

const deps = (): WebhookDeps => ({
  resolveClinic: (id) => resolveClinicByPhoneNumberId(id, env()),
  clientFor: (clinicId) => createClinicServiceClient(clinicId, env()),
  senderFor: async () => sender,
});

/** O paciente digita ou toca numa opção (`{ id }`), respondendo à última mensagem com opções. */
async function say(phone: string, input: string | { id: string }): Promise<Sent[]> {
  sent = [];
  const id = `wamid.pn2.in.${++seq}`;
  const from = phone.slice(1);
  const { data: convo } = await adminClient().from("conversation_state").select("context").eq("clinic_id", f.clinicId).eq("contact_phone", phone).maybeSingle();
  const prompt = ((convo?.context ?? {}) as Record<string, unknown>)._prompt as string | undefined;
  const message =
    typeof input === "string"
      ? { id, from, type: "text", text: { body: input } }
      : { id, from, type: "interactive", interactive: { button_reply: { id: input.id, title: "" } }, ...(prompt ? { context: { id: prompt } } : {}) };
  const summary = await processWebhook(
    { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER }, messages: [message] } }] }] },
    deps(),
    new Date(),
  );
  expect(summary.errors).toBe(0);
  return sent;
}

/** A rotina de minuto em minuto (conversa parada + pedido não concluído), agora ou `minutes` à frente. */
async function routine(minutes = 0): Promise<Sent[]> {
  sent = [];
  await closeIdleConversations(createClinicServiceClient(f.clinicId, env()), f.clinicId, sender, new Date(Date.now() + minutes * 60_000));
  return sent;
}

const ASK_BIRTHDATE = "Para sua segurança, antes de mostrar o agendamento precisamos confirmar a identidade.\n\nQual a data de nascimento do paciente? (formato dd/mm/aaaa)";

/** Remarcar pelo menu de Consultas (ou Exames) até o link. */
async function rescheduleLink(phone: string, submenu: "1" | "2"): Promise<string> {
  let reply = await say(phone, "oi");
  if (reply.at(-1)?.options.some((o) => o.id === "entry_no")) await say(phone, { id: "entry_no" });
  await say(phone, submenu);
  reply = await say(phone, { id: "manage_reschedule" });
  if (reply.at(-1)?.body === ASK_BIRTHDATE) reply = await say(phone, "01/01/2020");
  expect(reply[0].body).toMatch(/^Prontinho! Escolha o novo dia e horário/);
  const { data } = await adminClient().from("booking_links").select("id").eq("contact_phone", phone).order("created_at", { ascending: false }).limit(1).single();
  return data!.id;
}

/** O link venceu há um minuto. */
const expire = (linkId: string) =>
  adminClient().from("booking_links").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", linkId);

const titles = (reply: Sent[]) => reply.at(-1)!.options.map((o) => o.title);

const P1 = "+5584991227001"; // contato do Paciente Um
const P2 = "+5584991227002"; // contato do Paciente Dois
const P3 = "+5584991227003"; // contato do Paciente Três

let consultP1: string;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Bot PN2", "+55849912270");
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: NUMBER, waba_id: "pn2-waba", status: "connected", coexistence: true });
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
  await book(f.ids.p2, f.ids.consulta, f.ids.agendaDra2, MON1, "08:00");
  await book(f.ids.p3, f.ids.exame, f.ids.agendaExams, MON2, "08:00");
});

afterAll(async () => f.cleanup());

describe("link de remarcação vencido sem uso", () => {
  it("a mensagem sai uma vez, com os três botões; Desistir mantém o atendimento", async () => {
    const linkId = await rescheduleLink(P1, "1");
    // Ainda valendo: nada.
    expect(await routine()).toEqual([]);
    await expire(linkId);
    // A rotina passa pela clínica mesmo sem conversa parada (depois do link a conversa volta ao começo).
    expect(await listClinicsWithIdleConversations(new Date(Date.now() - 15 * 60_000), env())).toContain(f.clinicId);
    let reply = await routine();
    expect(reply).toEqual([expect.objectContaining({ to: P1, kind: "buttons", body: "Não concluímos a remarcação de *Paciente Um*. Como prefere seguir?" })]);
    expect(titles(reply)).toEqual(["Novo link", "Falar com a recepção", "Desistir"]);
    const { data: link } = await adminClient().from("booking_links").select("not_completed_prompted_at").eq("id", linkId).single();
    expect(link!.not_completed_prompted_at).not.toBeNull();
    // Uma vez só.
    expect(await routine()).toEqual([]);

    reply = await say(P1, { id: "nc_give_up" });
    expect(reply.map((m) => m.body)).toEqual(["Tudo bem, a consulta de Paciente Um continua marcada para segunda, 10/03 às 08:00."]);
    const { data: appointment } = await adminClient().from("appointments").select("status").eq("id", consultP1).single();
    expect(appointment!.status).toBe("scheduled");
  });

  it("Novo link: outro link igual, com 30 minutos", async () => {
    const linkId = await rescheduleLink(P1, "1");
    await expire(linkId);
    await routine();
    const reply = await say(P1, { id: "nc_retry" });
    expect(reply[0].body).toMatch(/^Aqui está um novo link para remarcar o atendimento de Paciente Um:\nhttps:\/\/app\.exemplo\.test\/agendar\/[A-Za-z0-9_-]{22}\n\nO link vale por 30 minutos\.$/);
    const { data: links } = await adminClient()
      .from("booking_links")
      .select("id, mode, appointment_id, service_id, agenda_id, expires_at")
      .eq("contact_phone", P1)
      .order("created_at", { ascending: false })
      .limit(2);
    const [fresh, old] = links!;
    expect(fresh.id).not.toBe(linkId);
    expect(old.id).toBe(linkId);
    expect({ mode: fresh.mode, appointment_id: fresh.appointment_id, service_id: fresh.service_id, agenda_id: fresh.agenda_id }).toEqual({
      mode: old.mode,
      appointment_id: old.appointment_id,
      service_id: old.service_id,
      agenda_id: old.agenda_id,
    });
    expect(new Date(fresh.expires_at).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
  });

  it("Falar com a recepção: Atendimento humano, com o assunto do pedido", async () => {
    const linkId = await rescheduleLink(P2, "1");
    await expire(linkId);
    await routine();
    await say(P2, { id: "nc_reception" });
    const { data: convo } = await adminClient()
      .from("conversation_state")
      .select("human_handoff, handoff_subject")
      .eq("clinic_id", f.clinicId)
      .eq("contact_phone", P2)
      .single();
    expect(convo).toEqual({ human_handoff: true, handoff_subject: "Não concluiu a remarcação de Paciente Dois pelo WhatsApp." });
  });

  it("não manda nada com a conversa em outro caminho (o link fica tratado)", async () => {
    const linkId = await rescheduleLink(P1, "1");
    await say(P1, "oi");
    await say(P1, "1");
    await expire(linkId);
    expect(await routine()).toEqual([]);
    const { data: link } = await adminClient().from("booking_links").select("not_completed_prompted_at").eq("id", linkId).single();
    expect(link!.not_completed_prompted_at).not.toBeNull();
  });
});

describe("cancelamento sem resposta", () => {
  it("15 minutos sem resposta ao \"Confirma o cancelamento?\": a mensagem no lugar do encerramento; Cancelar agora pergunta de novo", async () => {
    let reply = await say(P3, "oi");
    if (reply.at(-1)?.options.some((o) => o.id === "entry_no")) await say(P3, { id: "entry_no" });
    await say(P3, "2");
    reply = await say(P3, { id: "manage_cancel" });
    if (reply.at(-1)?.body === ASK_BIRTHDATE) reply = await say(P3, "01/01/2020");
    expect(reply[0].body).toMatch(/^Confirma o cancelamento do exame Exame de \*Paciente Três\*/);
    // 16 minutos depois (o banco grava a hora da conversa sozinho).
    reply = (await routine(16)).filter((m) => m.to === P3);
    expect(reply).toEqual([expect.objectContaining({ to: P3, kind: "buttons", body: "Não concluímos o cancelamento de *Paciente Três*. Como prefere seguir?" })]);
    expect(titles(reply)).toEqual(["Cancelar agora", "Falar com a recepção", "Desistir"]);

    reply = await say(P3, { id: "nc_retry" });
    expect(reply[0].body).toMatch(/^Confirma o cancelamento do exame Exame de \*Paciente Três\*/);
    reply = await say(P3, "não");
    const { data: appointment } = await adminClient().from("appointments").select("status").eq("patient_id", f.ids.p3).single();
    expect(appointment!.status).toBe("scheduled");
  });
});
