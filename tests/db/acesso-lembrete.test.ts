import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, cancelAppointment, rescheduleAppointment } from "../../src/lib/data/agenda/appointments";
import type { DbClient } from "../../src/lib/data/clients";
import { recordInboundMessage, recordOutboundMessage, updateDeliveryStatus } from "../../src/lib/data/whatsapp/messages";
import {
  listPreparationResendable,
  resendPreparation,
  sendPreparationAfterDelivery,
  type PreparationSender,
  type PreparationToSend,
} from "../../src/lib/data/whatsapp/preparation";
import {
  listReminderActions,
  recordReminderTap,
  runAppointmentReminders,
  sendReminderFromPanel,
  type ReminderSender,
  type ReminderToSend,
} from "../../src/lib/data/whatsapp/reminders";
import { adminClient, clinicServiceClient, createClinic, deleteClinics, type TestUser } from "./helpers";
import { asDb, at, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";

// F3.9b — lembrete da véspera, botões da tela, reenvio automático, resposta
// aos botões e preparo do exame, na clínica de teste da agenda
// (tests/db/agendaFixture.ts: "agora" é domingo, 09/03/2031, meio-dia; os
// atendimentos são na segunda). Hora do lembrete: 14h (padrão).

let fixture: AgendaFixture;
let clinicId: string;
let reception: TestUser;
let ids: AgendaIds;
let bot: DbClient;
let clinicOff: string;
const db = asDb;
const SUN = "2031-03-09";

let seq = 0;
const reminders: ReminderToSend[] = [];
const failFor = new Set<string>();
const sender: ReminderSender = async (reminder) => {
  reminders.push(reminder);
  return failFor.has(reminder.appointmentId)
    ? { sent: false, reason: "recusado pela Meta" }
    : { sent: true, messageId: `wamid.rem.${Date.now()}.${++seq}`, body: "Lembrete" };
};
const preparations: PreparationToSend[] = [];
const prepFailFor = new Set<string>();
const prepSender: PreparationSender = async (preparation) => {
  preparations.push(preparation);
  return prepFailFor.has(preparation.appointmentId)
    ? { sent: false, reason: "recusado" }
    : { sent: true, messageId: `wamid.prep.${Date.now()}.${++seq}` };
};

const book = async (patient: string, service: string, agenda: string, start: Date, now = NOW) =>
  (await bookAppointment(db(reception), clinicId, { patientId: patient, serviceId: service, agendaId: agenda, start, channel: "admin", actorId: reception.id }, now))
    .appointment.id;

const appointmentRow = async (id: string) => {
  const { data } = await adminClient()
    .from("appointments")
    .select("reminder_sent_at, reminder_response, patient_confirmed_at, patient_confirmed_by")
    .eq("id", id)
    .single();
  return data!;
};

const messagesOf = async (appointmentId: string, type: string) => {
  const { data } = await adminClient()
    .from("whatsapp_messages")
    .select("status, template_name, wa_message_id, body, contact_phone")
    .eq("appointment_id", appointmentId)
    .eq("message_type", type)
    .order("created_at");
  return data!;
};

const trailOf = async (appointmentId: string, event: string) => {
  const { data } = await adminClient()
    .from("appointment_events")
    .select("channel, actor_id, details")
    .eq("appointment_id", appointmentId)
    .eq("event_type", event)
    .order("occurred_at");
  return data!;
};

const phoneOfPatient = async (patientId: string) => {
  const { data } = await adminClient().from("patients").select("contacts ( phone )").eq("id", patientId).single();
  return (data!.contacts as unknown as { phone: string }).phone;
};

const setTemplate = (key: string, status: string) =>
  adminClient().from("whatsapp_templates").update({ status }).eq("clinic_id", clinicId).eq("template_key", key);

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do lembrete", "849777300");
  ({ clinicId, reception, ids } = fixture);
  bot = clinicServiceClient(clinicId) as unknown as DbClient;
  // Os horários destes testes contam com o lembrete às 14h (o padrão era esse até a F7).
  await adminClient().from("clinic_settings").update({ reminder_hour: 14 }).eq("clinic_id", clinicId);
  await adminClient()
    .from("whatsapp_connections")
    .insert({ clinic_id: clinicId, phone_number_id: `pn-lembrete-${Date.now()}`, waba_id: "waba", status: "connected" });
  await adminClient().from("whatsapp_templates").insert([
    { clinic_id: clinicId, template_key: "reminder", name: "rc_lembrete", status: "approved" },
    { clinic_id: clinicId, template_key: "exam_preparation", name: "rc_preparo", status: "approved" },
  ]);
  await adminClient().from("services").update({ preparation_instructions: "Jejum de 4 horas." }).eq("id", ids.exame);
  clinicOff = await createClinic("Clínica sem lembrete", []);
});

