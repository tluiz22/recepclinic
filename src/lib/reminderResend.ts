import type { SupabaseClient } from "@supabase/supabase-js";
import { logAppointmentEvent } from "./audit";
import { isReminderTemplateConfigured, sendAppointmentReminder } from "./whatsapp/notifications";

import { fetchReminderHour } from "./automaticSends";

// Botão do lembrete na Agenda (Fase 22 · etapa 6; regra revista na Fase 23 ·
// etapa 3, decisão do cliente) — vale para atendimento ativo e futuro:
// - "Reenviar lembrete": já houve tentativa (do agendador ou da tela) que
//   não foi entregue;
// - "Enviar lembrete": nenhuma tentativa e o envio automático da véspera já
//   passou — inclui quem foi marcado depois dele ou para o próprio dia, que
//   nunca recebe o lembrete automático;
// - nenhum botão antes do envio automático da véspera ou depois de um envio
//   com sucesso.
// Só contam os lembretes enviados depois da última remarcação: remarcar zera
// o lembrete (a data nova pede outro), e o lembrete da data antiga não é
// "tentativa não entregue" (achado do cliente, 02/out/2026).
// - "Reenviar lembrete" também para lembrete entregue e sem resposta há 2h
//   ou mais (nenhum botão tocado e presença não marcada) — 03/out/2026.
//
// Reenvio automático (03/out/2026, `autoResendUnanswered`): 4h depois do
// lembrete automático, para quem não respondeu, uma vez só, entre 7h e 20h
// (Fortaleza; fora disso espera a próxima hora permitida, se o atendimento
// ainda não passou). Não sai se a equipe já reenviou pelo botão nem para
// lembrete cujo primeiro envio foi pelo "Enviar lembrete", nem para atendimento
// que começa em menos de 2h.

const NOT_DELIVERED = new Set(["failed", "skipped_no_template"]);

// "resend": tentativa não entregue; "resend_unanswered": entregue e sem resposta.
export type ReminderAction = "send" | "resend" | "resend_unanswered";

const UNANSWERED_BUTTON_MS = 2 * 60 * 60 * 1000;
const AUTO_RESEND_MS = 4 * 60 * 60 * 1000;
const AUTO_RESEND_HOURS = { first: 7, last: 20 };
const AUTO_RESEND_MIN_LEAD_MS = 2 * 60 * 60 * 1000;

export interface ReminderActionInput {
  id: string;
  scheduled_at: string;
  reminder_sent_at: string | null;
  rescheduled_at?: string | null;
  // Resposta ao lembrete (botão tocado) e presença marcada — qualquer uma
  // conta como "respondeu".
  reminder_response?: string | null;
  patient_confirmed_at?: string | null;
}

/** Envio automático que cobriria o atendimento: véspera, na hora configurada (Fortaleza, UTC-3). */
export function reminderCutoff(scheduledAt: Date, reminderHour: number): Date {
  const local = new Date(scheduledAt.getTime() - 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - 1, reminderHour + 3));
}

/**
 * Qual botão cada atendimento (ativo e futuro — o chamador filtra) mostra.
 * Fora do mapa = nenhum botão.
 */
export async function fetchReminderActions(
  supabase: SupabaseClient,
  appointments: ReminderActionInput[],
  now = new Date()
): Promise<Map<string, ReminderAction>> {
  const actions = new Map<string, ReminderAction>();
  if (appointments.length === 0) return actions;

  const [reminderHour, { data }] = await Promise.all([
    fetchReminderHour(supabase),
    supabase
      .from("whatsapp_messages")
      .select("appointment_id, status, created_at")
      .eq("message_type", "appointment_reminder")
      .eq("direction", "outbound")
      .in(
        "appointment_id",
        appointments.map((a) => a.id)
      )
      .order("created_at"),
  ]);

  const rescheduledAt = new Map(
    appointments.map((a) => [a.id, a.rescheduled_at ? Date.parse(a.rescheduled_at) : null])
  );
  const latest = new Map<string, { status: string | null; createdAt: number }>();
  for (const row of data ?? []) {
    const since = rescheduledAt.get(row.appointment_id as string);
    if (since && Date.parse(row.created_at as string) < since) continue;
    latest.set(row.appointment_id as string, {
      status: row.status as string | null,
      createdAt: Date.parse(row.created_at as string),
    });
  }

  for (const appointment of appointments) {
    const last = latest.get(appointment.id);
    if (last) {
      // A Meta pode avisar a falha de entrega depois do envio aceito.
      if (NOT_DELIVERED.has(last.status ?? "") || !appointment.reminder_sent_at) {
        actions.set(appointment.id, "resend");
      } else if (
        !appointment.reminder_response &&
        !appointment.patient_confirmed_at &&
        now.getTime() - last.createdAt >= UNANSWERED_BUTTON_MS
      ) {
        actions.set(appointment.id, "resend_unanswered");
      }
    } else if (
      !appointment.reminder_sent_at &&
      now.getTime() >= reminderCutoff(new Date(appointment.scheduled_at), reminderHour).getTime()
    ) {
      actions.set(appointment.id, "send");
    }
  }
  return actions;
}

