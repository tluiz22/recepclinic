import { formatCnpj, normalizeCnpj } from "../cnpj";
import type { DbClient } from "./clients";
import { cleanText, DataError, fromDbError, unwrap, Validation } from "./errors";
import { FISCAL_MUNICIPALITIES, normalizeServiceCode, parseIssRate } from "./fiscal";

// Emissores fiscais (N2, planejamento-nfse-asaas.md seções 14 e 15): o da
// clínica e o de cada profissional com CNPJ próprio, cada um com a sua
// subconta no Asaas. N-P1: profissional sem emissor próprio emite pela
// clínica ou não emite (o Administrador escolhe). N-P2: o Administrador e o
// próprio profissional configuram o emissor dele. O banco confere tudo; aqui
// só a validação dos campos para a tela.

export type IssuerKind = "clinic" | "professional";
export type AccountStatus = "none" | "pending" | "awaiting_approval" | "approved" | "rejected";
export type FiscalInfoStatus = "pending" | "configured" | "error";
export type IssuerPayer = "clinic" | "professional";
export type ProfessionalRoute = "own" | "clinic" | "none";

export type MunicipalOptionsSnapshot = {
  authenticationType: string;
  supportsCancellation: boolean;
  usesSpecialTaxRegimes: boolean;
  specialTaxRegimesList: { label: string; value: string }[];
};

export type FiscalIssuer = {
  id: string;
  clinicId: string;
  kind: IssuerKind;
  professionalId: string | null;
  cnpj: string;
  legalName: string;
  fiscalEmail: string;
  mobilePhone: string;
  companyType: string;
  monthlyIncomeCents: number;
  postalCode: string;
  street: string;
  streetNumber: string;
  complement: string | null;
  district: string;
  municipalityIbge: string;
  municipalRegistration: string | null;
  simplesNacional: boolean;
  specialTaxRegime: string | null;
  cnae: string | null;
  serviceListItem: string | null;
  serviceCode: string | null;
  serviceName: string | null;
  nbsCode: string | null;
  issRate: number;
  pisCofinsTaxStatus: string | null;
  taxSituationCode: string | null;
  taxClassificationCode: string | null;
  operationIndicatorCode: string | null;
  rpsSeries: string | null;
  rpsNextNumber: number | null;
  environment: "sandbox" | "production";
  hasAccount: boolean;
  accountStatus: AccountStatus;
  municipalOptions: MunicipalOptionsSnapshot | null;
  fiscalInfoStatus: FiscalInfoStatus;
  fiscalInfoMessage: string | null;
  fiscalInfoSyncedAt: Date | null;
  certificateSentAt: Date | null;
  certificateValidUntil: Date | null;
  issuingEnabled: boolean;
  payer: IssuerPayer;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  updatedAt: Date;
};

const COLUMNS =
  "id, clinic_id, kind, professional_id, cnpj, legal_name, fiscal_email, mobile_phone, company_type, monthly_income_cents, postal_code, street, street_number, complement, district, municipality_ibge, municipal_registration, simples_nacional, special_tax_regime, cnae, service_list_item, service_code, service_name, nbs_code, iss_rate, pis_cofins_tax_status, tax_situation_code, tax_classification_code, operation_indicator_code, rps_series, rps_next_number, environment, asaas_account_id, account_status, municipal_options, fiscal_info_status, fiscal_info_message, fiscal_info_synced_at, certificate_sent_at, certificate_valid_until, issuing_enabled, payer, suspended_at, suspended_reason, updated_at";

type Row = {
  id: string;
  clinic_id: string;
  kind: string;
  professional_id: string | null;
  cnpj: string;
  legal_name: string;
  fiscal_email: string;
  mobile_phone: string;
  company_type: string;
  monthly_income_cents: number;
  postal_code: string;
  street: string;
  street_number: string;
  complement: string | null;
  district: string;
  municipality_ibge: string;
  municipal_registration: string | null;
  simples_nacional: boolean;
  special_tax_regime: string | null;
  cnae: string | null;
  service_list_item: string | null;
  service_code: string | null;
  service_name: string | null;
  nbs_code: string | null;
  iss_rate: number;
  pis_cofins_tax_status: string | null;
  tax_situation_code: string | null;
  tax_classification_code: string | null;
  operation_indicator_code: string | null;
  rps_series: string | null;
  rps_next_number: number | null;
  environment: string;
  asaas_account_id: string | null;
  account_status: string;
  municipal_options: unknown;
  fiscal_info_status: string;
  fiscal_info_message: string | null;
  fiscal_info_synced_at: string | null;
  certificate_sent_at: string | null;
  certificate_valid_until: string | null;
  issuing_enabled: boolean;
  payer: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  updated_at: string;
};

