import { addDays, formatInstant, localDateOf, todayIn } from "../../clinicTime";
import { capitalize } from "../../vocabulary";
import { logError } from "../../log";
import { bookAppointment, cancelAppointment, findReturnOrigin, rescheduleAppointment } from "../agenda/appointments";
import { earliestDate, getFreeSlots, getNextAvailableDates, horizonLastDate } from "../agenda/slots";
import { BOOKING_HORIZON_DEFAULT } from "../config/clinic";
import type { DbClient } from "../clients";
import { DataError, unwrap } from "../errors";
import { confirmationEnabled, sendAppointmentNotice, sendOtherResponsibleNotice } from "../whatsapp/notices";
import { recipientOfAppointment } from "../whatsapp/recipient";
import type { ClinicSender } from "../whatsapp/send";
import { phonePatients, saveContactHomeAddress } from "./booking";
import { findContactByPhone } from "../patients";
import { responsibleLabel, setAppointmentsBooker } from "../patientContacts";

// Minhas consultas (F3c; especificação P12; RD10, I7, F3-3 e F3-4): com o celular comprovado (código ou link do bot),
// as próximas consultas dos pacientes do celular, cada uma com Remarcar (mesmo profissional, serviço e tipo de local;
// dias e horários do mesmo jeito do portal) e Cancelar ("Tem certeza? A vaga será liberada."). Regras:
//   - antecedência da clínica (`portal_cancel_lead_hours`; padrão 0 h, sem prazo, desde 10/nov/2026) só para quem entra direto em Minhas consultas;
//     o link do bot (Remarcar do menu e do lembrete) remarca a qualquer hora (F3-4); dentro do prazo, só "Falar com a
//     recepção";
//   - turma e domiciliar: só Cancelar (Remarcar com a recepção até a F3e);
//   - sessão de série: remarca ou cancela só ela (D9, como no bot);
//   - remarcação depois do cancelamento pela clínica (F3-3): o atendimento cancelado volta a ser marcado (novo, com o
//     mesmo paciente, serviço e agenda); retorno sem o limite do prazo (Fase 17).

const ACTIVE: ("scheduled" | "confirmed")[] = ["scheduled", "confirmed"];

export type MyAppointment = {
  id: string;
  patientId: string;
  patientName: string;
  serviceId: string;
  serviceName: string;
  category: "consultation" | "return_visit" | "exam";
  professionalName: string | null;
  agendaId: string;
  locationId: string;
  locationName: string;
  locationAddress: string | null;
  locationType: string;
  start: Date;
  durationMinutes: number;
  status: string;
  isGroup: boolean;
  originAppointmentId: string | null;
  /** Remarcar pelo portal (individual, no consultório ou em casa, F3e-1). */
  canReschedule: boolean;
  /** Em casa (F3e-1): o endereço gravado no atendimento. */
  homeVisitAddress: string | null;
  /**
   * Quem marcou e recebe os avisos (UI-4, D14): "Marcada por você", "Marcada por Carlos (pai), que recebe os
   * avisos"… Só quando o paciente tem mais de um responsável (com um só, nada muda); null = não mostra.
   */
  bookedByText: string | null;
};

const COLUMNS =
  "id, patient_id, scheduled_at, duration_minutes, status, agenda_id, service_id, location_id, origin_appointment_id, home_visit_address, booked_by_contact_id, booking_channel, patients ( full_name ), services ( name, category, scheduling_mode ), agendas ( professionals ( display_name ) ), locations ( name, type, address )";

type Row = {
  id: string;
  patient_id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  agenda_id: string;
  service_id: string;
  location_id: string;
  origin_appointment_id: string | null;
  home_visit_address: string | null;
  booked_by_contact_id: string | null;
  booking_channel: string;
  patients: { full_name: string };
  services: { name: string; category: MyAppointment["category"]; scheduling_mode: string };
  agendas: { professionals: { display_name: string } | null } | null;
  locations: { name: string; type: string; address: string | null };
};

/** O número é do próprio paciente: "com avisos para o próprio paciente", "Marcada pelo próprio paciente". */
const SELF_LABEL = "o próprio paciente";

/** Responsáveis dos pacientes do celular: o nome de cada um na tela ("Carlos (pai)"), por paciente. */
type Bookers = { sessionContactId: string | null; labels: Map<string, Map<string, string>> };

