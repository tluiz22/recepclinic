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

// Lembrete ao paciente (Fases 19, 22 e 23 do piloto), F3.9b; reestruturado
// pelo cliente em 09/out/2026. Só com o item "Lembrete automático" liberado
// (D11: lembrete, botões de envio e reenvio e horário) e com o WhatsApp da
// clínica conectado.
//
// - **Um lembrete só** (agendador, de hora em hora), na hora escolhida pela
//   clínica (6h às 20h): na **véspera**, todo atendimento ativo do dia
//   seguinte (calendário da clínica); **no dia**, todo atendimento ativo de
//   hoje que começa depois do horário. Os que ainda não receberam lembrete.
//   Marcado depois do envio (ou, no dia, antes do horário) fica sem lembrete
//   automático; o botão "Enviar lembrete" resolve. Sem template aprovado ou
//   sem conexão: não envia, não conta como lembrado e registra "não enviado"
//   na trilha uma vez por data. Saiu o reenvio automático de 4h.
// - **Botões da tela**, para atendimento ativo e futuro: "Reenviar lembrete"
//   quando a última tentativa não chegou, ou quando chegou e ficou sem
//   resposta por 2h; "Enviar lembrete" quando não houve tentativa e o envio
//   automático já passou (ou não vai cobrir o atendimento). Só contam as
//   tentativas depois da última remarcação (remarcar zera o lembrete).
//
// O envio de verdade (template com os botões Confirmar presença · Remarcar ·
// Cancelar) é de quem chama (reminderSender em send.ts, F6.2; agendador na
// F7): a camada recebe a função que envia, registra a mensagem e a trilha.

export const REMINDER_MESSAGE_TYPE = "appointment_reminder";
export const UNANSWERED_BUTTON_MS = 2 * 60 * 60_000;

/** Tentativa que não chegou ao paciente: o botão "Reenviar" aparece. */
export const NOT_DELIVERED = new Set(["failed", "skipped_no_template"]);

const ACTIVE = ["scheduled", "confirmed"] as const;

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

export type ReminderTiming = "eve" | "same_day";

/**
 * Envio automático que cobriria o atendimento, na hora do lembrete, no
 * calendário da clínica: a véspera ou o próprio dia. No dia, atendimento que
 * começa até o horário não é coberto: devolve o início da época (o botão
 * "Enviar lembrete" vale desde já).
 */
export function reminderCutoff(scheduledAt: Date, reminderHour: number, timeZone: string, timing: ReminderTiming = "eve"): Date {
  const day = localDateOf(scheduledAt, timeZone);
  const sendAt = toInstant(timing === "eve" ? addDays(day, -1) : day, `${String(reminderHour).padStart(2, "0")}:00`, timeZone);
  return timing === "same_day" && scheduledAt.getTime() <= sendAt.getTime() ? new Date(0) : sendAt;
}

/** Atendimentos que o lembrete de agora cobre: o dia seguinte inteiro, ou o resto de hoje. */
export function reminderWindow(now: Date, timeZone: string, timing: ReminderTiming = "eve"): { start: Date; end: Date } {
  const today = todayIn(timeZone, now);
  if (timing === "same_day") return { start: now, end: dayBounds(today, timeZone).end };
  return dayBounds(addDays(today, 1), timeZone);
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
  timing: ReminderTiming = "eve",
): ReminderAction | null {
  const last = attemptsSinceReschedule(appointment, attempts).at(-1);
  if (last) {
    // A Meta pode avisar a falha de entrega depois do envio aceito.
    if (NOT_DELIVERED.has(last.status ?? "") || !appointment.reminderSentAt) return "resend";
    if (!answered(appointment) && now.getTime() - last.createdAt.getTime() >= UNANSWERED_BUTTON_MS) return "resend_unanswered";
    return null;
  }
  if (!appointment.reminderSentAt && now.getTime() >= reminderCutoff(appointment.scheduledAt, reminderHour, timeZone, timing).getTime()) {
    return "send";
  }
  return null;
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
  /** Profissional da agenda (null = agenda de recurso, ex.: sala de exames). */
  professionalName: string | null;
  scheduledAt: Date;
  locationName: string;
  isHomeVisit: boolean;
  /** Endereço do atendimento domiciliar, ou do local. */
  address: string | null;
  template: { name: string; language: string; body?: string | null };
  /** Payloads dos três botões, na ordem do template. */
  buttonPayloads: string[];
};

export type ReminderSender = (reminder: ReminderToSend) => Promise<SendOutcome>;

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const APPOINTMENT_COLUMNS =
  "id, status, scheduled_at, reminder_sent_at, rescheduled_at, reminder_response, patient_confirmed_at, home_visit_address, services ( name, category ), agendas ( professionals ( display_name ) ), locations ( name, type, address ), patients ( full_name, contacts ( id, full_name, phone ) )";

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
  agendas: { professionals: { display_name: string } | null };
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

type ReminderSettings = { timeZone: string; reminderHour: number; enabled: boolean; timing: ReminderTiming };

async function loadSettings(db: DbClient, clinicId: string): Promise<ReminderSettings> {
  const row = unwrapOne(
    await db.from("clinic_settings").select("timezone, reminder_hour, reminder_enabled, reminder_timing").eq("clinic_id", clinicId).maybeSingle(),
    "Configuração da clínica",
  );
  return { timeZone: row.timezone, reminderHour: row.reminder_hour, enabled: row.reminder_enabled, timing: row.reminder_timing as ReminderTiming };
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
    const action = reminderAction(toState(row), attempts.get(row.id) ?? [], settings.reminderHour, settings.timeZone, now, settings.timing);
    if (action) actions.set(row.id, action);
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Envio e registro
// ---------------------------------------------------------------------------

type SendContext = { settings: ReminderSettings; template: { name: string; language: string; body?: string | null } };

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
    professionalName: row.agendas.professionals?.display_name ?? null,
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

export type ReminderRunTotals = {
  candidates: number;
  sent: number;
  failed: number;
  not_sent_no_template: number;
  not_sent_not_connected: number;
};

export type ReminderRunResult = { skipped: "not_enabled" | "disabled" | "outside_hour" } | { runId: number; totals: ReminderRunTotals };

/**
 * Rodada do agendador (de hora em hora) para a clínica: na hora do lembrete
 * da clínica (ou chamada manual), o lembrete da véspera ou do dia. Cada
 * rodada que envia vira uma execução em `job_runs`.
 */
export async function runAppointmentReminders(
  db: DbClient,
  clinicId: string,
  { trigger, sender }: { trigger: JobTrigger; sender: ReminderSender },
  now: Date = new Date(),
): Promise<ReminderRunResult> {
  if (!(await hasFeature(db, clinicId, "reminders"))) return { skipped: "not_enabled" };
  const settings = await loadSettings(db, clinicId);
  // A clínica desligou o lembrete automático (F7; os botões da Agenda continuam).
  if (!settings.enabled) return { skipped: "disabled" };
  if (trigger === "scheduled" && localHourOf(now, settings.timeZone) !== settings.reminderHour) return { skipped: "outside_hour" };

  const runId = await startJobRun(db, clinicId, "appointment_reminders", { trigger }, now);
  const totals: ReminderRunTotals = { candidates: 0, sent: 0, failed: 0, not_sent_no_template: 0, not_sent_not_connected: 0 };
  try {
    const window = reminderWindow(now, settings.timeZone, settings.timing);
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
  return { runId, totals };
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
