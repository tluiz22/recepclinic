import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTrailSummaries } from "./appointmentTrail";

// Envios automáticos (Fase 22 · etapa 5): execuções dos crons (`job_runs`)
// e atendimentos com envio com falha — base da tela "Envios automáticos" e
// do alerta no Dashboard.

// Resumo do dia pelo agendador do Supabase (migrações 0030/0031), no fuso de
// Fortaleza (UTC-3): o da véspera tem horário fixo; o do dia sai 1h antes do
// início dos atendimentos (`dailySummarySchedule.ts`).
export const DAILY_SUMMARY_SCHEDULES = {
  preview: "Todo dia às 18h (atendimentos de amanhã)",
  final:
    "1h antes da primeira janela do dia na Disponibilidade (ou do primeiro atendimento, se for antes). Dia sem janela: 6h30. Reenvia se for marcado atendimento antes do primeiro horário já informado.",
} as const;

// Lembrete (etapa 7): hora cheia configurável, disparada pelo agendador do
// Supabase na hora exata. Opções decididas com o cliente: 7h às 20h.
export const REMINDER_HOUR_MIN = 7;
export const REMINDER_HOUR_MAX = 20;
export const DEFAULT_REMINDER_HOUR = 8;

export async function fetchReminderHour(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from("appointment_settings").select("reminder_hour").eq("id", 1).maybeSingle();
  return (data?.reminder_hour as number | undefined) ?? DEFAULT_REMINDER_HOUR;
}

// Só cobra "não rodou" 1h depois da hora configurada (folga para a chamada
// do agendador e a execução).
const REMINDER_ALERT_GRACE_HOURS = 1;

// Execução que passou disso ainda em 'running' caiu no meio (timeout).
const STUCK_AFTER_MS = 15 * 60 * 1000;

export interface JobRun {
  id: number;
  job: "appointment_reminders" | "daily_summary";
  variant: "preview" | "final" | null;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "error";
  error_message: string | null;
  totals: Record<string, number>;
}

export type JobRunState = "ok" | "error" | "running" | "stuck";

export function jobRunState(run: JobRun, now = new Date()): JobRunState {
  if (run.status === "running") {
    return now.getTime() - Date.parse(run.started_at) > STUCK_AFTER_MS ? "stuck" : "running";
  }
  return run.status;
}

export function isRunProblem(run: JobRun, now = new Date()): boolean {
  const state = jobRunState(run, now);
  return state === "error" || state === "stuck";
}

/** Início e fim do dia (hoje + `offsetDays`) no fuso de Fortaleza. */
export function fortalezaDayBounds(now = new Date(), offsetDays = 0): { start: Date; end: Date } {
  const todayStr = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = new Date(`${todayStr}T00:00:00-03:00`);
  start.setUTCDate(start.getUTCDate() + offsetDays);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Hora cheia (0–23) no fuso de Fortaleza. */
export function fortalezaHour(now: Date): number {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).getUTCHours();
}

export async function fetchRecentJobRuns(supabase: SupabaseClient, limit = 30): Promise<JobRun[]> {
  const { data } = await supabase
    .from("job_runs")
    .select("id, job, variant, started_at, finished_at, status, error_message, totals")
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as JobRun[];
}

export interface AppointmentWithFailedSends {
  id: string;
  scheduled_at: string;
  reminder_sent_at: string | null;
  appointment_type: string;
  exam_name: string | null;
  patient_id: string;
  patient_name: string;
  guardian_id: string;
  failedSends: number;
}