async function loadBookers(db: DbClient, clinicId: string, sessionContactId: string | null, patientIds: string[]): Promise<Bookers> {
  const labels = new Map<string, Map<string, string>>();
  if (!patientIds.length) return { sessionContactId, labels };
  const rows = unwrap(
    await db.from("patient_contacts").select("patient_id, contact_id, kinship, is_self, contacts ( full_name )").eq("clinic_id", clinicId).in("patient_id", patientIds),
    "Responsáveis do paciente",
  ) as unknown as { patient_id: string; contact_id: string; kinship: string | null; is_self: boolean; contacts: { full_name: string } | null }[];
  for (const row of rows) {
    const byContact = labels.get(row.patient_id) ?? new Map<string, string>();
    byContact.set(row.contact_id, responsibleLabel({ fullName: row.contacts?.full_name ?? "", kinship: row.kinship, isSelf: row.is_self }, SELF_LABEL));
    labels.set(row.patient_id, byContact);
  }
  return { sessionContactId, labels };
}

/** Como quem mexeu aparece no aviso ao outro responsável (VR4): "Ana (mãe)"; sem a ligação, o primeiro nome. */
async function actorLabel(db: DbClient, clinicId: string, patientId: string, contact: { id: string; fullName: string }): Promise<string> {
  const row = unwrap(
    await db.from("patient_contacts").select("kinship").eq("clinic_id", clinicId).eq("patient_id", patientId).eq("contact_id", contact.id).maybeSingle(),
    "Responsável do paciente",
  );
  return responsibleLabel({ fullName: contact.fullName, kinship: row?.kinship ?? null, isSelf: false }, "");
}

/** "Marcada por você" / "Marcada por Carlos (pai), que recebe os avisos" / "Marcada pela recepção, com avisos para …". */
export function bookedByText(row: Pick<Row, "patient_id" | "booked_by_contact_id" | "booking_channel">, bookers: Bookers): string | null {
  const byContact = bookers.labels.get(row.patient_id);
  if (!byContact || byContact.size < 2 || !row.booked_by_contact_id) return null;
  const you = row.booked_by_contact_id === bookers.sessionContactId;
  const name = you ? "você" : byContact.get(row.booked_by_contact_id);
  if (!name) return null;
  if (row.booking_channel === "admin") return `Marcada pela recepção, com avisos para ${name}`;
  if (you) return "Marcada por você";
  return `Marcada ${name === SELF_LABEL ? "pelo próprio paciente" : `por ${name}`}, que recebe os avisos`;
}

const toItem = (row: Row, bookers?: Bookers): MyAppointment => {
  const isGroup = row.services.scheduling_mode === "group";
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patients.full_name,
    serviceId: row.service_id,
    serviceName: row.services.name,
    category: row.services.category,
    professionalName: row.agendas?.professionals?.display_name ?? null,
    agendaId: row.agenda_id,
    locationId: row.location_id,
    locationName: row.locations.name,
    locationAddress: row.locations.address,
    locationType: row.locations.type,
    start: new Date(row.scheduled_at),
    durationMinutes: row.duration_minutes,
    status: row.status,
    isGroup,
    originAppointmentId: row.origin_appointment_id,
    canReschedule: !isGroup,
    homeVisitAddress: row.home_visit_address,
    bookedByText: bookers ? bookedByText(row, bookers) : null,
  };
};

/** "Consulta com Dra. Ana", "Retorno com Dra. Ana" ou o nome do exame (lista, remarcar, confirmar e cancelar). */
export const whatOf = (item: Pick<MyAppointment, "category" | "serviceName" | "professionalName">) =>
  item.category === "exam" ? item.serviceName : `${item.category === "return_visit" ? "Retorno" : item.serviceName}${item.professionalName ? ` com ${item.professionalName}` : ""}`;

/** "Quarta-feira, 11 de novembro às 08:00". */
export const whenOf = (start: Date, timeZone: string) => capitalize(formatInstant(start, timeZone, "EEEE, d 'de' MMMM 'às' HH:mm"));

/** Antecedência da clínica para cancelar e remarcar pelo portal (RD10), em horas. */
export async function leadHoursOf(db: DbClient, clinicId: string): Promise<number> {
  const row = unwrap(await db.from("clinic_settings").select("portal_cancel_lead_hours").eq("clinic_id", clinicId).maybeSingle(), "Configuração da clínica");
  return row?.portal_cancel_lead_hours ?? 0;
}

/** Fora do prazo da RD10 (pode remarcar e cancelar pelo portal). */
export const outsideLead = (start: Date, leadHours: number, now: Date = new Date()) => start.getTime() - now.getTime() >= leadHours * 3_600_000;

