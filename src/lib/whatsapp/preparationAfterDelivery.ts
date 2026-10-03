import type { SupabaseClient } from "@supabase/supabase-js";
import { sendExamPreparation } from "./notifications";

// Preparo do exame depois da entrega. Regra do cliente (03/out/2026, revendo
// a de 02/out): as orientações saem **uma única vez**, depois que o paciente
// recebe a confirmação da marcação do exame — nunca junto com o lembrete, nem
// de novo na remarcação ou na presença confirmada (pelo lembrete ou pela
// tela). Para chegarem DEPOIS no celular, o preparo espera a Meta avisar
// (webhook de status) que a confirmação foi entregue ou lida. O botão
// "Reenviar preparo do exame" da Agenda continua para reenvio manual.

export const PREPARATION_TRIGGER_TYPES = ["appointment_confirmation"] as const;

export interface DeliveredMessage {
  appointment_id: string | null;
  message_type: string;
  created_at: string;
}

/**
 * Chamado pelo webhook quando uma mensagem passa a "entregue"/"lida" (uma
 * única vez por mensagem). Envia o preparo se ela é a confirmação da
 * marcação, o atendimento é um exame ativo e futuro e nenhum preparo foi
 * enviado antes para ele (envio único).
 */
export async function sendPreparationAfterDelivery(
  supabase: SupabaseClient,
  message: DeliveredMessage
): Promise<void> {
  if (!message.appointment_id) return;
  if (!(PREPARATION_TRIGGER_TYPES as readonly string[]).includes(message.message_type)) return;

  // Envio único: qualquer preparo já registrado para o atendimento basta (o
  // que falhou é reenviado pelo botão da Agenda).
  const { data: previous } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("appointment_id", message.appointment_id)
    .eq("direction", "outbound")
    .eq("message_type", "exam_preparation")
    .limit(1);
  if (previous?.length) return;

  await sendPreparationIfExam(supabase, message.appointment_id);
}

/**
 * Envia o preparo se o atendimento é um exame ativo e futuro com responsável
 * com telefone; senão não faz nada. Usado depois da entrega da confirmação.
 */
export async function sendPreparationIfExam(supabase: SupabaseClient, appointmentId: string): Promise<void> {
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
    return;
  }

  const patient = (appointment.patients ?? null) as unknown as {
    guardians: { id: string; phone: string } | null;
  } | null;
  const guardian = patient?.guardians ?? null;
  if (!guardian?.phone) return;

  await sendExamPreparation({
    supabase,
    appointmentId: appointment.id,
    guardianId: guardian.id,
    guardianPhone: guardian.phone,
    examTypeId: appointment.exam_type_id,
  });
}