// Atendimentos ativos e futuros com envio com falha ainda não resolvido
// (mesma regra do aviso do Histórico, `countFailedSends`). Parte das falhas
// dos últimos `lookbackDays` pra não varrer a agenda inteira — uma falha
// mais antiga que isso num atendimento ainda futuro é improvável (o lembrete
// sai na véspera).
export async function fetchAppointmentsWithFailedSends(
  supabase: SupabaseClient,
  options: { until?: Date; lookbackDays?: number; now?: Date } = {}
): Promise<AppointmentWithFailedSends[]> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - (options.lookbackDays ?? 30) * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: failedMessages }, { data: notSentEvents }] = await Promise.all([
    supabase
      .from("whatsapp_messages")
      .select("appointment_id")
      .eq("direction", "outbound")
      .in("status", ["failed", "skipped_no_template"])
      .not("appointment_id", "is", null)
      .gte("created_at", since),
    supabase
      .from("appointment_events")
      .select("appointment_id")
      .eq("event_type", "message_not_sent")
      .gte("occurred_at", since),
  ]);

  const candidateIds = [
    ...new Set([...(failedMessages ?? []), ...(notSentEvents ?? [])].map((row) => row.appointment_id as string)),
  ];
  if (candidateIds.length === 0) return [];

  let query = supabase
    .from("appointments")
    .select(
      "id, scheduled_at, reminder_sent_at, appointment_type, exam_types ( name ), patients ( id, full_name, guardian_id )"
    )
    .in("id", candidateIds)
    .in("status", ["scheduled", "confirmed"])
    .gte("scheduled_at", now.toISOString())
    .order("scheduled_at");
  if (options.until) query = query.lt("scheduled_at", options.until.toISOString());

  const { data: appointments } = await query;
  if (!appointments?.length) return [];

  const summaries = await fetchTrailSummaries(supabase, appointments);

  return appointments
    .map((a) => {
      const patient = (a.patients ?? null) as unknown as { id: string; full_name: string; guardian_id: string } | null;
      const examType = (a.exam_types ?? null) as unknown as { name: string } | null;
      return {
        id: a.id,
        scheduled_at: a.scheduled_at,
        reminder_sent_at: a.reminder_sent_at,
        appointment_type: a.appointment_type,
        exam_name: examType?.name ?? null,
        patient_id: patient?.id ?? "",
        patient_name: patient?.full_name ?? "Paciente",
        guardian_id: patient?.guardian_id ?? "",
        failedSends: summaries.get(a.id)?.failedSends ?? 0,
      };
    })
    .filter((a) => a.failedSends > 0);
}

export interface SendsAlert {
  // Lembrete de hoje: não rodou (depois das 9h) ou a execução de hoje deu erro/caiu.
  reminderNotRun: boolean;
  reminderRunFailed: boolean;
  // Atendimentos de hoje (ainda por vir) e amanhã com envio com falha.
  failedAppointments: number;
}

export async function fetchSendsAlert(supabase: SupabaseClient, now = new Date()): Promise<SendsAlert> {
  const today = fortalezaDayBounds(now);
  const tomorrow = fortalezaDayBounds(now, 1);

  const [reminderHour, { data: todayRuns }, failed] = await Promise.all([
    fetchReminderHour(supabase),
    supabase
      .from("job_runs")
      .select("id, job, variant, started_at, finished_at, status, error_message, totals")
      .eq("job", "appointment_reminders")
      .gte("started_at", today.start.toISOString())
      .order("started_at", { ascending: false }),
    fetchAppointmentsWithFailedSends(supabase, { until: tomorrow.end, now }),
  ]);

  const runs = (todayRuns ?? []) as JobRun[];
  const latest = runs[0];

  return {
    reminderNotRun: !latest && fortalezaHour(now) >= reminderHour + REMINDER_ALERT_GRACE_HOURS,
    reminderRunFailed: latest ? isRunProblem(latest, now) : false,
    failedAppointments: failed.length,
  };
}

/** Frases do alerta (Dashboard e tela Envios automáticos); vazio = sem alerta. */
export function describeSendsAlert(alert: SendsAlert): string[] {
  const lines: string[] = [];
  if (alert.reminderNotRun) lines.push("O lembrete de hoje ainda não rodou.");
  if (alert.reminderRunFailed) lines.push("A execução do lembrete de hoje teve erro ou foi interrompida.");
  if (alert.failedAppointments > 0) {
    const noun = alert.failedAppointments === 1 ? "atendimento" : "atendimentos";
    lines.push(`${alert.failedAppointments} ${noun} de hoje ou amanhã com envio com falha.`);
  }
  return lines;
}