/** Próximas consultas dos pacientes do celular, da mais próxima à mais distante. */
export async function listMyAppointments(db: DbClient, clinicId: string, phone: string, now: Date = new Date()): Promise<MyAppointment[]> {
  const { contact, patients } = await phonePatients(db, clinicId, phone);
  if (!patients.length) return [];
  const rows = unwrap(
    await db
      .from("appointments")
      .select(COLUMNS)
      .eq("clinic_id", clinicId)
      .in(
        "patient_id",
        patients.map((p) => p.id),
      )
      .in("status", ACTIVE)
      .gte("scheduled_at", now.toISOString())
      .order("scheduled_at")
      .limit(30),
    "Atendimentos",
  ) as unknown as Row[];
  const bookers = await loadBookers(db, clinicId, contact?.id ?? null, [...new Set(rows.map((r) => r.patient_id))]);
  return rows.map((row) => toItem(row, bookers));
}

/**
 * Um atendimento do celular (ativo e futuro, ou o cancelado pela clínica de um link de remarcação). null = não é deste
 * celular, já passou ou não está mais ativo.
 */
export async function findMyAppointment(
  db: DbClient,
  clinicId: string,
  phone: string,
  id: string,
  { now = new Date(), canceledByClinic = false }: { now?: Date; canceledByClinic?: boolean } = {},
): Promise<MyAppointment | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { contact, patients } = await phonePatients(db, clinicId, phone);
  const row = unwrap(await db.from("appointments").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Atendimento") as unknown as Row | null;
  if (!row || !patients.some((p) => p.id === row.patient_id)) return null;
  if (canceledByClinic ? row.status !== "canceled" : !(ACTIVE as string[]).includes(row.status) || new Date(row.scheduled_at) < now) return null;
  return toItem(row, await loadBookers(db, clinicId, contact?.id ?? null, [row.patient_id]));
}

/** Até quando oferecer horários: prazo do profissional e, no retorno, o fim do prazo do retorno (sem ele na remarcação da clínica). */
async function lastDateFor(db: DbClient, clinicId: string, item: MyAppointment, timeZone: string, waiveReturnDeadline: boolean, now: Date): Promise<string> {
  const agenda = unwrap(await db.from("agendas").select("booking_horizon_days").eq("clinic_id", clinicId).eq("id", item.agendaId).maybeSingle(), "Agenda");
  const horizon = horizonLastDate(todayIn(timeZone, now), agenda?.booking_horizon_days ?? BOOKING_HORIZON_DEFAULT);
  if (item.category !== "return_visit" || !item.originAppointmentId || waiveReturnDeadline) return horizon;
  const origin = await findReturnOrigin(
    db,
    clinicId,
    { patientId: item.patientId, agendaId: item.agendaId, returnServiceId: item.serviceId, originAppointmentId: item.originAppointmentId, ignoreAppointmentId: item.id },
    now,
  );
  return earliestDate(origin?.lastDate ?? null, horizon) ?? horizon;
}

