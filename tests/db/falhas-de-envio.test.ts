import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import type { DbClient } from "../../src/lib/data/clients";
import { updateContact } from "../../src/lib/data/patients";
import { listAppointmentsWithFailedSends } from "../../src/lib/data/sends";
import { recordOutboundMessage, type SendOutcome } from "../../src/lib/data/whatsapp/messages";
import { runSendRetries } from "../../src/lib/data/whatsapp/retries";
import { botRetryContext } from "../../src/lib/data/whatsapp/retryRules";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import { dismissSendFailure, getLatestNotice, listNumbersWithoutWhatsapp } from "../../src/lib/data/whatsapp/undeliverable";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient, clinicServiceClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// Falhas de envio (cliente, 05/nov/2026; docs/arquivo/modulos/falhas-de-envio.md): descartar na aba Envios (só o Suporte), número sem
// WhatsApp no Início (corrigir ou "o número está certo") e o reenvio rápido das mensagens do bot.

let f: AgendaFixture;
let db: DbClient;
let staff: TestUser;
let contactId = "";
let phone = "";
let seq = 0;
const seconds = (n: number) => new Date(NOW.getTime() + n * 1000);

const failure = (code: number, technical: boolean): SendOutcome => ({
  sent: false,
  reason: `Envio pelo WhatsApp (código ${code})`,
  failure: { code, technical },
  request: { to: "x", type: "text" },
  body: "corpo",
});
const ok = (request: Record<string, unknown>): SendOutcome => ({ sent: true, messageId: `wamid.falhas.${++seq}`, request, body: "corpo" });

const resends: Record<string, unknown>[] = [];
const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica Falhas",
  baseUrl: "https://app.exemplo.test",
  template: async (to) => ok({ to, type: "template" }),
  text: async (to) => ok({ to, type: "text" }),
  list: async (to) => ok({ to, type: "interactive" }),
  buttons: async (to) => ok({ to, type: "interactive" }),
  resend: async (request) => (resends.push(request), ok(request)),
};

const failed = (messageType: string, code: number, now: Date, appointmentId: string | null = null, technical = false) =>
  recordOutboundMessage(
    db,
    f.clinicId,
    {
      phone,
      contactId,
      appointmentId,
      messageType,
      status: "failed",
      ...(technical ? { retry: { outcome: failure(code, true), context: botRetryContext(now) } } : {}),
    },
    now,
  ).then(async (id) => {
    if (!technical) await adminClient().from("whatsapp_messages").update({ failure_code: code, failure_reason: `erro ${code}` }).eq("id", id);
    return id;
  });

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Falhas de Envio", "849555500");
  db = clinicServiceClient(f.clinicId) as unknown as DbClient;
  staff = await createUser("falhas-suporte");
  await makePlatformStaff(staff.id);
  const patient = (await adminClient().from("patients").select("contact_id, contacts ( phone )").eq("id", f.ids.p1).single()).data as unknown as {
    contact_id: string;
    contacts: { phone: string };
  };
  contactId = patient.contact_id;
  phone = patient.contacts.phone;
});

afterAll(async () => {
  await f.cleanup();
  await deleteUsers([staff]);
});

describe("descartar na aba Envios", () => {
  let appointment = "";
  let message = "";

  it("a falha aparece com o número, o código e o motivo", async () => {
    appointment = (
      await bookAppointment(asDb(f.reception), f.clinicId, { patientId: f.ids.p1, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra, start: at(MON1, "09:00"), locationId: f.ids.office, channel: "admin", actorId: null }, NOW)
    ).appointment.id;
    message = await failed("appointment_reschedule", 131042, NOW, appointment);
    const [listed] = await listAppointmentsWithFailedSends(asDb(f.reception), f.clinicId, {}, NOW);
    expect(listed).toMatchObject({ id: appointment, failedSends: 1 });
    expect(listed.sends).toMatchObject([{ messageId: message, phone, failureCode: 131042, failureReason: "erro 131042" }]);
  });

  it("só o Suporte descarta; descartada, sai da lista", async () => {
    expect(await codeOf(() => dismissSendFailure(asDb(f.reception), f.clinicId, "envios", { messageId: message }))).toBe("forbidden");
    expect(await codeOf(() => dismissSendFailure(asDb(f.admin), f.clinicId, "envios", { messageId: message }))).toBe("forbidden");
    await dismissSendFailure(asDb(staff), f.clinicId, "envios", { messageId: message });
    // De novo: nada muda.
    await dismissSendFailure(asDb(staff), f.clinicId, "envios", { messageId: message });
    expect(await listAppointmentsWithFailedSends(asDb(f.reception), f.clinicId, {}, NOW)).toEqual([]);
  });

  it("a equipe lê o descarte, mas não grava direto na tabela", async () => {
    const { error } = await f.reception.client.from("send_failure_dismissals").insert({ clinic_id: f.clinicId, message_id: message, scope: "inicio" });
    expect(error).not.toBeNull();
    const { data } = await f.reception.client.from("send_failure_dismissals").select("scope").eq("message_id", message);
    expect(data).toEqual([{ scope: "envios" }]);
  });
});

