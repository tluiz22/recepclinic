import { CertificateError, MAX_CERTIFICATE_BYTES, readCertificate } from "../certificate";
import { formatCnpj, normalizeCnpj } from "../cnpj";
import { FISCAL_TERMS_VERSION } from "../fiscalTerms";
import type { DbClient } from "./clients";
import { cleanText, DataError, fromDbError, unwrap, Validation } from "./errors";

// Dados fiscais da clínica e certificado A1 (F11.3, cliente, 12/out/2026), no
// Módulo financeiro. Dados fiscais e códigos por serviço: o Administrador e o
// Suporte gravam. Certificado: só o Administrador da clínica envia, troca e
// revoga, aceitando o termo; o arquivo e a senha vão para o Vault e nunca
// voltam (a tela mostra titular, CNPJ e validade). O banco confere o CNPJ do
// certificado contra o dos dados fiscais.

/** Municípios liberados (o banco tem a mesma lista: app.is_supported_fiscal_municipality). */
export const FISCAL_MUNICIPALITIES = [{ ibge: "2408003", name: "Mossoró", state: "RN" }] as const;

export const SIMPLES_NACIONAL_OPTIONS = [
  { value: "me_epp", label: "Optante: microempresa ou empresa de pequeno porte (ME/EPP)" },
  { value: "mei", label: "Optante: microempreendedor individual (MEI)" },
  { value: "not_optant", label: "Não optante (Lucro Presumido ou Real)" },
] as const;

export const SPECIAL_REGIME_OPTIONS = [
  { value: "none", label: "Nenhum" },
  { value: "professional_society", label: "Sociedade de profissionais" },
  { value: "autonomous", label: "Profissional autônomo" },
  { value: "cooperative", label: "Ato cooperado" },
  { value: "estimate", label: "Estimativa" },
  { value: "municipal_micro", label: "Microempresa municipal" },
] as const;

/** Regime de apuração do Simples (ME/EPP), exigido pela nota nacional (F11.4). */
export const SIMPLES_REGIME_OPTIONS = [
  { value: "1", label: "Tributos federais e ISS pelo Simples Nacional" },
  { value: "2", label: "Federais pelo Simples; ISS fora dele (sublimite ultrapassado)" },
  { value: "3", label: "Federais e ISS fora do Simples (limite ultrapassado)" },
] as const;

export const ENVIRONMENT_LABEL = {
  restricted: "Produção Restrita (testes, sem valor fiscal)",
  production: "Produção (notas de verdade)",
  simulation: "Simulação (a nota sai do próprio RecepClinic, sem a Receita; só no staging)",
} as const;

export type SimplesNacional = (typeof SIMPLES_NACIONAL_OPTIONS)[number]["value"];
export type SimplesRegime = (typeof SIMPLES_REGIME_OPTIONS)[number]["value"];
export type FiscalEnvironment = keyof typeof ENVIRONMENT_LABEL;
export type SpecialRegime = (typeof SPECIAL_REGIME_OPTIONS)[number]["value"];

export type FiscalSettings = {
  cnpj: string;
  legalName: string;
  municipalRegistration: string | null;
  municipalityIbge: string;
  simplesNacional: SimplesNacional;
  /** Só ME/EPP: regime de apuração e percentual aproximado de tributos do Simples. */
  simplesRegime: SimplesRegime | null;
  simplesTotalRate: number | null;
  specialRegime: SpecialRegime;
  /** Produção Restrita (testes) até o Suporte passar para Produção (F11.4). */
  environment: FiscalEnvironment;
  /** Código de tributação nacional, "04.01.01". */
  serviceCode: string;
  /** Percentual, 0 a 5. */
  issRate: number;
};

export const FISCAL_MESSAGES = {
  cnpj: "CNPJ inválido: confira os 14 caracteres.",
  legalName: "Informe a razão social.",
  municipalRegistration: "Inscrição municipal: só números, letras, ponto, barra ou hífen (até 20).",
  municipality: "Escolha o município.",
  simplesNacional: "Escolha a situação no Simples Nacional.",
  specialRegime: "Escolha o regime especial.",
  serviceCode: "Código do serviço no formato 04.01.01 (item, subitem e desdobro da lista nacional).",
  issRate: "Alíquota do ISS: de 0 a 5%, com até duas casas (ex.: 2 ou 2,5).",
  simplesRegime: "ME/EPP: escolha o regime de apuração do Simples.",
  simplesTotalRate: "ME/EPP: informe o percentual aproximado de tributos do Simples (ex.: 6 ou 11,2).",
  terms: "Para enviar o certificado, leia e aceite o termo de autorização.",
  file: "Escolha o arquivo do certificado (.pfx ou .p12).",
  fileSize: "O arquivo é grande demais para um certificado A1.",
  password: "Informe a senha do certificado.",
  notCnpj: "Este certificado não traz CNPJ: envie o e-CNPJ (A1) da clínica.",
} as const;

