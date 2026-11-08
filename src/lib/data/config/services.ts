import type { PreparationFile } from "./preparationFile";
import { MAX_PREPARATION_LENGTH, normalizeMultilineText } from "../../whatsappFormat";
import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { cleanText, unwrap, unwrapOne, Validation } from "../errors";

// Serviços (D4c): consulta, retorno e exame, oferecidos em um ou mais locais,
// com preço próprio opcional por local. Saem por desativação (têm atendimentos
// ligados). Serviços por profissional (MS, 07/nov/2026): cada serviço tem um
// dono, um profissional ou a equipe (exames), que não muda depois de escolhido;
// o banco liga o serviço à agenda do dono (service_agendas).

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
  /** Só Exame: arquivo com as orientações, enviado depois do preparo (C7). */
  preparationFile: PreparationFile | null;
  isActive: boolean;
  /** Dono (MS): o profissional; null com isTeam = serviço da equipe; os dois vazios = sem dono (desativado). */
  professionalId: string | null;
  isTeam: boolean;
  agendaIds: string[];
  locations: ServiceLocationPrice[];
};

/** Dono do serviço (MS): um profissional ou a equipe (só exame). */
export type ServiceOwner = { professionalId: string } | { team: true };

export type ServiceInput = Omit<Service, "id" | "isActive" | "agendaIds" | "locations" | "preparationFile" | "professionalId" | "isTeam">;

export const hasOwner = (s: Pick<Service, "professionalId" | "isTeam">) => s.isTeam || s.professionalId !== null;

/** Valor do campo "Profissional" do formulário: o id do profissional ou "equipe". */
export const TEAM_OWNER = "equipe";
export function parseOwner(value: string | null | undefined): ServiceOwner | null {
  if (!value) return null;
  return value === TEAM_OWNER ? { team: true } : { professionalId: value };
}
const ownerColumns = (owner: ServiceOwner) =>
  "team" in owner ? { professional_id: null, is_team: true } : { professional_id: owner.professionalId, is_team: false };

const COLUMNS =
  "id, name, category, duration_minutes, price_cents, return_deadline_days, preparation_instructions, preparation_file_path, preparation_file_name, preparation_file_type, preparation_file_size, scheduling_mode, is_active, professional_id, is_team, service_agendas ( agenda_id ), service_locations ( location_id, price_cents )";
const CATEGORIES: ServiceCategory[] = ["consultation", "return_visit", "exam"];

type Row = {
  id: string;
  name: string;
  category: ServiceCategory;
  duration_minutes: number;
  price_cents: number;
  return_deadline_days: number | null;
  preparation_instructions: string | null;
  preparation_file_path: string | null;
  preparation_file_name: string | null;
  preparation_file_type: string | null;
  preparation_file_size: number | null;
  scheduling_mode: SchedulingMode;
  is_active: boolean;
  professional_id: string | null;
  is_team: boolean;
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
  preparationFile:
    row.preparation_file_path && row.preparation_file_name && row.preparation_file_type && row.preparation_file_size
      ? { path: row.preparation_file_path, name: row.preparation_file_name, type: row.preparation_file_type, size: row.preparation_file_size }
      : null,
  isActive: row.is_active,
  professionalId: row.professional_id,
  isTeam: row.is_team,
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
  {
    includeInactive = false,
    category,
    professionalId,
  }: { includeInactive?: boolean; category?: ServiceCategory; professionalId?: string } = {},
): Promise<Service[]> {
  let query = db.from("services").select(COLUMNS).eq("clinic_id", clinicId).order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  if (category) query = query.eq("category", category);
  if (professionalId) query = query.eq("professional_id", professionalId);
  return (unwrap(await query, "Serviços") as unknown as Row[]).map(toService);
}

/** Só o necessário para a cor de cada serviço (inclusive os desativados). */
export async function listServiceRefs(db: DbClient, clinicId: string): Promise<{ id: string; category: ServiceCategory; createdAt: string }[]> {
  const rows = unwrap(await db.from("services").select("id, category, created_at").eq("clinic_id", clinicId), "Serviços") as unknown as {
    id: string;
    category: ServiceCategory;
    created_at: string;
  }[];
  return rows.map((r) => ({ id: r.id, category: r.category, createdAt: r.created_at }));
}

export async function getService(db: DbClient, clinicId: string, id: string): Promise<Service> {
  return toService(
    unwrapOne(await db.from("services").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Serviço") as unknown as Row,
  );
}

export function validateOwner(owner: ServiceOwner | null, category: ServiceCategory) {
  const v = new Validation();
  v.check(owner !== null, "owner", "Escolha o profissional do serviço");
  v.check(!owner || !("team" in owner) || category === "exam", "owner", "A equipe só atende exames");
  v.throwIfInvalid("Serviço");
  return ownerColumns(owner!);
}

export async function createService(db: DbClient, clinicId: string, input: ServiceInput, owner: ServiceOwner | null): Promise<Service> {
  const row = validateService(input);
  const created = await db
    .from("services")
    .insert({ clinic_id: clinicId, ...row, ...validateOwner(owner, row.category) })
    .select("id")
    .single();
  const { id } = unwrap(created, "Serviço");
  return getService(db, clinicId, id);
}

/**
 * A categoria e o dono não mudam depois de criado (atendimentos e regras
 * dependem deles). Exceção: o serviço sem dono (desativado na MS) ganha um.
 */
export async function updateService(
  db: DbClient,
  clinicId: string,
  id: string,
  input: Omit<ServiceInput, "category">,
  owner: ServiceOwner | null = null,
): Promise<Service> {
  const current = await getService(db, clinicId, id);
  const { category: _category, ...row } = validateService({ ...input, category: current.category });
  const ownerRow = hasOwner(current) ? {} : validateOwner(owner, current.category);
  unwrapOne(
    await db.from("services").update({ ...row, ...ownerRow }).eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(),
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

/**
 * Locais em que o serviço é oferecido, com preço próprio opcional (null = o
 * preço do serviço). Local fora da lista = serviço não oferecido ali. `keep`:
 * locais que ficam como estão, nem gravados nem tirados (ex.: domiciliar com
 * o item desligado na matriz, D11; religar o item traz de volta).
 */
export async function setServiceLocations(
  db: DbClient,
  clinicId: string,
  serviceId: string,
  locations: ServiceLocationPrice[],
  { keep = [] }: { keep?: string[] } = {},
): Promise<Service> {
  locations = locations.filter((l) => !keep.includes(l.locationId));
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
  const toRemove = current.locations
    .map((l) => l.locationId)
    .filter((id) => !keep.includes(id) && !locations.some((l) => l.locationId === id));
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
