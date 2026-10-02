import type { SupabaseClient } from "@supabase/supabase-js";

// Trilha de auditoria (Fase 22) — grava em `appointment_events` e `job_runs`
// (migração 0028). Melhor esforço: uma falha aqui nunca pode travar a ação
// da agenda, a conversa do bot nem o cron, só loga.

export type AppointmentEventType =
  | "created"
  | "rescheduled"
  | "canceled"
  | "presence_confirmed"
  | "presence_unconfirmed"
  | "attendance_recorded"
  | "attendance_corrected"
  | "message_not_sent"
  | "reminder_resent"
  | "preparation_resent"
  // Lista de espera (Fase 25)
  | "waitlist_joined"
  | "waitlist_left"
  | "waitlist_advanced";

export type AppointmentEventChannel =
  | "admin"
  | "whatsapp_bot"
  | "booking_link"
  | "cron"
  | "mass_cancel"
  | "schedule_block";

export interface AppointmentEvent {
  appointmentId: string;
  type: AppointmentEventType;
  channel: AppointmentEventChannel;
  // Login de quem fez pela tela; nulo = WhatsApp ou o próprio sistema.
  actorId?: string | null;
  details?: Record<string, unknown>;
}

export async function logAppointmentEvent(supabase: SupabaseClient, event: AppointmentEvent): Promise<void> {
  const { error } = await supabase.from("appointment_events").insert({
    appointment_id: event.appointmentId,
    event_type: event.type,
    channel: event.channel,
    actor_id: event.actorId ?? null,
    details: event.details ?? {},
  });
  if (error) {
    console.error("[audit] erro ao gravar evento:", event.type, event.appointmentId, error.message);
  }
}

export type JobName = "appointment_reminders" | "daily_summary";

// Quem disparou: o agendador do Supabase (`?trigger=scheduled`) ou uma
// chamada à mão da rota (teste) — marcada na tela Envios (migração 0035).
export type JobTrigger = "scheduled" | "manual";

/**
 * Abre a execução como 'running' e devolve o id para `finishJobRun` (null se
 * a gravação falhou — o cron segue normalmente).
 */
export async function startJobRun(
  supabase: SupabaseClient,
  job: JobName,
  variant: "preview" | "final" | null,
  trigger: JobTrigger
): Promise<number | null> {
  const { data, error } = await supabase.from("job_runs").insert({ job, variant, trigger }).select("id").single();
  if (error) {
    console.error("[audit] erro ao abrir execução:", job, variant, error.message);
    return null;
  }
  return data.id as number;
}

export async function finishJobRun(
  supabase: SupabaseClient,
  runId: number | null,
  result: { totals?: Record<string, number>; error?: string | null }
): Promise<void> {
  if (runId === null) return;
  const { error } = await supabase
    .from("job_runs")
    .update({
      finished_at: new Date().toISOString(),
      status: result.error ? "error" : "ok",
      error_message: result.error ?? null,
      totals: result.totals ?? {},
    })
    .eq("id", runId);
  if (error) {
    console.error("[audit] erro ao fechar execução:", runId, error.message);
  }
}
