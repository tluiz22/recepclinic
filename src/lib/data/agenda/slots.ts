import { addDays, dayBounds, localTimeOf, todayIn, toInstant, weekdayOf } from "../../clinicTime";
import { isNationalHoliday } from "../../holidays";
import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { unwrap, unwrapOne } from "../errors";
import { computeFreeSlots, type BusyInterval, type FreeSlot, type SlotWindow } from "./freeSlots";

// Horários livres por agenda, serviço, local e dia (F3.6a), lidos com o login
// (ou a credencial do bot) de quem pergunta: o RLS limita às agendas que ele
// pode ver. Regras:
//   - feriado nacional ou da clínica: nenhum horário;
//   - janelas ativas da agenda no dia da semana, gerais ou do próprio serviço,
//     em locais onde o serviço é oferecido;
//   - ocupado = atendimentos ativos da agenda (turmas inclusive) + bloqueios;
//   - serviço ou agenda inativos, ou serviço que a agenda não atende: nada;
//   - turma tem cálculo próprio (getGroupSessions): uma sessão por janela, com vagas.

export const DEFAULT_DATE_COUNT = 10;
export const MAX_DAYS_AHEAD = 60;
/** Nenhum atendimento dura um dia: buscar desde 24h antes pega o que ainda está em andamento. */
const MAX_APPOINTMENT_SPAN_MS = 24 * 60 * 60_000;

type ServiceCategory = Enums<"service_category">;

export type SchedulingPlan = {
  timeZone: string;
  serviceId: string;
  agendaId: string;
  category: ServiceCategory;
  isGroup: boolean;
  durationMinutes: number;
  bufferMinutes: number;
  /** Retorno: menor duração de Consulta ativa da agenda (tapar buracos); null = sem consulta. */
  consultationMinutes: number | null;
  /** Janelas por dia da semana (gerais e do serviço; capacidade só nas de turma). */
  windowsByWeekday: Map<number, (SlotWindow & { capacity: number | null })[]>;
};

export type DateWithSlots = { date: string; weekday: number };
export type AgendaSlot = FreeSlot & { agendaId: string };
export type GroupSession = {
  date: string;
  time: string;
  start: Date;
  locationId: string;
  capacity: number;
  remaining: number;
};

/** Tudo o que não muda de um dia para outro: carregado uma vez por consulta. */
export async function loadSchedulingPlan(
  db: DbClient,
  clinicId: string,
  { serviceId, agendaId, locationId }: { serviceId: string; agendaId: string; locationId?: string | null },
): Promise<SchedulingPlan | null> {
  const [settings, service, agenda, windows] = await Promise.all([
    db.from("clinic_settings").select("timezone").eq("clinic_id", clinicId).maybeSingle().then((r) => unwrapOne(r, "Configuração da clínica")),
    db
      .from("services")
      .select("category, scheduling_mode, duration_minutes, is_active, service_agendas ( agenda_id ), service_locations ( location_id )")
      .eq("clinic_id", clinicId)
      .eq("id", serviceId)
      .maybeSingle()
      .then((r) => unwrap(r, "Serviço")),
    db.from("agendas").select("buffer_minutes, is_active").eq("clinic_id", clinicId).eq("id", agendaId).maybeSingle().then((r) => unwrap(r, "Agenda")),
    db
      .from("availability_windows")
      .select("location_id, service_id, weekday, start_time, end_time, capacity")
      .eq("clinic_id", clinicId)
      .eq("agenda_id", agendaId)
      .eq("is_active", true)
      .then((r) => unwrap(r, "Horários de atendimento")),
  ]);
  if (!service || !agenda || !service.is_active || !agenda.is_active) return null;
  const links = service as unknown as { service_agendas: { agenda_id: string }[]; service_locations: { location_id: string }[] };
  if (!links.service_agendas.some((link) => link.agenda_id === agendaId)) return null;
  const offeredAt = new Set(links.service_locations.map((link) => link.location_id));

  const isGroup = service.scheduling_mode === "group";
  const windowsByWeekday = new Map<number, (SlotWindow & { capacity: number | null })[]>();
  for (const window of windows) {
    if (!offeredAt.has(window.location_id)) continue;
    if (locationId && window.location_id !== locationId) continue;
    // Turma: só as janelas do próprio serviço (com vagas). Individual: gerais e as do serviço.
    if (isGroup ? window.service_id !== serviceId : window.service_id !== null && window.service_id !== serviceId) continue;
    const list = windowsByWeekday.get(window.weekday) ?? [];
    list.push({
      locationId: window.location_id,
      startTime: window.start_time.slice(0, 5),
      endTime: window.end_time.slice(0, 5),
      capacity: window.capacity,
    });
    windowsByWeekday.set(window.weekday, list);
  }

  let consultationMinutes: number | null = null;
  if (service.category === "return_visit") {
    const consultations = unwrap(
      await db
        .from("services")
        .select("duration_minutes, service_agendas!inner ( agenda_id )")
        .eq("clinic_id", clinicId)
        .eq("category", "consultation")
        .eq("is_active", true)
        .eq("service_agendas.agenda_id", agendaId),
      "Consultas da agenda",
    );
    consultationMinutes = consultations.length ? Math.min(...consultations.map((c) => c.duration_minutes)) : null;
  }

  return {
    timeZone: settings.timezone,
    serviceId,
    agendaId,
    category: service.category,
    isGroup,
    durationMinutes: service.duration_minutes,
    bufferMinutes: agenda.buffer_minutes,
    consultationMinutes,
    windowsByWeekday,
  };
}

