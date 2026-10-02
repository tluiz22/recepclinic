import type { SupabaseClient } from "@supabase/supabase-js";
import { sendExamPreparation } from "./notifications";

// Preparo do exame depois da entrega (ajuste de 02/out/2026). Regra do
// cliente: as orientações só saem depois de o paciente receber a confirmação
// da marcação (ou da remarcação) ou de confirmar a presença — nunca antes,
// nem junto com o lembrete. Para garantir que cheguem DEPOIS no celular, o
// preparo espera a Meta avisar (webhook de status) que a mensagem-gatilho
// foi entregue ou lida; um intervalo fixo não garantia a ordem.
//
// Presença confirmada pela tela não tem mensagem antes: o preparo sai na
// hora (`api/admin/agenda/appointments/[id]/presence.ts`).

export const PREPARATION_TRIGGER_TYPES = [
  "appointment_confirmation",
  "appointment_reschedule",
  "bot_presence_confirmed",
] as const;

export interface DeliveredMessage {
  appointment_id: string | null;
  message_type: string;
  created_at: string;
}

/**
 * Chamado pelo webhook quando uma mensagem passa a "entregue"/"lida" (uma
 * única vez por mensagem). Envia o preparo se ela é gatilho, o atendimento é
 * um exame ativo e futuro, ela é o gatilho mais recente do atendimento e
 * nenhum preparo saiu depois dela.
 */
export async function sendPreparationAfterDelivery(
  supabase: SupabaseClient,
  message: DeliveredMessage
): Promise<void> {
  if (!message.appointment_id) return;
  if (!(PREPARATION_TRIGGER_TYPES as readonly string[]).includes(message.message_type)) return;

  // Um gatilho mais novo (ex.: remarcou antes de a confirmação ser entregue)
  // decide sozinho; e um preparo já enviado depois deste gatilho basta.
  const { data: later } = await supabase
    .from("whatsapp_messages")
    .select("message_type")
    .eq("appointment_id", message.appointment_id)
    .eq("direction", "outbound")
    .in("message_type", [...PREPARATION_TRIGGER_TYPES, "exam_preparation"])
    .gt("created_at", message.created_at)
    .limit(1);
  if (later?.length) return;

  await sendPreparationIfExam(supabase, message.appointment_id);
}

/**
 * Envia o preparo se o atendimento é um exame ativo e futuro com responsável
 * com telefone; senão não faz nada. Usado depois da entrega do gatilho e na
 * presença confirmada pela tela (que não tem mensagem antes).
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
