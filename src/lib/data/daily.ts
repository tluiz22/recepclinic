import { dayBounds, todayIn } from "../clinicTime";
import type { DbClient } from "./clients";
import { unwrap, unwrapOne } from "./errors";
import { findBlockingAppointment, listUpcomingAppointments, logTrail } from "./agenda/appointments";
import { AGENDA_COLUMNS, toAgendaAppointment, type AgendaAppointment, type AgendaRow } from "./agenda/view";
import { describeSendsAlert, getSendsAlert } from "./sends";
import { listWaitlist } from "./waitlist/entries";
import { REMINDER_MESSAGE_TYPE } from "./whatsapp/reminders";
import { confirmedByReminder, REMINDER_TAP_MESSAGE_TYPES, responseFromTapMessage } from "../reminderResponse";

// Resumo do Dia (F4.8): as abas do dia a dia, como no piloto, no banco novo.
// Tudo das agendas que o login vê (RLS).

// ---------------------------------------------------------------------------
// Lembretes do dia
// ---------------------------------------------------------------------------

export type ReminderGroup = "confirm" | "reschedule" | "cancel" | "no_answer" | "not_delivered";

export const REMINDER_GROUP_LABELS: Record<ReminderGroup, string> = {
  confirm: "Confirmaram",
  reschedule: "Pediram para remarcar",
  cancel: "Pediram para cancelar",
  no_answer: "Não responderam",
  not_delivered: "Não entregue",
};

const NOT_DELIVERED = new Set(["failed", "skipped_no_template"]);

/**
 * Em que grupo fica o atendimento: o botão tocado (o banco guarda "confirmed"
 * para o "confirm"); sem toque, se a última tentativa não chegou.
 */
export function reminderGroup(response: string | null, lastStatus: string | null): ReminderGroup {
  if (confirmedByReminder(response)) return "confirm";
  if (response === "reschedule" || response === "cancel") return response;
  return NOT_DELIVERED.has(lastStatus ?? "") ? "not_delivered" : "no_answer";
}

export type ReminderOfDay = { appointment: AgendaAppointment; group: ReminderGroup; sentAt: Date };

/** Lembretes enviados no dia (no fuso da clínica), um por atendimento (a última tentativa). */
export async function listRemindersOfDay(db: DbClient, clinicId: string, date: string, timeZone: string): Promise<ReminderOfDay[]> {
  const { start, end } = dayBounds(date, timeZone);
  const messages = unwrap(
    await db
      .from("whatsapp_messages")
      .select("appointment_id, status, created_at")
      .eq("clinic_id", clinicId)
      .eq("direction", "outbound")
      .eq("message_type", REMINDER_MESSAGE_TYPE)
      .not("appointment_id", "is", null)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at"),
    "Lembretes do dia",
  );
  const last = new Map<string, { status: string | null; at: Date }>();
  for (const m of messages) last.set(m.appointment_id!, { status: m.status, at: new Date(m.created_at) });
  if (!last.size) return [];
  const [rows, taps] = await Promise.all([
    unwrap(
      await db.from("appointments").select(AGENDA_COLUMNS).eq("clinic_id", clinicId).in("id", [...last.keys()]).order("scheduled_at"),
      "Atendimentos",
    ) as unknown as AgendaRow[],
    listReminderTaps(db, clinicId, last),
  ]);
  return rows.map((row) => {
    const appointment = toAgendaAppointment(row);
    const sent = last.get(appointment.id)!;
    // O toque gravado nas mensagens vale mesmo depois de remarcar (que zera a resposta no atendimento).
    const response = taps.get(appointment.id) ?? appointment.reminderResponse;
    return { appointment, group: reminderGroup(response, sent.status), sentAt: sent.at };
  });
}

/**
 * Botão tocado em cada lembrete, pelas mensagens recebidas depois do envio
 * (`reminder_confirm`, `reminder_reschedule`, `reminder_cancel`), como o
 * banco guarda a resposta. Remarcar zera `reminder_response` no atendimento
 * (a data nova pede outro lembrete); a mensagem fica (cliente, 15/out/2026:
 * quem remarcou pelo lembrete aparecia em "Não responderam").
 */