/** Ocupado na agenda entre dois instantes: atendimentos ativos e bloqueios. */
export async function loadBusy(
  db: DbClient,
  clinicId: string,
  agendaId: string,
  from: Date,
  to: Date,
  ignoreAppointmentId?: string | null,
): Promise<BusyInterval[]> {
  let appointmentsQuery = db
    .from("appointments")
    .select("scheduled_at, duration_minutes")
    .eq("clinic_id", clinicId)
    .eq("agenda_id", agendaId)
    .in("status", ["scheduled", "confirmed"])
    .gte("scheduled_at", new Date(from.getTime() - MAX_APPOINTMENT_SPAN_MS).toISOString())
    .lt("scheduled_at", to.toISOString());
  // Remarcar: o próprio atendimento não ocupa o horário que vai deixar.
  if (ignoreAppointmentId) appointmentsQuery = appointmentsQuery.neq("id", ignoreAppointmentId);
  const [appointments, blocks] = await Promise.all([
    appointmentsQuery.then((r) => unwrap(r, "Atendimentos da agenda")),
    db
      .from("schedule_blocks")
      .select("starts_at, ends_at")
      .eq("clinic_id", clinicId)
      .eq("agenda_id", agendaId)
      .is("removed_at", null)
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString())
      .then((r) => unwrap(r, "Bloqueios da agenda")),
  ]);
  return [
    ...appointments.map((a) => {
      const start = new Date(a.scheduled_at);
      return { start, end: new Date(start.getTime() + a.duration_minutes * 60_000) };
    }),
    ...blocks.map((b) => ({ start: new Date(b.starts_at), end: new Date(b.ends_at) })),
  ].filter((interval) => interval.end > from);
}

/** Feriados extras da clínica no período (os nacionais vêm de isNationalHoliday). */
export async function loadClinicHolidays(db: DbClient, clinicId: string, fromDate: string, toDate: string): Promise<Set<string>> {
  const rows = unwrap(
    await db.from("clinic_holidays").select("date").eq("clinic_id", clinicId).gte("date", fromDate).lte("date", toDate),
    "Feriados",
  );
  return new Set(rows.map((row) => row.date));
}