describe("número sem WhatsApp no Início", () => {
  let message = "";

  it("a falha 131026 aparece para a recepção, com o atendimento", async () => {
    message = await failed("appointment_confirmation", 131026, seconds(60));
    const list = await listNumbersWithoutWhatsapp(asDb(f.reception), f.clinicId, seconds(120));
    expect(list).toMatchObject([{ messageId: message, contactId, phone, messageType: "appointment_confirmation" }]);
  });

  it("'O número está certo' tira o aviso (recepção pode; o descarte da aba Envios não mexe nele)", async () => {
    await dismissSendFailure(asDb(staff), f.clinicId, "envios", { messageId: message });
    expect(await listNumbersWithoutWhatsapp(asDb(f.reception), f.clinicId, seconds(120))).toHaveLength(1);
    await dismissSendFailure(asDb(f.reception), f.clinicId, "inicio", { messageId: message });
    expect(await listNumbersWithoutWhatsapp(asDb(f.reception), f.clinicId, seconds(120))).toEqual([]);
  });

  it("falha nova volta a avisar; uma mensagem que chega depois resolve", async () => {
    await failed("appointment_reminder", 131026, seconds(180));
    expect(await listNumbersWithoutWhatsapp(asDb(f.reception), f.clinicId, seconds(200))).toHaveLength(1);
    await recordOutboundMessage(db, f.clinicId, { phone, contactId, messageType: "appointment_reminder", status: "delivered", waMessageId: `wamid.falhas.${++seq}` }, seconds(240));
    expect(await listNumbersWithoutWhatsapp(asDb(f.reception), f.clinicId, seconds(260))).toEqual([]);
  });

  it("corrigido o cadastro, o aviso some", async () => {
    await failed("appointment_reminder", 131026, seconds(300));
    expect(await listNumbersWithoutWhatsapp(asDb(f.reception), f.clinicId, seconds(320))).toHaveLength(1);
    const contact = (await adminClient().from("contacts").select("full_name").eq("id", contactId).single()).data!;
    await updateContact(asDb(f.reception), f.clinicId, contactId, { fullName: contact.full_name, phone: "(84) 95555-0099" });
    expect(await listNumbersWithoutWhatsapp(asDb(f.reception), f.clinicId, seconds(340))).toEqual([]);
    phone = "+5584955550099";
  });
});

describe("situação da confirmação para o aviso da Agenda", () => {
  it("a última confirmação ou remarcação do atendimento, com o motivo e se vai tentar de novo", async () => {
    const appointment = (
      await bookAppointment(asDb(f.reception), f.clinicId, { patientId: f.ids.p2, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra, start: at(MON1, "10:00"), locationId: f.ids.office, channel: "admin", actorId: null }, NOW)
    ).appointment.id;
    expect(await getLatestNotice(asDb(f.reception), f.clinicId, appointment)).toBeNull();
    const id = await failed("appointment_confirmation", 131026, seconds(400), appointment);
    expect(await getLatestNotice(asDb(f.reception), f.clinicId, appointment)).toMatchObject({ messageId: id, status: "failed", failureCode: 131026, retrying: false });
  });
});

describe("reenvio rápido do bot", () => {
  it("falha passageira: nova tentativa 30 s depois, com o mesmo pedido", async () => {
    const start = seconds(1000);
    const id = await failed("bot_menu", 131000, start, null, true);
    const row = (await adminClient().from("whatsapp_messages").select("retry_at, retry_payload").eq("id", id).single()).data!;
    expect(new Date(row.retry_at!)).toEqual(seconds(1030));
    expect(row.retry_payload).toMatchObject({ context: { bot: true } });
    expect(await runSendRetries(db, f.clinicId, sender, seconds(1060))).toMatchObject({ due: 1, sent: 1 });
    const attempts = (await adminClient().from("whatsapp_messages").select("attempt, status").eq("first_attempt_id", id)).data!;
    expect(attempts).toEqual([{ attempt: 2, status: "sent" }]);
  });

  it("a conversa andou (outra mensagem saiu depois): não reenvia a resposta antiga", async () => {
    const start = seconds(2000);
    await failed("bot_menu", 131000, start, null, true);
    await recordOutboundMessage(db, f.clinicId, { phone, contactId, messageType: "bot_reply", status: "sent", waMessageId: `wamid.falhas.${++seq}` }, seconds(2010));
    const before = resends.length;
    expect(await runSendRetries(db, f.clinicId, sender, seconds(2060))).toMatchObject({ due: 1, sent: 0, dropped: 1 });
    expect(resends.length).toBe(before);
  });

  it("passados 5 minutos, desiste", async () => {
    const start = seconds(3000);
    await failed("bot_idle_closed", 131000, start, null, true);
    expect(await runSendRetries(db, f.clinicId, sender, seconds(3000 + 6 * 60))).toMatchObject({ due: 1, sent: 0, dropped: 1 });
  });
});
