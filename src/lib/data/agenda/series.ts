import { addDays, isCalendarDate, isClockTime, localDateOf, todayIn, toInstant, weekdayOf } from "../../clinicTime";
import { isNationalHoliday } from "../../holidays";
import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { DataError, fromDbError, unwrap, unwrapOne, Validation } from "../errors";
import { cancelAppointment, getAppointment, logTrail, type Appointment, type TrailChannel } from "./appointments";
import { loadClinicHolidays, loadSchedulingPlan } from "./slots";

// Séries recorrentes (D9), criadas no painel. Decisões do cliente (04/out/2026):
//   - séries sem fim mantêm as sessões criadas **até 3 meses à frente**; o
//     agendador cria as seguintes conforme o tempo passa (extendSeries);
//   - fim por número de sessões: **a data pulada não conta**, a série se
//     estende até completar as sessões marcadas;
//   - sessões de série não contam na trava "já tem atendimento futuro".
// Da D9: cada sessão é um atendimento comum ligado à série; feriado, bloqueio
// ou horário ocupado pulam a data, que fica registrada com o motivo; "só esta
// sessão" é remarcar/cancelar o atendimento; "esta e as próximas" encerra a
// série ou muda dia/horário dali em diante; sessões passadas nunca mudam.

export const SERIES_HORIZON_MONTHS = 3;
export const MAX_INTERVAL_WEEKS = 12;

export type SkipReason = Enums<"series_skip_reason">;

export type AppointmentSeries = {
  id: string;
  patientId: string;
  serviceId: string;
  agendaId: string;
  locationId: string;
  /** 1 = semanal, 2 = quinzenal, N = a cada N semanas. */
  intervalWeeks: number;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  startsOn: string;
  endsOn: string | null;
  maxSessions: number | null;
  homeVisitAddress: string | null;
  insurancePlanId: string | null;
  endedAt: Date | null;
};

export type SeriesSkip = { date: string; reason: SkipReason };
export type GenerationResult = { created: Appointment[]; skipped: SeriesSkip[] };

export type SeriesInput = {
  patientId: string;
  serviceId: string;
  agendaId: string;
  locationId: string;
  intervalWeeks: number;
  startsOn: string;
  startTime: string;
  endsOn?: string | null;
  maxSessions?: number | null;
  homeVisitAddress?: string | null;
  actorId: string | null;
};

const COLUMNS =
  "id, patient_id, service_id, agenda_id, location_id, interval_weeks, weekday, start_time, duration_minutes, starts_on, ends_on, max_sessions, home_visit_address, insurance_plan_id, ended_at";

type Row = {
  id: string;
  patient_id: string;
  service_id: string;
  agenda_id: string;
  location_id: string;
  interval_weeks: number;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  starts_on: string;
  ends_on: string | null;
  max_sessions: number | null;
  home_visit_address: string | null;
  insurance_plan_id: string | null;
  ended_at: string | null;
};

const toSeries = (row: Row): AppointmentSeries => ({
  id: row.id,
  patientId: row.patient_id,
  serviceId: row.service_id,
  agendaId: row.agenda_id,
  locationId: row.location_id,
  intervalWeeks: row.interval_weeks,
  weekday: row.weekday,
  startTime: row.start_time.slice(0, 5),
  durationMinutes: row.duration_minutes,
  startsOn: row.starts_on,
  endsOn: row.ends_on,
  maxSessions: row.max_sessions,
  homeVisitAddress: row.home_visit_address,
  insurancePlanId: row.insurance_plan_id,
  endedAt: row.ended_at ? new Date(row.ended_at) : null,
});

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

