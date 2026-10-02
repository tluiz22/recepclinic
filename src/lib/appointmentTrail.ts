import type { SupabaseClient } from "@supabase/supabase-js";
import { formatWhen } from "./whatsapp/formatDateTime";
import { fetchStaffLabels } from "./authorship";

// Trilha de cada atendimento (Fase 22 · etapa 4): junta as ações de
// `appointment_events` com as mensagens de `whatsapp_messages` ligadas ao
// atendimento (enviadas pelo sistema e respostas ao lembrete) — as
// mensagens não são duplicadas em `appointment_events`.

const STATUS_LABELS: Record<string, string> = {
  completed: "Realizada",
  no_show: "Não compareceu",
};

const MESSAGE_LABELS: Record<string, string> = {
  appointment_confirmation: "Confirmação de agendamento",
  appointment_reschedule: "Aviso de remarcação",
  appointment_cancellation: "Aviso de cancelamento",
  appointment_mass_cancellation: "Aviso de cancelamento (imprevisto da médica)",
  appointment_reminder: "Lembrete",
  exam_preparation: "Preparo do exame",
  bot_presence_confirmed: "Presença confirmada (resposta do bot)",
  reminder_confirm: "Resposta ao lembrete: Confirmar presença",
  reminder_reschedule: "Resposta ao lembrete: Remarcar",
  reminder_cancel: "Resposta ao lembrete: Cancelar",
};

const DELIVERY_LABELS: Record<string, string> = {
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  failed: "falhou",
  skipped_no_template: "não enviada — template desligado",
};

const NOT_SENT_KIND_LABELS: Record<string, string> = { reminder: "Lembrete" };

const NOT_SENT_REASON_LABELS: Record<string, string> = {
  no_phone: "sem telefone cadastrado",
  template_disabled: "template desligado",
};

// Mensagem do "não enviado" que, quando sai depois com sucesso, resolve o
// aviso de falha.
const NOT_SENT_KIND_MESSAGE_TYPE: Record<string, string> = { reminder: "appointment_reminder" };

const DELIVERED = new Set(["sent", "delivered", "read"]);

export type TrailTone = "neutral" | "success" | "danger";

export interface TrailEntry {
  at: string;
  text: string;
  tone: TrailTone;
}

export interface TrailSummary {
  count: number;
  // Envios com falha ainda não resolvidos: última tentativa de cada tipo de
  // mensagem falhou/não saiu, ou "não enviado" sem envio com sucesso depois.
  failedSends: number;
}

interface EventRow {
  appointment_id: string;
  event_type: string;
  channel: string;
  actor_id: string | null;
  details: Record<string, unknown> | null;
  occurred_at: string;
}

interface MessageRow {
  appointment_id: string;
  direction: string;
  message_type: string;
  status: string | null;
  created_at: string;
}

async function fetchRows(supabase: SupabaseClient, appointmentIds: string[]) {
  if (appointmentIds.length === 0) return { events: [] as EventRow[], messages: [] as MessageRow[] };
  const [{ data: events }, { data: messages }] = await Promise.all([
    supabase
      .from("appointment_events")
      .select("appointment_id, event_type, channel, actor_id, details, occurred_at")
      .in("appointment_id", appointmentIds)
      .order("occurred_at"),
    supabase
      .from("whatsapp_messages")
      .select("appointment_id, direction, message_type, status, created_at")
      .in("appointment_id", appointmentIds)
      .order("created_at"),
  ]);
  return { events: (events ?? []) as EventRow[], messages: (messages ?? []) as MessageRow[] };
}

function countFailedSends(events: EventRow[], messages: MessageRow[], scheduledAt: string): number {
  const outbound = messages.filter((m) => m.direction === "outbound");

  // Última tentativa de cada tipo (lista já em ordem cronológica).
  const latestByType = new Map<string, MessageRow>();
  for (const message of outbound) latestByType.set(message.message_type, message);
  let failed = [...latestByType.values()].filter(
    (m) => m.status === "failed" || m.status === "skipped_no_template"
  ).length;

  // "Não enviado" (Fase 22 · etapa 3) só conta se nada do mesmo tipo saiu
  // com sucesso depois, e se é da data atual do atendimento (remarcou →
  // o "não enviado" da data antiga não pesa mais).
  const pendingKinds = new Set<string>();
  for (const event of events) {
    if (event.event_type !== "message_not_sent") continue;
    const eventDate = event.details?.scheduled_at;
    if (typeof eventDate === "string" && Date.parse(eventDate) !== Date.parse(scheduledAt)) continue;
    const kind = String(event.details?.kind ?? "");
    const messageType = NOT_SENT_KIND_MESSAGE_TYPE[kind];
    const resolved = outbound.some(
      (m) =>
        m.message_type === messageType &&
        DELIVERED.has(m.status ?? "") &&
        Date.parse(m.created_at) > Date.parse(event.occurred_at)
    );
    if (resolved) pendingKinds.delete(kind);
    else pendingKinds.add(kind);
  }
  // Lembrete com falha já contado pela última tentativa não conta duas vezes.
  for (const kind of pendingKinds) {
    const latest = latestByType.get(NOT_SENT_KIND_MESSAGE_TYPE[kind]);
    const latestFailed = latest && (latest.status === "failed" || latest.status === "skipped_no_template");
    if (!latestFailed) failed++;
  }
  return failed;
}

