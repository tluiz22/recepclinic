import { localDateOf } from "../../clinicTime";
import type { ClinicProfile } from "../../vocabulary";
import type { DbClient } from "../clients";
import { DataError, unwrap, unwrapOne } from "../errors";
import { joinWaitlist } from "../waitlist/entries";
import { logWebFunnelEvent, type FunnelLink } from "../whatsapp/funnel";
import { bookAppointment, findReturnOrigin, getAppointment, rescheduleAppointment, type AppointmentStatus } from "./appointments";
import { bookingLinkLastDate, claimBookingLink, getBookingLink, linkState, type BookingLink } from "./links";
import { agendasForService, DEFAULT_DATE_COUNT, getFreeSlots, getGroupSessions, getNextAvailableDates, type DateWithSlots } from "./slots";
import { logError } from "../../log";

// Página pública /agendar/[token] (F5.2): o paciente (ou o contato) escolhe
// data e horário pelo link do bot ou da clínica. Tudo com a credencial
// limitada à clínica do link. Regras do piloto mantidas:
//   - link vencido ou usado não marca; usar é atômico (claimBookingLink);
//   - o horário é conferido de novo no servidor ao confirmar;
//   - retorno ligado a uma consulta: só datas até o fim do prazo (o link da
//     clínica dispensa o prazo) e um retorno por consulta;
//   - pedido de lista de espera feito antes de ter marcação entra ao confirmar.
// Novo no RecepClinic (cliente, 05/out/2026): o link de "primeiro horário
// disponível" junta as agendas do serviço, e cada horário mostra o
// profissional e o local quando houver mais de um.
// As mensagens de confirmação pelo WhatsApp vêm na F6.

export type ServiceCategory = "consultation" | "return_visit" | "exam";

type Option = { id: string; name: string };
type LocationOption = Option & { type: string; address: string | null };

/** Agendas e locais em que o link pode marcar. */
export type LinkCandidates = { agendas: Option[]; locations: LocationOption[] };

export type PublicSlot = {
  start: Date;
  agendaId: string;
  agendaName: string;
  locationId: string;
  locationName: string;
  /** Turma: vagas que sobram na sessão. */
  remaining: number | null;
};

export type BookingPageAppointment = {
  scheduledAt: Date;
  status: AppointmentStatus;
  agendaName: string;
  locationName: string;
  /** Endereço do local, ou o do domiciliar. */
  address: string | null;
};

export type BookingPage = {
  clinicId: string;
  timeZone: string;
  profile: ClinicProfile;
  link: BookingLink;
  state: "form" | "used" | "expired";
  service: { id: string; name: string; category: ServiceCategory; isGroup: boolean; hasPreparation: boolean };
  patient: { fullName: string; birthdate: string };
  contact: { fullName: string; phone: string };
  candidates: LinkCandidates;
  /** Remarcação: o atendimento atual; link usado: o atendimento marcado por ele. */
  appointment: BookingPageAppointment | null;
  /** Retorno com prazo: último dia que pode ser escolhido. */
  lastDate: string | null;
};

export type ConfirmResult =
  | { status: "confirmed"; appointmentId: string }
  /** Link vencido, usado ou inexistente: a página mostra o estado certo. */
  | { status: "unavailable" }
  | { status: "slot_taken" | "return_used" | "duplicate" | "failed" };

async function loadAppointmentView(db: DbClient, clinicId: string, id: string): Promise<BookingPageAppointment> {
  const row = unwrapOne(
    await db
      .from("appointments")
      .select("scheduled_at, status, home_visit_address, agendas ( name ), locations ( name, type, address )")
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .maybeSingle(),
    "Atendimento",
  ) as unknown as {
    scheduled_at: string;
    status: AppointmentStatus;
    home_visit_address: string | null;
    agendas: { name: string } | null;
    locations: { name: string; type: string; address: string | null } | null;
  };
  return {
    scheduledAt: new Date(row.scheduled_at),
    status: row.status,
    agendaName: row.agendas?.name ?? "",
    locationName: row.locations?.name ?? "",
    address: row.locations?.type === "home_visit" ? row.home_visit_address : (row.locations?.address ?? null),
  };
}

