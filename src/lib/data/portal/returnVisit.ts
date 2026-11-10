import { todayIn } from "../../clinicTime";
import { logError } from "../../log";
import {
  bookAppointment,
  evaluateReturnEligibility,
  findBlockingAppointment,
  findReturnOrigin,
  listUpcomingAppointments,
} from "../agenda/appointments";
import type { DbClient } from "../clients";
import { listServices, type Service } from "../config/services";
import { DataError, unwrap } from "../errors";
import { findContactByPhone } from "../patients";
import { checkBookingLimits, contactForLimits, recordBotLimitEvent } from "../whatsapp/botLimits";
import { dispatchNotice, enqueueNotice } from "../whatsapp/noticeQueue";
import type { ClinicSender } from "../whatsapp/send";
import { afterBooking, claimHold, loadHold, phonePatients, unclaimHold, type BlockReason, type ConfirmOutcome, type PortalPatient } from "./booking";
import { scopeLastDate, type PortalClinic, type PortalLocation, type PortalProfessional, type SlotScope } from "./portal";

// Retorno pelo portal (F2d; D4, seção 8 do plano): as regras do bot (I8; booking.ts › startReturn). Cada consulta do
// celular comprovado com direito a retorno vira um cartão ("De qual consulta é o retorno?"); as outras aparecem com o
// motivo. O paciente e o médico vêm da consulta de origem (não pergunta atendimento nem paciente; nunca mostra valor).
// Só entram os médicos do portal: retorno com médico fora dele fica com a recepção.

export type ReturnCard = {
  originId: string;
  patient: PortalPatient;
  professional: PortalProfessional;
  /** Cópia do serviço de Retorno na agenda do médico (MS). */
  service: Pick<Service, "id" | "name" | "durationMinutes"> & { locationIds: string[] };
  /** Data da consulta de origem. */
  originDate: string;
  /** Último dia do retorno (inclusive); null = sem prazo. */
  lastDate: string | null;
};

export type ReturnRefusal =
  | { kind: "expired"; patient: PortalPatient; professional: PortalProfessional; originDate: string; lastDate: string }
  | { kind: "home_visit"; patient: PortalPatient; professional: PortalProfessional; originDate: string }
  | { kind: "used"; patient: PortalPatient; professional: PortalProfessional; originDate: string }
  | { kind: "future"; patient: PortalPatient; professional: PortalProfessional; originDate: string; scheduledAt: Date };

export type ReturnOptions = {
  /** A clínica tem o serviço de Retorno com algum médico do portal. */
  offered: boolean;
  cards: ReturnCard[];
  refusals: ReturnRefusal[];
};

type ReturnCopy = { service: Service; professional: PortalProfessional };

/** As cópias ativas do Retorno, cada uma com o médico do portal da agenda dela. */
async function returnCopies(db: DbClient, portal: PortalClinic): Promise<ReturnCopy[]> {
  const services = await listServices(db, portal.clinicId, { category: "return_visit" });
  const copies: ReturnCopy[] = [];
  for (const service of services) {
    if (service.schedulingMode === "group") continue;
    for (const professional of portal.professionals) {
      if (service.agendaIds.includes(professional.agendaId)) copies.push({ service, professional });
    }
  }
  return copies;
}

/** O portal mostra "Marcar retorno" (só com o serviço de retorno, D4). */
export async function portalOffersReturn(db: DbClient, portal: PortalClinic): Promise<boolean> {
  return (await returnCopies(db, portal)).length > 0;
}

