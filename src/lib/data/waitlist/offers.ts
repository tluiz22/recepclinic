import { localDateOf } from "../../clinicTime";
import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { hasFeature } from "../features";
import { DataError, unwrap } from "../errors";
import type { SendOutcome } from "../whatsapp/messages";

export type { SendOutcome };
import { rescheduleAppointment } from "../agenda/appointments";
import { getFreeSlots, getGroupSessions, getNextAvailableDates, loadSchedulingPlan, type SchedulingPlan } from "../agenda/slots";

// Motor de ofertas da lista de espera (Fase 25 do piloto, etapa 3), F3.7b.
// Roda com a credencial da clínica (clinic_service): vagas e ofertas só são
// gravadas pelo sistema.
//
// Vaga aberta (`waitlist_openings`, gravada pelo gatilho do banco quando um
// atendimento é cancelado ou remarcado com mais de 2h) → oferecida a um por
// vez, por ordem de entrada na lista, com 60 minutos para responder. Só é
// oferecida se (1) começa daqui a mais de 2h, (2) o horário ainda está livre e
// não há horário livre antes dela do mesmo tipo de local (oferecer não
// ajudaria ninguém) e (3) vai para o primeiro da fila **na mesma agenda e no
// mesmo serviço** (D2) cujo atendimento é depois da vaga, no mesmo tipo de
// local (consultório com consultório, domiciliar com domiciliar). "Sim"
// remarca na hora; o horário antigo vira outra vaga (cascata, pelo mesmo
// gatilho). "Não" passa a vaga ao próximo na hora.
//
// O envio pelo WhatsApp (template ou texto com botões, janela de 24h) é de
// quem chama (bot na F6, agendador na F7): o motor recebe uma função que
// envia, e quem não pôde receber é pulado nessa vaga.

export const OFFER_MINUTES = 60;
export const MIN_LEAD_MS = 2 * 60 * 60_000;
/** Pessoas puladas por rodada numa vaga, contra laço longo. */
export const MAX_ATTEMPTS_PER_OPENING = 20;
/** Vagas tratadas por rodada do agendador, por clínica. */
export const MAX_OPENINGS_PER_RUN = 20;

type ServiceCategory = Enums<"service_category">;

// ---------------------------------------------------------------------------
// Envio (de quem chama)
// ---------------------------------------------------------------------------

export type OfferToSend = {
  offerId: string;
  clinicId: string;
  timeZone: string;
  contact: { id: string; fullName: string; phone: string };
  patientName: string;
  appointmentId: string;
  serviceName: string;
  serviceCategory: ServiceCategory;
  /** Horário atual do atendimento de quem espera. */
  currentStart: Date;
  slotStart: Date;
  slotLocationName: string;
  slotIsHomeVisit: boolean;
  expiresAt: Date;
};

export type OfferSender = (offer: OfferToSend) => Promise<SendOutcome>;

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

export type SlotCheck = "ok" | "slot_unavailable" | "earlier_free";

/**
 * A vaga ainda vale? `free` são os horários livres (ou sessões de turma com
 * lugar) da agenda e do serviço até o dia da vaga. Horário livre antes da vaga
 * (depois do mínimo de 2h e no mesmo tipo de local) torna a oferta inútil.
 */
export function checkOpeningSlot(
  free: { start: Date; locationId: string }[],
  slot: { start: Date; locationId: string },
  earliestUseful: Date,
  sameKindOfLocation: (locationId: string) => boolean,
): SlotCheck {
  const slotTime = slot.start.getTime();
  const earlier = free.some(
    (f) => f.start.getTime() > earliestUseful.getTime() && f.start.getTime() < slotTime && sameKindOfLocation(f.locationId),
  );
  if (earlier) return "earlier_free";
  return free.some((f) => f.start.getTime() === slotTime && f.locationId === slot.locationId) ? "ok" : "slot_unavailable";
}

export type QueueEntry = {
  entryId: string;
  appointmentId: string;
  appointmentStatus: string;
  scheduledAt: Date;
  agendaId: string;
  serviceId: string;
  isHomeVisit: boolean;
};

