import { localDateOf, todayIn } from "../../clinicTime";
import { describeReceptionHours } from "../../receptionHours";
import type { PortalPlan, PriceInfo } from "../../portal";
import type { DbClient } from "../clients";
import { listAgendas } from "../config/agendas";
import { getPublicClinicBrand, type PublicClinicBrand } from "../config/brand";
import { listInsurancePlans } from "../config/insurance";
import { listLocations } from "../config/locations";
import { listProfessionalBotInfo } from "../config/professionalBotInfo";
import { professionalRegistry, listProfessionals } from "../config/professionals";
import { PHOTO_BUCKET } from "../config/profilePhotos";
import { getReceptionHours } from "../config/receptionHours";
import { listServices, servicePriceAt } from "../config/services";
import { unwrap, unwrapOne } from "../errors";
import { getClinicFeatures } from "../features";
import { getFreeSlots, getNextAvailableDates, horizonLastDate, isAgendaOpenOn } from "../agenda/slots";
import type { FreeSlot } from "../agenda/freeSlots";
import { logError } from "../../log";

// Portal de agendamento, F2a (recepção digital, 08/nov/2026): o que a clínica mostra ao paciente antes de marcar.
// Tudo com a credencial limitada à clínica (D1), achada pelo apelido do endereço.
//
// Quem aparece (mesma regra do catálogo do bot, catalog.ts): profissional ativo, marcado para o portal, com um serviço
// de Consulta individual ativo na agenda dele e horário de atendimento cadastrado num local da clínica onde o serviço é
// oferecido, que atende particular ou algum convênio ativo. Domiciliar, turma, retorno e exames ficam fora desta etapa
// (retorno e exames: F2d). Perfil e idade limite da agenda valem quando o paciente for informado (P8, F2c).
// Os horários saem das mesmas funções do bot, do Marcar e do link de agendar (agenda/slots.ts): prazo do profissional,
// feriados, bloqueios, intervalo e atendimentos marcados.

export type PortalLocation = { id: string; name: string; address: string | null };

/** Um tipo de Consulta do profissional (cópia do serviço dele, MS). */
export type PortalConsultation = { serviceId: string; name: string; durationMinutes: number; priceCents: number | null };

export type PortalSpecialty = { id: string; name: string; terms: string[] };

export type PortalProfessional = PriceInfo & {
  id: string;
  slug: string;
  name: string;
  /** "CRM 12345 RN | RQE 6271" (vazio sem registro). */
  registry: string;
  /** A principal primeiro. */
  specialties: PortalSpecialty[];
  photoUrl: string | null;
  plans: PortalPlan[];
  consultations: PortalConsultation[];
  agendaId: string;
  /** Prazo para oferecer horários, em dias (do profissional). */
  horizonDays: number;
  /** Locais da clínica onde ele atende Consulta. */
  locations: PortalLocation[];
  /** Observações do profissional (as mesmas que o bot responde em Informações gerais). */
  orientation: string | null;
};

export type PortalUnavailable = { status: "unavailable"; brand: PublicClinicBrand };

export type PortalClinic = {
  status: "open";
  clinicId: string;
  slug: string;
  timeZone: string;
  brand: PublicClinicBrand;
  /** "Seg a Sex 07:00–19:00 · Sáb 08:00–12:00", ou null sem horário cadastrado. */
  receptionHours: string | null;
  /** Locais da clínica (sem o domiciliar) com algum profissional do portal. */
  locations: PortalLocation[];
  /** Em ordem alfabética (RD7). */
  professionals: PortalProfessional[];
};

/** Profissionais sem especialidade (cadastro pendente) ficam em "Outros profissionais", como no bot. */
export const OTHER_SPECIALTY: PortalSpecialty = { id: "outros", name: "Outros profissionais", terms: [] };

/**
 * A clínica no portal. Item "Portal de agendamento" desligado na Matriz ou clínica suspensa: indisponível (a página
 * mostra só o WhatsApp da clínica, sem falar de cobrança).
 */
