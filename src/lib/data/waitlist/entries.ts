import type { DbClient } from "../clients";
import { DataError, fromDbError, unwrap } from "../errors";
import { getAppointment, logTrail, type ActionChannel, type Appointment } from "../agenda/appointments";

// Lista de espera para antecipar (Fase 25 do piloto), F3.7a: entrar, sair e
// consultar a fila. Quem já tem atendimento marcado entra pelo bot, ao
// confirmar pelo link (quando pediu antes de ter marcação) ou pelo painel
// (cliente, 04/out/2026: quem pede por telefone ou no balcão). A fila é por
// ordem de entrada, e a vaga vai só para quem espera na mesma agenda e no
// mesmo serviço (D2). Sessão de série não entra (D9).
//
// Sair da lista retira a oferta em aberto e devolve a vaga à fila (gatilho do
// banco, migração 20261004220000); oferecer ao próximo é do motor de ofertas
// (F3.7b) e do agendador (F7).

export type WaitlistVia = "whatsapp_bot" | "booking_link" | "admin";
export type WaitlistEntryStatus = "active" | "advanced" | "left" | "removed" | "closed";

const ACTIVE_STATUSES = ["scheduled", "confirmed"];

/** Por que o atendimento não pode entrar na fila (null = pode). */
export function joinBlockReason(
  appointment: Pick<Appointment, "status" | "scheduledAt" | "seriesId">,
  now: Date = new Date(),
): string | null {
  if (!ACTIVE_STATUSES.includes(appointment.status)) return "Só atendimento marcado ou confirmado entra na lista de espera";
  if (appointment.scheduledAt.getTime() <= now.getTime()) return "O atendimento já passou";
  if (appointment.seriesId !== null) return "Sessão de série não entra na lista de espera";
  return null;
}

export type JoinResult = "joined" | "already";

/** Coloca o atendimento na fila. Já estar na lista não é erro. */
export async function joinWaitlist(
  db: DbClient,
  clinicId: string,
  appointmentId: string,
  { via, actorId }: { via: WaitlistVia; actorId: string | null },
  now: Date = new Date(),
): Promise<JoinResult> {
  const appointment = await getAppointment(db, clinicId, appointmentId);
  const blocked = joinBlockReason(appointment, now);
  if (blocked) throw new DataError("invalid", `Lista de espera: ${blocked}`, { appointmentId: blocked });

  const { error } = await db
    .from("waitlist_entries")
    .insert({ clinic_id: clinicId, appointment_id: appointmentId, created_via: via, created_at: now.toISOString() });
  if (error) {
    // Índice único: uma inscrição ativa por atendimento.
    if ((error as { code?: string }).code === "23505") return "already";
    throw fromDbError(error, "Lista de espera");
  }
  await logTrail(db, clinicId, appointmentId, "waitlist_joined", via, actorId);
  return "joined";
}

/**
 * Tira o atendimento da fila: pelo WhatsApp é "saiu" (o paciente pediu); pela
 * tela é "retirado", com quem retirou. Devolve false se já não estava na fila.
 */
export async function leaveWaitlist(
  db: DbClient,
  clinicId: string,
  appointmentId: string,
  { channel, actorId }: { channel: ActionChannel; actorId: string | null },
  now: Date = new Date(),
): Promise<boolean> {
  const reason = channel === "whatsapp_bot" ? "bot" : "admin";
  const rows = unwrap(
    await db
      .from("waitlist_entries")
      .update({
        status: channel === "whatsapp_bot" ? "left" : "removed",
        ended_at: now.toISOString(),
        ended_reason: reason,
        ended_by: actorId,
      })
      .eq("clinic_id", clinicId)
      .eq("appointment_id", appointmentId)
      .eq("status", "active")
      .select("id"),
    "Lista de espera",
  );
  if (!rows.length) return false;
  await logTrail(db, clinicId, appointmentId, "waitlist_left", channel, actorId, { reason });
  return true;
}

/**
 * Antecipado fora de uma oferta (bot, horário livre antes): a inscrição
 * termina como "antecipado". Devolve false se não estava na fila.
 */
export async function endAsAdvanced(db: DbClient, clinicId: string, appointmentId: string, now: Date = new Date()): Promise<boolean> {
  const rows = unwrap(
    await db
      .from("waitlist_entries")
      .update({ status: "advanced", ended_at: now.toISOString(), ended_reason: "advanced" })
      .eq("clinic_id", clinicId)
      .eq("appointment_id", appointmentId)
      .eq("status", "active")
      .select("id"),
    "Lista de espera",
  );
  return rows.length > 0;
}

/** Quais destes atendimentos estão na fila agora (selo da agenda, bot). */
export async function activeWaitlistAppointmentIds(db: DbClient, clinicId: string, appointmentIds: string[]): Promise<Set<string>> {
  if (!appointmentIds.length) return new Set();
  const rows = unwrap(
    await db
      .from("waitlist_entries")
      .select("appointment_id")
      .eq("clinic_id", clinicId)
      .eq("status", "active")
      .in("appointment_id", appointmentIds),
    "Lista de espera",
  );
  return new Set(rows.map((row) => row.appointment_id));
}

// ---------------------------------------------------------------------------
// Tela da lista de espera
// ---------------------------------------------------------------------------

export type PendingOffer = { id: string; slotStart: Date; slotLocationId: string; expiresAt: Date };