/** Primeiro da fila (ordem de entrada) a quem a vaga ajuda e que ainda não a recebeu. */
export function pickCandidate<T extends QueueEntry>(
  queue: T[],
  opening: { openedByAppointmentId: string | null; agendaId: string; serviceId: string; slotStart: Date; slotIsHomeVisit: boolean },
  alreadyOffered: Set<string>,
): T | null {
  return (
    queue.find(
      (entry) =>
        !alreadyOffered.has(entry.entryId) &&
        entry.appointmentId !== opening.openedByAppointmentId &&
        ["scheduled", "confirmed"].includes(entry.appointmentStatus) &&
        entry.agendaId === opening.agendaId &&
        entry.serviceId === opening.serviceId &&
        entry.scheduledAt.getTime() > opening.slotStart.getTime() &&
        entry.isHomeVisit === opening.slotIsHomeVisit,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Rodada do agendador (F7 percorre as clínicas)
// ---------------------------------------------------------------------------

export type WaitlistRunTotals = { expired: number; closedEntries: number; offered: number; skipped: number; closedOpenings: number };

export async function processWaitlist(db: DbClient, clinicId: string, send: OfferSender, now: Date = new Date()): Promise<WaitlistRunTotals> {
  const totals: WaitlistRunTotals = { expired: 0, closedEntries: 0, offered: 0, skipped: 0, closedOpenings: 0 };
  // Lista de espera não liberada para a clínica (D11): nada a fazer.
  if (!(await hasFeature(db, clinicId, "waitlist"))) return totals;
  totals.expired = await expireOffers(db, clinicId, now);
  totals.closedEntries = await closePastEntries(db, clinicId, now);

  const openings = unwrap(
    await db
      .from("waitlist_openings")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("status", "open")
      .order("created_at")
      .limit(MAX_OPENINGS_PER_RUN),
    "Vagas da lista de espera",
  );
  for (const opening of openings) {
    const result = await advanceOpening(db, clinicId, opening.id, send, now);
    totals.offered += result.offered ? 1 : 0;
    totals.skipped += result.skipped;
    totals.closedOpenings += result.closed ? 1 : 0;
  }
  return totals;
}

async function reopen(db: DbClient, clinicId: string, openingIds: (string | null)[]): Promise<void> {
  const ids = [...new Set(openingIds.filter((id): id is string => id !== null))];
  if (!ids.length) return;
  unwrap(
    await db.from("waitlist_openings").update({ status: "open" }).eq("clinic_id", clinicId).in("id", ids).eq("status", "offering"),
    "Vagas da lista de espera",
  );
}

/** Ofertas sem resposta no prazo vencem e a vaga volta para a fila. */
export async function expireOffers(db: DbClient, clinicId: string, now: Date = new Date()): Promise<number> {
  const expired = unwrap(
    await db
      .from("waitlist_offers")
      .update({ status: "expired" })
      .eq("clinic_id", clinicId)
      .eq("status", "pending")
      .lte("expires_at", now.toISOString())
      .select("opening_id"),
    "Ofertas da lista de espera",
  );
  await reopen(db, clinicId, expired.map((row) => row.opening_id));
  return expired.length;
}

/** Atendimento que já começou sem desfecho registrado sai da lista. */
export async function closePastEntries(db: DbClient, clinicId: string, now: Date = new Date()): Promise<number> {
  const rows = unwrap(
    await db
      .from("waitlist_entries")
      .select("id, appointments!inner ( scheduled_at )")
      .eq("clinic_id", clinicId)
      .eq("status", "active")
      .lte("appointments.scheduled_at", now.toISOString()),
    "Lista de espera",
  );
  if (!rows.length) return 0;
  unwrap(
    await db
      .from("waitlist_entries")
      .update({ status: "closed", ended_at: now.toISOString(), ended_reason: "past" })
      .eq("clinic_id", clinicId)
      .in("id", rows.map((row) => row.id))
      .eq("status", "active"),
    "Lista de espera",
  );
  return rows.length;
}

// ---------------------------------------------------------------------------
// Uma vaga
// ---------------------------------------------------------------------------

type Opening = {
  id: string;
  openedByAppointmentId: string | null;
  serviceId: string;
  agendaId: string;
  isGroupSession: boolean;
  slotStart: Date;
  slotLocationId: string;
  slotDurationMinutes: number;
};

type Location = { id: string; name: string; isHomeVisit: boolean };

export type AdvanceResult = { offered: boolean; skipped: number; closed: boolean; closedReason?: string };

/** Oferece a vaga ao próximo da fila, ou encerra a vaga. */
export async function advanceOpening(
  db: DbClient,
  clinicId: string,
  openingId: string,
  send: OfferSender,
  now: Date = new Date(),
): Promise<AdvanceResult> {
  const result: AdvanceResult = { offered: false, skipped: 0, closed: false };

  // Reserva a vaga (open → offering): duas rodadas ao mesmo tempo não
  // oferecem a mesma vaga duas vezes.
  const claimed = unwrap(
    await db
      .from("waitlist_openings")
      .update({ status: "offering" })
      .eq("clinic_id", clinicId)
      .eq("id", openingId)
      .eq("status", "open")
      .select("id, opened_by_appointment_id, service_id, agenda_id, is_group_session, slot_scheduled_at, slot_location_id, slot_duration_minutes")
      .maybeSingle(),
    "Vaga da lista de espera",
  );
  if (!claimed) return result;
  const opening: Opening = {
    id: claimed.id,
    openedByAppointmentId: claimed.opened_by_appointment_id,
    serviceId: claimed.service_id,
    agendaId: claimed.agenda_id,
    isGroupSession: claimed.is_group_session,
    slotStart: new Date(claimed.slot_scheduled_at),
    slotLocationId: claimed.slot_location_id,
    slotDurationMinutes: claimed.slot_duration_minutes,
  };

  const close = async (reason: string) => {
    unwrap(
      await db.from("waitlist_openings").update({ status: "closed", closed_reason: reason }).eq("clinic_id", clinicId).eq("id", opening.id),
      "Vaga da lista de espera",
    );
    return { ...result, closed: true, closedReason: reason };
  };

  if (opening.slotStart.getTime() - now.getTime() <= MIN_LEAD_MS) return close("too_late");

  const locations = await loadLocations(db, clinicId);
  const slotLocation = locations.get(opening.slotLocationId);
  if (!slotLocation) return close("slot_unavailable");

  const plan = await loadSchedulingPlan(db, clinicId, { serviceId: opening.serviceId, agendaId: opening.agendaId });
  if (!plan) return close("slot_unavailable");

  const availability = await checkAvailability(db, clinicId, plan, opening, slotLocation, locations, now);
  if (availability !== "ok") return close(availability);

  const [queue, offeredBefore] = await Promise.all([
    loadQueue(db, clinicId, opening),
    db
      .from("waitlist_offers")
      .select("entry_id")
      .eq("clinic_id", clinicId)
      .eq("opening_id", opening.id)
      .then((r) => unwrap(r, "Ofertas da lista de espera")),
  ]);
  const alreadyOffered = new Set(offeredBefore.map((row) => row.entry_id));

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_OPENING; attempt++) {
    const candidate = pickCandidate(queue, { ...opening, slotIsHomeVisit: slotLocation.isHomeVisit }, alreadyOffered);
    if (!candidate) return close("no_candidates");
    alreadyOffered.add(candidate.entryId);

    if (await sendOffer(db, clinicId, plan.timeZone, opening, slotLocation, candidate, send, now)) {
      return { ...result, offered: true };
    }
    result.skipped += 1;
  }

  // Muitas pessoas puladas nesta rodada: devolve a vaga para a próxima.
  await reopen(db, clinicId, [opening.id]);
  return result;
}

async function loadLocations(db: DbClient, clinicId: string): Promise<Map<string, Location>> {
  const rows = unwrap(await db.from("locations").select("id, name, type").eq("clinic_id", clinicId), "Locais");
  return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name, isHomeVisit: row.type === "home_visit" }]));
}

