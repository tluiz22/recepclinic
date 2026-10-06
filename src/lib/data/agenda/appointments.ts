import { addDays, localDateOf, localTimeOf, todayIn, weekdayOf } from "../../clinicTime";
import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { DataError, fromDbError, unwrap, unwrapOne } from "../errors";
import { getFreeSlots, loadSchedulingPlan } from "./slots";

// Marcar, remarcar, cancelar, presença e comparecimento (F3.6a), para a tela
// e para o bot. Regras herdadas do piloto, com as decisões de 04/out/2026:
//   - o horário pedido precisa estar entre os livres calculados agora (a trava
//     do banco ainda barra dois atendimentos ao mesmo tempo na agenda);
//   - **duplicidade por agenda** (cliente, 04/out): Consulta/Retorno não é
//     marcado se o paciente já tem Consulta/Retorno futuro na mesma agenda;
//     Exame, se já tem o mesmo exame futuro (como no piloto). Sessões de série
//     não contam nem são barradas pela trava (cliente, 04/out, F3.6b);
//   - **retorno ligado à última consulta na mesma agenda**, com o prazo do
//     serviço de Retorno (cliente, 04/out); na tela só avisa;
//   - local domiciliar exige o endereço;
//   - marcar invalida os links de agendamento pendentes do paciente para o
//     mesmo serviço; remarcar zera lembrete e confirmação de presença;
//   - cancelar é atômico (não cancela duas vezes nem avisa duas vezes);
//   - toda ação vai para a trilha (melhor esforço: falha na trilha não desfaz a ação).

export type ActionChannel = Enums<"action_channel">;
export type TrailChannel = ActionChannel | "booking_link" | "cron" | "mass_cancel" | "schedule_block";
export type AppointmentStatus = Enums<"appointment_status">;
type ServiceCategory = Enums<"service_category">;

const ACTIVE: AppointmentStatus[] = ["scheduled", "confirmed"];

export type Appointment = {
  id: string;
  patientId: string;
  serviceId: string;
  agendaId: string;
  locationId: string;
  seriesId: string | null;
  originAppointmentId: string | null;
  scheduledAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  bookingChannel: ActionChannel;
  isGroupSession: boolean;
  priceCents: number | null;
  insurancePlanId: string | null;
  homeVisitAddress: string | null;
  patientConfirmedAt: Date | null;
};

const COLUMNS =
  "id, patient_id, service_id, agenda_id, location_id, series_id, origin_appointment_id, scheduled_at, duration_minutes, status, booking_channel, is_group_session, price_cents, insurance_plan_id, home_visit_address, patient_confirmed_at";

type Row = {
  id: string;
  patient_id: string;
  service_id: string;
  agenda_id: string;
  location_id: string;
  series_id: string | null;
  origin_appointment_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: AppointmentStatus;
  booking_channel: ActionChannel;
  is_group_session: boolean;
  price_cents: number | null;
  insurance_plan_id: string | null;
  home_visit_address: string | null;
  patient_confirmed_at: string | null;
};

const toAppointment = (row: Row): Appointment => ({
  id: row.id,
  patientId: row.patient_id,
  serviceId: row.service_id,
  agendaId: row.agenda_id,
  locationId: row.location_id,
  seriesId: row.series_id,
  originAppointmentId: row.origin_appointment_id,
  scheduledAt: new Date(row.scheduled_at),
  durationMinutes: row.duration_minutes,
  status: row.status,
  bookingChannel: row.booking_channel,
  isGroupSession: row.is_group_session,
  priceCents: row.price_cents,
  insurancePlanId: row.insurance_plan_id,
  homeVisitAddress: row.home_visit_address,
  patientConfirmedAt: row.patient_confirmed_at ? new Date(row.patient_confirmed_at) : null,
});

