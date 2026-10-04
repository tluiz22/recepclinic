import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { cleanText, unwrap, unwrapOne, Validation } from "../errors";

// Locais de atendimento: consultório (com endereço) ou domiciliar (o endereço
// vem do paciente). Saem por desativação: têm atendimentos ligados.

export type LocationType = Enums<"location_type">;

export type Location = {
  id: string;
  name: string;
  type: LocationType;
  address: string | null;
  isActive: boolean;
};

export type LocationInput = Omit<Location, "id" | "isActive">;

const COLUMNS = "id, name, type, address, is_active";

const toLocation = (row: { id: string; name: string; type: LocationType; address: string | null; is_active: boolean }): Location => ({
  id: row.id,
  name: row.name,
  type: row.type,
  address: row.address,
  isActive: row.is_active,
});

export function validateLocation(input: LocationInput) {
  const v = new Validation();
  const row = { name: cleanText(input.name) ?? "", type: input.type, address: cleanText(input.address) };
  v.check(row.name.length > 0, "name", "Informe o nome do local");
  v.check(row.type === "clinic" || row.type === "home_visit", "type", "Tipo de local inválido");
  v.throwIfInvalid("Local");
  return row;
}

export async function listLocations(
  db: DbClient,
  clinicId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<Location[]> {
  let query = db.from("locations").select(COLUMNS).eq("clinic_id", clinicId).order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  return unwrap(await query, "Locais").map(toLocation);
}

export async function createLocation(db: DbClient, clinicId: string, input: LocationInput): Promise<Location> {
  const row = validateLocation(input);
  return toLocation(unwrap(await db.from("locations").insert({ clinic_id: clinicId, ...row }).select(COLUMNS).single(), "Local"));
}

export async function updateLocation(db: DbClient, clinicId: string, id: string, input: LocationInput): Promise<Location> {
  const row = validateLocation(input);
  return toLocation(
    unwrapOne(await db.from("locations").update(row).eq("clinic_id", clinicId).eq("id", id).select(COLUMNS).maybeSingle(), "Local"),
  );
}

export async function setLocationActive(db: DbClient, clinicId: string, id: string, isActive: boolean): Promise<void> {
  unwrapOne(
    await db.from("locations").update({ is_active: isActive }).eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(),
    "Local",
  );
}