async function checkAvailability(
  db: DbClient,
  clinicId: string,
  plan: SchedulingPlan,
  opening: Opening,
  slotLocation: Location,
  locations: Map<string, Location>,
  now: Date,
): Promise<SlotCheck> {
  const earliestUseful = new Date(now.getTime() + MIN_LEAD_MS);
  const sameKind = (locationId: string) => locations.get(locationId)?.isHomeVisit === slotLocation.isHomeVisit;
  const slot = { start: opening.slotStart, locationId: opening.slotLocationId };
  const query = { serviceId: opening.serviceId, agendaId: opening.agendaId };
  // Dias até a vaga (inclusive), com folga para o fuso.
  const maxDaysAhead = Math.ceil((opening.slotStart.getTime() - now.getTime()) / 86_400_000) + 2;

  if (opening.isGroupSession) {
    const sessions = await getGroupSessions(db, clinicId, { ...query, count: 1000, maxDaysAhead }, now);
    return checkOpeningSlot(sessions.filter((s) => s.start <= opening.slotStart), slot, earliestUseful, sameKind);
  }

  const slotDate = localDateOf(opening.slotStart, plan.timeZone);
  const dates = await getNextAvailableDates(db, clinicId, { ...query, count: maxDaysAhead, maxDaysAhead, lastDate: slotDate }, now);
  const free: { start: Date; locationId: string }[] = [];
  for (const { date } of dates) {
    const slots = await getFreeSlots(db, clinicId, { ...query, date }, now);
    free.push(...slots);
    // Já há horário útil antes da vaga: não precisa olhar os outros dias.
    if (date < slotDate && checkOpeningSlot(slots, slot, earliestUseful, sameKind) === "earlier_free") return "earlier_free";
  }
  return checkOpeningSlot(free, slot, earliestUseful, sameKind);
}