export async function listReminderTaps(db: DbClient, clinicId: string, sentAt: Map<string, { at: Date }>): Promise<Map<string, string>> {
  const taps = new Map<string, string>();
  if (!sentAt.size) return taps;
  const since = new Date(Math.min(...[...sentAt.values()].map((s) => s.at.getTime())));
  const messages = unwrap(
    await db
      .from("whatsapp_messages")
      .select("appointment_id, message_type, created_at")
      .eq("clinic_id", clinicId)
      .eq("direction", "inbound")
      .in("message_type", REMINDER_TAP_MESSAGE_TYPES)
      .in("appointment_id", [...sentAt.keys()])
      .gte("created_at", since.toISOString())
      .order("created_at"),
    "Respostas aos lembretes",
  );
  for (const m of messages) {
    const sent = sentAt.get(m.appointment_id!);
    const response = responseFromTapMessage(m.message_type);
    if (sent && response && new Date(m.created_at) >= sent.at) taps.set(m.appointment_id!, response);
  }
  return taps;
}

// ---------------------------------------------------------------------------
// Aguardando remarcação
// ---------------------------------------------------------------------------

/**
 * Cancelados pela clínica (em massa ou pelo bloqueio, como no piloto) que a
 * equipe ainda acompanha. Sai sozinho quando o paciente tem atendimento
 * futuro da mesma jornada (Consulta/Retorno na mesma agenda; o mesmo exame),
 * quando foi marcado de novo para ela depois do cancelamento, em qualquer
 * situação (marcado, compareceu, faltou ou cancelado de novo; cliente,
 * 11/out/2026: assim fica no máximo uma linha por paciente e jornada), ou com
 * "Desistiu". Cancelamento avulso pela Agenda
 * não entra (é uma ação pontual da equipe).
 */
export async function listAwaitingRebooking(db: DbClient, clinicId: string, now: Date = new Date()): Promise<AgendaAppointment[]> {
  const rows = unwrap(
    await db
      .from("appointments")
      .select(AGENDA_COLUMNS)
      .eq("clinic_id", clinicId)
      .eq("status", "canceled")
      .eq("mass_canceled", true)
      .is("rebooking_dismissed_at", null)
      .order("canceled_at", { ascending: false })
      .limit(200),
    "Aguardando remarcação",
  ) as unknown as AgendaRow[];
  const canceled = rows.map(toAgendaAppointment);
  if (canceled.length === 0) return [];
  const since = new Date(Math.min(...canceled.map((a) => (a.canceledAt ?? new Date(0)).getTime())));
  const later = unwrap(
    await db
      .from("appointments")
      .select("id, patient_id, service_id, agenda_id, created_at, services ( category )")
      .eq("clinic_id", clinicId)
      .in("patient_id", [...new Set(canceled.map((a) => a.patientId))])
      .gt("created_at", since.toISOString()),
    "Aguardando remarcação: marcados depois",
  ) as unknown as { id: string; patient_id: string; service_id: string; agenda_id: string; created_at: string; services: { category: ServiceCategory } }[];
  const bookedAfter = later.map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    serviceId: row.service_id,
    agendaId: row.agenda_id,
    category: row.services.category,
    createdAt: new Date(row.created_at),
  }));
  const upcoming = await listUpcomingAppointments(db, clinicId, [...new Set(canceled.map((a) => a.patientId))], now);
  return canceled.filter(
    (a) =>
      !findBlockingAppointment(upcoming.get(a.patientId) ?? [], { serviceId: a.serviceId, agendaId: a.agendaId, category: a.category }) &&
      !wasRebooked(a, bookedAfter),
  );
}

type ServiceCategory = AgendaAppointment["category"];
type Journey = { patientId: string; serviceId: string; agendaId: string; category: ServiceCategory };

/** Marcado de novo para a mesma jornada depois do cancelamento (qualquer situação). */
export function wasRebooked(canceled: Journey & { id: string; canceledAt: Date | null }, others: (Journey & { id: string; createdAt: Date })[]): boolean {
  const canceledAt = canceled.canceledAt?.getTime() ?? 0;
  return others.some(
    (o) =>
      o.id !== canceled.id &&
      o.patientId === canceled.patientId &&
      o.createdAt.getTime() > canceledAt &&
      (canceled.category === "exam"
        ? o.serviceId === canceled.serviceId
        : o.agendaId === canceled.agendaId && o.category !== "exam"),
  );
}

/** "Desistiu": a equipe para de acompanhar (fica na trilha, com quem). */
export async function dismissRebooking(db: DbClient, clinicId: string, appointmentId: string, actorId: string | null, now: Date = new Date()): Promise<void> {
  unwrapOne(
    await db
      .from("appointments")
      .update({ rebooking_dismissed_at: now.toISOString() })
      .eq("clinic_id", clinicId)
      .eq("id", appointmentId)
      .eq("status", "canceled")
      .is("rebooking_dismissed_at", null)
      .select("id")
      .maybeSingle(),
    "Aguardando remarcação",
  );
  await logTrail(db, clinicId, appointmentId, "rebooking_dismissed", "admin", actorId);
}

