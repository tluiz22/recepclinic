import { MAX_PREPARATION_LENGTH, normalizeMultilineText } from "../../whatsappFormat";
import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { cleanText, unwrap, unwrapOne, Validation } from "../errors";

// Serviços (D4c): consulta, retorno e exame, cada um atendido em uma ou mais
// agendas (D2 revista) e oferecido em um ou mais locais, com preço próprio
// opcional por local. Saem por desativação (têm atendimentos ligados).

export type ServiceCategory = Enums<"service_category">;
export type SchedulingMode = Enums<"scheduling_mode">;

export type ServiceLocationPrice = { locationId: string; priceCents: number | null };

export type Service = {
  id: string;
  name: string;
  category: ServiceCategory;
  durationMinutes: number;
  priceCents: number;
  /** Só Retorno: prazo em dias a partir da consulta de origem. */
  returnDeadlineDays: number | null;
  /** Só Exame: preparo, na formatação do WhatsApp. */
  preparationInstructions: string | null;
  /** Só Exame: individual ou turma. */
  schedulingMode: SchedulingMode;
  isActive: boolean;
  agendaIds: string[];
  locations: ServiceLocationPrice[];
};

export type ServiceInput = Omit<Service, "id" | "isActive" | "agendaIds" | "locations">;

const COLUMNS =
  "id, name, category, duration_minutes, price_cents, return_deadline_days, preparation_instructions, scheduling_mode, is_active, service_agendas ( agenda_id ), service_locations ( location_id, price_cents )";
const CATEGORIES: ServiceCategory[] = ["consultation", "return_visit", "exam"];

type Row = {
  id: string;
  name: string;
  category: ServiceCategory;
  duration_minutes: number;
  price_cents: number;
  return_deadline_days: number | null;
  preparation_instructions: string | null;
  scheduling_mode: SchedulingMode;
  is_active: boolean;
  service_agendas: { agenda_id: string }[];
  service_locations: { location_id: string; price_cents: number | null }[];
};

const toService = (row: Row): Service => ({
  id: row.id,
  name: row.name,
  category: row.category,
  durationMinutes: row.duration_minutes,
  priceCents: row.price_cents,
  returnDeadlineDays: row.return_deadline_days,
  preparationInstructions: row.preparation_instructions,
  schedulingMode: row.scheduling_mode,
  isActive: row.is_active,
  agendaIds: row.service_agendas.map((link) => link.agenda_id).sort(),
  locations: row.service_locations
    .map((link) => ({ locationId: link.location_id, priceCents: link.price_cents }))
    .sort((a, b) => a.locationId.localeCompare(b.locationId)),
});

const isNonNegativeInt = (value: number) => Number.isInteger(value) && value >= 0;
const isPositiveInt = (value: number) => Number.isInteger(value) && value > 0;

export function validateService(input: ServiceInput) {
  const v = new Validation();
  const preparation = input.preparationInstructions ? normalizeMultilineText(input.preparationInstructions) || null : null;
  const row = {
    name: cleanText(input.name) ?? "",
    category: input.category,
    duration_minutes: input.durationMinutes,
    price_cents: input.priceCents,
    return_deadline_days: input.returnDeadlineDays ?? null,
    preparation_instructions: preparation,
    scheduling_mode: input.schedulingMode ?? "individual",
  };
  v.check(row.name.length > 0, "name", "Informe o nome do serviço");
  v.check(CATEGORIES.includes(row.category), "category", "Categoria inválida");
  v.check(isPositiveInt(row.duration_minutes), "durationMinutes", "Duração em minutos inteiros, maior que 0");
  v.check(isNonNegativeInt(row.price_cents), "priceCents", "Valor inválido");
  v.check(
    row.return_deadline_days === null || (row.category === "return_visit" && isPositiveInt(row.return_deadline_days)),
    "returnDeadlineDays",
    "Prazo em dias só para Retorno, maior que 0",
  );
  v.check(row.preparation_instructions === null || row.category === "exam", "preparationInstructions", "Preparo só para Exame");
  v.check(
    (row.preparation_instructions?.length ?? 0) <= MAX_PREPARATION_LENGTH,
    "preparationInstructions",
    `Preparo com até ${MAX_PREPARATION_LENGTH} caracteres`,
  );
  v.check(
    row.scheduling_mode === "individual" || (row.scheduling_mode === "group" && row.category === "exam"),
    "schedulingMode",
    "Turma só para Exame",
  );
  v.throwIfInvalid("Serviço");
  return row;
}