/** Agendas (a do link, a do atendimento remarcado ou todas as do serviço) e locais (do serviço, filtrados pelo link). */
export async function linkCandidates(db: DbClient, clinicId: string, link: BookingLink): Promise<LinkCandidates> {
  let agendaIds: string[];
  if (link.mode === "reschedule" && link.appointmentId) {
    agendaIds = [(await getAppointment(db, clinicId, link.appointmentId)).agendaId];
  } else {
    agendaIds = link.agendaId ? [link.agendaId] : await agendasForService(db, clinicId, link.serviceId);
  }
  const [agendas, offered] = await Promise.all([
    agendaIds.length
      ? db.from("agendas").select("id, name").eq("clinic_id", clinicId).in("id", agendaIds).then((r) => unwrap(r, "Agendas"))
      : Promise.resolve([]),
    db
      .from("service_locations")
      .select("locations!inner ( id, name, type, address, is_active )")
      .eq("clinic_id", clinicId)
      .eq("service_id", link.serviceId)
      .eq("locations.is_active", true)
      .then((r) => unwrap(r, "Locais do serviço")),
  ]);
  const locations = (offered as unknown as { locations: LocationOption }[])
    .map((row) => ({ id: row.locations.id, name: row.locations.name, type: row.locations.type, address: row.locations.address }))
    .filter((location) => (link.locationId ? location.id === link.locationId : !link.locationCategory || location.type === link.locationCategory))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const byId = new Map(agendas.map((agenda) => [agenda.id, agenda.name]));
  return {
    agendas: agendaIds.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id)! })),
    locations,
  };
}

/** Tudo o que a página precisa para abrir o link. */
export async function loadBookingPage(db: DbClient, clinicId: string, linkId: string, now: Date = new Date()): Promise<BookingPage> {
  const link = await getBookingLink(db, clinicId, linkId);
  const [settings, service, patient] = await Promise.all([
    db.from("clinic_settings").select("timezone, profile").eq("clinic_id", clinicId).maybeSingle().then((r) => unwrapOne(r, "Configuração da clínica")),
    db
      .from("services")
      .select("id, name, category, scheduling_mode, preparation_instructions")
      .eq("clinic_id", clinicId)
      .eq("id", link.serviceId)
      .maybeSingle()
      .then((r) => unwrapOne(r, "Serviço")),
    db
      .from("patients")
      .select("full_name, birthdate, contacts ( full_name, phone )")
      .eq("clinic_id", clinicId)
      .eq("id", link.patientId)
      .maybeSingle()
      .then((r) => unwrapOne(r, "Paciente")),
  ]);
  const contact = (patient as unknown as { contacts: { full_name: string; phone: string } | null }).contacts;
  const state = linkState(link, now) === "valid" ? "form" : linkState(link, now) === "used" ? "used" : "expired";

  const [candidates, appointment, lastDate] = await Promise.all([
    state === "form" ? linkCandidates(db, clinicId, link) : Promise.resolve({ agendas: [], locations: [] }),
    link.appointmentId ? loadAppointmentView(db, clinicId, link.appointmentId) : Promise.resolve(null),
    state === "form" ? bookingLinkLastDate(db, clinicId, link, now) : Promise.resolve(null),
  ]);

  return {
    clinicId,
    timeZone: settings.timezone,
    profile: settings.profile,
    link,
    state,
    service: {
      id: service.id,
      name: service.name,
      category: service.category,
      isGroup: service.scheduling_mode === "group",
      hasPreparation: Boolean(service.preparation_instructions?.trim()),
    },
    patient: { fullName: patient.full_name, birthdate: patient.birthdate },
    contact: { fullName: contact?.full_name ?? "", phone: contact?.phone ?? link.contactPhone },
    candidates,
    appointment,
    lastDate,
  };
}

/** Pares agenda × local a consultar (local nulo = qualquer um do serviço). */
function combinations(candidates: LinkCandidates): { agenda: Option; locationId: string }[] {
  return candidates.agendas.flatMap((agenda) => candidates.locations.map((location) => ({ agenda, locationId: location.id })));
}

/** Próximas datas com horário livre (serviço individual). */
export async function listLinkDates(
  db: DbClient,
  clinicId: string,
  page: Pick<BookingPage, "link" | "candidates" | "lastDate">,
  now: Date = new Date(),
): Promise<DateWithSlots[]> {
  const perCombination = await Promise.all(
    combinations(page.candidates).map(({ agenda, locationId }) =>
      getNextAvailableDates(
        db,
        clinicId,
        {
          serviceId: page.link.serviceId,
          agendaId: agenda.id,
          locationId,
          lastDate: page.lastDate,
          ignoreAppointmentId: page.link.mode === "reschedule" ? page.link.appointmentId : null,
        },
        now,
      ),
    ),
  );
  const byDate = new Map(perCombination.flat().map((d) => [d.date, d]));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, DEFAULT_DATE_COUNT);
}