/** Locais da clínica onde o serviço é atendido (o tipo do atendimento de hoje). */
async function locationsFor(db: DbClient, clinicId: string, item: MyAppointment): Promise<{ id: string; name: string }[]> {
  const rows = unwrap(
    await db
      .from("service_locations")
      .select("locations!inner ( id, name, type, is_active )")
      .eq("clinic_id", clinicId)
      .eq("service_id", item.serviceId)
      .eq("locations.is_active", true)
      .eq("locations.type", item.locationType as "clinic"),
    "Locais do serviço",
  ) as unknown as { locations: { id: string; name: string } }[];
  return rows.map((r) => r.locations).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export type RescheduleScope = { lastDate: string; locations: { id: string; name: string }[]; ignoreAppointmentId: string | null; sessionId: string | null };

export async function rescheduleScope(
  db: DbClient,
  clinicId: string,
  item: MyAppointment,
  { timeZone, sessionId, rebook, now = new Date() }: { timeZone: string; sessionId: string | null; rebook: boolean; now?: Date },
): Promise<RescheduleScope> {
  const [lastDate, locations] = await Promise.all([lastDateFor(db, clinicId, item, timeZone, rebook, now), locationsFor(db, clinicId, item)]);
  return { lastDate, locations, ignoreAppointmentId: rebook ? null : item.id, sessionId };
}

/** Próximos dias com horário livre (o próprio atendimento não ocupa o horário que vai deixar). */
export async function rescheduleDates(db: DbClient, clinicId: string, item: MyAppointment, scope: RescheduleScope, now: Date = new Date()): Promise<string[]> {
  const per = await Promise.all(
    scope.locations.map((location) =>
      getNextAvailableDates(
        db,
        clinicId,
        { serviceId: item.serviceId, agendaId: item.agendaId, locationId: location.id, count: 60, lastDate: scope.lastDate, ignoreAppointmentId: scope.ignoreAppointmentId, holds: { exceptSession: scope.sessionId } },
        now,
      ),
    ),
  );
  // Como nos horários do agendamento (professionalDates): a faixa de dias anda pelo prazo inteiro.
  return [...new Set(per.flat().map((d) => d.date))].sort();
}

export type RescheduleSlot = { start: Date; locationId: string };

export async function rescheduleSlots(db: DbClient, clinicId: string, item: MyAppointment, scope: RescheduleScope, date: string, now: Date = new Date()): Promise<RescheduleSlot[]> {
  if (date > scope.lastDate) return [];
  const per = await Promise.all(
    scope.locations.map(async (location) =>
      (
        await getFreeSlots(
          db,
          clinicId,
          { serviceId: item.serviceId, agendaId: item.agendaId, locationId: location.id, date, ignoreAppointmentId: scope.ignoreAppointmentId, holds: { exceptSession: scope.sessionId } },
          now,
        )
      ).map((slot) => ({ start: slot.start, locationId: slot.locationId })),
    ),
  );
  const seen = new Set<number>();
  return per
    .flat()
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .filter((slot) => (seen.has(slot.start.getTime()) ? false : (seen.add(slot.start.getTime()), true)))
    // O horário de hoje não é "novo".
    .filter((slot) => scope.ignoreAppointmentId === null || slot.start.getTime() !== item.start.getTime());
}

/** O horário escolhido ainda está livre (conferido de novo antes de mostrar a confirmação). */
export async function isRescheduleSlotFree(db: DbClient, clinicId: string, item: MyAppointment, scope: RescheduleScope, slot: RescheduleSlot, timeZone: string, now: Date = new Date()): Promise<boolean> {
  if (!scope.locations.some((l) => l.id === slot.locationId)) return false;
  const date = localDateOf(slot.start, timeZone);
  if (date < todayIn(timeZone, now) || date > addDays(todayIn(timeZone, now), 400)) return false;
  return (await rescheduleSlots(db, clinicId, item, scope, date, now)).some((s) => s.start.getTime() === slot.start.getTime() && s.locationId === slot.locationId);
}

/** "duplicate": o paciente já tem outro atendimento futuro igual (a regra do bot e da Agenda); a recepção resolve. */
export type ChangeOutcome = { status: "done"; appointmentId: string } | { status: "taken" | "gone" | "lead" | "duplicate" | "failed" };

/**
 * Remarca (ou, depois do cancelamento pela clínica, marca de novo) pelo canal do portal e manda o aviso da remarcação
 * (ou a confirmação) pelo WhatsApp. O banco confere de novo o horário (um atendimento por horário).
 */
export async function rescheduleMine(
  db: DbClient,
  clinicId: string,
  input: {
    item: MyAppointment;
    slot: RescheduleSlot;
    scope: RescheduleScope;
    rebook: boolean;
    leadHours: number | null;
    sender: ClinicSender | null;
    /** Em casa (F3e-1, DM4): o endereço confirmado ou o novo; sem ele, fica o do atendimento. */
    homeVisitAddress?: string | null;
    /** O celular comprovado (o endereço novo vira o padrão do contato). */
    phone?: string;
  },
  now: Date = new Date(),
): Promise<ChangeOutcome> {
  const { item, slot } = input;
  const atHome = item.locationType === "home_visit";
  const address = atHome ? input.homeVisitAddress?.trim() || item.homeVisitAddress : null;
  if (!input.scope.locations.some((l) => l.id === slot.locationId)) return { status: "taken" };
  if (!input.rebook && input.leadHours !== null && !outsideLead(item.start, input.leadHours, now)) return { status: "lead" };
  // Quem remarca passa a ser quem marcou (UI-4, D14): a confirmação, o lembrete e os avisos seguintes vão para ele.
  const sessionContact = input.phone ? await findContactByPhone(db, clinicId, input.phone) : null;
  const sessionContactId = sessionContact?.id ?? null;
  // Quem marcou antes (VR4: recebe o aviso se não foi ele que remarcou).
  const previousBooker = input.rebook ? null : await recipientOfAppointment(db, clinicId, item.id).catch(() => null);
  let appointmentId: string;
  // O endereço novo só vira o padrão do contato se ficou gravado no atendimento.
  let addressSaved = true;
  // Quem remarcou virou quem marcou (senão, o aviso ao outro responsável não cabe).
  let bookerSaved = true;
  try {
    if (input.rebook) {
      const { appointment } = await bookAppointment(
        db,
        clinicId,
        {
          patientId: item.patientId,
          bookedByContactId: sessionContactId,
          serviceId: item.serviceId,
          agendaId: item.agendaId,
          start: slot.start,
          locationId: slot.locationId,
          homeVisitAddress: address,
          originAppointmentId: item.originAppointmentId,
          channel: "portal",
          actorId: null,
        },
        now,
      );
      appointmentId = appointment.id;
    } else {
      appointmentId = (await rescheduleAppointment(db, clinicId, item.id, { start: slot.start, locationId: slot.locationId, channel: "portal", actorId: null }, now)).id;
      if (sessionContactId) {
        await setAppointmentsBooker(db, clinicId, [appointmentId], sessionContactId).catch((error) => {
          // Sem a troca, quem marcou continua o mesmo: o aviso "remarcada" já vai para ele, sem o aviso a mais da VR4.
          bookerSaved = false;
          logError("portal: quem remarcou não gravado", error, { clinica: clinicId, atendimento: appointmentId });
        });
      }
      if (atHome && address && address !== item.homeVisitAddress) {
        const saved = await db.from("appointments").update({ home_visit_address: address }).eq("clinic_id", clinicId).eq("id", appointmentId);
        if (saved.error) {
          addressSaved = false;
          logError("portal: endereço da remarcação não gravado", saved.error, { clinica: clinicId, atendimento: appointmentId });
        }
      }
    }
  } catch (error) {
    if (error instanceof DataError && error.code === "conflict") return { status: "taken" };
    if (error instanceof DataError && error.code === "duplicate") return { status: "duplicate" };
    if (error instanceof DataError && error.code === "invalid") return { status: "gone" };
    logError("portal: não remarcou", error, { clinica: clinicId, atendimento: item.id });
    return { status: "failed" };
  }
  if (atHome && address && addressSaved && input.phone && address !== item.homeVisitAddress) await saveContactHomeAddress(db, clinicId, input.phone, address);
  if (!input.rebook || (await confirmationEnabled(db, clinicId, "portal"))) {
    await sendAppointmentNotice(db, clinicId, appointmentId, input.rebook ? "confirmation" : "reschedule", input.sender, now);
  }
  if (bookerSaved && previousBooker && sessionContact && previousBooker.id !== sessionContact.id) {
    const actor = await actorLabel(db, clinicId, item.patientId, sessionContact).catch(() => firstNameOnly(sessionContact.fullName));
    await sendOtherResponsibleNotice(db, clinicId, { appointmentId, kind: "rescheduled_by_other", booker: previousBooker, actor }, input.sender, now);
  }
  return { status: "done", appointmentId };
}

/** Cancela pelo canal do portal (com a antecedência, quando vale) e manda o aviso do cancelamento. */
export async function cancelMine(
  db: DbClient,
  clinicId: string,
  input: {
    item: MyAppointment;
    leadHours: number | null;
    sender: ClinicSender | null;
    /** O celular comprovado: o aviso do cancelamento vai para quem cancelou (quem marcou recebe o dele na VR4). */
    phone?: string;
  },
  now: Date = new Date(),
): Promise<ChangeOutcome> {
  if (input.leadHours !== null && !outsideLead(input.item.start, input.leadHours, now)) return { status: "lead" };
  const booker = await recipientOfAppointment(db, clinicId, input.item.id).catch(() => null);
  const canceled = await cancelAppointment(db, clinicId, input.item.id, { channel: "portal", actorId: null }, now);
  if (!canceled) return { status: "gone" };
  const actor = input.phone ? await findContactByPhone(db, clinicId, input.phone).catch(() => null) : null;
  const to = actor ? { id: actor.id, full_name: actor.fullName, phone: actor.phone } : undefined;
  await sendAppointmentNotice(db, clinicId, canceled.id, "cancellation", input.sender, now, undefined, to);
  // VR4: quem marcou recebe o aviso quando outro responsável cancela.
  if (booker && actor && booker.id !== actor.id) {
    const label = await actorLabel(db, clinicId, input.item.patientId, actor).catch(() => firstNameOnly(actor.fullName));
    await sendOtherResponsibleNotice(db, clinicId, { appointmentId: canceled.id, kind: "canceled_by_other", booker, actor: label }, input.sender, now);
  }
  return { status: "done", appointmentId: canceled.id };
}

const firstNameOnly = (name: string) => name.trim().split(/\s+/)[0] ?? name;