type Candidate = QueueEntry & {
  patientName: string;
  serviceName: string;
  serviceCategory: ServiceCategory;
  contact: { id: string; fullName: string; phone: string };
};

type QueueRow = {
  id: string;
  appointments: {
    id: string;
    status: string;
    scheduled_at: string;
    agenda_id: string;
    service_id: string;
    locations: { type: string };
    services: { name: string; category: ServiceCategory };
    patients: { full_name: string; contacts: { id: string; full_name: string; phone: string } };
  };
};

/** Fila da agenda e do serviço da vaga, por ordem de entrada. */
async function loadQueue(db: DbClient, clinicId: string, opening: Opening): Promise<Candidate[]> {
  const rows = unwrap(
    await db
      .from("waitlist_entries")
      .select(
        "id, appointments!inner ( id, status, scheduled_at, agenda_id, service_id, locations ( type ), services ( name, category ), patients ( full_name, contacts ( id, full_name, phone ) ) )",
      )
      .eq("clinic_id", clinicId)
      .eq("status", "active")
      .eq("appointments.agenda_id", opening.agendaId)
      .eq("appointments.service_id", opening.serviceId)
      .order("created_at"),
    "Lista de espera",
  ) as unknown as QueueRow[];
  return rows.map((row) => ({
    entryId: row.id,
    appointmentId: row.appointments.id,
    appointmentStatus: row.appointments.status,
    scheduledAt: new Date(row.appointments.scheduled_at),
    agendaId: row.appointments.agenda_id,
    serviceId: row.appointments.service_id,
    isHomeVisit: row.appointments.locations.type === "home_visit",
    patientName: row.appointments.patients.full_name,
    serviceName: row.appointments.services.name,
    serviceCategory: row.appointments.services.category,
    contact: {
      id: row.appointments.patients.contacts.id,
      fullName: row.appointments.patients.contacts.full_name,
      phone: row.appointments.patients.contacts.phone,
    },
  }));
}

