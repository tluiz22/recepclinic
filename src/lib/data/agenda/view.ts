import { addDays, dayBounds } from "../../clinicTime";
import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { unwrap } from "../errors";
import { listBlocks, type ScheduleBlock } from "./blocks";
import type { AppointmentStatus } from "./appointments";

// Visões da Agenda (F4.5): dia, semana e mês das agendas que o login vê (RLS),
// com o que cada cartão mostra (paciente, contato, serviço, local, agenda).
// Turma é um cartão só, com os pacientes dentro.

type ServiceCategory = Enums<"service_category">;

export type AgendaAppointment = {
  id: string;
  agendaId: string;
  agendaName: string;
  serviceId: string;
  serviceName: string;
  category: ServiceCategory;
  locationName: string;
  isHomeVisit: boolean;
  homeVisitAddress: string | null;
  scheduledAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  isGroupSession: boolean;
  seriesId: string | null;
  patientId: string;
  patientName: string;
  contactName: string;
  contactPhone: string;
  /** O paciente é o próprio contato. */
  isContactSelf: boolean;
  patientConfirmedAt: Date | null;
  reminderResponse: string | null;
  patientBirthdate: string;
  /** Retorno: a consulta de origem (`listOrigins` traz a data e a situação). */
  originAppointmentId: string | null;
  /** Quem marcou pelo painel (null = WhatsApp, link ou sistema). */
  createdBy: string | null;
  bookingChannel: string;
  canceledBy: string | null;
  canceledAt: Date | null;
};

export type AgendaItem =
  | { kind: "appointment"; start: Date; end: Date; appointment: AgendaAppointment }
  | {
      kind: "group";
      start: Date;
      end: Date;
      agendaId: string;
      agendaName: string;
      serviceName: string;
      locationName: string;
      appointments: AgendaAppointment[];
    }
  | { kind: "block"; start: Date; end: Date; agendaName: string; block: ScheduleBlock };

export const AGENDA_COLUMNS = `id, agenda_id, service_id, scheduled_at, duration_minutes, status, is_group_session, series_id, home_visit_address,
  patient_confirmed_at, reminder_response, created_by, booking_channel, canceled_by, canceled_at,
  origin_appointment_id,
  agendas ( name ), services ( name, category ), locations ( name, type ),
  patients ( id, full_name, birthdate, is_contact_self, contacts ( full_name, phone ) )`;

export type AgendaRow = {
  id: string;
  agenda_id: string;
  service_id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: AppointmentStatus;
  is_group_session: boolean;
  series_id: string | null;
  home_visit_address: string | null;
  patient_confirmed_at: string | null;
  reminder_response: string | null;
  created_by: string | null;
  booking_channel: string;
  canceled_by: string | null;
  canceled_at: string | null;
  origin_appointment_id: string | null;
  agendas: { name: string };
  services: { name: string; category: ServiceCategory };
  locations: { name: string; type: string };
  patients: { id: string; full_name: string; birthdate: string; is_contact_self: boolean; contacts: { full_name: string; phone: string } };
};

export const toAgendaAppointment = (row: AgendaRow): AgendaAppointment => {
  const scheduledAt = new Date(row.scheduled_at);
  return {
    id: row.id,
    agendaId: row.agenda_id,
    agendaName: row.agendas.name,
    serviceId: row.service_id,
    serviceName: row.services.name,
    category: row.services.category,
    locationName: row.locations.name,
    isHomeVisit: row.locations.type === "home_visit",
    homeVisitAddress: row.home_visit_address,
    scheduledAt,
    endsAt: new Date(scheduledAt.getTime() + row.duration_minutes * 60_000),
    status: row.status,
    isGroupSession: row.is_group_session,
    seriesId: row.series_id,
    patientId: row.patients.id,
    patientName: row.patients.full_name,
    contactName: row.patients.contacts.full_name,
    contactPhone: row.patients.contacts.phone,
    isContactSelf: row.patients.is_contact_self,
    patientConfirmedAt: row.patient_confirmed_at ? new Date(row.patient_confirmed_at) : null,
    reminderResponse: row.reminder_response,
    patientBirthdate: row.patients.birthdate,
    originAppointmentId: row.origin_appointment_id,
    createdBy: row.created_by,
    bookingChannel: row.booking_channel,
    canceledBy: row.canceled_by,
    canceledAt: row.canceled_at ? new Date(row.canceled_at) : null,
  };
};