const date = (v: string | null) => (v ? new Date(v) : null);

export function toFiscalIssuer(row: Row): FiscalIssuer {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    kind: row.kind as IssuerKind,
    professionalId: row.professional_id,
    cnpj: row.cnpj,
    legalName: row.legal_name,
    fiscalEmail: row.fiscal_email,
    mobilePhone: row.mobile_phone,
    companyType: row.company_type,
    monthlyIncomeCents: Number(row.monthly_income_cents),
    postalCode: row.postal_code,
    street: row.street,
    streetNumber: row.street_number,
    complement: row.complement,
    district: row.district,
    municipalityIbge: row.municipality_ibge,
    municipalRegistration: row.municipal_registration,
    simplesNacional: row.simples_nacional,
    specialTaxRegime: row.special_tax_regime,
    cnae: row.cnae,
    serviceListItem: row.service_list_item,
    serviceCode: row.service_code,
    serviceName: row.service_name,
    nbsCode: row.nbs_code,
    issRate: Number(row.iss_rate),
    pisCofinsTaxStatus: row.pis_cofins_tax_status,
    taxSituationCode: row.tax_situation_code,
    taxClassificationCode: row.tax_classification_code,
    operationIndicatorCode: row.operation_indicator_code,
    rpsSeries: row.rps_series,
    rpsNextNumber: row.rps_next_number,
    environment: row.environment as FiscalIssuer["environment"],
    hasAccount: row.asaas_account_id !== null,
    accountStatus: row.account_status as AccountStatus,
    municipalOptions: (row.municipal_options as MunicipalOptionsSnapshot | null) ?? null,
    fiscalInfoStatus: row.fiscal_info_status as FiscalInfoStatus,
    fiscalInfoMessage: row.fiscal_info_message,
    fiscalInfoSyncedAt: date(row.fiscal_info_synced_at),
    certificateSentAt: date(row.certificate_sent_at),
    certificateValidUntil: date(row.certificate_valid_until),
    issuingEnabled: row.issuing_enabled,
    payer: row.payer as IssuerPayer,
    suspendedAt: date(row.suspended_at),
    suspendedReason: row.suspended_reason,
    updatedAt: new Date(row.updated_at),
  };
}

export const COMPANY_TYPES = [
  { value: "LIMITED", label: "Sociedade limitada (Ltda) ou unipessoal (SLU)" },
  { value: "INDIVIDUAL", label: "Empresário individual (EI)" },
  { value: "MEI", label: "Microempreendedor individual (MEI)" },
  { value: "ASSOCIATION", label: "Associação" },
] as const;

/** O que falta para ligar a emissão (espelho de app.fiscal_issuer_missing). */
export const MISSING_LABEL: Record<string, string> = {
  subconta: "Subconta no Asaas (o Suporte cria)",
  aprovacao: "Cadastro aprovado pelo Asaas",
  configuracao: "Configuração fiscal enviada ao Asaas",
  servico: "Código e descrição do serviço",
  certificado: "Certificado digital A1 enviado",
  pis_cofins: "Situação do PIS/COFINS (com o contador)",
  suspenso: "Emissão suspensa por falta de pagamento",
};

export function issuerMissing(i: FiscalIssuer): string[] {
  const out: string[] = [];
  if (!i.hasAccount) out.push("subconta");
  if (i.accountStatus !== "approved") out.push("aprovacao");
  if (i.fiscalInfoStatus !== "configured") out.push("configuracao");
  if (!i.serviceCode || !i.serviceName) out.push("servico");
  if ((i.municipalOptions?.authenticationType ?? "CERTIFICATE") === "CERTIFICATE" && !i.certificateSentAt) out.push("certificado");
  if (!i.simplesNacional && !i.pisCofinsTaxStatus) out.push("pis_cofins");
  if (i.suspendedAt) out.push("suspenso");
  return out;
}

