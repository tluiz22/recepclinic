import type { Enums } from "../supabase/database.types";
import { MIN_BASE, PARTIAL_SHARE, ratio, type Ratio } from "../metricsRules";
import type { DbClient } from "./clients";
import { unwrap, unwrapAll } from "./errors";

// Métricas › Desempenho (redesign de 22/out/2026, M2): as contas vêm das
// funções do banco (`metrics_*`, security invoker: o RLS vale) e aqui viram
// os indicadores. Regras de cada indicador no plano ("Redesign das Métricas")
// e no "i" da tela.

type Category = Enums<"service_category">;
type Status = Enums<"appointment_status">;

export type PerformanceScope = {
  start: Date;
  end: Date;
  agendaIds: string[];
  serviceIds?: string[] | null;
  locationIds?: string[] | null;
};

export type ActivityDay = {
  day: string;
  createdPanel: number;
  createdWhatsapp: number;
  createdCanceled: number;
  returnsPanel: number;
  returnsWhatsapp: number;
  rescheduledPatient: number;
  rescheduledTeam: number;
  waitlistAdvanced: number;
  canceledPatient: number;
  canceledClinic: number;
  canceledMass: number;
};

export type AttendanceRow = {
  day: string;
  serviceId: string;
  serviceName: string;
  category: Category;
  locationId: string;
  locationName: string;
  scheduled: number;
  canceled: number;
  completed: number;
  noShow: number;
  unregistered: number;
  upcoming: number;
};

export type ReminderOutcome = "confirmed" | "reschedule" | "cancel" | "not_delivered" | "waiting" | "no_answer" | "canceled_no_answer" | "none";

export type ReminderRow = { outcome: ReminderOutcome; status: Status; total: number };

export type ReturnRight = {
  appointmentId: string;
  patientId: string;
  agendaId: string;
  scheduledAt: Date;
  lastDate: string;
  hasReturn: boolean;
  hasUpcoming: boolean;
  status: "due" | "open" | "other";
};

export type PerformanceData = { activity: ActivityDay[]; attendance: AttendanceRow[]; reminders: ReminderRow[]; returnRights: ReturnRight[] };

const n = (value: unknown) => Number(value) || 0;

function args(clinicId: string, scope: PerformanceScope) {
  return {
    p_clinic_id: clinicId,
    p_start: scope.start.toISOString(),
    p_end: scope.end.toISOString(),
    p_agenda_ids: scope.agendaIds,
    p_service_ids: scope.serviceIds?.length ? scope.serviceIds : undefined,
    p_location_ids: scope.locationIds?.length ? scope.locationIds : undefined,
  };
}

export async function listActivity(db: DbClient, clinicId: string, scope: PerformanceScope): Promise<ActivityDay[]> {
  if (!scope.agendaIds.length) return [];
  const rows = unwrap(await db.rpc("metrics_activity", args(clinicId, scope)), "Métricas: agendamentos");
  return rows.map((r) => ({
    day: r.day,
    createdPanel: n(r.created_panel),
    createdWhatsapp: n(r.created_whatsapp),
    createdCanceled: n(r.created_canceled),
    returnsPanel: n(r.returns_panel),
    returnsWhatsapp: n(r.returns_whatsapp),
    rescheduledPatient: n(r.rescheduled_patient),
    rescheduledTeam: n(r.rescheduled_team),
    waitlistAdvanced: n(r.waitlist_advanced),
    canceledPatient: n(r.canceled_patient),
    canceledClinic: n(r.canceled_clinic),
    canceledMass: n(r.canceled_mass),
  }));
}

export async function listAttendance(db: DbClient, clinicId: string, scope: PerformanceScope, now: Date): Promise<AttendanceRow[]> {
  if (!scope.agendaIds.length) return [];
  const rows = await unwrapAll(
    (from, to) =>
      db
        .rpc("metrics_attendance", { ...args(clinicId, scope), p_now: now.toISOString() })
        .order("day")
        .order("service_id")
        .order("location_id")
        .range(from, to),
    "Métricas: comparecimento",
  );
  return rows.map((r) => ({
    day: r.day,
    serviceId: r.service_id,
    serviceName: r.service_name,
    category: r.service_category,
    locationId: r.location_id,
    locationName: r.location_name,
    scheduled: n(r.scheduled),
    canceled: n(r.canceled),
    completed: n(r.completed),
    noShow: n(r.no_show),
    unregistered: n(r.unregistered),
    upcoming: n(r.upcoming),
  }));
}

