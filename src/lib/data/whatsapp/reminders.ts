import { addDays, dayBounds, localDateOf, localHourOf, toInstant, todayIn } from "../../clinicTime";
import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { unwrap, unwrapOne } from "../errors";
import { hasFeature } from "../features";
import { finishJobRun, startJobRun, type JobTrigger } from "../jobRuns";
import { logTrail } from "../agenda/appointments";
import { getApprovedTemplate, getWhatsappConnection } from "./connection";
import { resetConversationAfterNotice } from "./conversations";
import { recordOutboundMessage, type SendOutcome } from "./messages";

// Lembrete da véspera e reenvios (Fases 19, 22 e 23 do piloto), F3.9b. Só
// com o item "Lembrete automático" liberado (D11: lembrete, botões de envio
// e reenvio, reenvio automático e hora) e com o WhatsApp da clínica conectado.
//
// - **Lembrete da véspera** (agendador, de hora em hora): na hora do lembrete
//   da clínica, todo atendimento ativo do dia seguinte (calendário da
//   clínica) que ainda não recebeu lembrete. Marcado depois do envio ou para o
//   próprio dia fica sem lembrete automático; o botão "Enviar lembrete"
//   resolve. Sem template aprovado ou sem conexão: não envia, não conta como
//   lembrado e registra "não enviado" na trilha uma vez por data.
// - **Botões da tela**, para atendimento ativo e futuro: "Reenviar lembrete"
//   quando a última tentativa não chegou, ou quando chegou e ficou sem
//   resposta por 2h; "Enviar lembrete" quando não houve tentativa e o envio
//   automático da véspera já passou. Só contam as tentativas depois da última
//   remarcação (remarcar zera o lembrete).
// - **Reenvio automático**: 4h depois do lembrete automático entregue, para
//   quem não respondeu, uma vez só, entre 7h e 20h da clínica, e não para
//   atendimento que começa em menos de 2h. Não sai se a equipe já usou o
//   botão.
//
// O envio de verdade (template com os botões Confirmar presença · Remarcar ·
// Cancelar) é de quem chama (bot na F6, agendador na F7): a camada recebe a
// função que envia, registra a mensagem e a trilha.

export const REMINDER_MESSAGE_TYPE = "appointment_reminder";
export const UNANSWERED_BUTTON_MS = 2 * 60 * 60_000;
export const AUTO_RESEND_AFTER_MS = 4 * 60 * 60_000;
export const AUTO_RESEND_HOURS = { first: 7, last: 20 } as const;
export const AUTO_RESEND_MIN_LEAD_MS = 2 * 60 * 60_000;
/** Lembretes mais antigos que isso não são reenviados (o atendimento é do dia seguinte). */
const AUTO_RESEND_LOOKBACK_MS = 3 * 24 * 60 * 60_000;

/** Tentativa que não chegou ao paciente: o botão "Reenviar" aparece. */
export const NOT_DELIVERED = new Set(["failed", "skipped_no_template"]);

const ACTIVE = ["scheduled", "confirmed"] as const;

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

/** Envio automático que cobriria o atendimento: véspera, na hora do lembrete, no calendário da clínica. */
export function reminderCutoff(scheduledAt: Date, reminderHour: number, timeZone: string): Date {
  const eve = addDays(localDateOf(scheduledAt, timeZone), -1);
  return toInstant(eve, `${String(reminderHour).padStart(2, "0")}:00`, timeZone);
}

/** Atendimentos que o lembrete de agora cobre: o dia seguinte inteiro da clínica. */
export function reminderWindow(now: Date, timeZone: string): { start: Date; end: Date } {
  return dayBounds(addDays(todayIn(timeZone, now), 1), timeZone);
}

export type ReminderAction = "send" | "resend" | "resend_unanswered";

export type ReminderState = {
  scheduledAt: Date;
  reminderSentAt: Date | null;
  rescheduledAt: Date | null;
  reminderResponse: string | null;
  patientConfirmedAt: Date | null;
};