export async function loadPortal(db: DbClient, clinicId: string, slug: string): Promise<PortalClinic | PortalUnavailable> {
  const [brand, features] = await Promise.all([getPublicClinicBrand(db, clinicId), getClinicFeatures(db, clinicId)]);
  if (brand.suspended || !features.includes("portal")) return { status: "unavailable", brand };

  const [settings, professionals, agendas, services, locations, plans, links, botInfo, photos, windows, hours] = await Promise.all([
    db.from("clinic_settings").select("timezone").eq("clinic_id", clinicId).maybeSingle().then((r) => unwrapOne(r, "Configuração da clínica")),
    listProfessionals(db, clinicId),
    listAgendas(db, clinicId),
    listServices(db, clinicId, { category: "consultation" }),
    listLocations(db, clinicId),
    listInsurancePlans(db, clinicId),
    db
      .from("professional_insurance_plans")
      .select("professional_id, insurance_plan_id, note")
      .eq("clinic_id", clinicId)
      .then((r) => unwrap(r, "Convênios do profissional")),
    listProfessionalBotInfo(db, clinicId),
    db.from("professionals").select("id, photo_path").eq("clinic_id", clinicId).then((r) => unwrap(r, "Fotos dos profissionais")),
    db
      .from("availability_windows")
      .select("agenda_id, location_id, service_id")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .then((r) => unwrap(r, "Horários de atendimento")),
    getReceptionHours(db, clinicId).catch((error) => {
      logError("portal: horário da recepção não lido", error, { clinica: clinicId });
      return null;
    }),
  ]);

  const clinicLocations = new Map(locations.filter((l) => l.type === "clinic").map((l) => [l.id, l]));
  const planById = new Map(plans.map((p) => [p.id, p]));
  const agendaByProfessional = new Map(agendas.filter((a) => a.professionalId).map((a) => [a.professionalId!, a]));
  const specialtyIds = [...new Set(professionals.flatMap((p) => p.specialties.map((s) => s.id)))];
  const terms = specialtyIds.length
    ? new Map(
        unwrap(await db.from("kb_specialties").select("id, terms").in("id", specialtyIds), "Especialidades").map((row) => [row.id, row.terms ?? []]),
      )
    : new Map<string, string[]>();

  const result: PortalProfessional[] = [];
  for (const professional of professionals) {
    if (!professional.showInPortal) continue;
    const agenda = agendaByProfessional.get(professional.id);
    if (!agenda?.isActive) continue;
    const consultations: PortalConsultation[] = [];
    const used = new Set<string>();
    for (const service of services) {
      if (service.schedulingMode === "group" || !service.agendaIds.includes(agenda.id)) continue;
      const offered = new Set(service.locations.map((l) => l.locationId).filter((id) => clinicLocations.has(id)));
      const here = windows.filter((w) => w.agenda_id === agenda.id && offered.has(w.location_id) && (w.service_id === null || w.service_id === service.id));
      if (!here.length) continue;
      const prices = [...new Set(here.map((w) => w.location_id))].map((id) => servicePriceAt(service, id)).filter((p): p is number => p !== null);
      for (const w of here) used.add(w.location_id);
      consultations.push({
        serviceId: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        priceCents: prices.length ? Math.min(...prices) : service.priceCents,
      });
    }
    if (!consultations.length) continue;

    const accepted = links
      .filter((link) => link.professional_id === professional.id && planById.has(link.insurance_plan_id))
      .map((link) => ({ id: link.insurance_plan_id, name: planById.get(link.insurance_plan_id)!.name, note: link.note?.trim() || null }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    // Sem particular e sem convênio ativo não há como marcar (o bot manda à recepção): fica fora do portal.
    if (!professional.acceptsPrivate && !accepted.length) continue;
    const priced = consultations.map((c) => c.priceCents).filter((p): p is number => p !== null && p > 0);
    const photoPath = photos.find((row) => row.id === professional.id)?.photo_path ?? null;
    result.push({
      id: professional.id,
      slug: professional.portalSlug,
      name: professional.displayName,
      registry: professionalRegistry(professional),
      specialties: professional.specialties.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name, terms: terms.get(s.id) ?? [] })),
      photoUrl: photoPath,
      acceptsPrivate: professional.acceptsPrivate,
      privatePriceCents: priced.length ? Math.min(...priced) : null,
      privatePriceVaries: new Set(priced).size > 1,
      plans: accepted,
      consultations: consultations.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      agendaId: agenda.id,
      horizonDays: agenda.bookingHorizonDays,
      locations: [...used].map((id) => clinicLocations.get(id)!).map((l) => ({ id: l.id, name: l.name, address: l.address })),
      orientation: botInfo.get(professional.id)?.notes?.trim() || null,
    });
  }
  result.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  await signPhotos(db, clinicId, result);

  const usedLocations = new Set(result.flatMap((p) => p.locations.map((l) => l.id)));
  return {
    status: "open",
    clinicId,
    slug,
    timeZone: settings.timezone,
    brand,
    receptionHours: hours && hours.hours.some(Boolean) ? describeReceptionHours(hours.hours) : null,
    locations: [...clinicLocations.values()].filter((l) => usedLocations.has(l.id)).map((l) => ({ id: l.id, name: l.name, address: l.address })),
    professionals: result,
  };
}

