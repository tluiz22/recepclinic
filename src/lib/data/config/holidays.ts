import { isCalendarDate } from "../../clinicTime";
import type { DbClient } from "../clients";
import { cleanText, DataError, unwrap, unwrapOne, Validation } from "../errors";

// Feriados extras da clínica (municipais, estaduais, recesso), somados aos
// nacionais de src/lib/holidays.ts. Um por data.

export type ClinicHoliday = { id: string; date: string; description: string };

const COLUMNS = "id, date, description";

/** Feriados a partir de `fromDate` (inclusive), em ordem de data. */
export async function listClinicHolidays(db: DbClient, clinicId: string, fromDate?: string): Promise<ClinicHoliday[]> {
  let query = db.from("clinic_holidays").select(COLUMNS).eq("clinic_id", clinicId).order("date");
  if (fromDate) query = query.gte("date", fromDate);
  return unwrap(await query, "Feriados");
}

export async function addClinicHoliday(
  db: DbClient,
  clinicId: string,
  input: { date: string; description: string },
): Promise<ClinicHoliday> {
  const v = new Validation();
  const description = cleanText(input.description) ?? "";
  v.check(isCalendarDate(input.date), "date", "Data inválida");
  v.check(description.length > 0, "description", "Informe a descrição");
  v.throwIfInvalid("Feriado");
  const result = await db.from("clinic_holidays").insert({ clinic_id: clinicId, date: input.date, description }).select(COLUMNS).single();
  if (result.error?.code === "23505") throw new DataError("duplicate", "Feriado: já existe um feriado nessa data", { date: "Já existe um feriado nessa data." });
  return unwrap(result, "Feriado");
}

export async function removeClinicHoliday(db: DbClient, clinicId: string, id: string): Promise<void> {
  unwrapOne(await db.from("clinic_holidays").delete().eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(), "Feriado");
}
