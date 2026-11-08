import type { DbClient } from "../../clients";
import { listAgendas, type AgendaAttendance } from "../../config/agendas";
import { listLocations, type LocationType } from "../../config/locations";
import { listProfessionals } from "../../config/professionals";
import { listServices, servicePriceAt, type ServiceCategory } from "../../config/services";
import { unwrap } from "../../errors";
import type { FeatureKey } from "../../../features";
import type { PreparationFile } from "../../config/preparationFile";

// Catálogo do bot (F6.3, D4c): os menus saem dos serviços da clínica. Um
// serviço aparece quando tem agenda ativa com horário de atendimento
// cadastrado num local ativo dele (regra do piloto, Fase 11: sem dia e
// horário cadastrados, o serviço nem aparece para escolher). Item desligado
// na matriz some do bot (D11): exames sem "Exames e procedimentos",
// domiciliar sem "Atendimento domiciliar".
//
// Serviços por profissional (MS, 07/nov/2026): cada serviço tem um dono, e o
// mesmo serviço de vários profissionais são cópias. No menu, as cópias com o
// mesmo nome e tipo viram uma opção só (como antes da MS), e cada agenda leva
// o id da sua cópia (`serviceId`); escolhida a agenda, o bot segue com a cópia
// dela (valor, duração, preparo). `copies` guarda todas, uma por serviço.

export type BotAgenda = {
  id: string;
  /** A cópia do serviço atendida nesta agenda (MS). */
  serviceId: string;
  name: string;
  professionalName: string | null;
  professionalId: string | null;
  specialty: string | null;
  /** Especialidades do profissional, a principal primeiro (MB, 07/nov/2026); agenda sem profissional: nenhuma. */
  specialties: { id: string; name: string }[];
  /** Tipos de local com horário nesta agenda. */
  locationTypes: LocationType[];
  /** Perfil, prazo e idade limite do profissional (ou da Equipe) desta agenda (cliente, 08/nov/2026). */
  attendance: AgendaAttendance;
};

export type BotService = {
  id: string;
  name: string;
  category: ServiceCategory;
  isGroup: boolean;
  /** Agendas em que o paciente consegue horário, por nome. */
  agendas: BotAgenda[];
  /** Tipos de local com horário, com o valor (null = sem valor próprio cadastrado). */
  locationPrices: Partial<Record<LocationType, number>>;
  priceCents: number;
  returnDeadlineDays: number | null;
  preparation: string | null;
  /** Arquivo do preparo (C7.5): vai no lugar das instruções. */
  preparationFile: PreparationFile | null;
};

export type BotLocation = { id: string; name: string; type: LocationType; address: string | null };

export type BotCatalog = {
  /** Para os menus: as cópias de mesmo nome e tipo juntas. */
  services: BotService[];
  /** Cada serviço com as agendas dele (MS). */
  copies: BotService[];
  locations: BotLocation[];
};

const mergeKey = (s: BotService) =>
  `${s.category}|${s.isGroup}|${s.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()}`;

/** Junta as cópias de mesmo nome e tipo numa opção só; a primeira dá os dados. */
export function mergeCopies(copies: BotService[]): BotService[] {
  const merged = new Map<string, BotService>();
  for (const copy of copies) {
    const key = mergeKey(copy);
    const current = merged.get(key);
    if (!current) merged.set(key, { ...copy, agendas: [...copy.agendas] });
    else {
      current.agendas = [...current.agendas, ...copy.agendas].sort((a, b) => (a.professionalName ?? a.name).localeCompare(b.professionalName ?? b.name, "pt-BR"));
      for (const [type, price] of Object.entries(copy.locationPrices) as [LocationType, number][]) if (!(type in current.locationPrices)) current.locationPrices[type] = price;
    }
  }
  return [...merged.values()];
}

