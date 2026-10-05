import { addDays, dayBounds, localHourOf, todayIn } from "../clinicTime";
import type { DbClient } from "./clients";
import { unwrap, unwrapOne } from "./errors";
import { hasFeature } from "./features";
import type { JobName, JobTrigger } from "./jobRuns";

// Envios automáticos (Fases 22 e 23 do piloto), F3.9c: execuções das rotinas
// da clínica (`job_runs`), atendimentos com envio com falha ainda não
// resolvido e o alerta do painel (aba Envios e Dashboard, F4). Tudo pela
// clínica: a hora do lembrete e o fuso são os dela.

/** Execução que passou disso ainda "rodando" caiu no meio (timeout). */
export const STUCK_AFTER_MS = 15 * 60_000;
/** Só cobra "o lembrete não rodou" 1h depois da hora do lembrete. */
export const REMINDER_ALERT_GRACE_HOURS = 1;

export type JobRun = {
  id: number;
  job: JobName;
  variant: "preview" | "final" | null;
  trigger: JobTrigger | null;
  startedAt: Date;
  finishedAt: Date | null;
  status: "running" | "ok" | "error";
  errorMessage: string | null;
  totals: Record<string, number>;
};

export type JobRunState = "ok" | "error" | "running" | "stuck";

export function jobRunState(run: Pick<JobRun, "status" | "startedAt">, now: Date = new Date()): JobRunState {
  if (run.status === "running") return now.getTime() - run.startedAt.getTime() > STUCK_AFTER_MS ? "stuck" : "running";
  return run.status;
}

export function isRunProblem(run: Pick<JobRun, "status" | "startedAt">, now: Date = new Date()): boolean {
  const state = jobRunState(run, now);
  return state === "error" || state === "stuck";
}

const RUN_COLUMNS = "id, job, variant, trigger, started_at, finished_at, status, error_message, totals";

type RunRow = {
  id: number;
  job: string;
  variant: string | null;
  trigger: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  error_message: string | null;
  totals: unknown;
};

const toRun = (row: RunRow): JobRun => ({
  id: row.id,
  job: row.job as JobName,
  variant: row.variant as JobRun["variant"],
  trigger: row.trigger as JobTrigger | null,
  startedAt: new Date(row.started_at),
  finishedAt: row.finished_at ? new Date(row.finished_at) : null,
  status: row.status as JobRun["status"],
  errorMessage: row.error_message,
  totals: (row.totals ?? {}) as Record<string, number>,
});

/** Últimas execuções das rotinas da clínica, das mais novas para as mais antigas. */
export async function listJobRuns(db: DbClient, clinicId: string, { limit = 30, job }: { limit?: number; job?: JobName } = {}): Promise<JobRun[]> {
  let query = db.from("job_runs").select(RUN_COLUMNS).eq("clinic_id", clinicId);
  if (job) query = query.eq("job", job);
  return unwrap(await query.order("started_at", { ascending: false }).limit(limit), "Execuções das rotinas").map(toRun);
}

// ---------------------------------------------------------------------------
// Envios com falha
// ---------------------------------------------------------------------------

const DELIVERED = new Set(["sent", "delivered", "read"]);
const FAILED = new Set(["failed", "skipped_no_template"]);
/** Tipo do "não enviado" na trilha → mensagem que o resolve. */
const NOT_SENT_KIND_MESSAGE_TYPE: Record<string, string> = { reminder: "appointment_reminder" };

export type SentMessage = { messageType: string; status: string | null; createdAt: Date };
export type NotSentEvent = { kind: string; scheduledAt: Date | null; occurredAt: Date };

/**
 * Envios com falha ainda não resolvidos de um atendimento (regra do piloto):
 * a última tentativa de cada tipo de mensagem falhou ou não saiu (confirmação
 * com falha deixa de contar se um aviso de remarcação saiu depois), ou há
 * "não enviado" da data atual sem envio do mesmo tipo com sucesso depois.
 */
export function countFailedSends(messages: SentMessage[], notSent: NotSentEvent[], scheduledAt: Date): number {
  const sorted = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const latestByType = new Map<string, SentMessage>();
  for (const message of sorted) latestByType.set(message.messageType, message);
  const supersededByReschedule = (m: SentMessage) =>
    m.messageType === "appointment_confirmation" &&
    sorted.some(
      (later) => later.messageType === "appointment_reschedule" && DELIVERED.has(later.status ?? "") && later.createdAt.getTime() > m.createdAt.getTime(),
    );
  let failed = [...latestByType.values()].filter((m) => FAILED.has(m.status ?? "") && !supersededByReschedule(m)).length;

  const pending = new Set<string>();
  for (const event of [...notSent].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    // Remarcou: o "não enviado" da data antiga não pesa mais.
    if (event.scheduledAt && event.scheduledAt.getTime() !== scheduledAt.getTime()) continue;
    const messageType = NOT_SENT_KIND_MESSAGE_TYPE[event.kind];
    const resolved = sorted.some(
      (m) => m.messageType === messageType && DELIVERED.has(m.status ?? "") && m.createdAt.getTime() > event.occurredAt.getTime(),
    );
    if (resolved) pending.delete(event.kind);
    else pending.add(event.kind);
  }
  // Lembrete com falha já contado pela última tentativa não conta duas vezes.
  for (const kind of pending) {
    if (!FAILED.has(latestByType.get(NOT_SENT_KIND_MESSAGE_TYPE[kind])?.status ?? "")) failed++;
  }
  return failed;
}