/** Situação em uma palavra, para a lista. */
export function issuerState(i: FiscalIssuer): { tone: "ok" | "wait" | "todo" | "stop"; label: string } {
  if (i.suspendedAt) return { tone: "stop", label: "Suspenso" };
  if (i.issuingEnabled) return { tone: "ok", label: "Emitindo" };
  if (i.fiscalInfoStatus === "error") return { tone: "stop", label: "Recusado pelo Asaas" };
  if (!i.hasAccount) return { tone: "todo", label: "Aguardando subconta" };
  if (i.accountStatus !== "approved") return { tone: "wait", label: "Em aprovação" };
  if (issuerMissing(i).length) return { tone: "todo", label: "Configuração pendente" };
  return { tone: "wait", label: "Pronto para ligar" };
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export type IssuerInput = {
  cnpj: string;
  legalName: string;
  fiscalEmail: string;
  mobilePhone: string;
  companyType: string;
  monthlyIncome: string;
  postalCode: string;
  street: string;
  streetNumber: string;
  complement: string;
  district: string;
  municipalityIbge: string;
  municipalRegistration: string;
  simplesNacional: string;
  specialTaxRegime: string;
  cnae: string;
  serviceCode: string;
  serviceName: string;
  nbsCode: string;
  issRate: string;
  pisCofinsTaxStatus: string;
  taxSituationCode: string;
  taxClassificationCode: string;
  operationIndicatorCode: string;
  rpsSeries: string;
  rpsNextNumber: string;
};

export const ISSUER_MESSAGES = {
  cnpj: "CNPJ inválido: confira os 14 caracteres.",
  legalName: "Informe a razão social.",
  fiscalEmail: "E-mail inválido.",
  mobilePhone: "Celular com DDD (10 ou 11 dígitos).",
  companyType: "Escolha o tipo de empresa.",
  monthlyIncome: "Faturamento mensal em reais (ex.: 30000).",
  postalCode: "CEP com 8 dígitos.",
  street: "Informe a rua.",
  streetNumber: "Informe o número (ou s/n).",
  district: "Informe o bairro.",
  municipality: "Escolha o município.",
  municipalRegistration: "Inscrição municipal: só números, letras, ponto, barra ou hífen (até 20).",
  cnae: "CNAE com 7 dígitos (ex.: 8630-5/03).",
  serviceCode: "Código de tributação no formato 04.01.01.",
  serviceName: "Descreva o serviço (ex.: Medicina).",
  nbsCode: "NBS no formato 1.2301.22.00.",
  issRate: "Alíquota do ISS: de 0 a 5%, com até duas casas (ex.: 2 ou 2,5).",
  pisCofins: "Código do Asaas em maiúsculas (ex.: NONE).",
  taxSituationCode: "CST do IBS/CBS com 3 dígitos (ex.: 200).",
  taxClassificationCode: "cClassTrib com 6 dígitos (ex.: 200029).",
  operationIndicatorCode: "Indicador de operação com 6 dígitos (ex.: 030101).",
  rpsSeries: "Série: até 10 letras ou números.",
  rpsNextNumber: "Número: inteiro maior que zero.",
} as const;

/** "1230122.00", "1.2301.22.00" → "1.2301.22.00"; inválido = null. */
export function normalizeNbs(input: string): string | null {
  const d = input.replace(/\D/g, "");
  if (d.length !== 9) return null;
  return `${d[0]}.${d.slice(1, 5)}.${d.slice(5, 7)}.${d.slice(7, 9)}`;
}

/** Valida e monta o pedido para o banco (jsonb de save_fiscal_issuer). */
export function parseIssuerInput(input: IssuerInput): Record<string, string | number | boolean | null> {
  const v = new Validation();
  const cnpj = normalizeCnpj(input.cnpj);
  v.check(cnpj !== null, "cnpj", ISSUER_MESSAGES.cnpj);
  const legalName = cleanText(input.legalName);
  v.check(legalName !== null && legalName.length <= 200, "legalName", ISSUER_MESSAGES.legalName);
  const email = cleanText(input.fiscalEmail)?.toLowerCase() ?? null;
  v.check(email !== null && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), "fiscalEmail", ISSUER_MESSAGES.fiscalEmail);
  const phone = input.mobilePhone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  v.check(/^\d{10,11}$/.test(phone), "mobilePhone", ISSUER_MESSAGES.mobilePhone);
  v.check(COMPANY_TYPES.some((c) => c.value === input.companyType), "companyType", ISSUER_MESSAGES.companyType);
  const incomeText = input.monthlyIncome.trim().replace(/\./g, "").replace(",", ".");
  const income = incomeText === "" ? 0 : Number(incomeText);
  v.check(Number.isFinite(income) && income >= 0, "monthlyIncome", ISSUER_MESSAGES.monthlyIncome);
  const cep = input.postalCode.replace(/\D/g, "");
  v.check(cep.length === 8, "postalCode", ISSUER_MESSAGES.postalCode);
  v.check(cleanText(input.street) !== null, "street", ISSUER_MESSAGES.street);
  v.check(cleanText(input.streetNumber) !== null, "streetNumber", ISSUER_MESSAGES.streetNumber);
  v.check(cleanText(input.district) !== null, "district", ISSUER_MESSAGES.district);
  v.check(FISCAL_MUNICIPALITIES.some((m) => m.ibge === input.municipalityIbge), "municipalityIbge", ISSUER_MESSAGES.municipality);
  const registration = cleanText(input.municipalRegistration);
  v.check(registration === null || /^[0-9A-Za-z./-]{1,20}$/.test(registration), "municipalRegistration", ISSUER_MESSAGES.municipalRegistration);
  const cnae = input.cnae.replace(/\D/g, "");
  v.check(cnae === "" || cnae.length === 7, "cnae", ISSUER_MESSAGES.cnae);
  const serviceCode = cleanText(input.serviceCode) ? normalizeServiceCode(input.serviceCode) : null;
  v.check(!cleanText(input.serviceCode) || serviceCode !== null, "serviceCode", ISSUER_MESSAGES.serviceCode);
  const serviceName = cleanText(input.serviceName);
  v.check(serviceName === null || serviceName.length <= 250, "serviceName", ISSUER_MESSAGES.serviceName);
  const nbs = cleanText(input.nbsCode) ? normalizeNbs(input.nbsCode) : null;
  v.check(!cleanText(input.nbsCode) || nbs !== null, "nbsCode", ISSUER_MESSAGES.nbsCode);
  const iss = parseIssRate(input.issRate || "0");
  v.check(!Number.isNaN(iss), "issRate", ISSUER_MESSAGES.issRate);
  const pisCofins = cleanText(input.pisCofinsTaxStatus)?.toUpperCase() ?? null;
  v.check(pisCofins === null || /^[A-Z_]{2,60}$/.test(pisCofins), "pisCofinsTaxStatus", ISSUER_MESSAGES.pisCofins);
  const cst = input.taxSituationCode.replace(/\D/g, "");
  v.check(cst === "" || cst.length === 3, "taxSituationCode", ISSUER_MESSAGES.taxSituationCode);
  const cls = input.taxClassificationCode.replace(/\D/g, "");
  v.check(cls === "" || cls.length === 6, "taxClassificationCode", ISSUER_MESSAGES.taxClassificationCode);
  const op = input.operationIndicatorCode.replace(/\D/g, "");
  v.check(op === "" || op.length === 6, "operationIndicatorCode", ISSUER_MESSAGES.operationIndicatorCode);
  const series = cleanText(input.rpsSeries);
  v.check(series === null || /^[0-9A-Za-z]{1,10}$/.test(series), "rpsSeries", ISSUER_MESSAGES.rpsSeries);
  const numberText = input.rpsNextNumber.trim();
  v.check(numberText === "" || (/^\d{1,9}$/.test(numberText) && Number(numberText) > 0), "rpsNextNumber", ISSUER_MESSAGES.rpsNextNumber);
  v.throwIfInvalid("Emissor");
  return {
    cnpj,
    legal_name: legalName,
    fiscal_email: email,
    mobile_phone: phone,
    company_type: input.companyType,
    monthly_income_cents: Math.round(income * 100),
    postal_code: cep,
    street: cleanText(input.street),
    street_number: cleanText(input.streetNumber),
    complement: cleanText(input.complement),
    district: cleanText(input.district),
    municipality_ibge: input.municipalityIbge,
    municipal_registration: registration,
    simples_nacional: input.simplesNacional === "true",
    special_tax_regime: cleanText(input.specialTaxRegime),
    cnae: cnae || null,
    service_list_item: serviceCode ? serviceCode.slice(0, 5) : null,
    service_code: serviceCode,
    service_name: serviceName,
    nbs_code: nbs,
    iss_rate: iss,
    pis_cofins_tax_status: pisCofins,
    tax_situation_code: cst || null,
    tax_classification_code: cls || null,
    operation_indicator_code: op || null,
    rps_series: series,
    rps_next_number: numberText ? Number(numberText) : null,
  };
}