/** As consultas do celular com e sem direito a retorno, na ordem das regras do bot. */
export async function loadReturnOptions(db: DbClient, portal: PortalClinic, phone: string, now: Date = new Date()): Promise<ReturnOptions> {
  const copies = await returnCopies(db, portal);
  if (!copies.length) return { offered: false, cards: [], refusals: [] };
  const { patients } = await phonePatients(db, portal.clinicId, phone);
  if (!patients.length) return { offered: true, cards: [], refusals: [] };
  const today = todayIn(portal.timeZone, now);
  const upcoming = await listUpcomingAppointments(
    db,
    portal.clinicId,
    patients.map((p) => p.id),
    now,
  );

  // Uma cópia por agenda (a do médico) e, por paciente, a última consulta de cada médico, como no bot. As origens são
  // buscadas ao mesmo tempo (clínica grande: muitos médicos com retorno).
  const perAgenda = [...new Map(copies.map((c) => [c.professional.agendaId, c])).values()];
  const pairs = patients.flatMap((patient) => perAgenda.map((copy) => ({ patient, ...copy })));
  const origins = await Promise.all(
    pairs.map(({ patient, service, professional }) =>
      findReturnOrigin(db, portal.clinicId, { patientId: patient.id, agendaId: professional.agendaId, returnServiceId: service.id }, now),
    ),
  );

  const cards: ReturnCard[] = [];
  const refusals: ReturnRefusal[] = [];
  pairs.forEach(({ patient, service, professional }, i) => {
    const origin = origins[i];
    if (!origin) return;
    const blocking = findBlockingAppointment(upcoming.get(patient.id) ?? [], { serviceId: service.id, agendaId: professional.agendaId, category: "return_visit" });
    const result = evaluateReturnEligibility(origin, today, blocking);
    const base = { patient, professional, originDate: origin.date };
    if (result.status === "eligible") {
      cards.push({
        ...base,
        originId: origin.id,
        service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes, locationIds: service.locations.map((l) => l.locationId) },
        lastDate: origin.lastDate,
      });
    } else if (result.status === "no_recent_consultation" && origin.lastDate) {
      refusals.push({ ...base, kind: "expired", lastDate: origin.lastDate });
    } else if (result.status === "home_visit") {
      refusals.push({ ...base, kind: "home_visit" });
    } else if (result.status === "return_used") {
      refusals.push({ ...base, kind: "used" });
    } else if (result.status === "future_appointment") {
      refusals.push({ ...base, kind: "future", scheduledAt: result.futureScheduledAt });
    }
  });
  // O prazo que acaba antes primeiro; sem prazo no fim.
  cards.sort((a, b) => (a.lastDate ?? "9999").localeCompare(b.lastDate ?? "9999") || a.patient.fullName.localeCompare(b.patient.fullName, "pt-BR"));
  refusals.sort((a, b) => b.originDate.localeCompare(a.originDate));
  return { offered: true, cards, refusals };
}

/** O cartão de uma consulta de origem, conferido de novo (ainda do celular e ainda com direito). */
export async function findReturnCard(db: DbClient, portal: PortalClinic, phone: string, originId: string, now: Date = new Date()): Promise<ReturnCard | null> {
  if (!/^[0-9a-f-]{36}$/.test(originId)) return null;
  const { cards } = await loadReturnOptions(db, portal, phone, now);
  return cards.find((c) => c.originId === originId) ?? null;
}

/** Locais do retorno: os do médico onde o serviço de Retorno é oferecido (todos os do médico, se o serviço não diz). */
export function returnScope(card: ReturnCard): SlotScope & { locations: PortalLocation[] } {
  const offered = new Set(card.service.locationIds);
  // Só no consultório: o domiciliar não dá direito a retorno (regra do bot), e o médico pode atender em casa (F3e-1).
  const clinic = card.professional.locations.filter((l) => l.type === "clinic");
  const here = clinic.filter((l) => offered.has(l.id));
  return { locations: here.length ? here : clinic, lastDate: card.lastDate };
}

/** O último dia mostrado: o fim do prazo do retorno, sem passar do prazo do médico (o mesmo corte dos horários). */
export const returnLastShownDate = (card: ReturnCard, timeZone: string, now: Date = new Date()) => scopeLastDate(card.professional, timeZone, now, returnScope(card));

/** Grava a consulta de origem e o paciente dela na reserva ativa (logo depois de reservar). */
export async function setHoldReturn(db: DbClient, clinicId: string, sessionId: string, holdId: string, card: ReturnCard, now: Date = new Date()): Promise<boolean> {
  const rows = unwrap(
    await db
      .from("slot_holds")
      .update({ return_origin_id: card.originId, patient_id: card.patient.id, new_patient: null, informed_birthdate: null })
      .eq("clinic_id", clinicId)
      .eq("session_id", sessionId)
      .eq("id", holdId)
      .is("released_at", null)
      .is("appointment_id", null)
      .gt("expires_at", now.toISOString())
      .select("id"),
    "Reserva do horário",
  );
  return rows.length > 0;
}