afterAll(async () => {
  await deleteClinics([clinicOff]);
  await fixture.cleanup();
});

const appt = {} as Record<string, string>;

describe("lembrete da véspera (agendador)", () => {
  it("fora da hora do lembrete, nada", async () => {
    expect(await runAppointmentReminders(bot, clinicId, { trigger: "scheduled", sender }, at(SUN, "13:00"))).toEqual({ skipped: "outside_hour" });
  });

  it("na hora, lembra os atendimentos ativos de amanhã; quem falhou não conta como lembrado", async () => {
    appt.a1 = await book(ids.p1, ids.consulta, ids.agendaDra, at(MON1, "08:00"));
    appt.canceled = await book(ids.p2, ids.consulta, ids.agendaDra, at(MON1, "09:00"));
    await cancelAppointment(db(reception), clinicId, appt.canceled, { channel: "admin", actorId: reception.id }, NOW);
    appt.nextWeek = await book(ids.p3, ids.consulta, ids.agendaDra, at(MON2, "08:00"));
    appt.a4 = await book(ids.p3, ids.consulta, ids.agendaDra2, at(MON1, "08:00"));
    failFor.add(appt.a4);

    const result = await runAppointmentReminders(bot, clinicId, { trigger: "scheduled", sender }, at(SUN, "14:00"));
    expect(result).toMatchObject({ totals: { candidates: 2, sent: 1, failed: 1, not_sent_no_template: 0, not_sent_not_connected: 0 } });

    const toA1 = reminders.find((r) => r.appointmentId === appt.a1)!;
    expect(toA1).toMatchObject({
      phone: await phoneOfPatient(ids.p1),
      patientName: "Paciente Um",
      serviceName: "Consulta",
      locationName: "Consultório",
      address: "Rua A, 1",
      isHomeVisit: false,
      template: { name: "rc_lembrete", language: "pt_BR" },
      buttonPayloads: [`reminder:confirm:${appt.a1}`, `reminder:reschedule:${appt.a1}`, `reminder:cancel:${appt.a1}`],
    });
    expect((await appointmentRow(appt.a1)).reminder_sent_at).not.toBeNull();
    expect((await appointmentRow(appt.a4)).reminder_sent_at).toBeNull();
    expect(await messagesOf(appt.a4, "appointment_reminder")).toEqual([expect.objectContaining({ status: "failed", template_name: "rc_lembrete" })]);

    const { data: run } = await adminClient().from("job_runs").select("job, trigger, status, totals").eq("id", (result as { runId: number }).runId).single();
    expect(run).toMatchObject({ job: "appointment_reminders", trigger: "scheduled", status: "ok", totals: { sent: 1, failed: 1 } });
  });
});

describe("botões da tela", () => {
  it("Reenviar para quem falhou; sem resposta só depois de 2h; nada antes da véspera", async () => {
    const actions = await listReminderActions(db(reception), clinicId, [appt.a1, appt.a4, appt.nextWeek], at(SUN, "15:00"));
    expect(Object.fromEntries(actions)).toEqual({ [appt.a4]: "resend" });
    expect((await listReminderActions(db(reception), clinicId, [appt.a1], at(SUN, "16:00"))).get(appt.a1)).toBe("resend_unanswered");
  });

  it("Reenviar lembrete: envia, fica na trilha com quem enviou e não repete no clique duplo", async () => {
    failFor.delete(appt.a4);
    expect(await sendReminderFromPanel(db(reception), clinicId, appt.a4, reception.id, sender, at(SUN, "15:00"))).toBe("sent");
    expect(await sendReminderFromPanel(db(reception), clinicId, appt.a4, reception.id, sender, at(SUN, "15:00"))).toBe("not_eligible");
    expect(await trailOf(appt.a4, "reminder_resent")).toEqual([{ channel: "admin", actor_id: reception.id, details: { first: false } }]);
    expect((await appointmentRow(appt.a4)).reminder_sent_at).not.toBeNull();
  });

  it("Enviar lembrete: marcado depois do envio da véspera", async () => {
    appt.a5 = await book(ids.p2, ids.consulta, ids.agendaDra, at(MON1, "10:00"), at(SUN, "15:00"));
    expect((await listReminderActions(db(reception), clinicId, [appt.a5], at(SUN, "15:00"))).get(appt.a5)).toBe("send");
    expect(await sendReminderFromPanel(db(reception), clinicId, appt.a5, reception.id, sender, at(SUN, "15:00"))).toBe("sent");
    expect(await trailOf(appt.a5, "reminder_resent")).toEqual([{ channel: "admin", actor_id: reception.id, details: { first: true } }]);
  });
});