export async function listReminderOutcomes(db: DbClient, clinicId: string, scope: PerformanceScope, now: Date): Promise<ReminderRow[]> {
  if (!scope.agendaIds.length) return [];
  const rows = unwrap(await db.rpc("metrics_reminders", { ...args(clinicId, scope), p_now: now.toISOString() }), "Métricas: lembretes");
  return rows.map((r) => ({ outcome: r.outcome as ReminderOutcome, status: r.status, total: n(r.total) }));
}

/** Consultas com direito a retorno; com `start = end = agora`, as de prazo ainda aberto. */
export async function listReturnRights(
  db: DbClient,
  clinicId: string,
  scope: Pick<PerformanceScope, "start" | "end" | "agendaIds" | "locationIds">,
  now: Date,
): Promise<ReturnRight[]> {
  if (!scope.agendaIds.length) return [];
  const rows = await unwrapAll(
    (from, to) =>
      db
        .rpc("metrics_return_rights", {
          p_clinic_id: clinicId,
          p_start: scope.start.toISOString(),
          p_end: scope.end.toISOString(),
          p_agenda_ids: scope.agendaIds,
          p_location_ids: scope.locationIds?.length ? scope.locationIds : undefined,
          p_now: now.toISOString(),
        })
        .order("appointment_id")
        .range(from, to),
    "Métricas: retornos",
  );
  return rows.map((r) => ({
    appointmentId: r.appointment_id,
    patientId: r.patient_id,
    agendaId: r.agenda_id,
    scheduledAt: new Date(r.scheduled_at),
    lastDate: r.last_date,
    hasReturn: r.has_return,
    hasUpcoming: r.has_upcoming,
    status: r.status as ReturnRight["status"],
  }));
}

/** Oportunidade agora: consulta com o prazo aberto, sem retorno ligado e sem consulta ou retorno futuro na agenda. */
export async function listReturnOpportunities(
  db: DbClient,
  clinicId: string,
  scope: Pick<PerformanceScope, "agendaIds" | "locationIds">,
  now: Date,
): Promise<ReturnRight[]> {
  const rights = await listReturnRights(db, clinicId, { ...scope, start: now, end: now }, now);
  return rights.filter((r) => r.status === "open" && !r.hasReturn && !r.hasUpcoming).sort((a, b) => a.lastDate.localeCompare(b.lastDate));
}

export async function loadPerformance(db: DbClient, clinicId: string, scope: PerformanceScope, now: Date): Promise<PerformanceData> {
  const [activity, attendance, reminders, returnRights] = await Promise.all([
    listActivity(db, clinicId, scope),
    listAttendance(db, clinicId, scope, now),
    listReminderOutcomes(db, clinicId, scope, now),
    listReturnRights(db, clinicId, scope, now),
  ]);
  return { activity, attendance, reminders, returnRights };
}

// ---------------------------------------------------------------------------
// Indicadores (regras puras)
// ---------------------------------------------------------------------------

export type PerformanceSummary = {
  created: { total: number; panel: number; whatsapp: number; canceledLater: number };
  rescheduled: { total: number; patient: number; team: number; waitlist: number };
  canceled: { total: number; patient: number; clinic: number; mass: number; ofScheduled: Ratio };
  attendance: { completed: number; noShow: number; unregistered: number; upcoming: number; showRate: Ratio; noShowRate: Ratio; partial: boolean };
  reminders: {
    confirmed: number;
    reschedule: number;
    cancel: number;
    noAnswer: number;
    notDelivered: number;
    waiting: number;
    sent: number;
    confirmedRate: Ratio;
  };
  /** Faltas entre os registrados, pela resposta ao lembrete (associação, não causa). */
  noShowByReminder: { key: "confirmed" | "no_answer"; label: string; noShow: Ratio }[];
  returns: { booked: number; panel: number; whatsapp: number; dueWithReturn: Ratio };
};

const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);

