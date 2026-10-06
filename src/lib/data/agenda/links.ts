import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { DataError, unwrap, unwrapOne } from "../errors";
import type { Appointment } from "./appointments";
import { findReturnOrigin } from "./appointments";

// Links de agendar/remarcar (página pública /agendar/[token]; o token é o id).
// Regras do piloto:
//   - link do bot vale 30 minutos (meio de conversa); o de remarcação após
//     cancelamento pela clínica (dia inteiro, bloqueio) vale 2 dias;
//   - usar é atômico: um link só marca uma vez;
//   - retorno cancelado pela clínica: o link novo continua ligado à mesma
//     consulta de origem, sem o limite do prazo (Fase 17, decisão do cliente).

export const BOT_LINK_TTL_MS = 30 * 60_000;
export const REBOOKING_LINK_TTL_MS = 2 * 24 * 60 * 60_000;

export type BookingLinkMode = Enums<"booking_link_mode">;
export type LocationCategory = Enums<"location_type">;

export type BookingLink = {
  id: string;
  mode: BookingLinkMode;
  contactId: string;
  patientId: string;
  serviceId: string;
  /** null = "primeiro horário disponível" entre as agendas do serviço (D2). */
  agendaId: string | null;
  locationId: string | null;
  locationCategory: LocationCategory | null;
  appointmentId: string | null;
  originAppointmentId: string | null;
  returnDeadlineWaived: boolean;
  contactPhone: string;
  homeVisitAddress: string | null;
  joinWaitlist: boolean;
  funnelSessionId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
};

export type BookingLinkInput = Omit<BookingLink, "id" | "expiresAt" | "usedAt" | "returnDeadlineWaived" | "joinWaitlist" | "funnelSessionId"> & {
  /** Link de remarcação: o atendimento cancelado pela clínica (F5.4). */
  canceledAppointmentId?: string | null;
  returnDeadlineWaived?: boolean;
  joinWaitlist?: boolean;
  funnelSessionId?: string | null;
  ttlMs: number;
};

const COLUMNS =
  "id, mode, contact_id, patient_id, service_id, agenda_id, location_id, location_category, appointment_id, origin_appointment_id, return_deadline_waived, contact_phone, home_visit_address, join_waitlist, funnel_session_id, expires_at, used_at";

type Row = {
  id: string;
  mode: BookingLinkMode;
  contact_id: string;
  patient_id: string;
  service_id: string;
  agenda_id: string | null;
  location_id: string | null;
  location_category: LocationCategory | null;
  appointment_id: string | null;
  origin_appointment_id: string | null;
  return_deadline_waived: boolean;
  contact_phone: string;
  home_visit_address: string | null;
  join_waitlist: boolean;
  funnel_session_id: string | null;
  expires_at: string;
  used_at: string | null;
};

const toLink = (row: Row): BookingLink => ({
  id: row.id,
  mode: row.mode,
  contactId: row.contact_id,
  patientId: row.patient_id,
  serviceId: row.service_id,
  agendaId: row.agenda_id,
  locationId: row.location_id,
  locationCategory: row.location_category,
  appointmentId: row.appointment_id,
  originAppointmentId: row.origin_appointment_id,
  returnDeadlineWaived: row.return_deadline_waived,
  contactPhone: row.contact_phone,
  homeVisitAddress: row.home_visit_address,
  joinWaitlist: row.join_waitlist,
  funnelSessionId: row.funnel_session_id,
  expiresAt: new Date(row.expires_at),
  usedAt: row.used_at ? new Date(row.used_at) : null,
});

export async function createBookingLink(
  db: DbClient,
  clinicId: string,
  input: BookingLinkInput,
  now: Date = new Date(),
): Promise<BookingLink> {
  if (!(input.ttlMs > 0)) throw new DataError("invalid", "Link de agendamento: validade inválida");
  if (input.mode === "reschedule" && !input.appointmentId) {
    throw new DataError("invalid", "Link de agendamento: remarcação precisa do atendimento");
  }
  // Todas as colunas, sempre (cuidado da F2.5 com valores padrão no supabase-js).
  const row = {
    clinic_id: clinicId,
    mode: input.mode,
    contact_id: input.contactId,
    patient_id: input.patientId,
    service_id: input.serviceId,
    agenda_id: input.agendaId,
    location_id: input.locationId,
    location_category: input.locationCategory,
    appointment_id: input.appointmentId,
    origin_appointment_id: input.originAppointmentId,
    return_deadline_waived: input.returnDeadlineWaived ?? false,
    contact_phone: input.contactPhone,
    home_visit_address: input.homeVisitAddress?.trim() || null,
    join_waitlist: input.joinWaitlist ?? false,
    funnel_session_id: input.funnelSessionId ?? null,
    canceled_appointment_id: input.canceledAppointmentId ?? null,
    expires_at: new Date(now.getTime() + input.ttlMs).toISOString(),
  };
  return toLink(unwrap(await db.from("booking_links").insert(row).select(COLUMNS).single(), "Link de agendamento"));
}