/** Mesma data N meses depois; dia que não existe vira o último do mês (31/01 + 1 = 28/02). */
export function addMonthsToDate(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

/** Último dia em que a geração cria sessões: o horizonte de 3 meses ou o fim da série, o que vier antes. */
export function generationLimit(today: string, endsOn: string | null): string {
  const horizon = addMonthsToDate(today, SERIES_HORIZON_MONTHS);
  return endsOn !== null && endsOn < horizon ? endsOn : horizon;
}

/**
 * Primeira data a considerar: a seguinte à última já considerada (sessão ou
 * data pulada), ou o início; nunca antes de hoje.
 */
export function firstCandidateDate(series: Pick<AppointmentSeries, "startsOn" | "intervalWeeks">, lastConsidered: string | null, today: string): string {
  const step = series.intervalWeeks * 7;
  let date = lastConsidered === null ? series.startsOn : addDays(lastConsidered, step);
  while (date < today) date = addDays(date, step);
  return date;
}

export function validateSeriesInput(input: SeriesInput, today: string): void {
  const v = new Validation();
  v.check(Number.isInteger(input.intervalWeeks) && input.intervalWeeks >= 1 && input.intervalWeeks <= MAX_INTERVAL_WEEKS, "intervalWeeks", `Frequência de 1 a ${MAX_INTERVAL_WEEKS} semanas`);
  v.check(isCalendarDate(input.startsOn), "startsOn", "Data de início inválida");
  v.check(!isCalendarDate(input.startsOn) || input.startsOn >= today, "startsOn", "A série não pode começar no passado");
  v.check(isClockTime(input.startTime), "startTime", "Horário no formato HH:mm");
  const endsOn = input.endsOn ?? null;
  const maxSessions = input.maxSessions ?? null;
  v.check(endsOn === null || maxSessions === null, "endsOn", "Escolha fim por data ou por número de sessões, não os dois");
  v.check(endsOn === null || (isCalendarDate(endsOn) && endsOn >= input.startsOn), "endsOn", "Data de fim inválida");
  v.check(maxSessions === null || (Number.isInteger(maxSessions) && maxSessions > 0), "maxSessions", "Número de sessões maior que 0");
  v.throwIfInvalid("Série");
}

// ---------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------

export async function getSeries(db: DbClient, clinicId: string, id: string): Promise<AppointmentSeries> {
  return toSeries(unwrapOne(await db.from("appointment_series").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Série"));
}

export async function listSeriesSkips(db: DbClient, clinicId: string, seriesId: string): Promise<SeriesSkip[]> {
  const rows = unwrap(
    await db.from("appointment_series_skips").select("skipped_on, reason").eq("clinic_id", clinicId).eq("series_id", seriesId).order("skipped_on"),
    "Datas puladas",
  );
  return rows.map((row) => ({ date: row.skipped_on, reason: row.reason }));
}

/** Cria as sessões que faltam até o limite (horizonte, fim por data ou por número). */
async function generateSessions(
  db: DbClient,
  clinicId: string,
  series: AppointmentSeries,
  { actorId, trailChannel }: { actorId: string | null; trailChannel: TrailChannel },
  now: Date,
): Promise<GenerationResult> {
  const result: GenerationResult = { created: [], skipped: [] };
  if (series.endedAt) return result;

  const settings = unwrapOne(await db.from("clinic_settings").select("timezone").eq("clinic_id", clinicId).maybeSingle(), "Configuração da clínica");
  const timeZone = settings.timezone;
  const today = todayIn(timeZone, now);

  const [sessions, skips] = await Promise.all([
    db.from("appointments").select("scheduled_at").eq("clinic_id", clinicId).eq("series_id", series.id).then((r) => unwrap(r, "Sessões da série")),
    listSeriesSkips(db, clinicId, series.id),
  ]);
  let count = sessions.length;
  const considered = [
    ...sessions.map((s) => localDateOf(new Date(s.scheduled_at), timeZone)),
    ...skips.map((s) => s.date),
  ].sort();
  const lastConsidered = considered.length ? considered[considered.length - 1] : null;

  const limit = generationLimit(today, series.endsOn);
  let date = firstCandidateDate(series, lastConsidered, today);
  if (date > limit || (series.maxSessions !== null && count >= series.maxSessions)) return result;

  const [holidays, blocks] = await Promise.all([
    loadClinicHolidays(db, clinicId, date, limit),
    db
      .from("schedule_blocks")
      .select("starts_at, ends_at")
      .eq("clinic_id", clinicId)
      .eq("agenda_id", series.agendaId)
      .is("removed_at", null)
      .lt("starts_at", toInstant(addDays(limit, 1), "00:00", timeZone).toISOString())
      .gt("ends_at", toInstant(date, "00:00", timeZone).toISOString())
      .then((r) => unwrap(r, "Bloqueios da agenda")),
  ]);

  const step = series.intervalWeeks * 7;
  for (; date <= limit && (series.maxSessions === null || count < series.maxSessions); date = addDays(date, step)) {
    const start = toInstant(date, series.startTime, timeZone);
    if (start <= now) continue; // hoje, mas o horário já passou: não é sessão nem data pulada
    const end = new Date(start.getTime() + series.durationMinutes * 60_000);

    let reason: SkipReason | null = null;
    if (isNationalHoliday(date) || holidays.has(date)) reason = "holiday";
    else if (blocks.some((b) => new Date(b.starts_at) < end && new Date(b.ends_at) > start)) reason = "block";

    if (reason === null) {
      const id = crypto.randomUUID();
      const { error } = await db.from("appointments").insert({
        id,
        clinic_id: clinicId,
        patient_id: series.patientId,
        service_id: series.serviceId,
        agenda_id: series.agendaId,
        location_id: series.locationId,
        series_id: series.id,
        scheduled_at: start.toISOString(),
        duration_minutes: series.durationMinutes,
        booking_channel: "admin",
        insurance_plan_id: series.insurancePlanId,
        home_visit_address: series.homeVisitAddress,
        created_by: actorId,
      });
      if (error) {
        if ((error as { code?: string }).code !== "23P01") throw fromDbError(error, "Sessão da série");
        reason = "conflict";
      } else {
        count += 1;
        await logTrail(db, clinicId, id, "created", trailChannel, actorId);
        result.created.push(await getAppointment(db, clinicId, id));
      }
    }
    if (reason !== null) result.skipped.push({ date, reason });
  }

  if (result.skipped.length) {
    unwrap(
      await db
        .from("appointment_series_skips")
        .insert(result.skipped.map((skip) => ({ clinic_id: clinicId, series_id: series.id, skipped_on: skip.date, reason: skip.reason }))),
      "Datas puladas",
    );
  }
  return result;
}

export async function createSeries(
  db: DbClient,
  clinicId: string,
  input: SeriesInput,
  now: Date = new Date(),
): Promise<{ series: AppointmentSeries } & GenerationResult> {
  const plan = await loadSchedulingPlan(db, clinicId, { serviceId: input.serviceId, agendaId: input.agendaId });
  if (!plan) throw new DataError("invalid", "Série: serviço inativo ou não atendido nesta agenda", { serviceId: "Serviço não atendido nesta agenda" });
  validateSeriesInput(input, todayIn(plan.timeZone, now));
  if (plan.isGroup) throw new DataError("invalid", "Série: turma não tem série (as vagas são por sessão)", { serviceId: "Turma não tem série" });

  const [patient, location, offered] = await Promise.all([
    db.from("patients").select("is_active, insurance_plan_id").eq("clinic_id", clinicId).eq("id", input.patientId).maybeSingle().then((r) => unwrapOne(r, "Paciente")),
    db.from("locations").select("type").eq("clinic_id", clinicId).eq("id", input.locationId).maybeSingle().then((r) => unwrapOne(r, "Local")),
    db
      .from("service_locations")
      .select("location_id")
      .eq("clinic_id", clinicId)
      .eq("service_id", input.serviceId)
      .eq("location_id", input.locationId)
      .maybeSingle()
      .then((r) => unwrap(r, "Locais do serviço")),
  ]);
  const v = new Validation();
  v.check(patient.is_active, "patientId", "Paciente desativado");
  v.check(offered !== null, "locationId", "O serviço não é oferecido neste local");
  const homeVisitAddress = input.homeVisitAddress?.trim() || null;
  v.check(location.type !== "home_visit" || homeVisitAddress !== null, "homeVisitAddress", "Informe o endereço");
  v.throwIfInvalid("Série");

  const id = crypto.randomUUID();
  unwrap(
    await db.from("appointment_series").insert({
      id,
      clinic_id: clinicId,
      patient_id: input.patientId,
      service_id: input.serviceId,
      agenda_id: input.agendaId,
      location_id: input.locationId,
      interval_weeks: input.intervalWeeks,
      weekday: weekdayOf(input.startsOn),
      start_time: input.startTime,
      duration_minutes: plan.durationMinutes,
      starts_on: input.startsOn,
      ends_on: input.endsOn ?? null,
      max_sessions: input.maxSessions ?? null,
      home_visit_address: location.type === "home_visit" ? homeVisitAddress : null,
      insurance_plan_id: patient.insurance_plan_id,
      created_by: input.actorId,
    }),
    "Série",
  );
  const series = await getSeries(db, clinicId, id);
  return { series, ...(await generateSessions(db, clinicId, series, { actorId: input.actorId, trailChannel: "admin" }, now)) };
}

/** Horizonte móvel: cria as sessões que entraram nos 3 meses à frente (agendador, F7). */
export async function extendSeries(
  db: DbClient,
  clinicId: string,
  seriesId: string,
  now: Date = new Date(),
): Promise<GenerationResult> {
  return generateSessions(db, clinicId, await getSeries(db, clinicId, seriesId), { actorId: null, trailChannel: "cron" }, now);
}

/** Sessões ativas a partir desta (inclusive), nunca as que já passaram. */
async function activeSessionsFrom(db: DbClient, clinicId: string, session: Appointment, now: Date): Promise<string[]> {
  const from = session.scheduledAt > now ? session.scheduledAt : now;
  const rows = unwrap(
    await db
      .from("appointments")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("series_id", session.seriesId!)
      .in("status", ["scheduled", "confirmed"])
      .gte("scheduled_at", from.toISOString())
      .order("scheduled_at"),
    "Sessões da série",
  );
  return rows.map((row) => row.id);
}

async function sessionOfSeries(db: DbClient, clinicId: string, appointmentId: string): Promise<Appointment> {
  const session = await getAppointment(db, clinicId, appointmentId);
  if (!session.seriesId) throw new DataError("invalid", "Série: este atendimento não é sessão de uma série", { appointmentId: "Não é sessão de série" });
  return session;
}

/** "Esta e as próximas" → encerrar: cancela esta e as seguintes e encerra a série. */
export async function endSeriesFrom(
  db: DbClient,
  clinicId: string,
  appointmentId: string,
  actorId: string | null,
  now: Date = new Date(),
): Promise<{ series: AppointmentSeries; canceled: Appointment[] }> {
  const session = await sessionOfSeries(db, clinicId, appointmentId);
  const canceled: Appointment[] = [];
  for (const id of await activeSessionsFrom(db, clinicId, session, now)) {
    const appointment = await cancelAppointment(db, clinicId, id, { channel: "admin", actorId }, now);
    if (appointment) canceled.push(appointment);
  }
  unwrapOne(
    await db
      .from("appointment_series")
      .update({ ended_at: now.toISOString(), ended_by: actorId })
      .eq("clinic_id", clinicId)
      .eq("id", session.seriesId!)
      .select("id")
      .maybeSingle(),
    "Série",
  );
  return { series: await getSeries(db, clinicId, session.seriesId!), canceled };
}

/**
 * "Esta e as próximas" → mudar dia/horário/frequência: encerra a série a
 * partir desta sessão e abre outra, com o mesmo paciente, serviço, agenda e
 * local, que continua o combinado (mesmo fim por data; por número, só as
 * sessões que faltavam).
 */
export async function changeSeriesFrom(
  db: DbClient,
  clinicId: string,
  appointmentId: string,
  change: { startsOn: string; startTime: string; intervalWeeks?: number },
  actorId: string | null,
  now: Date = new Date(),
): Promise<{ ended: AppointmentSeries; canceled: Appointment[]; next: ({ series: AppointmentSeries } & GenerationResult) | null }> {
  const session = await sessionOfSeries(db, clinicId, appointmentId);
  const old = await getSeries(db, clinicId, session.seriesId!);

  let remaining: number | null = null;
  if (old.maxSessions !== null) {
    const before = unwrap(
      await db
        .from("appointments")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("series_id", old.id)
        .lt("scheduled_at", session.scheduledAt.toISOString()),
      "Sessões da série",
    );
    remaining = old.maxSessions - before.length;
  }
  // Valida a mudança antes de encerrar a série antiga.
  const input: SeriesInput = {
    patientId: old.patientId,
    serviceId: old.serviceId,
    agendaId: old.agendaId,
    locationId: old.locationId,
    intervalWeeks: change.intervalWeeks ?? old.intervalWeeks,
    startsOn: change.startsOn,
    startTime: change.startTime,
    endsOn: old.endsOn,
    maxSessions: remaining,
    homeVisitAddress: old.homeVisitAddress,
    actorId,
  };
  if (remaining === null || remaining > 0) validateSeriesInput(input, todayIn((await loadTimezone(db, clinicId)), now));

  const { series: ended, canceled } = await endSeriesFrom(db, clinicId, appointmentId, actorId, now);
  const next = remaining === null || remaining > 0 ? await createSeries(db, clinicId, input, now) : null;
  return { ended, canceled, next };
}

async function loadTimezone(db: DbClient, clinicId: string): Promise<string> {
  return unwrapOne(await db.from("clinic_settings").select("timezone").eq("clinic_id", clinicId).maybeSingle(), "Configuração da clínica").timezone;
}