export type ResendOutcome = "sent" | "failed" | "no_template" | "no_phone" | "not_eligible";

export async function resendReminder(
  supabase: SupabaseClient,
  appointmentId: string,
  actorId: string | null
): Promise<ResendOutcome> {
  const { data: appointment } = await supabase
    .from("appointments")
    .select(
      `${REMINDER_APPOINTMENT_COLUMNS}, reminder_sent_at, rescheduled_at, reminder_response, patient_confirmed_at`
    )
    .eq("id", appointmentId)
    .maybeSingle();

  if (
    !appointment ||
    !["scheduled", "confirmed"].includes(appointment.status) ||
    Date.parse(appointment.scheduled_at) <= Date.now()
  ) {
    return "not_eligible";
  }

  // Tela desatualizada ou clique duplo (o lembrete já saiu com sucesso), ou
  // antes do envio automático da véspera.
  const actions = await fetchReminderActions(supabase, [appointment]);
  if (!actions.has(appointment.id)) return "not_eligible";

  const status = await deliverReminder(supabase, appointment as unknown as ReminderAppointmentRow);
  if (status === "no_phone" || status === "no_template") return status;

  // Quem enviou fica na trilha mesmo se falhar — o resultado do envio está
  // na mensagem, em `whatsapp_messages`. `first`: primeira tentativa
  // ("Enviar lembrete"), não um reenvio.
  await logAppointmentEvent(supabase, {
    appointmentId: appointment.id,
    type: "reminder_resent",
    channel: "admin",
    actorId,
    details: { first: actions.get(appointment.id) === "send" },
  });

  if (status !== "sent") return "failed";

  // Mesmo efeito do cron: conta como lembrado (o cron não manda de novo). O
  // preparo do exame não vai junto (regra do cliente, 02/out/2026).
  await supabase.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", appointment.id);
  return "sent";
}

const REMINDER_APPOINTMENT_COLUMNS =
  "id, status, scheduled_at, appointment_type, exam_type_id, home_visit_address, clinic_locations ( type, address ), exam_types ( name ), patients ( full_name, guardians ( id, full_name, phone ) )";

interface ReminderAppointmentRow {
  id: string;
  scheduled_at: string;
  appointment_type: string;
  home_visit_address: string | null;
  clinic_locations: { type: string; address: string | null } | null;
  exam_types: { name: string } | null;
  patients: { full_name: string; guardians: { id: string; full_name: string; phone: string } | null } | null;
}

/** Envia o lembrete (template com botões) e devolve o status registrado. */
async function deliverReminder(
  supabase: SupabaseClient,
  appointment: ReminderAppointmentRow
): Promise<string> {
  const patient = appointment.patients;
  const guardian = patient?.guardians ?? null;
  if (!patient || !guardian?.phone) return "no_phone";
  if (!isReminderTemplateConfigured()) return "no_template";
  const location = appointment.clinic_locations;
  return sendAppointmentReminder({
    supabase,
    appointmentId: appointment.id,
    guardianId: guardian.id,
    guardianPhone: guardian.phone,
    patientName: patient.full_name,
    appointmentType: appointment.appointment_type,
    examName: appointment.exam_types?.name,
    scheduledAt: new Date(appointment.scheduled_at),
    locationType: location?.type,
    locationAddress: appointment.home_visit_address ?? location?.address ?? null,
  });
}