/** Limites do bot por telefone na marcação do retorno (como em startReturn). `record`: grava para a equipe. */
async function returnLimit(db: DbClient, clinicId: string, phone: string, record: boolean, now: Date): Promise<BlockReason | null> {
  const contact = await findContactByPhone(db, clinicId, phone);
  if (contact?.botBlockedAt) return { kind: "blocked_contact" };
  const limits = contact ? await contactForLimits(db, clinicId, phone) : null;
  if (!limits || limits.exempt) return null;
  const hit = await checkBookingLimits(db, clinicId, limits.id, now);
  if (!hit) return null;
  if (record) await recordBotLimitEvent(db, clinicId, limits.id, hit, false, now).catch((error) => logError("portal: limite não registrado", error, { clinica: clinicId }));
  return { kind: "limit", hit };
}

/** O impedimento antes da revisão (sem gravar nada): limites do bot. */
export const returnBlock = (db: DbClient, clinicId: string, phone: string, now: Date = new Date()) => returnLimit(db, clinicId, phone, false, now);

/**
 * "Marcar retorno": confere tudo de novo (o direito pela consulta de origem e os limites), marca pelo canal do portal
 * ligado à consulta de origem, solta a reserva com o atendimento e põe a confirmação na fila. Duplo toque não marca
 * duas vezes; recarregar mostra a mesma confirmação.
 */
export async function confirmPortalReturn(
  db: DbClient,
  portal: PortalClinic,
  input: { sessionId: string; holdId: string; sender: ClinicSender | null },
  now: Date = new Date(),
): Promise<ConfirmOutcome> {
  const clinicId = portal.clinicId;
  const hold = await loadHold(db, clinicId, input.sessionId, input.holdId, now);
  if (!hold?.returnOriginId) return { status: "expired" };
  if (hold.state === "booked") return { status: "booked", appointmentId: hold.appointmentId! };
  if (hold.state === "gone") return { status: "expired" };
  if (!(await claimHold(db, clinicId, input.sessionId, input.holdId, now))) {
    const again = await loadHold(db, clinicId, input.sessionId, input.holdId, now);
    if (again?.state === "booked") return { status: "booked", appointmentId: again.appointmentId! };
    return again?.state === "active" ? { status: "confirming" } : { status: "expired" };
  }

  let appointmentId: string;
  try {
    // O direito de novo, pela consulta de origem: outro canal pode ter marcado o retorno nesse meio-tempo.
    const card = await findReturnCard(db, portal, hold.phone, hold.returnOriginId, now);
    if (!card || card.patient.id !== hold.patientId || card.professional.agendaId !== hold.agendaId || card.service.id !== hold.serviceId) {
      // Sem direito agora (outro canal marcou o retorno, a consulta mudou): o horário é solto para todos.
      await db.from("slot_holds").update({ confirming_at: null, released_at: now.toISOString() }).eq("clinic_id", clinicId).eq("id", hold.id).is("appointment_id", null);
      return { status: "no_patient" };
    }
    const block = await returnLimit(db, clinicId, hold.phone, true, now);
    if (block) {
      await unclaimHold(db, clinicId, hold.id);
      return { status: "blocked", reason: block };
    }
    const { appointment } = await bookAppointment(
      db,
      clinicId,
      {
        patientId: card.patient.id,
        serviceId: hold.serviceId,
        agendaId: hold.agendaId,
        start: hold.start,
        locationId: hold.locationId,
        channel: "portal",
        actorId: null,
        originAppointmentId: card.originId,
      },
      now,
    );
    appointmentId = appointment.id;
  } catch (error) {
    await unclaimHold(db, clinicId, hold.id);
    if (error instanceof DataError && error.code === "conflict") {
      await db.from("slot_holds").update({ released_at: now.toISOString() }).eq("clinic_id", clinicId).eq("id", hold.id);
      return { status: "taken" };
    }
    logError("portal: não marcou o retorno", error, { clinica: clinicId, reserva: hold.id });
    return { status: "failed" };
  }

  const done = await db.from("slot_holds").update({ appointment_id: appointmentId, released_at: now.toISOString() }).eq("clinic_id", clinicId).eq("id", hold.id);
  if (done.error) logError("portal: reserva sem o atendimento", done.error, { clinica: clinicId, reserva: hold.id });
  // Retorno: o convênio fica o do cadastro (o retorno nunca fala de valor).
  await afterBooking(db, clinicId, { appointmentId, hold, entry: "clinic_link" }, now);
  await enqueueNotice(db, clinicId, appointmentId, "confirmation", now).catch((error) => logError("portal: confirmação fora da fila", error, { clinica: clinicId }));
  if (input.sender) await dispatchNotice(db, clinicId, appointmentId, "confirmation", input.sender, now);
  return { status: "booked", appointmentId };
}