export type AppointmentWithFailedSends = { id: string; scheduledAt: Date; patientName: string; serviceName: string; failedSends: number };

/**
 * Atendimentos ativos e futuros com envio com falha ainda não resolvido. Parte
 * das falhas dos últimos `lookbackDays` (o lembrete sai na véspera).
 */
export async function listAppointmentsWithFailedSends(
  db: DbClient,
  clinicId: string,
  { until, lookbackDays = 30 }: { until?: Date; lookbackDays?: number } = {},
  now: Date = new Date(),
): Promise<AppointmentWithFailedSends[]> {
  const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60_000).toISOString();
  const [failedMessages, notSentEvents] = await Promise.all([
    unwrap(
      await db
        .from("whatsapp_messages")
        .select("appointment_id")
        .eq("clinic_id", clinicId)
        .eq("direction", "outbound")
        .in("status", [...FAILED])
        .not("appointment_id", "is", null)
        .gte("created_at", since),
      "Mensagens do WhatsApp",
    ),
    unwrap(
      await db.from("appointment_events").select("appointment_id").eq("clinic_id", clinicId).eq("event_type", "message_not_sent").gte("occurred_at", since),
      "Trilha",
    ),
  ]);
  const candidateIds = [...new Set([...failedMessages.map((m) => m.appointment_id!), ...notSentEvents.map((e) => e.appointment_id)])];
  if (candidateIds.length === 0) return [];

  let query = db
    .from("appointments")
    .select("id, scheduled_at, services ( name ), patients ( full_name )")
    .eq("clinic_id", clinicId)
    .in("id", candidateIds)
    .in("status", ["scheduled", "confirmed"])
    .gte("scheduled_at", now.toISOString())
    .order("scheduled_at");
  if (until) query = query.lt("scheduled_at", until.toISOString());
  const appointments = unwrap(await query, "Atendimentos") as unknown as {
    id: string;
    scheduled_at: string;
    services: { name: string };
    patients: { full_name: string };
  }[];
  if (appointments.length === 0) return [];

  const ids = appointments.map((a) => a.id);
  const [messages, events] = await Promise.all([
    unwrap(
      await db
        .from("whatsapp_messages")
        .select("appointment_id, message_type, status, created_at")
        .eq("clinic_id", clinicId)
        .eq("direction", "outbound")
        .in("appointment_id", ids),
      "Mensagens do WhatsApp",
    ),
    unwrap(
      await db
        .from("appointment_events")
        .select("appointment_id, details, occurred_at")
        .eq("clinic_id", clinicId)
        .eq("event_type", "message_not_sent")
        .in("appointment_id", ids),
      "Trilha",
    ),
  ]);

  return appointments
    .map((a) => {
      const own = messages
        .filter((m) => m.appointment_id === a.id)
        .map((m) => ({ messageType: m.message_type, status: m.status, createdAt: new Date(m.created_at) }));
      const notSent = events
        .filter((e) => e.appointment_id === a.id)
        .map((e) => {
          const details = (e.details ?? {}) as { kind?: string; scheduled_at?: string };
          return { kind: String(details.kind ?? ""), scheduledAt: details.scheduled_at ? new Date(details.scheduled_at) : null, occurredAt: new Date(e.occurred_at) };
        });
      const scheduledAt = new Date(a.scheduled_at);
      return { id: a.id, scheduledAt, patientName: a.patients.full_name, serviceName: a.services.name, failedSends: countFailedSends(own, notSent, scheduledAt) };
    })
    .filter((a) => a.failedSends > 0);
}

// ---------------------------------------------------------------------------
// Alerta do painel
// ---------------------------------------------------------------------------

export type SendsAlert = {
  /** Lembrete de hoje não rodou (1h depois da hora do lembrete da clínica). */
  reminderNotRun: boolean;
  /** A execução do lembrete de hoje deu erro ou caiu. */
  reminderRunFailed: boolean;
  /** Atendimentos de hoje (ainda por vir) e amanhã com envio com falha. */
  failedAppointments: number;
};

export async function getSendsAlert(db: DbClient, clinicId: string, now: Date = new Date()): Promise<SendsAlert> {
  const settings = unwrapOne(
    await db.from("clinic_settings").select("timezone, reminder_hour").eq("clinic_id", clinicId).maybeSingle(),
    "Configuração da clínica",
  );
  const today = todayIn(settings.timezone, now);
  const tomorrowEnd = dayBounds(addDays(today, 1), settings.timezone).end;
  const [remindersOn, runs, failed] = await Promise.all([
    hasFeature(db, clinicId, "reminders"),
    unwrap(
      await db
        .from("job_runs")
        .select(RUN_COLUMNS)
        .eq("clinic_id", clinicId)
        .eq("job", "appointment_reminders")
        .gte("started_at", dayBounds(today, settings.timezone).start.toISOString())
        .order("started_at", { ascending: false }),
      "Execuções das rotinas",
    ),
    listAppointmentsWithFailedSends(db, clinicId, { until: tomorrowEnd }, now),
  ]);

  // Só o agendador conta: um teste manual não esconde que o automático não rodou ou falhou.
  const latest = runs.map(toRun).find((run) => run.trigger !== "manual");
  return {
    reminderNotRun: remindersOn && !latest && localHourOf(now, settings.timezone) >= settings.reminder_hour + REMINDER_ALERT_GRACE_HOURS,
    reminderRunFailed: latest ? isRunProblem(latest, now) : false,
    failedAppointments: failed.length,
  };
}

/** Frases do alerta (Dashboard e aba Envios); vazio = sem alerta. */
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
