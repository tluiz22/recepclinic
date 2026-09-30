import type { SupabaseClient } from "@supabase/supabase-js";
import { logAppointmentEvent } from "./audit";
import { isReminderTemplateConfigured, sendAppointmentReminder, sendExamPreparation } from "./whatsapp/notifications";

// Botão "Reenviar lembrete" (Fase 22 · etapa 6): Agenda (dia) e Envios
// automáticos. Vale para atendimento ativo, futuro e sem lembrete entregue
// — falhou, não enviado ou ainda não enviado (inclusive antes da janela do
// cron). Some depois de um envio com sucesso.

const NOT_DELIVERED = new Set(["failed", "skipped_no_template"]);

/**
 * Quais destes atendimentos (ativos e futuros — o chamador filtra) podem
 * reenviar: sem `reminder_sent_at`, ou com a última tentativa do lembrete
 * falhada (a Meta pode avisar a falha de entrega depois do envio aceito).
 */
export async function fetchReminderResendable(
  supabase: SupabaseClient,
  appointments: { id: string; reminder_sent_at: string | null }[]
): Promise<Set<string>> {
  if (appointments.length === 0) return new Set();
  const { data } = await supabase
    .from("whatsapp_messages")
    .select("appointment_id, status")
    .eq("message_type", "appointment_reminder")
    .eq("direction", "outbound")
    .in(
      "appointment_id",
      appointments.map((a) => a.id)
    )
    .order("created_at");

  const latestStatus = new Map<string, string | null>();
  for (const row of data ?? []) latestStatus.set(row.appointment_id as string, row.status as string | null);

  return new Set(
    appointments
      .filter((a) => !a.reminder_sent_at || NOT_DELIVERED.has(latestStatus.get(a.id) ?? ""))
      .map((a) => a.id)
  );
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

  // Tela desatualizada ou clique duplo: o lembrete já saiu com sucesso.
  const resendable = await fetchReminderResendable(supabase, [appointment]);
  if (!resendable.has(appointment.id)) return "not_eligible";

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

  // Quem reenviou fica na trilha mesmo se falhar — o resultado do envio
  // está na mensagem, em `whatsapp_messages`.
  await logAppointmentEvent(supabase, {
    appointmentId: appointment.id,
    type: "reminder_resent",
    channel: "admin",
    actorId,
  });

  if (status !== "sent") return "failed";

  // Mesmo efeito do cron: conta como lembrado (o cron não manda de novo) e
  // o preparo do exame vai junto (Fase 18).
  await supabase.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", appointment.id);
  if (appointment.appointment_type === "exam" && appointment.exam_type_id) {
    await sendExamPreparation({
      supabase,
      appointmentId: appointment.id,
      guardianId: guardian.id,
      guardianPhone: guardian.phone,
      examTypeId: appointment.exam_type_id,
    });
  }
  return "sent";
}

// Aviso na tela depois do reenvio (`?reenvio=`).
export const RESEND_MESSAGES: Record<ResendOutcome, { text: string; ok: boolean }> = {
  sent: { text: "Lembrete reenviado.", ok: true },
  failed: { text: "O lembrete não foi enviado: o WhatsApp recusou o envio. Veja a trilha do atendimento.", ok: false },
  no_template: { text: "O lembrete não foi enviado: o template do lembrete está desligado.", ok: false },
  no_phone: { text: "O lembrete não foi enviado: o responsável está sem telefone cadastrado.", ok: false },
  not_eligible: {
    text: "Nada a reenviar: o atendimento já recebeu o lembrete, foi cancelado ou já passou.",
    ok: false,
  },
};

export function parseResendOutcome(value: string | null): ResendOutcome | null {
  return value && value in RESEND_MESSAGES ? (value as ResendOutcome) : null;
}