/** Valores do emissor para preencher o formulário. */
export function issuerToInput(i: FiscalIssuer | null): IssuerInput {
  return {
    cnpj: i ? formatCnpj(i.cnpj) : "",
    legalName: i?.legalName ?? "",
    fiscalEmail: i?.fiscalEmail ?? "",
    mobilePhone: i?.mobilePhone ?? "",
    companyType: i?.companyType ?? "LIMITED",
    monthlyIncome: i ? String(i.monthlyIncomeCents / 100) : "",
    postalCode: i?.postalCode ?? "",
    street: i?.street ?? "",
    streetNumber: i?.streetNumber ?? "",
    complement: i?.complement ?? "",
    district: i?.district ?? "",
    municipalityIbge: i?.municipalityIbge ?? FISCAL_MUNICIPALITIES[0].ibge,
    municipalRegistration: i?.municipalRegistration ?? "",
    simplesNacional: i?.simplesNacional ? "true" : "false",
    specialTaxRegime: i?.specialTaxRegime ?? "",
    cnae: i?.cnae ?? "",
    serviceCode: i?.serviceCode ?? "",
    serviceName: i?.serviceName ?? "",
    nbsCode: i?.nbsCode ?? "",
    issRate: i ? String(i.issRate).replace(".", ",") : "",
    pisCofinsTaxStatus: i?.pisCofinsTaxStatus ?? "",
    taxSituationCode: i?.taxSituationCode ?? "",
    taxClassificationCode: i?.taxClassificationCode ?? "",
    operationIndicatorCode: i?.operationIndicatorCode ?? "",
    rpsSeries: i?.rpsSeries ?? "",
    rpsNextNumber: i?.rpsNextNumber ? String(i.rpsNextNumber) : "",
  };
}