/** Totais por atendimento para o card fechado ("Ver trilha (N)" + aviso de falha). */
export async function fetchTrailSummaries(
  supabase: SupabaseClient,
  appointments: { id: string; scheduled_at: string }[]
): Promise<Map<string, TrailSummary>> {
  const { events, messages } = await fetchRows(
    supabase,
    appointments.map((a) => a.id)
  );
  const summaries = new Map<string, TrailSummary>();
  for (const { id, scheduled_at } of appointments) {
    const ownEvents = events.filter((e) => e.appointment_id === id);
    const ownMessages = messages.filter((m) => m.appointment_id === id);
    summaries.set(id, {
      count: ownEvents.length + ownMessages.length,
      failedSends: countFailedSends(ownEvents, ownMessages, scheduled_at),
    });
  }
  return summaries;
}

function authorLabel(event: EventRow, staff: Map<string, string>): string {
  const person = (event.actor_id && staff.get(event.actor_id)) || "Tela (usuário não registrado)";
  switch (event.channel) {
    case "whatsapp_bot":
      return "WhatsApp";
    case "booking_link":
      return "WhatsApp (link)";
    case "cron":
      return "Sistema";
    case "mass_cancel":
      return `${person}, no cancelamento em massa`;
    case "schedule_block":
      return `${person}, no bloqueio de agenda`;
    default:
      return person;
  }
}

function describeEvent(event: EventRow, staff: Map<string, string>): TrailEntry {
  const by = authorLabel(event, staff);
  const details = event.details ?? {};
  const at = event.occurred_at;
  switch (event.event_type) {
    case "created":
      return { at, text: `Marcado por ${by}`, tone: "neutral" };
    case "rescheduled": {
      const from = typeof details.from === "string" ? formatWhen(new Date(details.from)) : null;
      const to = typeof details.to === "string" ? formatWhen(new Date(details.to)) : null;
      const change = from && to ? `: de ${from} para ${to}` : "";
      return { at, text: `Remarcado por ${by}${change}`, tone: "neutral" };
    }
    case "canceled":
      return { at, text: `Cancelado por ${by}`, tone: "neutral" };
    case "presence_confirmed":
      return { at, text: `Presença confirmada por ${by}`, tone: "success" };
    case "presence_unconfirmed":
      return { at, text: `Confirmação de presença desfeita por ${by}`, tone: "neutral" };
    case "attendance_recorded": {
      const status = STATUS_LABELS[String(details.status)] ?? String(details.status);
      return { at, text: `Registrado como ${status} por ${by}`, tone: "neutral" };
    }
    case "attendance_corrected": {
      const from = STATUS_LABELS[String(details.from)] ?? String(details.from);
      const to = STATUS_LABELS[String(details.to)] ?? String(details.to);
      return { at, text: `Corrigido de ${from} para ${to} por ${by}`, tone: "neutral" };
    }
    case "message_not_sent": {
      const kind = NOT_SENT_KIND_LABELS[String(details.kind)] ?? "Mensagem";
      const reason = NOT_SENT_REASON_LABELS[String(details.reason)] ?? String(details.reason);
      return { at, text: `${kind} não enviado — ${reason}`, tone: "danger" };
    }
    case "reminder_resent":
      return { at, text: `Lembrete ${details.first ? "enviado" : "reenviado"} por ${by}`, tone: "neutral" };
    case "preparation_resent":
      return { at, text: `Preparo do exame reenviado por ${by}`, tone: "neutral" };
    default:
      return { at, text: event.event_type, tone: "neutral" };
  }
}

function describeMessage(message: MessageRow): TrailEntry {
  const label = MESSAGE_LABELS[message.message_type] ?? message.message_type;
  if (message.direction === "inbound") {
    return { at: message.created_at, text: label, tone: "neutral" };
  }
  const status = message.status ?? "";
  const delivery = DELIVERY_LABELS[status] ?? status;
  const tone: TrailTone = status === "failed" || status === "skipped_no_template" ? "danger" : "neutral";
  return { at: message.created_at, text: `${label} — ${delivery}`, tone };
}

/** Trilha completa de um atendimento, do mais antigo ao mais recente. */
export async function fetchAppointmentTrail(supabase: SupabaseClient, appointmentId: string): Promise<TrailEntry[]> {
  const [{ events, messages }, staff] = await Promise.all([
    fetchRows(supabase, [appointmentId]),
    fetchStaffLabels(supabase),
  ]);
  return [...events.map((e) => describeEvent(e, staff)), ...messages.map(describeMessage)].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at)
  );
}