/** Registra a oferta e envia. `false` = pessoa pulada nesta vaga. */
async function sendOffer(
  db: DbClient,
  clinicId: string,
  timeZone: string,
  opening: Opening,
  slotLocation: Location,
  candidate: Candidate,
  send: OfferSender,
  now: Date,
): Promise<boolean> {
  const offerId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + OFFER_MINUTES * 60_000);
  const { error } = await db.from("waitlist_offers").insert({
    id: offerId,
    clinic_id: clinicId,
    entry_id: candidate.entryId,
    appointment_id: candidate.appointmentId,
    opening_id: opening.id,
    opened_by_appointment_id: opening.openedByAppointmentId,
    slot_scheduled_at: opening.slotStart.toISOString(),
    slot_location_id: opening.slotLocationId,
    slot_duration_minutes: opening.slotDurationMinutes,
    offered_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    details: {},
  });
  if (error) {
    // 23505: a pessoa já tem outra vaga oferecida, aguardando resposta.
    if ((error as { code?: string }).code !== "23505") console.error("[lista de espera] não registrou a oferta", error.message);
    return false;
  }

  let outcome: SendOutcome;
  try {
    outcome = await send({
      offerId,
      clinicId,
      timeZone,
      contact: candidate.contact,
      patientName: candidate.patientName,
      appointmentId: candidate.appointmentId,
      serviceName: candidate.serviceName,
      serviceCategory: candidate.serviceCategory,
      currentStart: candidate.scheduledAt,
      slotStart: opening.slotStart,
      slotLocationName: slotLocation.name,
      slotIsHomeVisit: slotLocation.isHomeVisit,
      expiresAt,
    });
  } catch (err) {
    console.error("[lista de espera] falha ao enviar a oferta", err instanceof Error ? err.message : String(err));
    outcome = { sent: false, reason: "send_failed" };
  }

  const update = outcome.sent ? { whatsapp_message_id: outcome.messageId } : { status: "skipped", details: { reason: outcome.reason } };
  unwrap(await db.from("waitlist_offers").update(update).eq("clinic_id", clinicId).eq("id", offerId), "Oferta da lista de espera");
  return outcome.sent;
}

// ---------------------------------------------------------------------------
// Resposta à oferta (bot)
// ---------------------------------------------------------------------------

export type OfferReplyResult =
  | { kind: "accepted"; appointmentId: string; patientName: string; from: Date; to: Date }
  | { kind: "declined"; patientName: string; currentStart: Date; stillInList: boolean }
  | { kind: "already_accepted" }
  | { kind: "late"; stillInList: boolean }
  | { kind: "taken"; stillInList: boolean }
  | { kind: "not_found" };

type LoadedOffer = {
  id: string;
  entryId: string;
  openingId: string | null;
  status: string;
  expiresAt: Date;
  slotStart: Date;
  slotLocationId: string;
  appointment: { id: string; status: string; scheduledAt: Date; patientName: string; contactId: string };
};

async function loadOffer(db: DbClient, clinicId: string, offerId: string, contactId: string | null): Promise<LoadedOffer | null> {
  const row = unwrap(
    await db
      .from("waitlist_offers")
      .select(
        "id, entry_id, opening_id, status, expires_at, slot_scheduled_at, slot_location_id, appointments!waitlist_offers_clinic_id_appointment_id_fkey ( id, status, scheduled_at, patients ( full_name, contact_id ) )",
      )
      .eq("clinic_id", clinicId)
      .eq("id", offerId)
      .maybeSingle(),
    "Oferta da lista de espera",
  ) as unknown as {
    id: string;
    entry_id: string;
    opening_id: string | null;
    status: string;
    expires_at: string;
    slot_scheduled_at: string;
    slot_location_id: string;
    appointments: { id: string; status: string; scheduled_at: string; patients: { full_name: string; contact_id: string } };
  } | null;
  if (!row) return null;
  // Só o contato do paciente pode responder.
  if (contactId && row.appointments.patients.contact_id !== contactId) return null;
  return {
    id: row.id,
    entryId: row.entry_id,
    openingId: row.opening_id,
    status: row.status,
    expiresAt: new Date(row.expires_at),
    slotStart: new Date(row.slot_scheduled_at),
    slotLocationId: row.slot_location_id,
    appointment: {
      id: row.appointments.id,
      status: row.appointments.status,
      scheduledAt: new Date(row.appointments.scheduled_at),
      patientName: row.appointments.patients.full_name,
      contactId: row.appointments.patients.contact_id,
    },
  };
}

async function entryStillActive(db: DbClient, clinicId: string, entryId: string): Promise<boolean> {
  const row = unwrap(await db.from("waitlist_entries").select("status").eq("clinic_id", clinicId).eq("id", entryId).maybeSingle(), "Lista de espera");
  return row?.status === "active";
}

/** Reserva a resposta (pending → status) dentro do prazo; false = já respondida, retirada ou vencida. */
async function claimReply(db: DbClient, clinicId: string, offerId: string, status: "accepted" | "declined", now: Date): Promise<boolean> {
  const rows = unwrap(
    await db
      .from("waitlist_offers")
      .update({ status, responded_at: now.toISOString() })
      .eq("clinic_id", clinicId)
      .eq("id", offerId)
      .eq("status", "pending")
      .gt("expires_at", now.toISOString())
      .select("id"),
    "Oferta da lista de espera",
  );
  return rows.length > 0;
}