function fortalezaHourOf(date: Date): number {
  return new Date(date.getTime() - 3 * 60 * 60 * 1000).getUTCHours();
}

/**
 * Reenvio automático do lembrete sem resposta (ver cabeçalho). Chamado pela
 * rota do lembrete, que o agendador do Supabase chama de hora em hora.
 * Devolve quantos foram reenviados.
 */
export async function autoResendUnanswered(supabase: SupabaseClient, now = new Date()): Promise<number> {
  const hour = fortalezaHourOf(now);
  if (hour < AUTO_RESEND_HOURS.first || hour > AUTO_RESEND_HOURS.last) return 0;

  const { data: candidates } = await supabase
    .from("appointments")
    .select(`${REMINDER_APPOINTMENT_COLUMNS}, reminder_sent_at, rescheduled_at`)
    .in("status", ["scheduled", "confirmed"])
    .gt("scheduled_at", new Date(now.getTime() + AUTO_RESEND_MIN_LEAD_MS).toISOString())
    .not("reminder_sent_at", "is", null)
    .lte("reminder_sent_at", new Date(now.getTime() - AUTO_RESEND_MS).toISOString())
    .gte("reminder_sent_at", new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString())
    .is("reminder_response", null)
    .is("patient_confirmed_at", null);
  if (!candidates?.length) return 0;

  const ids = candidates.map((row) => row.id as string);
  const [{ data: messages }, { data: events }] = await Promise.all([
    supabase
      .from("whatsapp_messages")
      .select("appointment_id, status, created_at")
      .eq("message_type", "appointment_reminder")
      .eq("direction", "outbound")
      .in("appointment_id", ids),
    supabase.from("appointment_events").select("appointment_id, occurred_at").eq("event_type", "reminder_resent").in("appointment_id", ids),
  ]);

  let resent = 0;
  for (const appointment of candidates) {
    const since = appointment.rescheduled_at ? Date.parse(appointment.rescheduled_at as string) : 0;
    const reminders = (messages ?? []).filter(
      (m) => m.appointment_id === appointment.id && Date.parse(m.created_at as string) >= since
    );
    const manual = (events ?? []).some(
      (e) => e.appointment_id === appointment.id && Date.parse(e.occurred_at as string) >= since
    );
    // Só o lembrete automático, uma vez entregue e nunca reenviado.
    if (manual || reminders.length !== 1 || NOT_DELIVERED.has((reminders[0].status as string) ?? "")) continue;
    if (now.getTime() - Date.parse(reminders[0].created_at as string) < AUTO_RESEND_MS) continue;

    const status = await deliverReminder(supabase, appointment as unknown as ReminderAppointmentRow);
    if (status === "no_phone" || status === "no_template") continue;
    await logAppointmentEvent(supabase, {
      appointmentId: appointment.id as string,
      type: "reminder_resent",
      channel: "cron",
      details: { automatic: true },
    });
    if (status === "sent") {
      resent++;
      await supabase.from("appointments").update({ reminder_sent_at: now.toISOString() }).eq("id", appointment.id);
    }
  }
  return resent;
}

// Aviso na tela depois do reenvio (`?reenvio=`).
export const RESEND_MESSAGES: Record<ResendOutcome, { text: string; ok: boolean }> = {
  sent: { text: "Lembrete enviado.", ok: true },
  failed: { text: "O lembrete não foi enviado: o WhatsApp recusou o envio. Veja a trilha do atendimento.", ok: false },
  no_template: { text: "O lembrete não foi enviado: o template do lembrete está desligado.", ok: false },
  no_phone: { text: "O lembrete não foi enviado: o responsável está sem telefone cadastrado.", ok: false },
  not_eligible: {
    text:
      "Nada a enviar: o atendimento já recebeu o lembrete, foi cancelado, já passou ou o envio automático da véspera ainda não aconteceu.",
    ok: false,
  },
};

export function parseResendOutcome(value: string | null): ResendOutcome | null {
  // Só os códigos próprios (achado 4 da F1: `in` aceitava "toString" e outros herdados).
  return value !== null && Object.hasOwn(RESEND_MESSAGES, value) ? (value as ResendOutcome) : null;
}