export function summarizePerformance(data: PerformanceData): PerformanceSummary {
  const a = data.activity;
  const createdPanel = sum(a, (r) => r.createdPanel);
  const createdWhatsapp = sum(a, (r) => r.createdWhatsapp);
  const rescheduledPatient = sum(a, (r) => r.rescheduledPatient);
  const rescheduledTeam = sum(a, (r) => r.rescheduledTeam);
  const waitlist = sum(a, (r) => r.waitlistAdvanced);
  const canceledPatient = sum(a, (r) => r.canceledPatient);
  const canceledClinic = sum(a, (r) => r.canceledClinic);
  const canceledMass = sum(a, (r) => r.canceledMass);

  const att = data.attendance;
  const completed = sum(att, (r) => r.completed);
  const noShow = sum(att, (r) => r.noShow);
  const unregistered = sum(att, (r) => r.unregistered);
  const registered = completed + noShow;
  const withDate = sum(att, (r) => r.scheduled + r.canceled);

  const rem = (outcome: ReminderOutcome) => sum(data.reminders.filter((r) => r.outcome === outcome), (r) => r.total);
  const confirmed = rem("confirmed");
  const reschedule = rem("reschedule");
  const cancel = rem("cancel");
  const noAnswer = rem("no_answer");
  const remindersBase = confirmed + reschedule + cancel + noAnswer;
  const byReminder = (outcomes: ReminderOutcome[]) => {
    const rows = data.reminders.filter((r) => outcomes.includes(r.outcome));
    const ns = sum(rows.filter((r) => r.status === "no_show"), (r) => r.total);
    const reg = sum(rows.filter((r) => r.status === "no_show" || r.status === "completed"), (r) => r.total);
    return ratio(ns, reg);
  };

  const due = data.returnRights.filter((r) => r.status === "due");

  return {
    created: { total: createdPanel + createdWhatsapp, panel: createdPanel, whatsapp: createdWhatsapp, canceledLater: sum(a, (r) => r.createdCanceled) },
    rescheduled: { total: rescheduledPatient + rescheduledTeam + waitlist, patient: rescheduledPatient, team: rescheduledTeam, waitlist },
    canceled: {
      total: canceledPatient + canceledClinic + canceledMass,
      patient: canceledPatient,
      clinic: canceledClinic,
      mass: canceledMass,
      ofScheduled: ratio(sum(att, (r) => r.canceled), withDate),
    },
    attendance: {
      completed,
      noShow,
      unregistered,
      upcoming: sum(att, (r) => r.upcoming),
      showRate: ratio(completed, registered),
      noShowRate: ratio(noShow, registered),
      partial: registered + unregistered > 0 && unregistered / (registered + unregistered) > PARTIAL_SHARE,
    },
    reminders: {
      confirmed,
      reschedule,
      cancel,
      noAnswer,
      notDelivered: rem("not_delivered"),
      waiting: rem("waiting"),
      sent: remindersBase + rem("not_delivered") + rem("waiting"),
      confirmedRate: ratio(confirmed, remindersBase),
    },
    noShowByReminder: [
      { key: "confirmed", label: "Confirmaram", noShow: byReminder(["confirmed"]) },
      { key: "no_answer", label: "Não responderam", noShow: byReminder(["no_answer"]) },
    ],
    returns: {
      booked: sum(a, (r) => r.returnsPanel + r.returnsWhatsapp),
      panel: sum(a, (r) => r.returnsPanel),
      whatsapp: sum(a, (r) => r.returnsWhatsapp),
      dueWithReturn: ratio(due.filter((r) => r.hasReturn).length, due.length),
    },
  };
}

export type ServiceLocationRow = {
  serviceName: string;
  locationName: string;
  category: Category;
  total: number;
  registered: number;
  noShow: number;
  noShowRate: Ratio;
  /** Taxa de faltas 1,5 vez acima da clínica, com base de pelo menos 20 registrados. */
  hot: boolean;
};

/** Volume e faltas por serviço e local (sem os cancelados), do maior volume para o menor. */
export function byServiceAndLocation(rows: AttendanceRow[]): { rows: ServiceLocationRow[]; total: ServiceLocationRow } {
  const map = new Map<string, ServiceLocationRow>();
  for (const r of rows) {
    const key = `${r.serviceId}:${r.locationId}`;
    const row = map.get(key) ?? { serviceName: r.serviceName, locationName: r.locationName, category: r.category, total: 0, registered: 0, noShow: 0, noShowRate: ratio(0, 0), hot: false };
    row.total += r.scheduled;
    row.registered += r.completed + r.noShow;
    row.noShow += r.noShow;
    map.set(key, row);
  }
  const list = [...map.values()].filter((r) => r.total > 0);
  const totalRegistered = sum(list, (r) => r.registered);
  const totalNoShow = sum(list, (r) => r.noShow);
  const clinicRate = totalRegistered ? totalNoShow / totalRegistered : 0;
  for (const r of list) {
    r.noShowRate = ratio(r.noShow, r.registered);
    r.hot = r.registered >= MIN_BASE && clinicRate > 0 && r.noShowRate.rate! >= clinicRate * 1.5;
  }
  list.sort((x, y) => y.total - x.total || x.serviceName.localeCompare(y.serviceName, "pt-BR"));
  return {
    rows: list,
    total: {
      serviceName: "Total",
      locationName: "",
      category: "consultation",
      total: sum(list, (r) => r.total),
      registered: totalRegistered,
      noShow: totalNoShow,
      noShowRate: ratio(totalNoShow, totalRegistered),
      hot: false,
    },
  };
}
