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

const NOT_DELIVERED = new Set(["failed", "skipped_no_template"]);

export type ReminderAction = "send" | "resend";

export interface ReminderActionInput {
  id: string;
  scheduled_at: string;
  reminder_sent_at: string | null;
  rescheduled_at?: string | null;
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
  const latestStatus = new Map<string, string | null>();
  for (const row of data ?? []) {
    const since = rescheduledAt.get(row.appointment_id as string);
    if (since && Date.parse(row.created_at as string) < since) continue;
    latestStatus.set(row.appointment_id as string, row.status as string | null);
  }

  for (const appointment of appointments) {
    const attempted = latestStatus.has(appointment.id);
    if (attempted) {
      // A Meta pode avisar a falha de entrega depois do envio aceito.
      if (NOT_DELIVERED.has(latestStatus.get(appointment.id) ?? "") || !appointment.reminder_sent_at) {
        actions.set(appointment.id, "resend");
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
      "id, status, scheduled_at, reminder_sent_at, appointment_type, exam_type_id, home_visit_address, clinic_locations ( type, address ), exam_types ( name ), patients ( full_name, guardians ( id, full_name, phone ) )"
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

  const patient = (appointment.patients ?? null) as unknown as {
    full_name: string;
    guardians: { id: string; full_name: string; phone: string } | null;
  } | null;
  const guardian = patient?.guardians ?? null;
  if (!patient || !guardian?.phone) return "no_phone";
  if (!isReminderTemplateConfigured()) return "no_template";

  const location = (appointment.clinic_locations ?? null) as unknown as {
    type: string;
    address: string | null;
  } | null;
  const examType = (appointment.exam_types ?? null) as unknown as { name: string } | null;

  const status = await sendAppointmentReminder({
    supabase,
    appointmentId: appointment.id,
    guardianId: guardian.id,
    guardianPhone: guardian.phone,
    patientName: patient.full_name,
    appointmentType: appointment.appointment_type,
    examName: examType?.name,
    scheduledAt: new Date(appointment.scheduled_at),
    locationType: location?.type,
    locationAddress: appointment.home_visit_address ?? location?.address ?? null,
  });

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
  return value && value in RESEND_MESSAGES ? (value as ResendOutcome) : null;
}
