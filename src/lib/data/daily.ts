import { dayBounds } from "../clinicTime";
import type { DbClient } from "./clients";
import { unwrap, unwrapOne } from "./errors";
import { findBlockingAppointment, listUpcomingAppointments, logTrail } from "./agenda/appointments";
import { AGENDA_COLUMNS, toAgendaAppointment, type AgendaAppointment, type AgendaRow } from "./agenda/view";
import { REMINDER_MESSAGE_TYPE } from "./whatsapp/reminders";

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

/** Em que grupo fica o atendimento: o botão tocado; sem toque, se a última tentativa não chegou. */
export function reminderGroup(response: string | null, lastStatus: string | null): ReminderGroup {
  if (response === "confirm" || response === "reschedule" || response === "cancel") return response;
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
  const rows = unwrap(
    await db.from("appointments").select(AGENDA_COLUMNS).eq("clinic_id", clinicId).in("id", [...last.keys()]).order("scheduled_at"),
    "Atendimentos",
  ) as unknown as AgendaRow[];
  return rows.map((row) => {
    const appointment = toAgendaAppointment(row);
    const sent = last.get(appointment.id)!;
    return { appointment, group: reminderGroup(appointment.reminderResponse, sent.status), sentAt: sent.at };
  });
}

// ---------------------------------------------------------------------------
// Aguardando remarcação
// ---------------------------------------------------------------------------

/**
 * Cancelados pela clínica (em massa ou pelo bloqueio, como no piloto) que a
 * equipe ainda acompanha: sai sozinho quando o paciente remarca a mesma
 * jornada (Consulta/Retorno na mesma agenda; o mesmo exame) ou com "Desistiu".
 * Cancelamento avulso pela Agenda não entra (é uma ação pontual da equipe).
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
  const upcoming = await listUpcomingAppointments(db, clinicId, [...new Set(canceled.map((a) => a.patientId))], now);
  return canceled.filter(
    (a) => !findBlockingAppointment(upcoming.get(a.patientId) ?? [], { serviceId: a.serviceId, agendaId: a.agendaId, category: a.category }),
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