/** Profissional e local ao lado do horário, só quando o link tem mais de um (cliente, 05/out/2026). */
export function slotDetails(candidates: LinkCandidates, slot: Pick<PublicSlot, "agendaName" | "locationName">): string {
  return [candidates.agendas.length > 1 ? slot.agendaName : null, candidates.locations.length > 1 ? slot.locationName : null]
    .filter(Boolean)
    .join(" · ");
}

/** Valor do horário no formulário: "<início ISO>|<agenda>|<local>". */
export function slotChoiceValue(slot: Pick<PublicSlot, "start" | "agendaId" | "locationId">): string {
  return `${slot.start.toISOString()}|${slot.agendaId}|${slot.locationId}`;
}

export function parseSlotChoice(value: string | null | undefined): { start: Date; agendaId: string; locationId: string } | null {
  const [iso, agendaId, locationId] = (value ?? "").split("|");
  const start = new Date(iso ?? "");
  return Number.isNaN(start.getTime()) || !agendaId || !locationId ? null : { start, agendaId, locationId };
}

const nameOf = (list: Option[], id: string) => list.find((item) => item.id === id)?.name ?? "";

/**
 * Horários livres do dia em todas as combinações; o mesmo horário aparece uma
 * vez, na primeira agenda em ordem de nome (D2 revista).
 */
export async function listLinkSlots(
  db: DbClient,
  clinicId: string,
  page: Pick<BookingPage, "link" | "candidates" | "lastDate">,
  date: string,
  now: Date = new Date(),
): Promise<PublicSlot[]> {
  if (page.lastDate && date > page.lastDate) return [];
  const perCombination = await Promise.all(
    combinations(page.candidates).map(async ({ agenda, locationId }) =>
      (
        await getFreeSlots(
          db,
          clinicId,
          {
            serviceId: page.link.serviceId,
            agendaId: agenda.id,
            locationId,
            date,
            ignoreAppointmentId: page.link.mode === "reschedule" ? page.link.appointmentId : null,
          },
          now,
        )
      ).map((slot) => ({ start: slot.start, agendaId: agenda.id, agendaName: agenda.name, locationId: slot.locationId, remaining: null })),
    ),
  );
  const seen = new Set<number>();
  return perCombination
    .flat()
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.agendaName.localeCompare(b.agendaName, "pt-BR"))
    .filter((slot) => (seen.has(slot.start.getTime()) ? false : (seen.add(slot.start.getTime()), true)))
    .map((slot) => ({ ...slot, locationName: nameOf(page.candidates.locations, slot.locationId) }));
}

/** Turma: próximas sessões com vaga nas agendas e locais do link. */
export async function listLinkGroupSessions(
  db: DbClient,
  clinicId: string,
  page: Pick<BookingPage, "link" | "candidates">,
  now: Date = new Date(),
): Promise<PublicSlot[]> {
  const locationIds = new Set(page.candidates.locations.map((location) => location.id));
  const perAgenda = await Promise.all(
    page.candidates.agendas.map(async (agenda) =>
      (await getGroupSessions(db, clinicId, { serviceId: page.link.serviceId, agendaId: agenda.id }, now))
        .filter((session) => locationIds.has(session.locationId))
        .map((session) => ({
          start: session.start,
          agendaId: agenda.id,
          agendaName: agenda.name,
          locationId: session.locationId,
          locationName: nameOf(page.candidates.locations, session.locationId),
          remaining: session.remaining,
        })),
    ),
  );
  return perAgenda
    .flat()
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, DEFAULT_DATE_COUNT);
}

const funnelLink = (link: BookingLink, category: ServiceCategory): FunnelLink => ({
  funnelSessionId: link.funnelSessionId,
  contactPhone: link.contactPhone,
  contactId: link.contactId,
  mode: link.mode,
  serviceCategory: category,
});

/** Passo do funil do bot na página (link sem tentativa do bot não entra). */
export async function logBookingPageStep(
  db: DbClient,
  clinicId: string,
  page: Pick<BookingPage, "link" | "service">,
  step: "page_opened" | "link_expired" | "date_changed" | "confirm_failed" | "confirmed",
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await logWebFunnelEvent(db, clinicId, funnelLink(page.link, page.service.category), step, metadata);
  } catch (error) {
    // O funil é medição: falhar nele nunca impede marcar.
    logError("agendar: funil não registrado", error, { clinica: clinicId });
  }
}