/** Atendimentos (cancelados inclusive) das agendas escolhidas, de `fromDate` a `toDate` (inclusive). */
export async function listAgendaAppointments(
  db: DbClient,
  clinicId: string,
  { fromDate, toDate, timeZone, agendaIds }: { fromDate: string; toDate: string; timeZone: string; agendaIds: string[] },
): Promise<AgendaAppointment[]> {
  if (!agendaIds.length) return [];
  const rows = unwrap(
    await db
      .from("appointments")
      .select(AGENDA_COLUMNS)
      .eq("clinic_id", clinicId)
      .in("agenda_id", agendaIds)
      .gte("scheduled_at", dayBounds(fromDate, timeZone).start.toISOString())
      .lt("scheduled_at", dayBounds(toDate, timeZone).end.toISOString())
      .order("scheduled_at"),
    "Agenda",
  ) as unknown as AgendaRow[];
  // Mesmo horário em agendas diferentes: em ordem de agenda, sempre igual.
  return rows
    .map(toAgendaAppointment)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.agendaName.localeCompare(b.agendaName) || a.patientName.localeCompare(b.patientName));
}

export type OriginInfo = { scheduledAt: Date; status: AppointmentStatus };

/** Consultas de origem dos retornos (data e situação), para o cartão. */
export async function listOrigins(db: DbClient, clinicId: string, appointments: AgendaAppointment[]): Promise<Map<string, OriginInfo>> {
  const ids = [...new Set(appointments.map((a) => a.originAppointmentId).filter((id): id is string => !!id))];
  if (!ids.length) return new Map();
  const rows = unwrap(await db.from("appointments").select("id, scheduled_at, status").eq("clinic_id", clinicId).in("id", ids), "Consultas de origem");
  return new Map(rows.map((row) => [row.id, { scheduledAt: new Date(row.scheduled_at), status: row.status }]));
}

/** Atendimentos pelos ids (avisos depois de cancelar), em ordem de horário. */
export async function listAgendaAppointmentsByIds(db: DbClient, clinicId: string, ids: string[]): Promise<AgendaAppointment[]> {
  if (!ids.length) return [];
  const rows = unwrap(await db.from("appointments").select(AGENDA_COLUMNS).eq("clinic_id", clinicId).in("id", ids).order("scheduled_at"), "Atendimentos") as unknown as AgendaRow[];
  return rows.map(toAgendaAppointment);
}

/** Histórico do paciente (F4.7): todos os atendimentos das agendas que o login vê, do mais recente ao mais antigo. */
export async function listPatientAppointments(db: DbClient, clinicId: string, patientId: string): Promise<AgendaAppointment[]> {
  const rows = unwrap(
    await db.from("appointments").select(AGENDA_COLUMNS).eq("clinic_id", clinicId).eq("patient_id", patientId).order("scheduled_at", { ascending: false }).limit(200),
    "Histórico do paciente",
  ) as unknown as AgendaRow[];
  return rows.map(toAgendaAppointment);
}

/** Sessões de uma série (todas, as passadas inclusive), em ordem de horário. */
export async function listSeriesAppointments(db: DbClient, clinicId: string, seriesId: string): Promise<AgendaAppointment[]> {
  const rows = unwrap(
    await db.from("appointments").select(AGENDA_COLUMNS).eq("clinic_id", clinicId).eq("series_id", seriesId).order("scheduled_at"),
    "Sessões da série",
  ) as unknown as AgendaRow[];
  return rows.map(toAgendaAppointment);
}