export async function getAppointment(db: DbClient, clinicId: string, id: string): Promise<Appointment> {
  return toAppointment(
    unwrapOne(await db.from("appointments").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Atendimento"),
  );
}

/** Atendimentos de um dia no fuso da clínica (só das agendas que o login pode ver). */
export async function listAppointmentsBetween(
  db: DbClient,
  clinicId: string,
  { from, to, agendaIds, statuses }: { from: Date; to: Date; agendaIds?: string[]; statuses?: AppointmentStatus[] },
): Promise<Appointment[]> {
  let query = db
    .from("appointments")
    .select(COLUMNS)
    .eq("clinic_id", clinicId)
    .gte("scheduled_at", from.toISOString())
    .lt("scheduled_at", to.toISOString())
    .order("scheduled_at");
  if (agendaIds) query = query.in("agenda_id", agendaIds);
  if (statuses) query = query.in("status", statuses);
  return unwrap(await query, "Atendimentos").map(toAppointment);
}

// ---------------------------------------------------------------------------
// Trilha
// ---------------------------------------------------------------------------

export type TrailEvent =
  | "created"
  | "rescheduled"
  | "canceled"
  | "presence_confirmed"
  | "presence_unconfirmed"
  | "attendance_recorded"
  | "attendance_corrected"
  | "waitlist_joined"
  | "waitlist_left"
  | "waitlist_advanced"
  | "message_not_sent"
  | "reminder_resent"
  | "preparation_resent"
  | "rebooking_dismissed";

/** Grava na trilha; falha só vai para o log (não desfaz a ação já feita). */
export async function logTrail(
  db: DbClient,
  clinicId: string,
  appointmentId: string,
  event: TrailEvent,
  channel: TrailChannel,
  actorId: string | null,
  details: Record<string, string | boolean> = {},
): Promise<void> {
  const { error } = await db
    .from("appointment_events")
    .insert({ clinic_id: clinicId, appointment_id: appointmentId, event_type: event, channel, actor_id: actorId, details });
  if (error) console.error("[trilha] não gravou", event, appointmentId, error.message);
}

// ---------------------------------------------------------------------------
// Duplicidade (por agenda) e retorno (mesma agenda)
// ---------------------------------------------------------------------------

const VISIT_CATEGORIES: ServiceCategory[] = ["consultation", "return_visit"];

export type UpcomingAppointment = {
  id: string;
  scheduledAt: Date;
  agendaId: string;
  serviceId: string;
  category: ServiceCategory;
  /** Sessão de série recorrente (D9). */
  seriesId: string | null;
};

/** Atendimentos ativos futuros dos pacientes (para a busca e para a trava de duplicidade). */
export async function listUpcomingAppointments(
  db: DbClient,
  clinicId: string,
  patientIds: string[],
  now: Date = new Date(),
): Promise<Map<string, UpcomingAppointment[]>> {
  const result = new Map<string, UpcomingAppointment[]>();
  if (!patientIds.length) return result;
  const rows = unwrap(
    await db
      .from("appointments")
      .select("id, patient_id, scheduled_at, agenda_id, service_id, series_id, services ( category )")
      .eq("clinic_id", clinicId)
      .in("patient_id", patientIds)
      .in("status", ACTIVE)
      .gt("scheduled_at", now.toISOString())
      .order("scheduled_at"),
    "Próximos atendimentos",
  ) as unknown as {
    id: string;
    patient_id: string;
    scheduled_at: string;
    agenda_id: string;
    service_id: string;
    series_id: string | null;
    services: { category: ServiceCategory };
  }[];
  for (const row of rows) {
    const list = result.get(row.patient_id) ?? [];
    list.push({
      id: row.id,
      scheduledAt: new Date(row.scheduled_at),
      agendaId: row.agenda_id,
      serviceId: row.service_id,
      category: row.services.category,
      seriesId: row.series_id,
    });
    result.set(row.patient_id, list);
  }
  return result;
}

/**
 * O atendimento futuro que impede marcar outro (decisão de 04/out):
 * Consulta/Retorno → Consulta/Retorno na mesma agenda; Exame → o mesmo exame.
 * Sessões de série não travam (decisão de 04/out, F3.6b).
 */
export function findBlockingAppointment(
  upcoming: UpcomingAppointment[],
  target: { serviceId: string; agendaId: string; category: ServiceCategory },
  ignoreAppointmentId?: string,
): UpcomingAppointment | null {
  return (
    upcoming.find((appointment) => {
      if (appointment.id === ignoreAppointmentId || appointment.seriesId !== null) return false;
      if (target.category === "exam") return appointment.serviceId === target.serviceId;
      return appointment.agendaId === target.agendaId && VISIT_CATEGORIES.includes(appointment.category);
    }) ?? null
  );
}

export type ReturnOrigin = {
  id: string;
  /** Data da consulta no fuso da clínica. */
  date: string;
  /** Último dia do retorno (inclusive); null = serviço sem prazo. */
  lastDate: string | null;
  isHomeVisit: boolean;
  /** Já tem um retorno não cancelado ligado a ela. */
  alreadyUsed: boolean;
};

/** Último dia do retorno: data da consulta + prazo do serviço (Fase 17). */
export function returnLastDate(originDate: string, deadlineDays: number | null): string | null {
  return deadlineDays === null ? null : addDays(originDate, deadlineDays);
}

/**
 * Consulta de origem de um retorno: a indicada, ou a última Consulta do
 * paciente **na mesma agenda** já realizada ou passada e ainda pendente
 * (falta e cancelada nunca contam).
 */
export async function findReturnOrigin(
  db: DbClient,
  clinicId: string,
  {
    patientId,
    agendaId,
    returnServiceId,
    originAppointmentId,
    ignoreAppointmentId,
  }: { patientId: string; agendaId: string; returnServiceId: string; originAppointmentId?: string | null; ignoreAppointmentId?: string | null },
  now: Date = new Date(),
): Promise<ReturnOrigin | null> {
  const [settings, returnService] = await Promise.all([
    db.from("clinic_settings").select("timezone").eq("clinic_id", clinicId).maybeSingle().then((r) => unwrapOne(r, "Configuração da clínica")),
    db.from("services").select("return_deadline_days").eq("clinic_id", clinicId).eq("id", returnServiceId).maybeSingle().then((r) => unwrapOne(r, "Serviço de retorno")),
  ]);

  let query = db
    .from("appointments")
    .select("id, scheduled_at, locations ( type ), services!inner ( category )")
    .eq("clinic_id", clinicId);
  if (originAppointmentId) {
    query = query.eq("id", originAppointmentId);
  } else {
    query = query
      .eq("patient_id", patientId)
      .eq("agenda_id", agendaId)
      .eq("services.category", "consultation")
      .in("status", ["completed", "scheduled", "confirmed"])
      .lt("scheduled_at", now.toISOString());
    if (ignoreAppointmentId) query = query.neq("id", ignoreAppointmentId);
  }
  const origin = unwrap(await query.order("scheduled_at", { ascending: false }).limit(1).maybeSingle(), "Consulta de origem") as unknown as {
    id: string;
    scheduled_at: string;
    locations: { type: string } | null;
  } | null;
  if (!origin) return null;

  let used = db.from("appointments").select("id").eq("clinic_id", clinicId).eq("origin_appointment_id", origin.id).neq("status", "canceled");
  if (ignoreAppointmentId) used = used.neq("id", ignoreAppointmentId);
  const usedRows = unwrap(await used.limit(1), "Retornos da consulta");

  const date = localDateOf(new Date(origin.scheduled_at), settings.timezone);
  return {
    id: origin.id,
    date,
    lastDate: returnLastDate(date, returnService.return_deadline_days),
    isHomeVisit: origin.locations?.type === "home_visit",
    alreadyUsed: usedRows.length > 0,
  };
}

export type ReturnEligibility =
  | { status: "eligible"; origin: ReturnOrigin }
  | { status: "no_recent_consultation"; origin: ReturnOrigin | null }
  | { status: "home_visit"; origin: ReturnOrigin }
  | { status: "return_used"; origin: ReturnOrigin }
  | { status: "future_appointment"; origin: ReturnOrigin; futureScheduledAt: Date };

/** Direito ao retorno, na ordem das regras da Fase 17 (usado pelo bot, que bloqueia). */
export function evaluateReturnEligibility(
  origin: ReturnOrigin | null,
  today: string,
  blocking: UpcomingAppointment | null,
): ReturnEligibility {
  if (!origin || (origin.lastDate !== null && today > origin.lastDate)) return { status: "no_recent_consultation", origin };
  if (origin.isHomeVisit) return { status: "home_visit", origin };
  if (origin.alreadyUsed) return { status: "return_used", origin };
  if (blocking) return { status: "future_appointment", origin, futureScheduledAt: blocking.scheduledAt };
  return { status: "eligible", origin };
}

/** Avisos da tela ao marcar retorno (nunca bloqueiam, Fase 17). */
export function returnWarnings(origin: ReturnOrigin | null, today: string): string[] {
  const br = (date: string) => date.split("-").reverse().join("/");
  if (!origin) return ["Paciente sem Consulta anterior nesta agenda: o retorno ficará sem consulta de origem."];
  const warnings: string[] = [];
  if (origin.isHomeVisit) warnings.push(`A consulta de origem (${br(origin.date)}) foi domiciliar: consulta domiciliar não dá direito a retorno.`);
  if (origin.alreadyUsed) warnings.push(`A consulta de origem (${br(origin.date)}) já tem um retorno vinculado.`);
  if (origin.lastDate !== null && today > origin.lastDate) {
    warnings.push(`Fora do prazo: o retorno da consulta de ${br(origin.date)} deveria ser até ${br(origin.lastDate)}.`);
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Marcar
// ---------------------------------------------------------------------------

export type BookInput = {
  patientId: string;
  serviceId: string;
  agendaId: string;
  start: Date;
  /** Obrigatório só quando o mesmo horário existe em mais de um local. */
  locationId?: string | null;
  homeVisitAddress?: string | null;
  /** Retorno: a consulta de origem indicada (link do bot ou da clínica); sem ela, a última da agenda. */
  originAppointmentId?: string | null;
  channel: ActionChannel;
  /** Origem na trilha, se diferente do canal (ex.: link de agendamento). */
  trailChannel?: TrailChannel;
  actorId: string | null;
};

export type BookResult = { appointment: Appointment; returnWarnings: string[] };

async function serviceCategory(db: DbClient, clinicId: string, serviceId: string): Promise<ServiceCategory> {
  return unwrapOne(await db.from("services").select("category").eq("clinic_id", clinicId).eq("id", serviceId).maybeSingle(), "Serviço").category;
}

async function assertNotDuplicate(
  db: DbClient,
  clinicId: string,
  target: { patientId: string; serviceId: string; agendaId: string; category: ServiceCategory },
  now: Date,
  ignoreAppointmentId?: string,
): Promise<void> {
  const upcoming = (await listUpcomingAppointments(db, clinicId, [target.patientId], now)).get(target.patientId) ?? [];
  const blocking = findBlockingAppointment(upcoming, target, ignoreAppointmentId);
  if (blocking) {
    throw new DataError("duplicate", "Atendimento: o paciente já tem atendimento futuro marcado", {
      patientId: "O paciente já tem atendimento futuro marcado nesta agenda",
    });
  }
}

async function locationType(db: DbClient, clinicId: string, locationId: string): Promise<string> {
  return unwrapOne(await db.from("locations").select("type").eq("clinic_id", clinicId).eq("id", locationId).maybeSingle(), "Local").type;
}

export async function bookAppointment(db: DbClient, clinicId: string, input: BookInput, now: Date = new Date()): Promise<BookResult> {
  const plan = await loadSchedulingPlan(db, clinicId, { serviceId: input.serviceId, agendaId: input.agendaId, locationId: input.locationId });
  if (!plan) throw new DataError("invalid", "Atendimento: serviço inativo ou não atendido nesta agenda", { serviceId: "Serviço não atendido nesta agenda" });

  const patient = unwrapOne(
    await db.from("patients").select("is_active").eq("clinic_id", clinicId).eq("id", input.patientId).maybeSingle(),
    "Paciente",
  );
  if (!patient.is_active) throw new DataError("invalid", "Atendimento: paciente desativado", { patientId: "Paciente desativado" });

  await assertNotDuplicate(db, clinicId, { ...input, category: plan.category }, now);

  const date = localDateOf(input.start, plan.timeZone);
  let locationId: string;
  if (plan.isGroup) {
    const time = localTimeOf(input.start, plan.timeZone);
    const window = (plan.windowsByWeekday.get(weekdayOf(date)) ?? []).find((w) => w.startTime === time && w.capacity !== null);
    if (!window) throw new DataError("conflict", "Atendimento: não há turma neste horário", { start: "Não há turma neste horário" });
    locationId = window.locationId;
  } else {
    const slots = await getFreeSlots(db, clinicId, { serviceId: input.serviceId, agendaId: input.agendaId, locationId: input.locationId, date }, now);
    const slot = slots.find((s) => s.start.getTime() === input.start.getTime());
    if (!slot) throw new DataError("conflict", "Atendimento: horário não está mais livre", { start: "Horário não está mais livre" });
    locationId = slot.locationId;
  }

  const homeVisitAddress = input.homeVisitAddress?.trim() || null;
  const isHomeVisit = (await locationType(db, clinicId, locationId)) === "home_visit";
  if (isHomeVisit && !homeVisitAddress) {
    throw new DataError("invalid", "Atendimento: informe o endereço do atendimento domiciliar", { homeVisitAddress: "Informe o endereço" });
  }

  let origin: ReturnOrigin | null = null;
  if (plan.category === "return_visit") {
    origin = await findReturnOrigin(
      db,
      clinicId,
      { patientId: input.patientId, agendaId: input.agendaId, returnServiceId: input.serviceId, originAppointmentId: input.originAppointmentId },
      now,
    );
  }

  let id: string;
  if (plan.isGroup) {
    const { data, error } = await db.rpc("book_group_session", {
      p_service_id: input.serviceId,
      p_agenda_id: input.agendaId,
      p_location_id: locationId,
      p_patient_id: input.patientId,
      p_scheduled_at: input.start.toISOString(),
      p_booking_channel: input.channel,
    });
    if (error) {
      const message = (error as { message?: string }).message ?? "";
      if (message === "slot_full") throw new DataError("conflict", "Atendimento: turma lotada", { start: "Turma lotada" }, { cause: error });
      if (message === "no_window") throw new DataError("conflict", "Atendimento: não há turma neste horário", { start: "Não há turma neste horário" }, { cause: error });
      throw fromDbError(error, "Atendimento");
    }
    id = data as string;
    if (input.actorId || homeVisitAddress) {
      unwrap(
        await db.from("appointments").update({ created_by: input.actorId, home_visit_address: homeVisitAddress }).eq("clinic_id", clinicId).eq("id", id),
        "Atendimento",
      );
    }
  } else {
    id = crypto.randomUUID();
    const { error } = await db.from("appointments").insert({
      id,
      clinic_id: clinicId,
      patient_id: input.patientId,
      service_id: input.serviceId,
      agenda_id: input.agendaId,
      location_id: locationId,
      scheduled_at: input.start.toISOString(),
      duration_minutes: plan.durationMinutes,
      booking_channel: input.channel,
      origin_appointment_id: origin?.id ?? null,
      home_visit_address: isHomeVisit ? homeVisitAddress : null,
      created_by: input.actorId,
    });
    if (error) {
      if ((error as { code?: string }).code === "23P01") {
        throw new DataError("conflict", "Atendimento: horário não está mais livre", { start: "Horário não está mais livre" }, { cause: error });
      }
      throw fromDbError(error, "Atendimento");
    }
  }

  await logTrail(db, clinicId, id, "created", input.trailChannel ?? input.channel, input.actorId);

  // Links de agendamento pendentes do mesmo serviço perdem a validade (piloto, Fase 12).
  const { error: linkError } = await db
    .from("booking_links")
    .update({ used_at: now.toISOString() })
    .eq("clinic_id", clinicId)
    .eq("patient_id", input.patientId)
    .eq("service_id", input.serviceId)
    .eq("mode", "create")
    .is("used_at", null);
  if (linkError) console.error("[agenda] não invalidou links pendentes", linkError.message);

  return {
    appointment: await getAppointment(db, clinicId, id),
    returnWarnings: plan.category === "return_visit" ? returnWarnings(origin, todayIn(plan.timeZone, now)) : [],
  };
}

// ---------------------------------------------------------------------------
// Remarcar
// ---------------------------------------------------------------------------

export type RescheduleInput = {
  start: Date;
  locationId?: string | null;
  channel: ActionChannel;
  trailChannel?: TrailChannel;
  /** Evento da trilha, se não for "remarcado" (ex.: antecipado pela lista de espera). */
  trailEvent?: TrailEvent;
  actorId: string | null;
};

/** Remarcar zera o lembrete e a confirmação de presença (a data nova pede outros). */
const PRESENCE_RESET = {
  reminder_sent_at: null,
  reminder_response: null,
  reminder_response_at: null,
  confirmed_at: null,
  patient_confirmed_at: null,
  patient_confirmed_by: null,
};

export async function rescheduleAppointment(
  db: DbClient,
  clinicId: string,
  id: string,
  input: RescheduleInput,
  now: Date = new Date(),
): Promise<Appointment> {
  const current = await getAppointment(db, clinicId, id);
  if (!ACTIVE.includes(current.status)) {
    throw new DataError("invalid", "Atendimento: só atendimento marcado ou confirmado pode ser remarcado", { status: "Atendimento não está ativo" });
  }
  const plan = await loadSchedulingPlan(db, clinicId, { serviceId: current.serviceId, agendaId: current.agendaId, locationId: input.locationId });
  if (!plan) throw new DataError("invalid", "Atendimento: serviço inativo ou não atendido nesta agenda", { serviceId: "Serviço não atendido nesta agenda" });

  // Sessão de série não passa pela trava (decisão de 04/out, F3.6b).
  if (current.seriesId === null) {
    const category = await serviceCategory(db, clinicId, current.serviceId);
    await assertNotDuplicate(db, clinicId, { ...current, category }, now, id);
  }

  if (plan.isGroup) {
    const { error } = await db.rpc("reschedule_group_session", {
      p_appointment_id: id,
      p_scheduled_at: input.start.toISOString(),
      p_channel: input.channel,
    });
    if (error) {
      const message = (error as { message?: string }).message ?? "";
      if (message === "slot_full" || message === "no_window") {
        throw new DataError("conflict", "Atendimento: turma lotada ou inexistente neste horário", { start: "Turma indisponível" }, { cause: error });
      }
      throw fromDbError(error, "Atendimento");
    }
    unwrap(await db.from("appointments").update(PRESENCE_RESET).eq("clinic_id", clinicId).eq("id", id), "Atendimento");
  } else {
    // O próprio atendimento não ocupa o horário que vai deixar.
    const date = localDateOf(input.start, plan.timeZone);
    const slots = await getFreeSlots(db, clinicId, { serviceId: current.serviceId, agendaId: current.agendaId, locationId: input.locationId, date, ignoreAppointmentId: id }, now);
    const slot = slots.find((s) => s.start.getTime() === input.start.getTime());
    if (!slot) throw new DataError("conflict", "Atendimento: horário não está mais livre", { start: "Horário não está mais livre" });
    const { data, error } = await db
      .from("appointments")
      .update({
        scheduled_at: input.start.toISOString(),
        location_id: slot.locationId,
        rescheduled_at: now.toISOString(),
        rescheduled_via: input.channel,
        rescheduled_by: input.actorId,
        ...PRESENCE_RESET,
      })
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .in("status", ACTIVE)
      .select("id")
      .maybeSingle();
    if (error && (error as { code?: string }).code === "23P01") {
      throw new DataError("conflict", "Atendimento: horário não está mais livre", { start: "Horário não está mais livre" }, { cause: error });
    }
    unwrapOne({ data, error }, "Atendimento");
  }

  await logTrail(db, clinicId, id, input.trailEvent ?? "rescheduled", input.trailChannel ?? input.channel, input.actorId, {
    from: current.scheduledAt.toISOString(),
    to: input.start.toISOString(),
  });
  return getAppointment(db, clinicId, id);
}

// ---------------------------------------------------------------------------
// Cancelar, presença e comparecimento
// ---------------------------------------------------------------------------

export type CancelInput = {
  channel: ActionChannel;
  trailChannel?: TrailChannel;
  actorId: string | null;
  /** Cancelamento pela clínica de vários de uma vez (dia inteiro, bloqueio). */
  massCanceled?: boolean;
};

/**
 * Cancela, se ainda não estava cancelado (trava atômica do piloto). Devolve
 * o atendimento cancelado, ou null se outro canal já tinha cancelado.
 */
export async function cancelAppointment(
  db: DbClient,
  clinicId: string,
  id: string,
  input: CancelInput,
  now: Date = new Date(),
): Promise<Appointment | null> {
  const row = unwrap(
    await db
      .from("appointments")
      .update({
        status: "canceled",
        canceled_at: now.toISOString(),
        canceled_via: input.channel,
        canceled_by: input.actorId,
        mass_canceled: input.massCanceled ?? false,
      })
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .neq("status", "canceled")
      .select(COLUMNS)
      .maybeSingle(),
    "Atendimento",
  );
  if (!row) return null;
  await logTrail(db, clinicId, id, "canceled", input.trailChannel ?? input.channel, input.actorId);
  return toAppointment(row);
}

/** Cancela vários (dia inteiro, bloqueio): cada um é independente; devolve os cancelados agora. */
export async function cancelAppointments(
  db: DbClient,
  clinicId: string,
  ids: string[],
  input: CancelInput,
  now: Date = new Date(),
): Promise<{ canceled: Appointment[]; skipped: number }> {
  const canceled: Appointment[] = [];
  let skipped = 0;
  for (const id of ids) {
    const appointment = await cancelAppointment(db, clinicId, id, { ...input, massCanceled: true }, now);
    if (appointment) canceled.push(appointment);
    else skipped += 1;
  }
  return { canceled, skipped };
}

/** Presença confirmada à mão (Fase 19); a trilha só registra mudança de fato. */
export async function setPresenceConfirmed(
  db: DbClient,
  clinicId: string,
  id: string,
  confirmed: boolean,
  actorId: string | null,
  now: Date = new Date(),
): Promise<Appointment> {
  const before = await getAppointment(db, clinicId, id);
  const row = unwrapOne(
    await db
      .from("appointments")
      .update(confirmed ? { patient_confirmed_at: now.toISOString(), patient_confirmed_by: actorId } : { patient_confirmed_at: null, patient_confirmed_by: null })
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .in("status", ACTIVE)
      .select(COLUMNS)
      .maybeSingle(),
    "Atendimento",
  );
  if ((before.patientConfirmedAt !== null) !== confirmed) {
    await logTrail(db, clinicId, id, confirmed ? "presence_confirmed" : "presence_unconfirmed", "admin", actorId);
  }
  return toAppointment(row);
}

/** Realizado ou falta; trocar um pelo outro fica como correção na trilha. */
export async function recordAttendance(
  db: DbClient,
  clinicId: string,
  id: string,
  status: "completed" | "no_show",
  actorId: string | null,
): Promise<Appointment> {
  if (status !== "completed" && status !== "no_show") throw new DataError("invalid", "Atendimento: situação inválida", { status: "Situação inválida" });
  const before = await getAppointment(db, clinicId, id);
  if (before.status === "canceled") throw new DataError("invalid", "Atendimento: cancelado não recebe presença", { status: "Atendimento cancelado" });
  const row = unwrapOne(
    await db.from("appointments").update({ status }).eq("clinic_id", clinicId).eq("id", id).select(COLUMNS).maybeSingle(),
    "Atendimento",
  );
  if (before.status !== status) {
    const isCorrection = before.status === "completed" || before.status === "no_show";
    await logTrail(
      db,
      clinicId,
      id,
      isCorrection ? "attendance_corrected" : "attendance_recorded",
      "admin",
      actorId,
      isCorrection ? { from: before.status, to: status } : { status },
    );
  }
  return toAppointment(row);
}