export type WaitlistEntry = {
  id: string;
  createdAt: Date;
  createdVia: WaitlistVia;
  appointment: {
    id: string;
    scheduledAt: Date;
    serviceId: string;
    serviceName: string;
    agendaId: string;
    agendaName: string;
    locationId: string;
    locationName: string;
    isHomeVisit: boolean;
  };
  patient: { id: string; fullName: string };
  contact: { id: string; fullName: string; phone: string };
  /** Vaga oferecida e ainda sem resposta. */
  pendingOffer: PendingOffer | null;
};

type EntryRow = {
  id: string;
  created_at: string;
  created_via: WaitlistVia;
  appointments: {
    id: string;
    scheduled_at: string;
    service_id: string;
    agenda_id: string;
    location_id: string;
    services: { name: string };
    agendas: { name: string };
    locations: { name: string; type: string };
    patients: { id: string; full_name: string; contacts: { id: string; full_name: string; phone: string } };
  };
};

const ENTRY_COLUMNS =
  "id, created_at, created_via, appointments!inner ( id, scheduled_at, service_id, agenda_id, location_id, services ( name ), agendas ( name ), locations ( name, type ), patients ( id, full_name, contacts ( id, full_name, phone ) ) )";

/**
 * Quem está na fila, na ordem em que a vaga é oferecida (ordem de entrada),
 * só das agendas que o login pode ver. `agendaIds` filtra a agenda exibida.
 */
export async function listWaitlist(db: DbClient, clinicId: string, { agendaIds }: { agendaIds?: string[] } = {}): Promise<WaitlistEntry[]> {
  let query = db.from("waitlist_entries").select(ENTRY_COLUMNS).eq("clinic_id", clinicId).eq("status", "active");
  if (agendaIds) query = query.in("appointments.agenda_id", agendaIds);
  const rows = unwrap(await query.order("created_at"), "Lista de espera") as unknown as EntryRow[];
  if (!rows.length) return [];

  const offers = unwrap(
    await db
      .from("waitlist_offers")
      .select("id, entry_id, slot_scheduled_at, slot_location_id, expires_at")
      .eq("clinic_id", clinicId)
      .eq("status", "pending")
      .in("entry_id", rows.map((row) => row.id)),
    "Ofertas da lista de espera",
  );
  const pendingByEntry = new Map(
    offers.map((offer) => [
      offer.entry_id,
      { id: offer.id, slotStart: new Date(offer.slot_scheduled_at), slotLocationId: offer.slot_location_id, expiresAt: new Date(offer.expires_at) },
    ]),
  );

  return rows.map((row) => {
    const appointment = row.appointments;
    return {
      id: row.id,
      createdAt: new Date(row.created_at),
      createdVia: row.created_via,
      appointment: {
        id: appointment.id,
        scheduledAt: new Date(appointment.scheduled_at),
        serviceId: appointment.service_id,
        serviceName: appointment.services.name,
        agendaId: appointment.agenda_id,
        agendaName: appointment.agendas.name,
        locationId: appointment.location_id,
        locationName: appointment.locations.name,
        isHomeVisit: appointment.locations.type === "home_visit",
      },
      patient: { id: appointment.patients.id, fullName: appointment.patients.full_name },
      contact: {
        id: appointment.patients.contacts.id,
        fullName: appointment.patients.contacts.full_name,
        phone: appointment.patients.contacts.phone,
      },
      pendingOffer: pendingByEntry.get(row.id) ?? null,
    };
  });
}

export type OfferStatus = "pending" | "accepted" | "declined" | "expired" | "withdrawn" | "skipped";

export type OfferHistoryItem = {
  id: string;
  appointmentId: string;
  patientName: string;
  status: OfferStatus;
  offeredAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  slotStart: Date;
  slotLocationName: string;
  /** Motivo de pulada ou retirada (ex.: sem telefone, saiu da lista). */
  reason: string | null;
};

type OfferRow = {
  id: string;
  appointment_id: string;
  status: OfferStatus;
  offered_at: string;
  expires_at: string;
  responded_at: string | null;
  slot_scheduled_at: string;
  details: { reason?: string } | null;
  locations: { name: string };
  appointments: { patients: { full_name: string } };
};

export const OFFER_HISTORY_LIMIT = 30;

/** Últimas ofertas feitas (histórico da tela), das agendas que o login pode ver. */
export async function listRecentOffers(db: DbClient, clinicId: string, limit: number = OFFER_HISTORY_LIMIT): Promise<OfferHistoryItem[]> {
  const rows = unwrap(
    await db
      .from("waitlist_offers")
      .select(
        "id, appointment_id, status, offered_at, expires_at, responded_at, slot_scheduled_at, details, locations ( name ), appointments!waitlist_offers_clinic_id_appointment_id_fkey ( patients ( full_name ) )",
      )
      .eq("clinic_id", clinicId)
      .order("offered_at", { ascending: false })
      .limit(limit),
    "Ofertas da lista de espera",
  ) as unknown as OfferRow[];
  return rows.map((row) => ({
    id: row.id,
    appointmentId: row.appointment_id,
    patientName: row.appointments.patients.full_name,
    status: row.status,
    offeredAt: new Date(row.offered_at),
    expiresAt: new Date(row.expires_at),
    respondedAt: row.responded_at ? new Date(row.responded_at) : null,
    slotStart: new Date(row.slot_scheduled_at),
    slotLocationName: row.locations.name,
    reason: row.details?.reason ?? null,
  }));
}
