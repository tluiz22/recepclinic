import { isValidTimeZone } from "../../clinicTime";
import type { Enums, TablesUpdate } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { cleanText, unwrapOne, Validation } from "../errors";
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
  /** Hora do lembrete da véspera (7–20, no fuso da clínica). */
  reminderHour: number;
  /** Lembrete automático da véspera ligado (F7; cliente, 07/out/2026). */
  reminderEnabled: boolean;
  /** Resumo da equipe na véspera: ligado e a hora (7–20). */
  summaryPreviewEnabled: boolean;
  summaryPreviewHour: number;
  /** Resumo da equipe no dia: ligado e quantas horas antes da primeira agenda (1–4). */
  summaryTodayEnabled: boolean;
  summaryTodayLeadHours: number;
  botPaymentInfo: string | null;
  botInsuranceInfo: string | null;
  botNotes: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  /** Site da clínica: o botão "Voltar para o site" das páginas públicas (F5). */
  websiteUrl: string | null;
  /** Pedir carteirinha e validade na marcação por plano (D10). */
  requireInsuranceDetails: boolean;
};

export type ClinicSettingsPatch = Partial<Omit<ClinicSettings, "clinicId">>;

export const CLINIC_PROFILES: ClinicProfile[] = ["pediatric", "adult", "mixed"];

/** Hora do lembrete: horas cheias das 7h às 20h, como no piloto (cliente, 05/out/2026). */
export const REMINDER_HOUR_MIN = 7;
export const REMINDER_HOUR_MAX = 20;
/** Resumo da equipe no dia: de 1 a 4 horas antes da primeira agenda (cliente, 07/out/2026). */
export const SUMMARY_LEAD_MIN = 1;
export const SUMMARY_LEAD_MAX = 4;

const WEBSITE_URL_PATTERN = /^https?:\/\/[^\s/]+\.[^\s]+$/i;

/** Site digitado sem "https://" ganha o prefixo; vazio = null. */
export function normalizeWebsiteUrl(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

const SETTINGS_COLUMNS =
  "clinic_id, profile, timezone, consultation_age_limit_years, reminder_hour, bot_payment_info, bot_insurance_info, bot_notes, logo_url, brand_color, website_url, require_insurance_details, message_article, reminder_enabled, summary_preview_enabled, summary_preview_hour, summary_today_enabled, summary_today_lead_hours";

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
    reminderHour: settings.reminder_hour,
    reminderEnabled: settings.reminder_enabled,
    summaryPreviewEnabled: settings.summary_preview_enabled,
    summaryPreviewHour: settings.summary_preview_hour,
    summaryTodayEnabled: settings.summary_today_enabled,
    summaryTodayLeadHours: settings.summary_today_lead_hours,
    botPaymentInfo: settings.bot_payment_info,
    botInsuranceInfo: settings.bot_insurance_info,
    botNotes: settings.bot_notes,
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
  if ("reminderHour" in patch) {
    const hour = patch.reminderHour!;
    v.check(
      Number.isInteger(hour) && hour >= REMINDER_HOUR_MIN && hour <= REMINDER_HOUR_MAX,
      "reminderHour",
      `Hora do lembrete das ${REMINDER_HOUR_MIN}h às ${REMINDER_HOUR_MAX}h`,
    );
  }
  if ("summaryPreviewHour" in patch) {
    const hour = patch.summaryPreviewHour!;
    v.check(
      Number.isInteger(hour) && hour >= REMINDER_HOUR_MIN && hour <= REMINDER_HOUR_MAX,
      "summaryPreviewHour",
      `Hora do resumo da véspera das ${REMINDER_HOUR_MIN}h às ${REMINDER_HOUR_MAX}h`,
    );
  }
  if ("summaryTodayLeadHours" in patch) {
    const lead = patch.summaryTodayLeadHours!;
    v.check(Number.isInteger(lead) && lead >= SUMMARY_LEAD_MIN && lead <= SUMMARY_LEAD_MAX, "summaryTodayLeadHours", `De ${SUMMARY_LEAD_MIN} a ${SUMMARY_LEAD_MAX} horas antes`);
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
    ["summaryPreviewEnabled", "summary_preview_enabled"],
    ["summaryPreviewHour", "summary_preview_hour"],
    ["summaryTodayEnabled", "summary_today_enabled"],
    ["summaryTodayLeadHours", "summary_today_lead_hours"],
    ["botPaymentInfo", "bot_payment_info"],
    ["botInsuranceInfo", "bot_insurance_info"],
    ["botNotes", "bot_notes"],
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