/** "Não, manter horário": a vaga passa ao próximo da fila na hora. */
export async function declineOffer(
  db: DbClient,
  clinicId: string,
  offerId: string,
  contactId: string | null,
  send: OfferSender,
  now: Date = new Date(),
): Promise<OfferReplyResult> {
  const offer = await loadOffer(db, clinicId, offerId, contactId);
  if (!offer) return { kind: "not_found" };
  if (offer.status === "accepted") return { kind: "already_accepted" };
  if (!(await claimReply(db, clinicId, offer.id, "declined", now))) {
    return { kind: "late", stillInList: await entryStillActive(db, clinicId, offer.entryId) };
  }

  if (offer.openingId) {
    await reopen(db, clinicId, [offer.openingId]);
    await advanceOpening(db, clinicId, offer.openingId, send, now);
  }
  return {
    kind: "declined",
    patientName: offer.appointment.patientName,
    currentStart: offer.appointment.scheduledAt,
    stillInList: await entryStillActive(db, clinicId, offer.entryId),
  };
}

/**
 * "Sim, quero antecipar": remarca para a vaga (o horário precisa estar livre
 * agora) e tira da lista. O aviso de remarcação pelo WhatsApp é de quem chama.
 */
export async function acceptOffer(
  db: DbClient,
  clinicId: string,
  offerId: string,
  contactId: string | null,
  now: Date = new Date(),
): Promise<OfferReplyResult> {
  const offer = await loadOffer(db, clinicId, offerId, contactId);
  if (!offer) return { kind: "not_found" };
  if (offer.status === "accepted") return { kind: "already_accepted" };
  // Reserva a resposta antes de remarcar: o agendador não vence esta oferta no meio do caminho.
  if (!(await claimReply(db, clinicId, offer.id, "accepted", now))) {
    return { kind: "late", stillInList: await entryStillActive(db, clinicId, offer.entryId) };
  }

  const giveUp = async (reason: string) => {
    unwrap(
      await db.from("waitlist_offers").update({ status: "withdrawn", details: { reason } }).eq("clinic_id", clinicId).eq("id", offer.id),
      "Oferta da lista de espera",
    );
    if (offer.openingId) {
      unwrap(
        await db
          .from("waitlist_openings")
          .update({ status: "closed", closed_reason: "slot_unavailable" })
          .eq("clinic_id", clinicId)
          .eq("id", offer.openingId),
        "Vaga da lista de espera",
      );
    }
    return { kind: "taken" as const, stillInList: await entryStillActive(db, clinicId, offer.entryId) };
  };

  const { appointment } = offer;
  if (!["scheduled", "confirmed"].includes(appointment.status) || appointment.scheduledAt.getTime() <= offer.slotStart.getTime()) {
    return giveUp("appointment_changed");
  }

  try {
    await rescheduleAppointment(
      db,
      clinicId,
      appointment.id,
      { start: offer.slotStart, locationId: offer.slotLocationId, channel: "whatsapp_bot", trailEvent: "waitlist_advanced", actorId: null },
      now,
    );
  } catch (error) {
    if (!(error instanceof DataError) || error.code === "unexpected") {
      console.error("[lista de espera] erro ao antecipar", error instanceof Error ? error.message : String(error));
    }
    return giveUp("slot_taken");
  }

  if (offer.openingId) {
    unwrap(
      await db.from("waitlist_openings").update({ status: "filled" }).eq("clinic_id", clinicId).eq("id", offer.openingId),
      "Vaga da lista de espera",
    );
  }
  unwrap(
    await db
      .from("waitlist_entries")
      .update({ status: "advanced", ended_at: now.toISOString(), ended_reason: "advanced" })
      .eq("clinic_id", clinicId)
      .eq("id", offer.entryId),
    "Lista de espera",
  );
  return { kind: "accepted", appointmentId: appointment.id, patientName: appointment.patientName, from: appointment.scheduledAt, to: offer.slotStart };
}
