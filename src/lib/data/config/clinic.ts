import { isValidTimeZone } from "../../clinicTime";
import type { Enums, TablesUpdate } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { cleanText, unwrapOne, Validation } from "../errors";

// Perfil e identidade da clínica (D4b): `clinics` + `clinic_settings`.
// Leitura: qualquer membro. Alteração: Administrador (RLS).

export type ClinicProfile = Enums<"clinic_profile">;

export type ClinicSettings = {
  clinicId: string;
  name: string;
  profile: ClinicProfile;
  timezone: string;
  /** Idade a partir da qual não marca Consulta (só Retorno/Exame); null = desligada. */
  consultationAgeLimitYears: number | null;
  /** Hora do lembrete da véspera (7–20, no fuso da clínica). */
  reminderHour: number;
  botPaymentInfo: string | null;
  botInsuranceInfo: string | null;
  botNotes: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  /** Pedir carteirinha e validade na marcação por plano (D10). */
  requireInsuranceDetails: boolean;
};

export type ClinicSettingsPatch = Partial<Omit<ClinicSettings, "clinicId">>;

export const CLINIC_PROFILES: ClinicProfile[] = ["pediatric", "adult", "mixed"];

/** Hora do lembrete: horas cheias das 7h às 20h, como no piloto (cliente, 05/out/2026). */
export const REMINDER_HOUR_MIN = 7;
export const REMINDER_HOUR_MAX = 20;

const SETTINGS_COLUMNS =
  "clinic_id, profile, timezone, consultation_age_limit_years, reminder_hour, bot_payment_info, bot_insurance_info, bot_notes, logo_url, brand_color, require_insurance_details";

export async function getClinicSettings(db: DbClient, clinicId: string): Promise<ClinicSettings> {
  const [clinic, settings] = await Promise.all([
    db.from("clinics").select("name").eq("id", clinicId).maybeSingle().then((r) => unwrapOne(r, "Clínica")),
    db
      .from("clinic_settings")
      .select(SETTINGS_COLUMNS)
      .eq("clinic_id", clinicId)
      .maybeSingle()
      .then((r) => unwrapOne(r, "Configuração da clínica")),
  ]);
  return {
    clinicId,
    name: clinic.name,
    profile: settings.profile,
    timezone: settings.timezone,
    consultationAgeLimitYears: settings.consultation_age_limit_years,
    reminderHour: settings.reminder_hour,
    botPaymentInfo: settings.bot_payment_info,
    botInsuranceInfo: settings.bot_insurance_info,
    botNotes: settings.bot_notes,
    logoUrl: settings.logo_url,
    brandColor: settings.brand_color,
    requireInsuranceDetails: settings.require_insurance_details,
  };
}

/** Valida e normaliza a alteração (textos sem espaços nas pontas; vazio = null). */
export function validateClinicSettingsPatch(patch: ClinicSettingsPatch): ClinicSettingsPatch {
  const v = new Validation();
  const out: ClinicSettingsPatch = { ...patch };

  if ("name" in patch) {
    out.name = cleanText(patch.name) ?? "";
    v.check(out.name.length > 0, "name", "Informe o nome da clínica");
  }
  if ("profile" in patch) v.check(CLINIC_PROFILES.includes(patch.profile!), "profile", "Perfil inválido");
  if ("timezone" in patch) v.check(isValidTimeZone(patch.timezone ?? ""), "timezone", "Fuso horário inválido");
  if ("consultationAgeLimitYears" in patch && patch.consultationAgeLimitYears !== null) {
    const age = patch.consultationAgeLimitYears!;
    v.check(Number.isInteger(age) && age > 0, "consultationAgeLimitYears", "Idade limite em anos inteiros, maior que 0");
  }
  if ("reminderHour" in patch) {
    const hour = patch.reminderHour!;
    v.check(
      Number.isInteger(hour) && hour >= REMINDER_HOUR_MIN && hour <= REMINDER_HOUR_MAX,
      "reminderHour",
      `Hora do lembrete das ${REMINDER_HOUR_MIN}h às ${REMINDER_HOUR_MAX}h`,
    );
  }
  for (const field of ["botPaymentInfo", "botInsuranceInfo", "botNotes"] as const) {
    if (field in patch) out[field] = cleanText(patch[field]);
  }
  if ("logoUrl" in patch) out.logoUrl = cleanText(patch.logoUrl);
  if ("brandColor" in patch) {
    out.brandColor = cleanText(patch.brandColor)?.toUpperCase() ?? null;
    v.check(out.brandColor === null || /^#[0-9A-F]{6}$/.test(out.brandColor), "brandColor", "Cor no formato #RRGGBB");
  }

  v.throwIfInvalid("Configuração da clínica");
  return out;
}

export async function updateClinicSettings(
  db: DbClient,
  clinicId: string,
  patch: ClinicSettingsPatch,
): Promise<ClinicSettings> {
  const clean = validateClinicSettingsPatch(patch);

  if (clean.name !== undefined) {
    unwrapOne(
      await db.from("clinics").update({ name: clean.name }).eq("id", clinicId).select("id").maybeSingle(),
      "Clínica",
    );
  }

  const row: Record<string, unknown> = {};
  const map: [keyof ClinicSettingsPatch, keyof TablesUpdate<"clinic_settings">][] = [
    ["profile", "profile"],
    ["timezone", "timezone"],
    ["consultationAgeLimitYears", "consultation_age_limit_years"],
    ["reminderHour", "reminder_hour"],
    ["botPaymentInfo", "bot_payment_info"],
    ["botInsuranceInfo", "bot_insurance_info"],
    ["botNotes", "bot_notes"],
    ["logoUrl", "logo_url"],
    ["brandColor", "brand_color"],
    ["requireInsuranceDetails", "require_insurance_details"],
  ];
  for (const [key, column] of map) if (key in clean) row[column] = clean[key];

  if (Object.keys(row).length) {
    unwrapOne(
      await db.from("clinic_settings").update(row as TablesUpdate<"clinic_settings">).eq("clinic_id", clinicId).select("clinic_id").maybeSingle(),
      "Configuração da clínica",
    );
  }
  return getClinicSettings(db, clinicId);
}