const SERVICE_CODE = /^\d{2}\.\d{2}\.\d{2}$/;

/** "04.01.01" ou "040101" → "04.01.01"; outro formato = null. */
export function normalizeServiceCode(input: string | null | undefined): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  if (digits.length !== 6) return null;
  const code = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}`;
  return SERVICE_CODE.test(code) ? code : null;
}

/** "2", "2,5" ou "2.50" → 2.5; inválido ou fora de 0 a 5 = NaN. */
export function parseIssRate(input: string | null | undefined): number {
  const text = (input ?? "").trim().replace("%", "").replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return Number.NaN;
  const rate = Number(text);
  return rate >= 0 && rate <= 5 ? rate : Number.NaN;
}

/** "6", "11,2" ou "11.20" → 11.2; inválido ou fora de 0 a 99,99 = NaN. */
export function parsePercent(input: string | null | undefined): number {
  const text = (input ?? "").trim().replace("%", "").replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return Number.NaN;
  return Number(text);
}

/** Troca o ambiente da nota (só o Suporte; o banco confere e põe na trilha). */
export async function setFiscalEnvironment(db: DbClient, clinicId: string, environment: string, { simulationEnabled = false }: { simulationEnabled?: boolean } = {}): Promise<void> {
  if (!(environment in ENVIRONMENT_LABEL)) throw new DataError("invalid", "Ambiente: escolha um válido", { environment: "Ambiente inválido." });
  if (environment === "simulation" && !simulationEnabled) {
    throw new DataError("invalid", "Ambiente: a simulação só existe no staging", { environment: "A simulação só existe no staging (NFSE_SIMULATION=1)." });
  }
  const { data, error } = await db.from("clinic_fiscal_settings").update({ environment }).eq("clinic_id", clinicId).select("clinic_id");
  if (error) throw fromDbError(error, "Ambiente");
  if (!data?.length) throw new DataError("invalid", "Ambiente: salve antes os dados fiscais", { environment: "Salve antes os dados fiscais." });
}

type SettingsRow = {
  cnpj: string;
  legal_name: string;
  municipal_registration: string | null;
  municipality_ibge: string;
  simples_nacional: string;
  simples_regime: string | null;
  simples_total_rate: number | null;
  environment: string;
  special_regime: string;
  service_code: string;
  iss_rate: number;
};

export async function getFiscalSettings(db: DbClient, clinicId: string): Promise<FiscalSettings | null> {
  const row = unwrap(
    await db
      .from("clinic_fiscal_settings")
      .select("cnpj, legal_name, municipal_registration, municipality_ibge, simples_nacional, simples_regime, simples_total_rate, environment, special_regime, service_code, iss_rate")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    "Dados fiscais",
  ) as SettingsRow | null;
  if (!row) return null;
  return {
    cnpj: row.cnpj,
    legalName: row.legal_name,
    municipalRegistration: row.municipal_registration,
    municipalityIbge: row.municipality_ibge,
    simplesNacional: row.simples_nacional as SimplesNacional,
    simplesRegime: row.simples_regime as SimplesRegime | null,
    simplesTotalRate: row.simples_total_rate === null ? null : Number(row.simples_total_rate),
    specialRegime: row.special_regime as SpecialRegime,
    environment: row.environment as FiscalEnvironment,
    serviceCode: row.service_code,
    issRate: Number(row.iss_rate),
  };
}

export type FiscalSettingsInput = {
  cnpj: string;
  legalName: string;
  municipalRegistration?: string | null;
  municipalityIbge: string;
  simplesNacional: string;
  simplesRegime?: string | null;
  simplesTotalRate?: string | null;
  specialRegime: string;
  serviceCode: string;
  issRate: string;
};

export async function saveFiscalSettings(db: DbClient, clinicId: string, input: FiscalSettingsInput): Promise<void> {
  const v = new Validation();
  const cnpj = normalizeCnpj(input.cnpj);
  v.check(cnpj !== null, "cnpj", FISCAL_MESSAGES.cnpj);
  const legalName = cleanText(input.legalName);
  v.check(legalName !== null, "legal_name", FISCAL_MESSAGES.legalName);
  const registration = cleanText(input.municipalRegistration);
  v.check(registration === null || /^[0-9A-Za-z./-]{1,20}$/.test(registration), "municipal_registration", FISCAL_MESSAGES.municipalRegistration);
  v.check(FISCAL_MUNICIPALITIES.some((m) => m.ibge === input.municipalityIbge), "municipality_ibge", FISCAL_MESSAGES.municipality);
  v.check(SIMPLES_NACIONAL_OPTIONS.some((o) => o.value === input.simplesNacional), "simples_nacional", FISCAL_MESSAGES.simplesNacional);
  v.check(SPECIAL_REGIME_OPTIONS.some((o) => o.value === input.specialRegime), "special_regime", FISCAL_MESSAGES.specialRegime);
  const serviceCode = normalizeServiceCode(input.serviceCode);
  v.check(serviceCode !== null, "service_code", FISCAL_MESSAGES.serviceCode);
  const issRate = parseIssRate(input.issRate);
  v.check(Number.isFinite(issRate), "iss_rate", FISCAL_MESSAGES.issRate);
  const meEpp = input.simplesNacional === "me_epp";
  const simplesRegime = meEpp ? (SIMPLES_REGIME_OPTIONS.find((o) => o.value === input.simplesRegime)?.value ?? null) : null;
  v.check(!meEpp || simplesRegime !== null, "simples_regime", FISCAL_MESSAGES.simplesRegime);
  const simplesTotalRate = meEpp ? parsePercent(input.simplesTotalRate) : null;
  v.check(!meEpp || Number.isFinite(simplesTotalRate), "simples_total_rate", FISCAL_MESSAGES.simplesTotalRate);
  v.throwIfInvalid("Dados fiscais");

  unwrap(
    await db.from("clinic_fiscal_settings").upsert(
      {
        clinic_id: clinicId,
        cnpj: cnpj!,
        legal_name: legalName!,
        municipal_registration: registration,
        municipality_ibge: input.municipalityIbge,
        simples_nacional: input.simplesNacional,
        simples_regime: simplesRegime,
        simples_total_rate: simplesTotalRate,
        special_regime: input.specialRegime,
        service_code: serviceCode!,
        iss_rate: issRate,
      },
      { onConflict: "clinic_id" },
    ),
    "Dados fiscais",
  );
}

/** Códigos próprios dos serviços (sem linha = o da clínica). */
export async function listServiceFiscalCodes(db: DbClient, clinicId: string): Promise<Map<string, string>> {
  const rows = unwrap(await db.from("service_fiscal_codes").select("service_id, service_code").eq("clinic_id", clinicId), "Códigos dos serviços") as {
    service_id: string;
    service_code: string;
  }[];
  return new Map(rows.map((row) => [row.service_id, row.service_code]));
}

/** Grava os códigos próprios: vazio volta para o código da clínica. */
export async function saveServiceFiscalCodes(db: DbClient, clinicId: string, entries: { serviceId: string; code: string | null }[]): Promise<void> {
  const v = new Validation();
  const parsed = entries.map((entry) => {
    const text = cleanText(entry.code);
    const code = text ? normalizeServiceCode(text) : null;
    v.check(!text || code !== null, `code_${entry.serviceId}`, FISCAL_MESSAGES.serviceCode);
    return { serviceId: entry.serviceId, code };
  });
  v.throwIfInvalid("Códigos dos serviços");
  const clear = parsed.filter((p) => p.code === null).map((p) => p.serviceId);
  const set = parsed.filter((p) => p.code !== null);
  if (clear.length) unwrap(await db.from("service_fiscal_codes").delete().eq("clinic_id", clinicId).in("service_id", clear), "Códigos dos serviços");
  if (set.length) {
    unwrap(
      await db
        .from("service_fiscal_codes")
        .upsert(set.map((p) => ({ clinic_id: clinicId, service_id: p.serviceId, service_code: p.code! })), { onConflict: "service_id" }),
      "Códigos dos serviços",
    );
  }
}

export type FiscalCertificate = {
  subjectName: string;
  subjectCnpj: string;
  validFrom: Date;
  validUntil: Date;
  termsVersion: string;
  uploadedAt: Date;
};

export async function getFiscalCertificate(db: DbClient, clinicId: string): Promise<FiscalCertificate | null> {
  const row = unwrap(
    await db
      .from("clinic_fiscal_certificates")
      .select("subject_name, subject_cnpj, valid_from, valid_until, terms_version, uploaded_at")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    "Certificado",
  ) as { subject_name: string; subject_cnpj: string; valid_from: string; valid_until: string; terms_version: string; uploaded_at: string } | null;
  if (!row) return null;
  return {
    subjectName: row.subject_name,
    subjectCnpj: row.subject_cnpj,
    validFrom: new Date(row.valid_from),
    validUntil: new Date(row.valid_until),
    termsVersion: row.terms_version,
    uploadedAt: new Date(row.uploaded_at),
  };
}

export type CertificateUpload = {
  /** Conteúdo do .pfx (null = nenhum arquivo escolhido). */
  pfx: Uint8Array | null;
  password: string;
  acceptedTerms: boolean;
};

/**
 * Envia (ou troca) o certificado: abre o .pfx com a senha, lê titular, CNPJ e
 * validade e manda tudo ao banco, que confere o CNPJ e guarda no Vault.
 */
export async function uploadFiscalCertificate(db: DbClient, clinicId: string, upload: CertificateUpload): Promise<FiscalCertificate> {
  const v = new Validation();
  v.check(upload.acceptedTerms, "terms", FISCAL_MESSAGES.terms);
  v.check(upload.pfx !== null && upload.pfx.length > 0, "pfx", FISCAL_MESSAGES.file);
  v.check(upload.pfx === null || upload.pfx.length <= MAX_CERTIFICATE_BYTES, "pfx", FISCAL_MESSAGES.fileSize);
  v.check(upload.password.length > 0, "password", FISCAL_MESSAGES.password);
  v.throwIfInvalid("Certificado");

  let info;
  try {
    info = readCertificate(upload.pfx!, upload.password);
  } catch (error) {
    if (error instanceof CertificateError) throw new DataError("invalid", `Certificado: ${error.message}`, { pfx: error.message });
    throw error;
  }
  if (!info.cnpj) throw new DataError("invalid", `Certificado: ${FISCAL_MESSAGES.notCnpj}`, { pfx: FISCAL_MESSAGES.notCnpj });

  const { error } = await db.rpc("set_fiscal_certificate", {
    p_clinic_id: clinicId,
    p_pfx_base64: Buffer.from(upload.pfx!).toString("base64"),
    p_password: upload.password,
    p_subject_name: info.subjectName,
    p_subject_cnpj: info.cnpj,
    p_valid_from: info.validFrom.toISOString(),
    p_valid_until: info.validUntil.toISOString(),
    p_terms_version: FISCAL_TERMS_VERSION,
  });
  if (error) {
    // O CNPJ do certificado vai formatado, para a pessoa conferir.
    const message = error.message?.replace(/\(([0-9A-Z]{14})\)/, (_, cnpj: string) => `(${formatCnpj(cnpj)})`);
    throw fromDbError({ ...error, message }, "Certificado");
  }
  const saved = await getFiscalCertificate(db, clinicId);
  if (!saved) throw new DataError("unexpected", "Certificado: não gravado");
  return saved;
}

/** Revoga: o certificado e a senha saem do Vault e a emissão desliga na hora. */
export async function revokeFiscalCertificate(db: DbClient, clinicId: string): Promise<void> {
  const { error } = await db.rpc("revoke_fiscal_certificate", { p_clinic_id: clinicId });
  if (error) throw fromDbError(error, "Certificado");
}

export type FiscalAuditEvent =
  | "terms_accepted"
  | "certificate_uploaded"
  | "certificate_replaced"
  | "certificate_revoked"
  | "dmed_generated"
  | "environment_changed"
  | "nfse_issue_requested"
  | "nfse_issued"
  | "nfse_rejected"
  | "nfse_cancel_requested"
  | "nfse_canceled"
  | "nfse_cancel_rejected";

export const FISCAL_AUDIT_LABEL: Record<FiscalAuditEvent, string> = {
  terms_accepted: "Termo de autorização aceito",
  certificate_uploaded: "Certificado enviado",
  certificate_replaced: "Certificado trocado",
  certificate_revoked: "Certificado revogado",
  dmed_generated: "Arquivo da DMED gerado",
  environment_changed: "Ambiente da Receita trocado",
  nfse_issue_requested: "Emissão de nota pedida",
  nfse_issued: "Nota emitida",
  nfse_rejected: "Nota recusada pela Receita",
  nfse_cancel_requested: "Cancelamento de nota pedido",
  nfse_canceled: "Nota cancelada",
  nfse_cancel_rejected: "Cancelamento recusado pela Receita",
};

export type FiscalAuditEntry = { event: FiscalAuditEvent; actorId: string | null; createdAt: Date; details: Record<string, unknown> };

export async function listFiscalAudit(db: DbClient, clinicId: string, limit = 20): Promise<FiscalAuditEntry[]> {
  const rows = unwrap(
    await db.from("fiscal_audit_log").select("event, actor_id, details, created_at").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(limit),
    "Trilha do certificado",
  ) as { event: string; actor_id: string | null; details: Record<string, unknown>; created_at: string }[];
  return rows.map((row) => ({ event: row.event as FiscalAuditEvent, actorId: row.actor_id, createdAt: new Date(row.created_at), details: row.details }));
}