describe("resposta aos botões do lembrete", () => {
  it("Confirmar marca a presença pelo WhatsApp e liga o toque ao atendimento", async () => {
    const phone = await phoneOfPatient(ids.p2);
    const waMessageId = `wamid.tap.${Date.now()}`;
    await recordInboundMessage(bot, clinicId, { id: waMessageId, from: phone.slice(1), type: "button", button: { text: "Confirmar presença", payload: `reminder:confirm:${appt.a5}` } }, at(SUN, "16:00"));

    expect(await recordReminderTap(bot, clinicId, { button: "confirm", appointmentId: appt.a5, phone: "+5584900000000", waMessageId }, at(SUN, "16:00"))).toEqual({ result: "inactive" });
    const tap = await recordReminderTap(bot, clinicId, { button: "confirm", appointmentId: appt.a5, phone, waMessageId }, at(SUN, "16:00"));
    expect(tap).toMatchObject({ result: "recorded", confirmedNow: true, appointment: { patientName: "Paciente Dois", serviceCategory: "consultation" } });
    expect(await appointmentRow(appt.a5)).toMatchObject({ reminder_response: "confirmed", patient_confirmed_by: null });
    expect((await appointmentRow(appt.a5)).patient_confirmed_at).not.toBeNull();
    expect(await trailOf(appt.a5, "presence_confirmed")).toEqual([{ channel: "whatsapp_bot", actor_id: null, details: {} }]);
    const { data: inbound } = await adminClient().from("whatsapp_messages").select("appointment_id, message_type").eq("wa_message_id", waMessageId).single();
    expect(inbound).toEqual({ appointment_id: appt.a5, message_type: "reminder_confirm" });

    // De novo: já estava confirmada.
    expect(await recordReminderTap(bot, clinicId, { button: "confirm", appointmentId: appt.a5, phone, waMessageId: null }, at(SUN, "16:10"))).toMatchObject({ confirmedNow: false });
  });

  it("remarcar zera o lembrete e a resposta; o toque no lembrete antigo não vale mais", async () => {
    await rescheduleAppointment(db(reception), clinicId, appt.a5, { start: at(MON1, "11:00"), channel: "admin", actorId: reception.id }, at(SUN, "16:20"));
    expect(await appointmentRow(appt.a5)).toMatchObject({ reminder_sent_at: null, reminder_response: null, patient_confirmed_at: null });
    const phone = await phoneOfPatient(ids.p2);
    expect(await recordReminderTap(bot, clinicId, { button: "cancel", appointmentId: appt.a5, phone, waMessageId: null }, at(SUN, "16:30"))).toEqual({ result: "inactive" });
  });
});

