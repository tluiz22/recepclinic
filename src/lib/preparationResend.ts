import type { SupabaseClient } from "@supabase/supabase-js";
import { logAppointmentEvent } from "./audit";
import { sendExamPreparation } from "./whatsapp/notifications";

// Botão "Reenviar preparo do exame" (ajuste de 02/out/2026): Agenda (dia) e
// Envios automáticos. Decisão do cliente: um botão por tipo de envio — este
// manda só o preparo; o lembrete tem o seu ("Reenviar lembrete",
// `reminderResend.ts`). Vale para exame ativo e futuro cuja última tentativa
// do preparo falhou ou ficou "template desligado". Some quando o preparo for
// entregue.

const NOT_DELIVERED = new Set(["failed", "skipped_no_template"]);

/**
 * Quais destes atendimentos (ativos e futuros — o chamador filtra) podem
 * reenviar o preparo: a última tentativa de `exam_preparation` não foi
 * entregue. Sem tentativa nenhuma não entra (o preparo vai junto da
 * confirmação e do lembrete).
 */
export async function fetchPreparationResendable(
  supabase: SupabaseClient,
  appointmentIds: string[]
): Promise<Set<string>> {
  if (appointmentIds.length === 0) return new Set();
  const { data } = await supabase
    .from("whatsapp_messages")
    .select("appointment_id, status")
    .eq("message_type", "exam_preparation")
    .eq("direction", "outbound")
    .in("appointment_id", appointmentIds)
    .order("created_at");

  const latestStatus = new Map<string, string | null>();
  for (const row of data ?? []) latestStatus.set(row.appointment_id as string, row.status as string | null);

  return new Set(appointmentIds.filter((id) => NOT_DELIVERED.has(latestStatus.get(id) ?? "")));
}

export type PreparationResendOutcome = "sent" | "failed" | "no_template" | "no_phone" | "not_eligible";

export async function resendPreparation(
  supabase: SupabaseClient,
  appointmentId: string,
  actorId: string | null
): Promise<PreparationResendOutcome> {
  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, status, scheduled_at, appointment_type, exam_type_id, patients ( guardians ( id, phone ) )")
    .eq("id", appointmentId)
    .maybeSingle();

  if (
    !appointment ||
    appointment.appointment_type !== "exam" ||
    !appointment.exam_type_id ||
    !["scheduled", "confirmed"].includes(appointment.status) ||
    Date.parse(appointment.scheduled_at) <= Date.now()
  ) {
    return "not_eligible";
  }

  // Tela desatualizada ou clique duplo: o preparo já foi entregue.
  const resendable = await fetchPreparationResendable(supabase, [appointment.id]);
  if (!resendable.has(appointment.id)) return "not_eligible";

  const patient = (appointment.patients ?? null) as unknown as {
    guardians: { id: string; phone: string } | null;
  } | null;
  const guardian = patient?.guardians ?? null;
  if (!guardian?.phone) return "no_phone";

  const status = await sendExamPreparation({
    supabase,
    appointmentId: appointment.id,
    guardianId: guardian.id,
    guardianPhone: guardian.phone,
    examTypeId: appointment.exam_type_id,
  });

  // Exame sem preparo cadastrado (tirado depois da falha): nada foi enviado.
  if (status === null) return "not_eligible";

  // Quem reenviou fica na trilha mesmo se falhar — o resultado do envio
  // está na mensagem, em `whatsapp_messages`.
  await logAppointmentEvent(supabase, {
    appointmentId: appointment.id,
    type: "preparation_resent",
    channel: "admin",
    actorId,
  });

  if (status === "skipped_no_template") return "no_template";
  return status === "sent" ? "sent" : "failed";
}

// Aviso na tela depois do reenvio (`?preparo=`).
export const PREPARATION_RESEND_MESSAGES: Record<PreparationResendOutcome, { text: string; ok: boolean }> = {
  sent: { text: "Preparo do exame reenviado.", ok: true },
  failed: {
    text: "O preparo não foi enviado: o WhatsApp recusou o envio. Veja a trilha do atendimento.",
    ok: false,
  },
  no_template: { text: "O preparo não foi enviado: o template do preparo do exame está desligado.", ok: false },
  no_phone: { text: "O preparo não foi enviado: o responsável está sem telefone cadastrado.", ok: false },
  not_eligible: {
    text: "Nada a reenviar: o preparo já foi entregue, o atendimento foi cancelado ou já passou.",
    ok: false,
  },
};

export function parsePreparationResendOutcome(value: string | null): PreparationResendOutcome | null {
  return value && value in PREPARATION_RESEND_MESSAGES ? (value as PreparationResendOutcome) : null;
}