/** A cópia do serviço atendida na agenda (sem ela, o próprio serviço). */
export function copyAt(catalog: Pick<BotCatalog, "copies">, service: BotService, agendaId: string | null | undefined): BotService {
  const serviceId = service.agendas.find((a) => a.id === agendaId)?.serviceId;
  if (!serviceId) return service;
  const copy = catalog.copies.find((c) => c.id === serviceId);
  return copy ? { ...copy, agendas: service.agendas.filter((a) => a.serviceId === serviceId) } : service;
}

/** O serviço tem agendas de cópias diferentes (sem "Primeiro horário disponível" entre elas). */
export const mixesCopies = (service: BotService) => new Set(service.agendas.map((a) => a.serviceId)).size > 1;

export async function loadCatalog(db: DbClient, clinicId: string, features: readonly FeatureKey[]): Promise<BotCatalog> {
  const [services, agendas, professionals, locations, windows] = await Promise.all([
    listServices(db, clinicId),
    listAgendas(db, clinicId),
    listProfessionals(db, clinicId),
    listLocations(db, clinicId),
    db
      .from("availability_windows")
      .select("agenda_id, location_id, service_id")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .then((r) => unwrap(r, "Horários de atendimento")),
  ]);
  const agendaById = new Map(agendas.map((a) => [a.id, a]));
  const professionalById = new Map(professionals.map((p) => [p.id, p]));
  const locationById = new Map(
    locations.filter((l) => l.type !== "home_visit" || features.includes("home_visit")).map((l) => [l.id, l]),
  );

  const bookable: BotService[] = [];
  for (const service of services) {
    if (service.category === "exam" && !features.includes("exams")) continue;
    const offeredLocations = new Set(service.locations.map((l) => l.locationId).filter((id) => locationById.has(id)));
    const fits = windows.filter(
      (w) => offeredLocations.has(w.location_id) && (w.service_id === null || w.service_id === service.id) && service.agendaIds.includes(w.agenda_id),
    );
    const agendaIds = [...new Set(fits.map((w) => w.agenda_id))].filter((id) => agendaById.has(id));
    if (!agendaIds.length) continue;

    const locationPrices: Partial<Record<LocationType, number>> = {};
    for (const w of fits) {
      const location = locationById.get(w.location_id)!;
      if (!(location.type in locationPrices)) locationPrices[location.type] = servicePriceAt(service, location.id) ?? service.priceCents;
    }
    bookable.push({
      id: service.id,
      name: service.name,
      category: service.category,
      isGroup: service.schedulingMode === "group",
      agendas: agendaIds
        .map((id) => {
          const agenda = agendaById.get(id)!;
          const professional = agenda.professionalId ? professionalById.get(agenda.professionalId) : undefined;
          const locationTypes = [...new Set(fits.filter((w) => w.agenda_id === id).map((w) => locationById.get(w.location_id)!.type))];
          return { id, serviceId: service.id, name: agenda.name, professionalName: professional?.displayName ?? null, professionalId: agenda.professionalId ?? null, specialty: professional?.specialty ?? null, specialties: (professional?.specialties ?? []).map((sp) => ({ id: sp.id, name: sp.name })), locationTypes, attendance: { profile: agenda.profile, bookingHorizonDays: agenda.bookingHorizonDays, consultationAgeLimitYears: agenda.consultationAgeLimitYears } };
        })
        .sort((a, b) => (a.professionalName ?? a.name).localeCompare(b.professionalName ?? b.name, "pt-BR")),
      locationPrices,
      priceCents: service.priceCents,
      returnDeadlineDays: service.returnDeadlineDays,
      preparation: service.preparationInstructions?.trim() || null,
      preparationFile: service.preparationFile,
    });
  }
  return {
    services: mergeCopies(bookable),
    copies: bookable,
    locations: [...locationById.values()].map((l) => ({ id: l.id, name: l.name, type: l.type, address: l.address })),
  };
}

export const servicesOf = (catalog: BotCatalog, category: ServiceCategory) => catalog.services.filter((s) => s.category === category);
