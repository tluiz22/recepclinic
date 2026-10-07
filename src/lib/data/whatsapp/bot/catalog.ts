import type { DbClient } from "../../clients";
import { listAgendas } from "../../config/agendas";
import { listLocations, type LocationType } from "../../config/locations";
import { listProfessionals } from "../../config/professionals";
import { listServices, servicePriceAt, type ServiceCategory } from "../../config/services";
import { unwrap } from "../../errors";
import type { FeatureKey } from "../../../features";

// Catálogo do bot (F6.3, D4c): os menus saem dos serviços da clínica. Um
// serviço aparece quando tem agenda ativa com horário de atendimento
// cadastrado num local ativo dele (regra do piloto, Fase 11: sem dia e
// horário cadastrados, o serviço nem aparece para escolher). Item desligado
// na matriz some do bot (D11): exames sem "Exames e procedimentos",
// domiciliar sem "Atendimento domiciliar".

export type BotAgenda = {
  id: string;
  name: string;
  professionalName: string | null;
  specialty: string | null;
  /** Tipos de local com horário nesta agenda. */
  locationTypes: LocationType[];
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
};

export type BotLocation = { id: string; name: string; type: LocationType; address: string | null };

export type BotCatalog = { services: BotService[]; locations: BotLocation[] };

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
          return { id, name: agenda.name, professionalName: professional?.displayName ?? null, specialty: professional?.specialty ?? null, locationTypes };
        })
        .sort((a, b) => (a.professionalName ?? a.name).localeCompare(b.professionalName ?? b.name, "pt-BR")),
      locationPrices,
      priceCents: service.priceCents,
      returnDeadlineDays: service.returnDeadlineDays,
      preparation: service.preparationInstructions?.trim() || null,
    });
  }
  return {
    services: bookable,
    locations: [...locationById.values()].map((l) => ({ id: l.id, name: l.name, type: l.type, address: l.address })),
  };
}

export const servicesOf = (catalog: BotCatalog, category: ServiceCategory) => catalog.services.filter((s) => s.category === category);
