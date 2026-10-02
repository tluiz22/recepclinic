import type { SupabaseClient } from "@supabase/supabase-js";
import { logAppointmentEvent, type AppointmentEventChannel } from "./audit";

// Lista de espera para encaixe/antecipação (Fase 25, migração 0037). Quem já
// tem atendimento marcado entra pelo bot (ou ao confirmar pelo link, quando
// pediu antes de ter marcação); a fila é por ordem de entrada. Ofertas de
// vaga ficam no motor da etapa 3.

export type JoinResult = "joined" | "already" | "error";

/** Coloca o atendimento na fila. Já estar na lista não é erro. */
export async function joinWaitlist(
  supabase: SupabaseClient,
  appointmentId: string,
  via: "whatsapp_bot" | "booking_link"
): Promise<JoinResult> {
  const { error } = await supabase
    .from("waitlist_entries")
    .insert({ appointment_id: appointmentId, created_via: via });
  if (error) {
    // 23505: índice único de uma entrada ativa por atendimento.
    if (error.code === "23505") return "already";
    console.error("[lista de espera] erro ao entrar na lista:", error.message);
    return "error";
  }
  await logAppointmentEvent(supabase, { appointmentId, type: "waitlist_joined", channel: via });
  return "joined";
}

export type LeaveReason = "bot" | "admin";

/** Tira o atendimento da fila (saiu pelo bot ou retirado pela tela). */
export async function leaveWaitlist(
  supabase: SupabaseClient,
  appointmentId: string,
  reason: LeaveReason,
  actorId: string | null = null
): Promise<boolean> {
  const { data, error } = await supabase
    .from("waitlist_entries")
    .update({
      status: reason === "bot" ? "left" : "removed",
      ended_at: new Date().toISOString(),
      ended_reason: reason,
      ended_by: actorId,
    })
    .eq("appointment_id", appointmentId)
    .eq("status", "active")
    .select("id");
  if (error) {
    console.error("[lista de espera] erro ao sair da lista:", error.message);
    return false;
  }
  if (!data?.length) return false;
  const channel: AppointmentEventChannel = reason === "bot" ? "whatsapp_bot" : "admin";
  await logAppointmentEvent(supabase, {
    appointmentId,
    type: "waitlist_left",
    channel,
    actorId,
    details: { reason },
  });
  return true;
}

/** Quais destes atendimentos estão na fila agora. */
export async function fetchActiveWaitlistAppointmentIds(
  supabase: SupabaseClient,
  appointmentIds: string[]
): Promise<Set<string>> {
  if (!appointmentIds.length) return new Set();
  const { data } = await supabase
    .from("waitlist_entries")
    .select("appointment_id")
    .eq("status", "active")
    .in("appointment_id", appointmentIds);
  return new Set((data ?? []).map((row) => row.appointment_id as string));
}
