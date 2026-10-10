import { isValidTimeZone } from "../../clinicTime";
import type { Enums, TablesUpdate } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { cleanText, unwrapOne, Validation } from "../errors";
import { BOT_LIMIT_RANGES } from "../whatsapp/botLimits";
import { MESSAGE_ARTICLES, type MessageArticle } from "../whatsapp/templates";

// Perfil e identidade da clínica (D4b): `clinics` + `clinic_settings`.
// Leitura: qualquer membro. Alteração: Administrador (RLS).

export type ClinicProfile = Enums<"clinic_profile">;

export type ClinicSettings = {
  clinicId: string;
  name: string;
  /** "da" ou "do" antes do nome nas mensagens do WhatsApp ("Aqui é da Clínica Sorriso"), F6.2. */
  messageArticle: MessageArticle;
  profile: ClinicProfile;
  timezone: string;
  /** Idade a partir da qual não marca Consulta (só Retorno/Exame); null = desligada. */
  consultationAgeLimitYears: number | null;
  /**
   * Lembretes (cliente, 09/out/2026): um envio só por público, na véspera
   * ("eve") ou no dia ("same_day"), em hora cheia das 6h às 20h, no fuso da
   * clínica. Ao paciente (item "Lembrete automático").
   */
  reminderEnabled: boolean;
  reminderTiming: ReminderTiming;
  reminderHour: number;
  /** Resumo do dia de cada profissional (item "Lembrete ao profissional"). */
  professionalSummaryEnabled: boolean;
  professionalSummaryTiming: ReminderTiming;
  professionalSummaryHour: number;
  /** Resumo do dia dos outros contatos (item "Lembrete à equipe"). */
  teamSummaryEnabled: boolean;
  teamSummaryTiming: ReminderTiming;
  teamSummaryHour: number;
  /** Orientações gerais depois da marcação de uma consulta (cliente, 08/out/2026). */
  guidanceEnabled: boolean;
  botPaymentInfo: string | null;
  botInsuranceInfo: string | null;
  botNotes: string | null;
  /** Limites do contato no bot (F9.6a): atendimentos futuros (1 a 10), cadastros em 30 dias (1 a 10), faltas em 90 dias (0 desliga). */
  botMaxFutureAppointments: number;
  botMaxNewPatients: number;
  botMaxNoShows: number;
  logoUrl: string | null;
  brandColor: string | null;
  /** Site da clínica: o botão "Voltar para o site" das páginas públicas (F5). */
  websiteUrl: string | null;
  /** Pedir carteirinha e validade na marcação por plano (D10). */
  requireInsuranceDetails: boolean;
};

export type ReminderTiming = "eve" | "same_day";
export const REMINDER_TIMINGS: ReminderTiming[] = ["eve", "same_day"];

export type ClinicSettingsPatch = Partial<Omit<ClinicSettings, "clinicId">>;

export const CLINIC_PROFILES: ClinicProfile[] = ["pediatric", "adult", "mixed"];

/** Hora dos lembretes: horas cheias das 6h às 20h (cliente, 09/out/2026; antes, 7h). */
export const REMINDER_HOUR_MIN = 6;
export const REMINDER_HOUR_MAX = 20;

const WEBSITE_URL_PATTERN = /^https?:\/\/[^\s/]+\.[^\s]+$/i;