// ---------------------------------------------------------------------------
// Comparecimento
// ---------------------------------------------------------------------------

/** Comparecimento a registrar: já passaram nesta janela. */
export const PENDING_DAYS = 60;
export const RECORDED_PAGE_SIZE = 20;

/** Ainda marcados e já passados (A registrar), do mais recente ao mais antigo. */
export async function listPendingAttendance(db: DbClient, clinicId: string, now: Date = new Date()): Promise<AgendaAppointment[]> {
  const since = new Date(now.getTime() - PENDING_DAYS * 24 * 60 * 60_000);
  const rows = unwrap(
    await db
      .from("appointments")
      .select(AGENDA_COLUMNS)
      .eq("clinic_id", clinicId)
      .in("status", ["scheduled", "confirmed"])
      .lt("scheduled_at", now.toISOString())
      .gte("scheduled_at", since.toISOString())
      .order("scheduled_at", { ascending: false }),
    "Comparecimento a registrar",
  ) as unknown as AgendaRow[];
  return rows.map(toAgendaAppointment);
}

/** Registradas (compareceu ou faltou), do mais recente ao mais antigo, 20 por página. */
export async function listRecordedPage(
  db: DbClient,
  clinicId: string,
  page: number,
): Promise<{ items: AgendaAppointment[]; total: number; page: number; pageCount: number }> {
  const current = Math.max(1, Math.floor(page) || 1);
  const from = (current - 1) * RECORDED_PAGE_SIZE;
  const { data, error, count } = await db
    .from("appointments")
    .select(AGENDA_COLUMNS, { count: "exact" })
    .eq("clinic_id", clinicId)
    .in("status", ["completed", "no_show"])
    .order("scheduled_at", { ascending: false })
    .range(from, from + RECORDED_PAGE_SIZE - 1);
  const rows = unwrap({ data, error }, "Comparecimento registrado") as unknown as AgendaRow[];
  const total = count ?? 0;
  return { items: rows.map(toAgendaAppointment), total, page: current, pageCount: Math.max(1, Math.ceil(total / RECORDED_PAGE_SIZE)) };
}

// ---------------------------------------------------------------------------
// Contadores das abas (redesign R3; cliente, 15/out/2026)
// ---------------------------------------------------------------------------

/** Pendências por aba; `undefined` quando a aba não aparece para a clínica. */
export type ResumoTabCounts = {
  /** Lembretes de hoje sem resposta ou não entregues. */
  reminders?: number;
  /** Quem está na lista de espera. */
  waitlist?: number;
  awaitingRebooking: number;
  pendingAttendance: number;
  /** Algo dos envios automáticos pede atenção (o mesmo alerta da aba Envios). */
  sendsAlert?: boolean;
};

/**
 * Contadores das abas do Resumo do Dia, com as mesmas regras das abas (e o
 * mesmo RLS): A registrar e Aguardando remarcação, o total; Lembretes, os de
 * hoje que pedem ação; Lista de espera, quem espera; Envios, se há alerta.
 */
export async function getResumoTabCounts(
  db: DbClient,
  clinicId: string,
  { timeZone, reminders, waitlist, sends }: { timeZone: string; reminders: boolean; waitlist: boolean; sends: boolean },
  now: Date = new Date(),
): Promise<ResumoTabCounts> {
  const since = new Date(now.getTime() - PENDING_DAYS * 24 * 60 * 60_000);
  const [pending, awaiting, ofDay, waiting, alert] = await Promise.all([
    db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .in("status", ["scheduled", "confirmed"])
      .lt("scheduled_at", now.toISOString())
      .gte("scheduled_at", since.toISOString()),
    listAwaitingRebooking(db, clinicId, now),
    reminders ? listRemindersOfDay(db, clinicId, todayIn(timeZone, now), timeZone) : Promise.resolve(null),
    // A mesma consulta da aba: o login de agendas restritas conta só o que vê nela.
    waitlist ? listWaitlist(db, clinicId) : Promise.resolve(null),
    sends ? getSendsAlert(db, clinicId, now) : Promise.resolve(null),
  ]);
  if (pending.error) unwrap(pending, "Comparecimento a registrar");
  return {
    pendingAttendance: pending.count ?? 0,
    awaitingRebooking: awaiting.length,
    reminders: ofDay ? ofDay.filter((r) => r.group === "no_answer" || r.group === "not_delivered").length : undefined,
    waitlist: waiting ? waiting.length : undefined,
    sendsAlert: alert ? describeSendsAlert(alert).length > 0 : undefined,
  };
}