describe("preparo do exame", () => {
  const confirmationDelivered = async (appointmentId: string, phone: string, now: Date) => {
    const waMessageId = `wamid.conf.${Date.now()}.${++seq}`;
    await recordOutboundMessage(bot, clinicId, { phone, appointmentId, messageType: "appointment_confirmation", status: "sent", waMessageId }, now);
    return updateDeliveryStatus(bot, clinicId, waMessageId, "delivered");
  };

  it("sai uma vez, quando a confirmação do exame chega; janela fechada vai por template", async () => {
    appt.e1 = await book(ids.p1, ids.exame, ids.agendaExams, at(MON1, "08:00"));
    const phone = await phoneOfPatient(ids.p1);
    const delivered = await confirmationDelivered(appt.e1, phone, NOW);
    expect(await sendPreparationAfterDelivery(bot, clinicId, delivered, prepSender, NOW)).toBe("sent");
    expect(preparations.at(-1)).toMatchObject({
      appointmentId: appt.e1,
      examName: "Exame",
      instructions: "Jejum de 4 horas.",
      pagePath: `/preparo/${ids.exame}`,
      mode: "template",
      template: { name: "rc_preparo", language: "pt_BR" },
    });
    // Outra confirmação entregue não manda de novo.
    expect(await sendPreparationAfterDelivery(bot, clinicId, await confirmationDelivered(appt.e1, phone, NOW), prepSender, NOW)).toBeNull();
    // Confirmação de consulta não tem preparo.
    expect(await sendPreparationAfterDelivery(bot, clinicId, await confirmationDelivered(appt.a1, phone, NOW), prepSender, NOW)).toBeNull();
  });

  it("falhou: Reenviar preparo pela tela, com texto se a janela de 24h está aberta", async () => {
    appt.e2 = await book(ids.p2, ids.exame, ids.agendaExams, at(MON1, "08:20"));
    const phone = await phoneOfPatient(ids.p2);
    await recordInboundMessage(bot, clinicId, { id: `wamid.in.${Date.now()}`, from: phone.slice(1), type: "text", text: { body: "Oi" } }, NOW);
    prepFailFor.add(appt.e2);
    expect(await sendPreparationAfterDelivery(bot, clinicId, await confirmationDelivered(appt.e2, phone, NOW), prepSender, NOW)).toBe("failed");
    expect(await listPreparationResendable(db(reception), clinicId, [appt.e1, appt.e2])).toEqual(new Set([appt.e2]));

    prepFailFor.delete(appt.e2);
    const later = at(SUN, "13:00");
    expect(await resendPreparation(db(reception), clinicId, appt.e2, reception.id, prepSender, later)).toBe("sent");
    expect(preparations.at(-1)).toMatchObject({ appointmentId: appt.e2, mode: "text", template: null });
    expect(await trailOf(appt.e2, "preparation_resent")).toEqual([{ channel: "admin", actor_id: reception.id, details: {} }]);
    expect(await resendPreparation(db(reception), clinicId, appt.e2, reception.id, prepSender, later)).toBe("not_eligible");
    expect(await resendPreparation(db(reception), clinicId, appt.a1, reception.id, prepSender, later)).toBe("not_eligible");
  });
});

describe("sem template, sem conexão e sem o item", () => {
  it("sem template aprovado: não envia, não conta como lembrado e registra 'não enviado' uma vez", async () => {
    await setTemplate("reminder", "pending");
    appt.a6 = await book(ids.p1, ids.consulta, ids.agendaDra2, at(MON1, "08:30"), at(SUN, "15:30"));
    const first = await runAppointmentReminders(bot, clinicId, { trigger: "manual", sender }, at(SUN, "16:00"));
    // Ainda sem lembrete: a5 (remarcado), a6 e os exames e1 e e2.
    expect(first).toMatchObject({ totals: { candidates: 4, sent: 0, not_sent_no_template: 4 } });
    await runAppointmentReminders(bot, clinicId, { trigger: "manual", sender }, at(SUN, "16:05"));
    expect(await trailOf(appt.a6, "message_not_sent")).toEqual([
      { channel: "cron", actor_id: null, details: { kind: "reminder", reason: "template_disabled", scheduled_at: at(MON1, "08:30").toISOString() } },
    ]);
    expect(await sendReminderFromPanel(db(reception), clinicId, appt.a6, reception.id, sender, at(SUN, "16:10"))).toBe("no_template");
  });

  it("WhatsApp desconectado: não envia", async () => {
    await setTemplate("reminder", "approved");
    await adminClient().from("whatsapp_connections").update({ status: "disconnected" }).eq("clinic_id", clinicId);
    expect(await sendReminderFromPanel(db(reception), clinicId, appt.a6, reception.id, sender, at(SUN, "16:10"))).toBe("not_connected");
    expect(await runAppointmentReminders(bot, clinicId, { trigger: "manual", sender }, at(SUN, "16:15"))).toMatchObject({
      totals: { not_sent_not_connected: 4 },
    });
    expect((await trailOf(appt.a6, "message_not_sent")).map((e) => (e.details as { reason: string }).reason)).toEqual(["template_disabled", "not_connected"]);
    await adminClient().from("whatsapp_connections").update({ status: "connected" }).eq("clinic_id", clinicId);
  });

  it("sem o item 'Lembrete automático': nada roda nem aparece", async () => {
    const off = clinicServiceClient(clinicOff) as unknown as DbClient;
    expect(await runAppointmentReminders(off, clinicOff, { trigger: "manual", sender })).toEqual({ skipped: "not_enabled" });
    expect(await listReminderActions(off, clinicOff, [appt.a1])).toEqual(new Map());
    expect(await sendReminderFromPanel(off, clinicOff, appt.a1, null, sender)).toBe("not_enabled");
    expect(await resendPreparation(off, clinicOff, appt.e2, null, prepSender)).toBe("not_enabled");
  });
});