/** Um atendimento com os dados do cartão (remarcar, avisos). */
export async function getAgendaAppointment(db: DbClient, clinicId: string, id: string): Promise<AgendaAppointment | null> {
  const row = unwrap(await db.from("appointments").select(AGENDA_COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Atendimento") as unknown as AgendaRow | null;
  return row ? toAgendaAppointment(row) : null;
}

/** Agenda de um item do dia (para as colunas por agenda). */
export function itemAgendaId(item: AgendaItem): string {
  return item.kind === "appointment" ? item.appointment.agendaId : item.kind === "group" ? item.agendaId : item.block.agendaId;
}

/**
 * Itens de um dia em ordem de horário: atendimentos, turmas (um item por
 * agenda, serviço e horário) e bloqueios. Cancelados ficam, apagados.
 */
export function buildDayItems(appointments: AgendaAppointment[], blocks: (ScheduleBlock & { agendaName: string })[]): AgendaItem[] {
  const items: AgendaItem[] = [];
  const groups = new Map<string, Extract<AgendaItem, { kind: "group" }>>();
  for (const appointment of appointments) {
    if (!appointment.isGroupSession) {
      items.push({ kind: "appointment", start: appointment.scheduledAt, end: appointment.endsAt, appointment });
      continue;
    }
    const key = `${appointment.agendaId}|${appointment.serviceId}|${appointment.scheduledAt.getTime()}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        kind: "group",
        start: appointment.scheduledAt,
        end: appointment.endsAt,
        agendaId: appointment.agendaId,
        agendaName: appointment.agendaName,
        serviceName: appointment.serviceName,
        locationName: appointment.locationName,
        appointments: [],
      };
      groups.set(key, group);
      items.push(group);
    }
    group.appointments.push(appointment);
  }
  for (const block of blocks) items.push({ kind: "block", start: block.startsAt, end: block.endsAt, agendaName: block.agendaName, block });
  return items.sort((a, b) => a.start.getTime() - b.start.getTime() || a.kind.localeCompare(b.kind));
}

/** Bloqueios do período, com o nome da agenda. */
export async function listAgendaBlocks(
  db: DbClient,
  clinicId: string,
  { fromDate, toDate, timeZone, agendaIds, agendaNames }: { fromDate: string; toDate: string; timeZone: string; agendaIds: string[]; agendaNames: Map<string, string> },
): Promise<(ScheduleBlock & { agendaName: string })[]> {
  if (!agendaIds.length) return [];
  const blocks = await listBlocks(db, clinicId, {
    from: dayBounds(fromDate, timeZone).start,
    to: dayBounds(toDate, timeZone).end,
    agendaIds,
  });
  return blocks.map((block) => ({ ...block, agendaName: agendaNames.get(block.agendaId) ?? "Agenda" }));
}

export type NoShowStats = { noShows: number; total: number };

export function isFrequentNoShow(stats: NoShowStats): boolean {
  return stats.noShows >= 2 && stats.noShows / stats.total >= 0.5;
}

/**
 * Selo "Faltou X de Y" (piloto, Fase 23, regra do cliente): 2 ou mais faltas
 * e faltas em pelo menos metade dos atendimentos registrados (realizado ou
 * falta), no histórico todo do paciente. Só informa, não bloqueia.
 */
export async function listNoShowStats(db: DbClient, clinicId: string, patientIds: string[]): Promise<Map<string, NoShowStats>> {
  const result = new Map<string, NoShowStats>();
  const ids = [...new Set(patientIds)];
  if (!ids.length) return result;
  const rows = unwrap(
    await db.from("appointments").select("patient_id, status").eq("clinic_id", clinicId).in("patient_id", ids).in("status", ["completed", "no_show"]),
    "Comparecimento",
  );
  for (const row of rows) {
    const stats = result.get(row.patient_id) ?? { noShows: 0, total: 0 };
    stats.total += 1;
    if (row.status === "no_show") stats.noShows += 1;
    result.set(row.patient_id, stats);
  }
  for (const [id, stats] of result) if (!isFrequentNoShow(stats)) result.delete(id);
  return result;
}

// ---------------------------------------------------------------------------
// Semana e mês
// ---------------------------------------------------------------------------

/** Segunda-feira da semana da data (a semana da clínica começa na segunda). */
export function weekStart(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

/** Dias da grade do mês: de segunda antes do dia 1 até domingo depois do último. */
export function monthGrid(date: string): { first: string; last: string; days: string[] } {
  const first = `${date.slice(0, 7)}-01`;
  const next = new Date(`${first}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastOfMonth = addDays(next.toISOString().slice(0, 10), -1);
  const start = weekStart(first);
  const end = addDays(weekStart(lastOfMonth), 6);
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return { first, last: lastOfMonth, days };
}

// ---------------------------------------------------------------------------
// Agendas da tela
// ---------------------------------------------------------------------------

export type AgendaScope = {
  /** Agendas que a pessoa vê (desativadas inclusive, para não sumir atendimento). */
  agendas: { id: string; name: string; isActive: boolean }[];
  /** As do seletor (ativas). */
  selectable: { id: string; name: string }[];
  /** null = todas. */
  selectedAgendaId: string | null;
  /** Agendas exibidas. */
  agendaIds: string[];
  agendaNames: Map<string, string>;
};