async function releaseLink(db: DbClient, clinicId: string, linkId: string): Promise<void> {
  const { error } = await db.from("booking_links").update({ used_at: null }).eq("clinic_id", clinicId).eq("id", linkId);
  if (error) logError("agendar: link não devolvido", error, { clinica: clinicId, link: linkId });
}

/**
 * Confirma o horário escolhido. Revalida a agenda e o local contra os do link,
 * o prazo e o uso do retorno, trava o link e marca (ou remarca); se o
 * horário deixou de estar livre, devolve o link para outra escolha.
 */
export async function confirmBookingLink(
  db: DbClient,
  clinicId: string,
  linkId: string,
  choice: { start: Date; agendaId: string; locationId: string },
  now: Date = new Date(),
): Promise<ConfirmResult> {
  const page = await loadBookingPage(db, clinicId, linkId, now);
  if (page.state !== "form") return { status: "unavailable" };
  const { link, candidates, timeZone } = page;
  if (!candidates.agendas.some((a) => a.id === choice.agendaId) || !candidates.locations.some((l) => l.id === choice.locationId)) {
    return { status: "slot_taken" };
  }

  if (page.service.category === "return_visit" && link.originAppointmentId) {
    const day = localDateOf(choice.start, timeZone);
    if (page.lastDate && day > page.lastDate) return { status: "slot_taken" };
    const origin = await findReturnOrigin(
      db,
      clinicId,
      {
        patientId: link.patientId,
        agendaId: choice.agendaId,
        returnServiceId: link.serviceId,
        originAppointmentId: link.originAppointmentId,
        ignoreAppointmentId: link.appointmentId,
      },
      now,
    );
    if (origin?.alreadyUsed) return { status: "return_used" };
  }

  if (!(await claimBookingLink(db, clinicId, linkId, now))) return { status: "unavailable" };

  let appointmentId: string;
  try {
    if (link.mode === "reschedule" && link.appointmentId) {
      appointmentId = link.appointmentId;
      await rescheduleAppointment(
        db,
        clinicId,
        appointmentId,
        { start: choice.start, locationId: choice.locationId, channel: "whatsapp_bot", trailChannel: "booking_link", actorId: null },
        now,
      );
      // Domiciliar: o bot reconfirma o endereço ao remarcar (piloto, Fase 16).
      const location = candidates.locations.find((l) => l.id === choice.locationId);
      if (link.homeVisitAddress && location?.type === "home_visit") {
        unwrap(
          await db.from("appointments").update({ home_visit_address: link.homeVisitAddress }).eq("clinic_id", clinicId).eq("id", appointmentId),
          "Atendimento",
        );
      }
    } else {
      const { appointment } = await bookAppointment(
        db,
        clinicId,
        {
          patientId: link.patientId,
          serviceId: link.serviceId,
          agendaId: choice.agendaId,
          start: choice.start,
          locationId: choice.locationId,
          homeVisitAddress: link.homeVisitAddress,
          originAppointmentId: link.originAppointmentId,
          channel: "whatsapp_bot",
          trailChannel: "booking_link",
          actorId: null,
        },
        now,
      );
      appointmentId = appointment.id;
      unwrap(
        await db.from("booking_links").update({ appointment_id: appointmentId }).eq("clinic_id", clinicId).eq("id", linkId),
        "Link de agendamento",
      );
    }
  } catch (error) {
    await releaseLink(db, clinicId, linkId);
    if (error instanceof DataError && error.code === "conflict") return { status: "slot_taken" };
    if (error instanceof DataError && error.code === "duplicate") return { status: "duplicate" };
    logError("agendar: não confirmou", error, { clinica: clinicId, link: linkId });
    return { status: "failed" };
  }

  // Lista de espera pedida antes de ter marcação (piloto, Fase 25).
  if (link.mode === "create" && link.joinWaitlist) {
    try {
      await joinWaitlist(db, clinicId, appointmentId, { via: "booking_link", actorId: null }, now);
    } catch (error) {
      logError("agendar: não entrou na lista de espera", error, { clinica: clinicId });
    }
  }
  return { status: "confirmed", appointmentId };
}