// ---------------------------------------------------------------------------
// Leitura e gravação (com o login de quem usa o painel)
// ---------------------------------------------------------------------------

export async function getFiscalIssuer(db: DbClient, issuerId: string): Promise<FiscalIssuer | null> {
  const row = unwrap(await db.from("fiscal_issuers").select(COLUMNS).eq("id", issuerId).maybeSingle(), "Emissor");
  return row ? toFiscalIssuer(row as unknown as Row) : null;
}

export async function getIssuerOf(db: DbClient, clinicId: string, professionalId: string | null): Promise<FiscalIssuer | null> {
  const q = db.from("fiscal_issuers").select(COLUMNS).eq("clinic_id", clinicId);
  const row = unwrap(await (professionalId ? q.eq("professional_id", professionalId) : q.eq("kind", "clinic")).maybeSingle(), "Emissor");
  return row ? toFiscalIssuer(row as unknown as Row) : null;
}

export type ProfessionalFiscalRow = {
  professionalId: string;
  name: string;
  specialty: string | null;
  profession: string;
  hasLogin: boolean;
  isActive: boolean;
  route: ProfessionalRoute;
  issuer: FiscalIssuer | null;
};

export type FiscalIssuerOverview = {
  clinicIssuer: FiscalIssuer | null;
  professionals: ProfessionalFiscalRow[];
};