function slotsOn(plan: SchedulingPlan, date: string, busy: BusyInterval[], holidays: Set<string>, now: Date): FreeSlot[] {
  if (plan.isGroup || isNationalHoliday(date) || holidays.has(date)) return [];
  const windows = plan.windowsByWeekday.get(weekdayOf(date));
  if (!windows?.length) return [];
  return computeFreeSlots({
    date,
    timeZone: plan.timeZone,
    windows,
    busy,
    durationMinutes: plan.durationMinutes,
    bufferMinutes: plan.bufferMinutes,
    strategy: plan.category === "return_visit" ? { kind: "return_gaps", consultationMinutes: plan.consultationMinutes } : { kind: "fill" },
    now,
  });
}

export type SlotQuery = { serviceId: string; agendaId: string; locationId?: string | null; ignoreAppointmentId?: string | null };

/** Horários livres de um dia (serviço individual). */
export async function getFreeSlots(
  db: DbClient,
  clinicId: string,
  query: SlotQuery & { date: string },
  now: Date = new Date(),
): Promise<FreeSlot[]> {
  const plan = await loadSchedulingPlan(db, clinicId, query);
  if (!plan) return [];
  const { start, end } = dayBounds(query.date, plan.timeZone);
  const [busy, holidays] = await Promise.all([
    loadBusy(db, clinicId, query.agendaId, start, end, query.ignoreAppointmentId),
    loadClinicHolidays(db, clinicId, query.date, query.date),
  ]);
  return slotsOn(plan, query.date, busy, holidays, now);
}

/** Próximas datas com pelo menos um horário livre, a partir de hoje (fuso da clínica). */
export async function getNextAvailableDates(
  db: DbClient,
  clinicId: string,
  query: SlotQuery & { count?: number; maxDaysAhead?: number; lastDate?: string | null },
  now: Date = new Date(),
): Promise<DateWithSlots[]> {
  const plan = await loadSchedulingPlan(db, clinicId, query);
  if (!plan || plan.isGroup || plan.windowsByWeekday.size === 0) return [];
  const { count = DEFAULT_DATE_COUNT, maxDaysAhead = MAX_DAYS_AHEAD, lastDate } = query;
  const firstDate = todayIn(plan.timeZone, now);
  const finalDate = addDays(firstDate, maxDaysAhead - 1);
  const [busy, holidays] = await Promise.all([
    loadBusy(db, clinicId, query.agendaId, dayBounds(firstDate, plan.timeZone).start, dayBounds(finalDate, plan.timeZone).end, query.ignoreAppointmentId),
    loadClinicHolidays(db, clinicId, firstDate, finalDate),
  ]);
  const result: DateWithSlots[] = [];
  for (let date = firstDate; date <= finalDate && result.length < count && (!lastDate || date <= lastDate); date = addDays(date, 1)) {
    if (slotsOn(plan, date, busy, holidays, now).length) result.push({ date, weekday: weekdayOf(date) });
  }
  return result;
}

/** Agendas ativas que atendem o serviço e que quem pergunta pode ver, em ordem de nome. */
export async function agendasForService(db: DbClient, clinicId: string, serviceId: string): Promise<string[]> {
  const rows = unwrap(
    await db
      .from("agendas")
      .select("id, service_agendas!inner ( service_id )")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .eq("service_agendas.service_id", serviceId)
      .order("name"),
    "Agendas do serviço",
  );
  return rows.map((row) => row.id);
}

/**
 * "Primeiro horário disponível" (D2 revista): horários livres do dia em todas
 * as agendas do serviço. Mesmo horário em mais de uma agenda aparece uma vez,
 * na primeira agenda em ordem de nome.
 */