export type ReminderAttempt = { status: string | null; createdAt: Date };

/** Tentativas que contam: depois da última remarcação (as da data antiga não valem). */
function attemptsSinceReschedule(appointment: ReminderState, attempts: ReminderAttempt[]): ReminderAttempt[] {
  const since = appointment.rescheduledAt?.getTime() ?? -Infinity;
  return attempts.filter((a) => a.createdAt.getTime() >= since).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

const answered = (appointment: ReminderState) => appointment.reminderResponse !== null || appointment.patientConfirmedAt !== null;

/** Qual botão o atendimento (ativo e futuro, o chamador filtra) mostra; null = nenhum. */
export function reminderAction(
  appointment: ReminderState,
  attempts: ReminderAttempt[],
  reminderHour: number,
  timeZone: string,
  now: Date,
): ReminderAction | null {
  const last = attemptsSinceReschedule(appointment, attempts).at(-1);
  if (last) {
    // A Meta pode avisar a falha de entrega depois do envio aceito.
    if (NOT_DELIVERED.has(last.status ?? "") || !appointment.reminderSentAt) return "resend";
    if (!answered(appointment) && now.getTime() - last.createdAt.getTime() >= UNANSWERED_BUTTON_MS) return "resend_unanswered";
    return null;
  }
  if (!appointment.reminderSentAt && now.getTime() >= reminderCutoff(appointment.scheduledAt, reminderHour, timeZone).getTime()) {
    return "send";
  }
  return null;
}

/** O reenvio automático cabe agora? `resendsSinceReschedule` = usos do botão ou reenvios depois da última remarcação. */
export function isAutoResendDue(
  appointment: ReminderState,
  attempts: ReminderAttempt[],
  resendsSinceReschedule: number,
  timeZone: string,
  now: Date,
): boolean {
  const hour = localHourOf(now, timeZone);
  if (hour < AUTO_RESEND_HOURS.first || hour > AUTO_RESEND_HOURS.last) return false;
  if (appointment.scheduledAt.getTime() <= now.getTime() + AUTO_RESEND_MIN_LEAD_MS) return false;
  if (!appointment.reminderSentAt || answered(appointment) || resendsSinceReschedule > 0) return false;
  const counted = attemptsSinceReschedule(appointment, attempts);
  // Só o lembrete automático, uma vez entregue e nunca reenviado.
  if (counted.length !== 1 || NOT_DELIVERED.has(counted[0].status ?? "")) return false;
  return now.getTime() - counted[0].createdAt.getTime() >= AUTO_RESEND_AFTER_MS;
}

// Botões do template: Confirmar presença · Remarcar · Cancelar. O payload diz
// o atendimento (um contato pode receber um lembrete por paciente).
export const REMINDER_BUTTONS = ["confirm", "reschedule", "cancel"] as const;
export type ReminderButton = (typeof REMINDER_BUTTONS)[number];

export function reminderButtonPayload(button: ReminderButton, appointmentId: string): string {
  return `reminder:${button}:${appointmentId}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReminderTap(payload: string | null | undefined): { button: ReminderButton; appointmentId: string } | null {
  const [prefix, button, appointmentId] = (payload ?? "").split(":");
  if (prefix !== "reminder" || !(REMINDER_BUTTONS as readonly string[]).includes(button)) return null;
  if (!appointmentId || !UUID_RE.test(appointmentId)) return null;
  return { button: button as ReminderButton, appointmentId };
}

// Aviso na tela depois do botão (`?reenvio=`). Achado 4 da F1: só os códigos
// próprios (antes, "toString" e outros nomes herdados passavam).
export type ResendOutcome = "sent" | "failed" | "no_template" | "not_connected" | "not_enabled" | "not_eligible";

export const RESEND_MESSAGES: Record<ResendOutcome, { text: string; ok: boolean }> = {
  sent: { text: "Lembrete enviado.", ok: true },
  failed: { text: "O lembrete não foi enviado: o WhatsApp recusou o envio. Veja a trilha do atendimento.", ok: false },
  no_template: { text: "O lembrete não foi enviado: o template do lembrete não está aprovado.", ok: false },
  not_connected: { text: "O lembrete não foi enviado: o WhatsApp da clínica não está conectado.", ok: false },
  not_enabled: { text: "O lembrete não está liberado para a clínica.", ok: false },
  not_eligible: {
    text: "Nada a enviar: o atendimento já recebeu o lembrete, foi cancelado, já passou ou o envio automático da véspera ainda não aconteceu.",
    ok: false,
  },
};

export function parseResendOutcome(value: string | null): ResendOutcome | null {
  return value !== null && Object.hasOwn(RESEND_MESSAGES, value) ? (value as ResendOutcome) : null;
}

// ---------------------------------------------------------------------------
// Envio (de quem chama)
// ---------------------------------------------------------------------------

export type ReminderToSend = {
  clinicId: string;
  timeZone: string;
  appointmentId: string;
  phone: string;
  contactName: string;
  patientName: string;
  serviceName: string;
  serviceCategory: Enums<"service_category">;
  scheduledAt: Date;
  locationName: string;
  isHomeVisit: boolean;
  /** Endereço do atendimento domiciliar, ou do local. */
  address: string | null;
  template: { name: string; language: string };
  /** Payloads dos três botões, na ordem do template. */
  buttonPayloads: string[];
};

export type ReminderSender = (reminder: ReminderToSend) => Promise<SendOutcome>;

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const APPOINTMENT_COLUMNS =
  "id, status, scheduled_at, reminder_sent_at, rescheduled_at, reminder_response, patient_confirmed_at, home_visit_address, services ( name, category ), locations ( name, type, address ), patients ( full_name, contacts ( id, full_name, phone ) )";

type AppointmentRow = {
  id: string;
  status: string;
  scheduled_at: string;
  reminder_sent_at: string | null;
  rescheduled_at: string | null;
  reminder_response: string | null;
  patient_confirmed_at: string | null;
  home_visit_address: string | null;
  services: { name: string; category: Enums<"service_category"> };
  locations: { name: string; type: Enums<"location_type">; address: string | null };
  patients: { full_name: string; contacts: { id: string; full_name: string; phone: string } };
};

const toState = (row: AppointmentRow): ReminderState => ({
  scheduledAt: new Date(row.scheduled_at),
  reminderSentAt: row.reminder_sent_at ? new Date(row.reminder_sent_at) : null,
  rescheduledAt: row.rescheduled_at ? new Date(row.rescheduled_at) : null,
  reminderResponse: row.reminder_response,
  patientConfirmedAt: row.patient_confirmed_at ? new Date(row.patient_confirmed_at) : null,
});

type ReminderSettings = { timeZone: string; reminderHour: number };

async function loadSettings(db: DbClient, clinicId: string): Promise<ReminderSettings> {
  const row = unwrapOne(
    await db.from("clinic_settings").select("timezone, reminder_hour").eq("clinic_id", clinicId).maybeSingle(),
    "Configuração da clínica",
  );
  return { timeZone: row.timezone, reminderHour: row.reminder_hour };
}

async function reminderAttempts(db: DbClient, clinicId: string, appointmentIds: string[]): Promise<Map<string, ReminderAttempt[]>> {
  const byAppointment = new Map<string, ReminderAttempt[]>();
  if (appointmentIds.length === 0) return byAppointment;
  const rows = unwrap(
    await db
      .from("whatsapp_messages")
      .select("appointment_id, status, created_at")
      .eq("clinic_id", clinicId)
      .eq("direction", "outbound")
      .eq("message_type", REMINDER_MESSAGE_TYPE)
      .in("appointment_id", appointmentIds)
      .order("created_at"),
    "Lembretes enviados",
  );
  for (const row of rows) {
    const list = byAppointment.get(row.appointment_id!) ?? [];
    list.push({ status: row.status, createdAt: new Date(row.created_at) });
    byAppointment.set(row.appointment_id!, list);
  }
  return byAppointment;
}

/** Quantos usos do botão (ou reenvios automáticos) cada atendimento teve depois da última remarcação. */
async function resendCounts(db: DbClient, clinicId: string, rows: AppointmentRow[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (rows.length === 0) return counts;
  const events = unwrap(
    await db
      .from("appointment_events")
      .select("appointment_id, occurred_at")
      .eq("clinic_id", clinicId)
      .eq("event_type", "reminder_resent")
      .in(
        "appointment_id",
        rows.map((r) => r.id),
      ),
    "Trilha",
  );
  const since = new Map(rows.map((r) => [r.id, r.rescheduled_at ? Date.parse(r.rescheduled_at) : -Infinity]));
  for (const event of events) {
    if (Date.parse(event.occurred_at) < (since.get(event.appointment_id) ?? -Infinity)) continue;
    counts.set(event.appointment_id, (counts.get(event.appointment_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Botão de cada atendimento (ativo e futuro) na tela; fora do mapa = nenhum.
 * Sem o item liberado, nenhum.
 */
export async function listReminderActions(
  db: DbClient,
  clinicId: string,
  appointmentIds: string[],
  now: Date = new Date(),
): Promise<Map<string, ReminderAction>> {
  const actions = new Map<string, ReminderAction>();
  if (appointmentIds.length === 0 || !(await hasFeature(db, clinicId, "reminders"))) return actions;
  const [settings, rows] = await Promise.all([
    loadSettings(db, clinicId),
    db
      .from("appointments")
      .select(APPOINTMENT_COLUMNS)
      .eq("clinic_id", clinicId)
      .in("id", appointmentIds)
      .in("status", [...ACTIVE])
      .gt("scheduled_at", now.toISOString())
      .then((result) => unwrap(result, "Atendimentos") as unknown as AppointmentRow[]),
  ]);
  const attempts = await reminderAttempts(
    db,
    clinicId,
    rows.map((r) => r.id),
  );
  for (const row of rows) {
    const action = reminderAction(toState(row), attempts.get(row.id) ?? [], settings.reminderHour, settings.timeZone, now);
    if (action) actions.set(row.id, action);
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Envio e registro
// ---------------------------------------------------------------------------

type SendContext = { settings: ReminderSettings; template: { name: string; language: string } };

/** Envia um lembrete e registra a mensagem; devolve se saiu. */
async function deliverReminder(
  db: DbClient,
  clinicId: string,
  row: AppointmentRow,
  { settings, template }: SendContext,
  sender: ReminderSender,
  now: Date,
): Promise<boolean> {
  const contact = row.patients.contacts;
  const reminder: ReminderToSend = {
    clinicId,
    timeZone: settings.timeZone,
    appointmentId: row.id,
    phone: contact.phone,
    contactName: contact.full_name,
    patientName: row.patients.full_name,
    serviceName: row.services.name,
    serviceCategory: row.services.category,
    scheduledAt: new Date(row.scheduled_at),
    locationName: row.locations.name,
    isHomeVisit: row.locations.type === "home_visit",
    address: row.home_visit_address ?? row.locations.address,
    template,
    buttonPayloads: REMINDER_BUTTONS.map((button) => reminderButtonPayload(button, row.id)),
  };
  let outcome: SendOutcome;
  try {
    outcome = await sender(reminder);
  } catch (error) {
    outcome = { sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
  await recordOutboundMessage(
    db,
    clinicId,
    {
      phone: contact.phone,
      contactId: contact.id,
      appointmentId: row.id,
      messageType: REMINDER_MESSAGE_TYPE,
      templateName: template.name,
      body: outcome.body ?? null,
      status: outcome.sent ? "sent" : "failed",
      waMessageId: outcome.sent ? outcome.messageId : null,
    },
    now,
  );
  await resetConversationAfterNotice(db, clinicId, contact.phone);
  if (outcome.sent) {
    // Conta como lembrado: o agendador não manda de novo.
    unwrap(await db.from("appointments").update({ reminder_sent_at: now.toISOString() }).eq("clinic_id", clinicId).eq("id", row.id), "Atendimento");
  }
  return outcome.sent;
}

/** Template aprovado e WhatsApp conectado; senão, o motivo de não enviar. */
async function sendContext(
  db: DbClient,
  clinicId: string,
): Promise<{ context: SendContext } | { blocked: "no_template" | "not_connected" }> {
  const [settings, template, connection] = await Promise.all([
    loadSettings(db, clinicId),
    getApprovedTemplate(db, clinicId, "reminder"),
    getWhatsappConnection(db, clinicId),
  ]);
  if (connection?.status !== "connected") return { blocked: "not_connected" };
  if (!template) return { blocked: "no_template" };
  return { context: { settings, template } };
}

/** "Enviar lembrete" / "Reenviar lembrete" da tela. Quem enviou fica na trilha mesmo se falhar. */
export async function sendReminderFromPanel(
  db: DbClient,
  clinicId: string,
  appointmentId: string,
  actorId: string | null,
  sender: ReminderSender,
  now: Date = new Date(),
): Promise<ResendOutcome> {
  if (!(await hasFeature(db, clinicId, "reminders"))) return "not_enabled";
  // Tela desatualizada ou clique duplo (o lembrete já saiu), ou antes do envio automático.
  const action = (await listReminderActions(db, clinicId, [appointmentId], now)).get(appointmentId);
  if (!action) return "not_eligible";

  const setup = await sendContext(db, clinicId);
  if ("blocked" in setup) return setup.blocked;
  const row = unwrapOne(
    await db.from("appointments").select(APPOINTMENT_COLUMNS).eq("clinic_id", clinicId).eq("id", appointmentId).maybeSingle(),
    "Atendimento",
  ) as unknown as AppointmentRow;

  const sent = await deliverReminder(db, clinicId, row, setup.context, sender, now);
  // `first`: primeira tentativa ("Enviar lembrete"), não um reenvio.
  await logTrail(db, clinicId, appointmentId, "reminder_resent", "admin", actorId, { first: action === "send" });
  return sent ? "sent" : "failed";
}

/** Reenvio automático do lembrete sem resposta (ver o cabeçalho). Devolve quantos saíram. */
export async function autoResendUnanswered(
  db: DbClient,
  clinicId: string,
  sender: ReminderSender,
  now: Date = new Date(),
): Promise<number> {
  if (!(await hasFeature(db, clinicId, "reminders"))) return 0;
  const setup = await sendContext(db, clinicId);
  if ("blocked" in setup) return 0;
  const { timeZone } = setup.context.settings;
  const hour = localHourOf(now, timeZone);
  if (hour < AUTO_RESEND_HOURS.first || hour > AUTO_RESEND_HOURS.last) return 0;

  const candidates = unwrap(
    await db
      .from("appointments")
      .select(APPOINTMENT_COLUMNS)
      .eq("clinic_id", clinicId)
      .in("status", [...ACTIVE])
      .gt("scheduled_at", new Date(now.getTime() + AUTO_RESEND_MIN_LEAD_MS).toISOString())
      .lte("reminder_sent_at", new Date(now.getTime() - AUTO_RESEND_AFTER_MS).toISOString())
      .gte("reminder_sent_at", new Date(now.getTime() - AUTO_RESEND_LOOKBACK_MS).toISOString())
      .is("reminder_response", null)
      .is("patient_confirmed_at", null),
    "Atendimentos",
  ) as unknown as AppointmentRow[];
  if (candidates.length === 0) return 0;

  const [attempts, resends] = await Promise.all([
    reminderAttempts(
      db,
      clinicId,
      candidates.map((r) => r.id),
    ),
    resendCounts(db, clinicId, candidates),
  ]);
  let resent = 0;
  for (const row of candidates) {
    if (!isAutoResendDue(toState(row), attempts.get(row.id) ?? [], resends.get(row.id) ?? 0, timeZone, now)) continue;
    const sent = await deliverReminder(db, clinicId, row, setup.context, sender, now);
    await logTrail(db, clinicId, row.id, "reminder_resent", "cron", null, { automatic: true });
    if (sent) resent++;
  }
  return resent;
}

export type ReminderRunTotals = {
  candidates: number;
  sent: number;
  failed: number;
  not_sent_no_template: number;
  not_sent_not_connected: number;
};

export type ReminderRunResult =
  | { skipped: "not_enabled" }
  | { skipped: "outside_hour"; autoResent: number }
  | { runId: number; totals: ReminderRunTotals; autoResent: number };

/**
 * Rodada do agendador (de hora em hora) para a clínica: reenvio automático e,
 * na hora do lembrete da clínica (ou chamada manual), o lembrete da véspera.
 * Cada lembrete da véspera vira uma execução em `job_runs`.
 */
export async function runAppointmentReminders(
  db: DbClient,
  clinicId: string,
  { trigger, sender }: { trigger: JobTrigger; sender: ReminderSender },
  now: Date = new Date(),
): Promise<ReminderRunResult> {
  if (!(await hasFeature(db, clinicId, "reminders"))) return { skipped: "not_enabled" };
  const autoResent = await autoResendUnanswered(db, clinicId, sender, now);
  const settings = await loadSettings(db, clinicId);
  if (trigger === "scheduled" && localHourOf(now, settings.timeZone) !== settings.reminderHour) {
    return { skipped: "outside_hour", autoResent };
  }

  const runId = await startJobRun(db, clinicId, "appointment_reminders", { trigger }, now);
  const totals: ReminderRunTotals = { candidates: 0, sent: 0, failed: 0, not_sent_no_template: 0, not_sent_not_connected: 0 };
  try {
    const window = reminderWindow(now, settings.timeZone);
    const candidates = unwrap(
      await db
        .from("appointments")
        .select(APPOINTMENT_COLUMNS)
        .eq("clinic_id", clinicId)
        .in("status", [...ACTIVE])
        .is("reminder_sent_at", null)
        .gte("scheduled_at", window.start.toISOString())
        .lt("scheduled_at", window.end.toISOString())
        .order("scheduled_at"),
      "Atendimentos",
    ) as unknown as AppointmentRow[];
    totals.candidates = candidates.length;

    const setup = await sendContext(db, clinicId);
    if ("blocked" in setup) {
      const reason = setup.blocked === "no_template" ? "template_disabled" : "not_connected";
      const logged = await loggedNotSent(db, clinicId, candidates);
      for (const row of candidates) {
        if (setup.blocked === "no_template") totals.not_sent_no_template++;
        else totals.not_sent_not_connected++;
        // Uma vez por data do atendimento e motivo (remarcar para outra data registra de novo).
        if (logged.has(notSentKey(row.id, row.scheduled_at, reason))) continue;
        await logTrail(db, clinicId, row.id, "message_not_sent", "cron", null, {
          kind: "reminder",
          reason,
          scheduled_at: new Date(row.scheduled_at).toISOString(),
        });
      }
    } else {
      for (const row of candidates) {
        if (await deliverReminder(db, clinicId, row, setup.context, sender, now)) totals.sent++;
        else totals.failed++;
      }
    }
  } catch (error) {
    await finishJobRun(db, runId, { totals, error: error instanceof Error ? error.message : String(error) }, now);
    throw error;
  }
  await finishJobRun(db, runId, { totals }, now);
  return { runId, totals, autoResent };
}

const notSentKey = (appointmentId: string, scheduledAt: string, reason: string) => `${appointmentId}|${Date.parse(scheduledAt)}|${reason}`;

async function loggedNotSent(db: DbClient, clinicId: string, rows: AppointmentRow[]): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  const events = unwrap(
    await db
      .from("appointment_events")
      .select("appointment_id, details")
      .eq("clinic_id", clinicId)
      .eq("event_type", "message_not_sent")
      .in(
        "appointment_id",
        rows.map((r) => r.id),
      ),
    "Trilha",
  );
  const keys = new Set<string>();
  for (const event of events) {
    const details = (event.details ?? {}) as { kind?: string; reason?: string; scheduled_at?: string };
    if (details.kind === "reminder" && details.reason && details.scheduled_at) {
      keys.add(notSentKey(event.appointment_id, details.scheduled_at, details.reason));
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Resposta aos botões do lembrete
// ---------------------------------------------------------------------------

const RESPONSE_BY_BUTTON: Record<ReminderButton, "confirmed" | "reschedule" | "cancel"> = {
  confirm: "confirmed",
  reschedule: "reschedule",
  cancel: "cancel",
};

export type ReminderTapResult =
  | { result: "inactive" }
  | {
      result: "recorded";
      /** Confirmar marcou a presença agora (antes não estava confirmada). */
      confirmedNow: boolean;
      appointment: { id: string; scheduledAt: Date; patientName: string; serviceName: string; serviceCategory: Enums<"service_category"> };
    };

/**
 * Toque num botão do lembrete (o bot responde e segue o fluxo na F6). Só vale
 * para o atendimento do próprio contato, ativo, futuro e com o lembrete de pé
 * (remarcado depois do lembrete = toque de uma data antiga). Grava a resposta
 * no atendimento e na mensagem recebida (que sobrevive à remarcação, para as
 * métricas); "Confirmar" marca a presença.
 */
export async function recordReminderTap(
  db: DbClient,
  clinicId: string,
  tap: { button: ReminderButton; appointmentId: string; phone: string; waMessageId: string | null },
  now: Date = new Date(),
): Promise<ReminderTapResult> {
  const row = unwrap(
    await db.from("appointments").select(APPOINTMENT_COLUMNS).eq("clinic_id", clinicId).eq("id", tap.appointmentId).maybeSingle(),
    "Atendimento",
  ) as unknown as AppointmentRow | null;
  if (
    !row ||
    row.patients.contacts.phone !== tap.phone ||
    !(ACTIVE as readonly string[]).includes(row.status) ||
    Date.parse(row.scheduled_at) <= now.getTime() ||
    !row.reminder_sent_at
  ) {
    return { result: "inactive" };
  }

  const confirmedNow = tap.button === "confirm" && !row.patient_confirmed_at;
  unwrap(
    await db
      .from("appointments")
      .update({
        reminder_response: RESPONSE_BY_BUTTON[tap.button],
        reminder_response_at: now.toISOString(),
        ...(confirmedNow ? { patient_confirmed_at: now.toISOString(), patient_confirmed_by: null } : {}),
      })
      .eq("clinic_id", clinicId)
      .eq("id", row.id),
    "Atendimento",
  );
  if (confirmedNow) await logTrail(db, clinicId, row.id, "presence_confirmed", "whatsapp_bot", null);
  if (tap.waMessageId) {
    unwrap(
      await db
        .from("whatsapp_messages")
        .update({ appointment_id: row.id, message_type: `reminder_${tap.button}` })
        .eq("clinic_id", clinicId)
        .eq("wa_message_id", tap.waMessageId)
        .eq("direction", "inbound"),
      "Mensagem do WhatsApp",
    );
  }
  return {
    result: "recorded",
    confirmedNow,
    appointment: {
      id: row.id,
      scheduledAt: new Date(row.scheduled_at),
      patientName: row.patients.full_name,
      serviceName: row.services.name,
      serviceCategory: row.services.category,
    },
  };
}