/** Lista da tela: o emissor da clínica e cada profissional com a forma de emitir. */
export async function getFiscalIssuerOverview(db: DbClient, clinicId: string): Promise<FiscalIssuerOverview> {
  const [issuers, routes, pros] = await Promise.all([
    db.from("fiscal_issuers").select(COLUMNS).eq("clinic_id", clinicId),
    db.from("professional_fiscal_routes").select("professional_id, mode").eq("clinic_id", clinicId),
    db.from("professionals").select("id, display_name, specialty, profession, user_id, is_active").eq("clinic_id", clinicId).order("display_name"),
  ]);
  const all = (unwrap(issuers, "Emissores") as unknown as Row[]).map(toFiscalIssuer);
  const routeOf = new Map((unwrap(routes, "Emissores") as { professional_id: string; mode: string }[]).map((r) => [r.professional_id, r.mode]));
  const professionals = (unwrap(pros, "Profissionais") as { id: string; display_name: string; specialty: string | null; profession: string; user_id: string | null; is_active: boolean }[]).map(
    (p): ProfessionalFiscalRow => {
      const issuer = all.find((i) => i.professionalId === p.id) ?? null;
      return {
        professionalId: p.id,
        name: p.display_name,
        specialty: p.specialty,
        profession: p.profession,
        hasLogin: p.user_id !== null,
        isActive: p.is_active,
        route: issuer ? "own" : ((routeOf.get(p.id) as ProfessionalRoute | undefined) ?? "clinic"),
        issuer,
      };
    },
  );
  return { clinicIssuer: all.find((i) => i.kind === "clinic") ?? null, professionals };
}

export async function saveFiscalIssuer(db: DbClient, clinicId: string, professionalId: string | null, input: IssuerInput): Promise<string> {
  const payload = parseIssuerInput(input);
  const { data, error } = await db.rpc("save_fiscal_issuer", { p_clinic_id: clinicId, p_professional_id: professionalId as string, p_data: payload });
  if (error) throw fromDbError(error, "Emissor");
  return data as string;
}

export async function setProfessionalRoute(db: DbClient, clinicId: string, professionalId: string, mode: "clinic" | "none"): Promise<void> {
  if (mode !== "clinic" && mode !== "none") throw new DataError("invalid", "Escolha como o profissional emite", { mode: "Escolha uma opção." });
  const { error } = await db.rpc("set_professional_fiscal_route", { p_clinic_id: clinicId, p_professional_id: professionalId, p_mode: mode });
  if (error) throw fromDbError(error, "Forma de emitir");
}

export async function setIssuerPayer(db: DbClient, issuerId: string, payer: IssuerPayer): Promise<void> {
  const { error } = await db.rpc("set_fiscal_issuer_payer", { p_issuer_id: issuerId, p_payer: payer });
  if (error) throw fromDbError(error, "Quem paga as notas");
}

export async function setIssuingEnabled(db: DbClient, issuerId: string, enabled: boolean): Promise<void> {
  const { error } = await db.rpc("set_fiscal_issuing_enabled", { p_issuer_id: issuerId, p_enabled: enabled });
  if (error) throw fromDbError(error, "Emissão");
}

export async function setIssuerServiceCode(db: DbClient, issuerId: string, serviceId: string, code: string): Promise<void> {
  const normalized = code.trim() ? normalizeServiceCode(code) : null;
  if (code.trim() && !normalized) throw new DataError("invalid", "Código do serviço inválido", { serviceCode: ISSUER_MESSAGES.serviceCode });
  const { error } = await db.rpc("set_fiscal_issuer_service_code", { p_issuer_id: issuerId, p_service_id: serviceId, p_code: normalized as string });
  if (error) throw fromDbError(error, "Código do serviço");
}

export async function listIssuerServiceCodes(db: DbClient, issuerId: string): Promise<Map<string, string>> {
  const rows = unwrap(await db.from("fiscal_issuer_service_codes").select("service_id, service_code").eq("issuer_id", issuerId), "Códigos dos serviços");
  return new Map((rows as { service_id: string; service_code: string }[]).map((r) => [r.service_id, r.service_code]));
}