export async function getFreeSlotsAnyAgenda(
  db: DbClient,
  clinicId: string,
  query: { serviceId: string; date: string; locationId?: string | null },
  now: Date = new Date(),
): Promise<AgendaSlot[]> {
  const agendaIds = await agendasForService(db, clinicId, query.serviceId);
  const perAgenda = await Promise.all(
    agendaIds.map(async (agendaId) =>
      (await getFreeSlots(db, clinicId, { ...query, agendaId }, now)).map((slot) => ({ ...slot, agendaId })),
    ),
  );
  const seen = new Set<number>();
  return perAgenda
    .flat()
    .filter((slot) => (seen.has(slot.start.getTime()) ? false : (seen.add(slot.start.getTime()), true)))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Próximas datas com horário livre em qualquer agenda do serviço. */
export async function getNextAvailableDatesAnyAgenda(
  db: DbClient,
  clinicId: string,
  query: { serviceId: string; locationId?: string | null; count?: number; maxDaysAhead?: number; lastDate?: string | null },
  now: Date = new Date(),
): Promise<DateWithSlots[]> {
  const agendaIds = await agendasForService(db, clinicId, query.serviceId);
  const count = query.count ?? DEFAULT_DATE_COUNT;
  const perAgenda = await Promise.all(
    agendaIds.map((agendaId) => getNextAvailableDates(db, clinicId, { ...query, agendaId, count }, now)),
  );
  const dates = [...new Set(perAgenda.flat().map((d) => d.date))].sort().slice(0, count);
  return dates.map((date) => ({ date, weekday: weekdayOf(date) }));
}

/**
 * Sessões de turma com vaga: cada janela de turma do serviço é uma sessão no
 * horário de início, com as vagas da janela menos os atendimentos ativos
 * naquele horário. Pula feriados e horários de bloqueio da agenda.
 */
export async function getGroupSessions(
  db: DbClient,
  clinicId: string,
  query: { serviceId: string; agendaId: string; count?: number; maxDaysAhead?: number },
  now: Date = new Date(),
): Promise<GroupSession[]> {
  const plan = await loadSchedulingPlan(db, clinicId, query);
  if (!plan || !plan.isGroup || plan.windowsByWeekday.size === 0) return [];
  const { count = DEFAULT_DATE_COUNT, maxDaysAhead = MAX_DAYS_AHEAD } = query;
  const firstDate = todayIn(plan.timeZone, now);
  const finalDate = addDays(firstDate, maxDaysAhead - 1);
  const from = dayBounds(firstDate, plan.timeZone).start;
  const to = dayBounds(finalDate, plan.timeZone).end;

  const [booked, blocks, holidays] = await Promise.all([
    db
      .from("appointments")
      .select("scheduled_at")
      .eq("clinic_id", clinicId)
      .eq("agenda_id", query.agendaId)
      .eq("service_id", query.serviceId)
      .in("status", ["scheduled", "confirmed"])
      .gte("scheduled_at", from.toISOString())
      .lt("scheduled_at", to.toISOString())
      .then((r) => unwrap(r, "Atendimentos da turma")),
    db
      .from("schedule_blocks")
      .select("starts_at, ends_at")
      .eq("clinic_id", clinicId)
      .eq("agenda_id", query.agendaId)
      .is("removed_at", null)
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString())
      .then((r) => unwrap(r, "Bloqueios da agenda")),
    loadClinicHolidays(db, clinicId, firstDate, finalDate),
  ]);
  const bookedAt = new Map<number, number>();
  for (const row of booked) {
    const key = new Date(row.scheduled_at).getTime();
    bookedAt.set(key, (bookedAt.get(key) ?? 0) + 1);
  }

  const sessions: GroupSession[] = [];
  for (let date = firstDate; date <= finalDate && sessions.length < count; date = addDays(date, 1)) {
    if (isNationalHoliday(date) || holidays.has(date)) continue;
    const windows = [...(plan.windowsByWeekday.get(weekdayOf(date)) ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (const window of windows) {
      if (window.capacity === null || sessions.length >= count) continue;
      const start = toInstant(date, window.startTime, plan.timeZone);
      if (start <= now || localTimeOf(start, plan.timeZone) !== window.startTime) continue;
      const end = new Date(start.getTime() + plan.durationMinutes * 60_000);
      if (blocks.some((b) => new Date(b.starts_at) < end && new Date(b.ends_at) > start)) continue;
      const remaining = window.capacity - (bookedAt.get(start.getTime()) ?? 0);
      if (remaining > 0) {
        sessions.push({ date, time: window.startTime, start, locationId: window.locationId, capacity: window.capacity, remaining });
      }
    }
  }
  return sessions;
}