/** Troca o caminho da foto por um link de 1 hora; sem o link, a página mostra as iniciais. */
async function signPhotos(db: DbClient, clinicId: string, professionals: PortalProfessional[]): Promise<void> {
  const withPhoto = professionals.filter((p) => p.photoUrl);
  if (!withPhoto.length) return;
  const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(withPhoto.map((p) => p.photoUrl!), 3600);
  if (error) logError("portal: fotos sem link", error, { clinica: clinicId });
  const byPath = new Map((data ?? []).filter((item) => item.signedUrl && !item.error).map((item) => [item.path, item.signedUrl]));
  for (const professional of professionals) professional.photoUrl = professional.photoUrl ? (byPath.get(professional.photoUrl) ?? null) : null;
}

/** Especialidades com algum profissional do portal, em ordem alfabética; "Outros profissionais" no fim. */
export function portalSpecialties(professionals: readonly PortalProfessional[]): PortalSpecialty[] {
  const byId = new Map<string, PortalSpecialty>();
  for (const p of professionals) for (const s of p.specialties) byId.set(s.id, s);
  const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return professionals.some((p) => !p.specialties.length) ? [...list, OTHER_SPECIALTY] : list;
}

export function professionalsOfSpecialty(professionals: readonly PortalProfessional[], specialtyId: string): PortalProfessional[] {
  return professionals.filter((p) => (specialtyId === OTHER_SPECIALTY.id ? !p.specialties.length : p.specialties.some((s) => s.id === specialtyId)));
}

// ---------------------------------------------------------------------------
// Horários

/** Último dia que o profissional oferece (o prazo dele; hoje conta como o 1º). */
export const lastBookableDate = (professional: Pick<PortalProfessional, "horizonDays">, timeZone: string, now: Date = new Date()) =>
  horizonLastDate(todayIn(timeZone, now), professional.horizonDays);

export type PortalSlot = FreeSlot & { serviceId: string };

/** Próximas datas com horário livre do tipo de Consulta, nos locais da clínica (até `count`, no prazo). */
export async function professionalDates(
  db: DbClient,
  clinicId: string,
  professional: PortalProfessional,
  serviceId: string,
  timeZone: string,
  { count = 60, now = new Date(), sessionId = null }: { count?: number; now?: Date; sessionId?: string | null } = {},
): Promise<string[]> {
  const lastDate = lastBookableDate(professional, timeZone, now);
  const holds = { exceptSession: sessionId };
  const perLocation = await Promise.all(
    professional.locations.map((location) =>
      getNextAvailableDates(db, clinicId, { serviceId, agendaId: professional.agendaId, locationId: location.id, count, lastDate, holds }, now),
    ),
  );
  return [...new Set(perLocation.flat().map((d) => d.date))].sort().slice(0, count);
}

