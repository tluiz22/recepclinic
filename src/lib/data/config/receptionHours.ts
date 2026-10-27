import type { Json } from "../../supabase/database.types";
import { suggestReceptionHours, validateReceptionHours, type ReceptionHours } from "../../receptionHours";
import type { DbClient } from "../clients";
import { DataError, unwrap, unwrapOne } from "../errors";

// Horário da recepção (F8.5b): o salvo em Configurações › Clínica ou, enquanto
// a clínica não salva, o sugerido pelos horários das agendas.

export type ReceptionHoursSetting = {
  hours: ReceptionHours;
  /** false = ainda é a sugestão das agendas. */
  saved: boolean;
};

const isDay = (value: unknown): value is { open: string; close: string } =>
  !!value && typeof value === "object" && typeof (value as { open?: unknown }).open === "string" && typeof (value as { close?: unknown }).close === "string";

export async function getReceptionHours(db: DbClient, clinicId: string): Promise<ReceptionHoursSetting> {
  const settings = unwrapOne(
    await db.from("clinic_settings").select("reception_hours").eq("clinic_id", clinicId).maybeSingle(),
    "Horário da recepção",
  );
  const stored = settings.reception_hours;
  if (Array.isArray(stored) && stored.length === 7) {
    return { hours: stored.map((day) => (isDay(day) ? { open: day.open, close: day.close } : null)), saved: true };
  }
  const windows = unwrap(
    await db.from("availability_windows").select("weekday, start_time, end_time").eq("clinic_id", clinicId).eq("is_active", true),
    "Horário da recepção",
  );
  return { hours: suggestReceptionHours(windows.map((w) => ({ weekday: w.weekday, startTime: w.start_time, endTime: w.end_time }))), saved: false };
}

/** Grava os 7 dias (Administrador; o banco confere o papel). Erros por dia em `abre_<n>` (o campo da abertura). */
export async function saveReceptionHours(db: DbClient, clinicId: string, hours: ReceptionHours): Promise<void> {
  const errors = validateReceptionHours(hours);
  if (Object.keys(errors).length > 0) {
    const fields = Object.fromEntries(Object.entries(errors).map(([day, message]) => [`abre_${day}`, message]));
    throw new DataError("invalid", "Horário da recepção: confira os dias marcados", fields);
  }
  unwrapOne(
    await db
      .from("clinic_settings")
      .update({ reception_hours: hours as unknown as Json })
      .eq("clinic_id", clinicId)
      .select("clinic_id")
      .maybeSingle(),
    "Horário da recepção",
  );
}