/** Site digitado sem "https://" ganha o prefixo; vazio = null. */
export function normalizeWebsiteUrl(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

const SETTINGS_COLUMNS =
  "clinic_id, profile, timezone, consultation_age_limit_years, reminder_hour, bot_payment_info, bot_insurance_info, bot_notes, logo_url, brand_color, website_url, require_insurance_details, message_article, reminder_enabled, reminder_timing, professional_summary_enabled, professional_summary_timing, professional_summary_hour, team_summary_enabled, team_summary_timing, team_summary_hour, guidance_enabled, bot_max_future_appointments, bot_max_new_patients, bot_max_no_shows";

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
    messageArticle: settings.message_article as MessageArticle,
    profile: settings.profile,
    timezone: settings.timezone,
    consultationAgeLimitYears: settings.consultation_age_limit_years,
    reminderEnabled: settings.reminder_enabled,
    reminderTiming: settings.reminder_timing as ReminderTiming,
    reminderHour: settings.reminder_hour,
    professionalSummaryEnabled: settings.professional_summary_enabled,
    professionalSummaryTiming: settings.professional_summary_timing as ReminderTiming,
    professionalSummaryHour: settings.professional_summary_hour,
    teamSummaryEnabled: settings.team_summary_enabled,
    teamSummaryTiming: settings.team_summary_timing as ReminderTiming,
    teamSummaryHour: settings.team_summary_hour,
    guidanceEnabled: settings.guidance_enabled,
    botPaymentInfo: settings.bot_payment_info,
    botInsuranceInfo: settings.bot_insurance_info,
    botNotes: settings.bot_notes,
    botMaxFutureAppointments: settings.bot_max_future_appointments,
    botMaxNewPatients: settings.bot_max_new_patients,
    botMaxNoShows: settings.bot_max_no_shows,
    logoUrl: settings.logo_url,
    brandColor: settings.brand_color,
    websiteUrl: settings.website_url,
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
  if ("messageArticle" in patch) v.check(MESSAGE_ARTICLES.includes(patch.messageArticle!), "messageArticle", "Escolha \"da\" ou \"do\"");
  if ("profile" in patch) v.check(CLINIC_PROFILES.includes(patch.profile!), "profile", "Perfil inválido");
  if ("timezone" in patch) v.check(isValidTimeZone(patch.timezone ?? ""), "timezone", "Fuso horário inválido");
  if ("consultationAgeLimitYears" in patch && patch.consultationAgeLimitYears !== null) {
    const age = patch.consultationAgeLimitYears!;
    v.check(Number.isInteger(age) && age > 0, "consultationAgeLimitYears", "Idade limite em anos inteiros, maior que 0");
  }
  for (const field of ["reminderHour", "professionalSummaryHour", "teamSummaryHour"] as const) {
    if (!(field in patch)) continue;
    const hour = patch[field]!;
    v.check(
      Number.isInteger(hour) && hour >= REMINDER_HOUR_MIN && hour <= REMINDER_HOUR_MAX,
      field,
      `Horário do lembrete das ${REMINDER_HOUR_MIN}h às ${REMINDER_HOUR_MAX}h`,
    );
  }
  for (const field of ["reminderTiming", "professionalSummaryTiming", "teamSummaryTiming"] as const) {
    if (field in patch) v.check(REMINDER_TIMINGS.includes(patch[field]!), field, "Escolha véspera ou no dia");
  }
  const limitFields = [
    ["botMaxFutureAppointments", "maxFutureAppointments", "Atendimentos futuros por contato"],
    ["botMaxNewPatients", "maxNewPatients", "Cadastros pelo bot por contato"],
    ["botMaxNoShows", "maxNoShows", "Faltas por contato"],
  ] as const;
  for (const [field, range, label] of limitFields) {
    if (!(field in patch)) continue;
    const value = patch[field]!;
    const { min, max } = BOT_LIMIT_RANGES[range];
    v.check(Number.isInteger(value) && value >= min && value <= max, field, `${label}: de ${min} a ${max}`);
  }
  for (const field of ["botPaymentInfo", "botInsuranceInfo", "botNotes"] as const) {
    if (field in patch) out[field] = cleanText(patch[field]);
  }
  if ("logoUrl" in patch) out.logoUrl = cleanText(patch.logoUrl);
  if ("brandColor" in patch) {
    out.brandColor = cleanText(patch.brandColor)?.toUpperCase() ?? null;
    v.check(out.brandColor === null || /^#[0-9A-F]{6}$/.test(out.brandColor), "brandColor", "Cor no formato #RRGGBB");
  }
  if ("websiteUrl" in patch) {
    out.websiteUrl = normalizeWebsiteUrl(patch.websiteUrl);
    v.check(
      out.websiteUrl === null || (WEBSITE_URL_PATTERN.test(out.websiteUrl) && out.websiteUrl.length <= 300),
      "websiteUrl",
      "Endereço do site inválido (ex.: www.suaclinica.com.br)",
    );
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
    ["messageArticle", "message_article"],
    ["profile", "profile"],
    ["timezone", "timezone"],
    ["consultationAgeLimitYears", "consultation_age_limit_years"],
    ["reminderHour", "reminder_hour"],
    ["reminderEnabled", "reminder_enabled"],
    ["reminderTiming", "reminder_timing"],
    ["professionalSummaryEnabled", "professional_summary_enabled"],
    ["professionalSummaryTiming", "professional_summary_timing"],
    ["professionalSummaryHour", "professional_summary_hour"],
    ["teamSummaryEnabled", "team_summary_enabled"],
    ["teamSummaryTiming", "team_summary_timing"],
    ["teamSummaryHour", "team_summary_hour"],
    ["guidanceEnabled", "guidance_enabled"],
    ["botPaymentInfo", "bot_payment_info"],
    ["botInsuranceInfo", "bot_insurance_info"],
    ["botNotes", "bot_notes"],
    ["botMaxFutureAppointments", "bot_max_future_appointments"],
    ["botMaxNewPatients", "bot_max_new_patients"],
    ["botMaxNoShows", "bot_max_no_shows"],
    ["logoUrl", "logo_url"],
    ["brandColor", "brand_color"],
    ["websiteUrl", "website_url"],
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