/**
 * Horários livres de um dia, nos locais da clínica, em ordem (o mesmo horário em dois locais aparece nos dois). Sem os
 * horários reservados por outras sessões do portal (`sessionId`: a de quem pergunta).
 */
export async function professionalSlots(
  db: DbClient,
  clinicId: string,
  professional: PortalProfessional,
  serviceId: string,
  date: string,
  timeZone: string,
  now: Date = new Date(),
  sessionId: string | null = null,
): Promise<PortalSlot[]> {
  if (date > lastBookableDate(professional, timeZone, now)) return [];
  const holds = { exceptSession: sessionId };
  const perLocation = await Promise.all(
    professional.locations.map((location) =>
      getFreeSlots(db, clinicId, { serviceId, agendaId: professional.agendaId, locationId: location.id, date, holds }, now),
    ),
  );
  return perLocation
    .flat()
    .map((slot) => ({ ...slot, serviceId }))
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.locationId.localeCompare(b.locationId));
}

/** O dia tem agenda aberta (para o aviso "não tem mais horário livre" × "não há agenda"). */
export async function isProfessionalDayOpen(
  db: DbClient,
  clinicId: string,
  professional: PortalProfessional,
  serviceId: string,
  date: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (date > lastBookableDate(professional, timeZone, now)) return false;
  const open = await Promise.all(
    professional.locations.map((location) => isAgendaOpenOn(db, clinicId, { serviceId, agendaId: professional.agendaId, locationId: location.id, date }, now)),
  );
  return open.some(Boolean);
}

/** Próximo horário livre do profissional, em qualquer tipo de Consulta (cartão da P3 e início do profissional). */
export async function nextFreeSlot(
  db: DbClient,
  clinicId: string,
  professional: PortalProfessional,
  timeZone: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const firsts = await Promise.all(
    professional.consultations.map(async (consultation) => {
      const [date] = await professionalDates(db, clinicId, professional, consultation.serviceId, timeZone, { count: 1, now });
      if (!date) return null;
      const [slot] = await professionalSlots(db, clinicId, professional, consultation.serviceId, date, timeZone, now);
      return slot?.start ?? null;
    }),
  );
  const times = firsts.filter((d): d is Date => d !== null).map((d) => d.getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

/** Próximo horário de cada profissional (por id; null = sem horário no prazo). */
export async function nextFreeSlots(
  db: DbClient,
  clinicId: string,
  professionals: readonly PortalProfessional[],
  timeZone: string,
  now: Date = new Date(),
): Promise<Map<string, Date | null>> {
  const entries = await Promise.all(professionals.map(async (p) => [p.id, await nextFreeSlot(db, clinicId, p, timeZone, now)] as const));
  return new Map(entries);
}

/**
 * O horário escolhido ainda está livre (antes de seguir para a identificação): confere de novo no servidor, porque
 * outra pessoa pode ter marcado entre a escolha e o Continuar.
 */
export async function isSlotStillFree(
  db: DbClient,
  clinicId: string,
  professional: PortalProfessional,
  choice: { serviceId: string; locationId: string; start: Date },
  timeZone: string,
  now: Date = new Date(),
  sessionId: string | null = null,
): Promise<boolean> {
  if (!professional.consultations.some((c) => c.serviceId === choice.serviceId)) return false;
  if (!professional.locations.some((l) => l.id === choice.locationId)) return false;
  const slots = await professionalSlots(db, clinicId, professional, choice.serviceId, localDateOf(choice.start, timeZone), timeZone, now, sessionId);
  return slots.some((slot) => slot.locationId === choice.locationId && slot.start.getTime() === choice.start.getTime());
}