export type BookingLinkState = "valid" | "used" | "expired";

export function linkState(link: Pick<BookingLink, "usedAt" | "expiresAt">, now: Date = new Date()): BookingLinkState {
  if (link.usedAt) return "used";
  return link.expiresAt <= now ? "expired" : "valid";
}

export async function getBookingLink(db: DbClient, clinicId: string, id: string): Promise<BookingLink> {
  return toLink(unwrapOne(await db.from("booking_links").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Link de agendamento"));
}

/** Marca o link como usado se ainda valia; false = já usado ou vencido. */
export async function claimBookingLink(db: DbClient, clinicId: string, id: string, now: Date = new Date()): Promise<boolean> {
  const row = unwrap(
    await db
      .from("booking_links")
      .update({ used_at: now.toISOString() })
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .is("used_at", null)
      .gt("expires_at", now.toISOString())
      .select("id")
      .maybeSingle(),
    "Link de agendamento",
  );
  return row !== null;
}

/**
 * Última data que o link pode oferecer: só retorno ligado a uma consulta
 * tem limite, e o link da clínica (cancelamento) dispensa o prazo.
 */
export async function bookingLinkLastDate(db: DbClient, clinicId: string, link: BookingLink, now: Date = new Date()): Promise<string | null> {
  if (link.returnDeadlineWaived || !link.originAppointmentId) return null;
  const origin = unwrapOne(
    await db.from("appointments").select("agenda_id").eq("clinic_id", clinicId).eq("id", link.originAppointmentId).maybeSingle(),
    "Consulta de origem",
  );
  const found = await findReturnOrigin(
    db,
    clinicId,
    { patientId: link.patientId, agendaId: origin.agenda_id, returnServiceId: link.serviceId, originAppointmentId: link.originAppointmentId },
    now,
  );
  return found?.lastDate ?? null;
}

/**
 * Link de remarcação para um atendimento cancelado pela clínica: mesmo
 * paciente, serviço, agenda e tipo de local, com o endereço do domiciliar;
 * retorno mantém a consulta de origem, sem prazo. null = paciente sem contato.
 */
export async function createRebookingLink(
  db: DbClient,
  clinicId: string,
  appointment: Appointment,
  now: Date = new Date(),
): Promise<BookingLink | null> {
  const patient = unwrapOne(
    await db.from("patients").select("contact_id, contacts ( phone )").eq("clinic_id", clinicId).eq("id", appointment.patientId).maybeSingle(),
    "Paciente",
  ) as unknown as { contact_id: string; contacts: { phone: string } | null };
  if (!patient.contacts?.phone) return null;
  const location = unwrapOne(
    await db.from("locations").select("type").eq("clinic_id", clinicId).eq("id", appointment.locationId).maybeSingle(),
    "Local",
  );
  const isReturnWithOrigin = appointment.originAppointmentId !== null;
  return createBookingLink(
    db,
    clinicId,
    {
      mode: "create",
      contactId: patient.contact_id,
      patientId: appointment.patientId,
      serviceId: appointment.serviceId,
      agendaId: appointment.agendaId,
      locationId: null,
      locationCategory: location.type,
      appointmentId: null,
      originAppointmentId: appointment.originAppointmentId,
      returnDeadlineWaived: isReturnWithOrigin,
      contactPhone: patient.contacts.phone,
      homeVisitAddress: location.type === "home_visit" ? appointment.homeVisitAddress : null,
      canceledAppointmentId: appointment.id,
      ttlMs: REBOOKING_LINK_TTL_MS,
    },
    now,
  );
}

/**
 * Link de remarcação ainda válido de cada atendimento cancelado pela clínica
 * (o mais novo), para a mensagem da tela "Avisar" (F5.4).
 */
export async function listValidRebookingLinks(
  db: DbClient,
  clinicId: string,
  canceledAppointmentIds: string[],
  now: Date = new Date(),
): Promise<Map<string, BookingLink>> {
  if (!canceledAppointmentIds.length) return new Map();
  const rows = unwrap(
    await db
      .from("booking_links")
      .select(`${COLUMNS}, canceled_appointment_id`)
      .eq("clinic_id", clinicId)
      .in("canceled_appointment_id", canceledAppointmentIds)
      .is("used_at", null)
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: false }),
    "Links de remarcação",
  ) as (Row & { canceled_appointment_id: string })[];
  const result = new Map<string, BookingLink>();
  for (const row of rows) if (!result.has(row.canceled_appointment_id)) result.set(row.canceled_appointment_id, toLink(row));
  return result;
}