export async function listServices(
  db: DbClient,
  clinicId: string,
  { includeInactive = false, category }: { includeInactive?: boolean; category?: ServiceCategory } = {},
): Promise<Service[]> {
  let query = db.from("services").select(COLUMNS).eq("clinic_id", clinicId).order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  if (category) query = query.eq("category", category);
  return (unwrap(await query, "Serviços") as unknown as Row[]).map(toService);
}

export async function getService(db: DbClient, clinicId: string, id: string): Promise<Service> {
  return toService(
    unwrapOne(await db.from("services").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Serviço") as unknown as Row,
  );
}

export async function createService(db: DbClient, clinicId: string, input: ServiceInput): Promise<Service> {
  const row = validateService(input);
  const created = await db.from("services").insert({ clinic_id: clinicId, ...row }).select("id").single();
  const { id } = unwrap<{ id: string }>(created, "Serviço");
  return getService(db, clinicId, id);
}

/** A categoria não muda depois de criado (atendimentos e regras dependem dela). */
export async function updateService(
  db: DbClient,
  clinicId: string,
  id: string,
  input: Omit<ServiceInput, "category">,
): Promise<Service> {
  const current = await getService(db, clinicId, id);
  const { category: _category, ...row } = validateService({ ...input, category: current.category });
  unwrapOne(
    await db.from("services").update(row).eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(),
    "Serviço",
  );
  return getService(db, clinicId, id);
}

export async function setServiceActive(db: DbClient, clinicId: string, id: string, isActive: boolean): Promise<void> {
  unwrapOne(
    await db.from("services").update({ is_active: isActive }).eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(),
    "Serviço",
  );
}

/** Agendas que atendem o serviço. Grava as novas antes de tirar as antigas. */
export async function setServiceAgendas(db: DbClient, clinicId: string, serviceId: string, agendaIds: string[]): Promise<Service> {
  const current = await getService(db, clinicId, serviceId);
  const wanted = [...new Set(agendaIds)];
  const toAdd = wanted.filter((id) => !current.agendaIds.includes(id));
  const toRemove = current.agendaIds.filter((id) => !wanted.includes(id));
  if (toAdd.length) {
    unwrap(
      await db.from("service_agendas").insert(toAdd.map((agenda_id) => ({ clinic_id: clinicId, service_id: serviceId, agenda_id }))),
      "Agendas do serviço",
    );
  }
  if (toRemove.length) {
    unwrap(
      await db.from("service_agendas").delete().eq("clinic_id", clinicId).eq("service_id", serviceId).in("agenda_id", toRemove),
      "Agendas do serviço",
    );
  }
  return getService(db, clinicId, serviceId);
}

/**
 * Locais em que o serviço é oferecido, com preço próprio opcional (null = o
 * preço do serviço). Local fora da lista = serviço não oferecido ali.
 */
export async function setServiceLocations(
  db: DbClient,
  clinicId: string,
  serviceId: string,
  locations: ServiceLocationPrice[],
): Promise<Service> {
  const v = new Validation();
  for (const { priceCents } of locations) {
    v.check(priceCents === null || isNonNegativeInt(priceCents), "priceCents", "Valor inválido");
  }
  v.check(new Set(locations.map((l) => l.locationId)).size === locations.length, "locationId", "Local repetido");
  v.throwIfInvalid("Locais do serviço");

  const current = await getService(db, clinicId, serviceId);
  if (locations.length) {
    // Todas as colunas em todas as linhas (cuidado da F2.5 com insert de várias linhas).
    unwrap(
      await db.from("service_locations").upsert(
        locations.map(({ locationId, priceCents }) => ({
          clinic_id: clinicId,
          service_id: serviceId,
          location_id: locationId,
          price_cents: priceCents,
        })),
        { onConflict: "service_id,location_id" },
      ),
      "Locais do serviço",
    );
  }
  const toRemove = current.locations.map((l) => l.locationId).filter((id) => !locations.some((l) => l.locationId === id));
  if (toRemove.length) {
    unwrap(
      await db.from("service_locations").delete().eq("clinic_id", clinicId).eq("service_id", serviceId).in("location_id", toRemove),
      "Locais do serviço",
    );
  }
  return getService(db, clinicId, serviceId);
}

/** Preço do serviço num local: o próprio do local, senão o do serviço; null se não é oferecido ali. */
export function servicePriceAt(service: Pick<Service, "priceCents" | "locations">, locationId: string): number | null {
  const link = service.locations.find((l) => l.locationId === locationId);
  if (!link) return null;
  return link.priceCents ?? service.priceCents;
}
