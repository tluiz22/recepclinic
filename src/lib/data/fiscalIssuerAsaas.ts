import { randomBytes } from "node:crypto";
import { asaasAccountsApi, type AsaasAccountsApi } from "../asaas/accountsApi";
import { asaasFiscalApi, type AsaasFiscalApi, type FiscalInfoInput, type MunicipalOptions } from "../asaas/fiscalApi";
import { AsaasApiError } from "../asaas/http";
import { CERTIFICATE_MESSAGES, CertificateError, MAX_CERTIFICATE_BYTES, readCertificate } from "../certificate";
import { platformEnv } from "../env";
import { DataError } from "./errors";
import { platformIssuerStore, type PlatformIssuerStore } from "./platform";

// Emissor fiscal × Asaas (N2b): o Suporte cria a subconta; o Administrador ou
// o profissional dono enviam a configuração fiscal e o certificado (que passa
// direto ao Asaas, sem ficar no RecepClinic); a situação do cadastro e as
// regras do município são lidas da subconta. Quem chama já conferiu a
// permissão lendo o emissor com o login (RLS).

export type IssuerAsaasDeps = {
  store: PlatformIssuerStore;
  accounts: AsaasAccountsApi;
  fiscalFor: (apiKey: string) => AsaasFiscalApi;
  environment: "sandbox" | "production";
  webhookUrl: string;
  webhookEmail: string;
  newToken: () => string;
  now: () => Date;
};

export function defaultIssuerAsaasDeps(): IssuerAsaasDeps {
  const env = platformEnv();
  if (!env.asaas) throw new DataError("not_enabled", "O Asaas não está configurado neste ambiente (ASAAS_API_KEY e ASAAS_BASE_URL).");
  if (!env.siteUrl) throw new DataError("not_enabled", "Falta o endereço público do sistema (SITE_URL) para o webhook das notas.");
  const asaas = env.asaas;
  const site = env.siteUrl;
  return {
    store: platformIssuerStore(),
    accounts: asaasAccountsApi(asaas),
    fiscalFor: (apiKey) => asaasFiscalApi({ baseUrl: asaas.baseUrl, apiKey }),
    environment: asaas.baseUrl.includes("sandbox") ? "sandbox" : "production",
    webhookUrl: `${site.replace(/\/+$/, "")}/api/asaas/notas`,
    webhookEmail: env.email?.from.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? "suporte@recepclinic.com.br",
    newToken: () => randomBytes(32).toString("base64url"),
    now: () => new Date(),
  };
}

const asaasMessage = (error: unknown) =>
  error instanceof AsaasApiError ? error.message : error instanceof Error ? `Falha ao falar com o Asaas: ${error.message}` : "Falha ao falar com o Asaas";

export function accountStatusOf(general: string): "pending" | "awaiting_approval" | "approved" | "rejected" {
  if (general === "APPROVED") return "approved";
  if (general === "REJECTED") return "rejected";
  if (general === "AWAITING_APPROVAL") return "awaiting_approval";
  return "pending";
}

const snapshot = (o: MunicipalOptions) => ({
  authenticationType: o.authenticationType,
  supportsCancellation: o.supportsCancellation,
  usesSpecialTaxRegimes: o.usesSpecialTaxRegimes,
  specialTaxRegimesList: o.specialTaxRegimesList,
});

async function issuerOrFail(deps: IssuerAsaasDeps, issuerId: string) {
  const issuer = await deps.store.read(issuerId);
  if (!issuer) throw new DataError("not_found", "Emissor não encontrado.");
  return issuer;
}

async function fiscalOf(deps: IssuerAsaasDeps, issuerId: string): Promise<AsaasFiscalApi> {
  const key = await deps.store.apiKey(issuerId);
  if (!key) throw new DataError("invalid", "Este emissor ainda não tem subconta no Asaas: o Suporte cria.", { asaas: "Sem subconta." });
  return deps.fiscalFor(key);
}

/** Suporte: cria a subconta do emissor (ou liga uma criada antes? não: a chave só vem na criação). */
export async function createIssuerSubaccount(issuerId: string, actorId: string, deps: IssuerAsaasDeps = defaultIssuerAsaasDeps()): Promise<void> {
  const issuer = await issuerOrFail(deps, issuerId);
  if (issuer.asaas_account_id) throw new DataError("invalid", "Este emissor já tem subconta no Asaas.");
  const existing = await deps.accounts.findSubaccount(issuer.cnpj).catch(() => null);
  if (existing) {
    // A chave não volta: o Suporte resolve com o Asaas (decisão 11.15, sem IP fixo).
    throw new DataError("invalid", "Já existe uma subconta no Asaas para este CNPJ, criada fora desta tela: fale com o Asaas para recuperar a chave.", {
      asaas: "Subconta já existe.",
    });
  }
  const placeholders = [
    issuer.fiscal_email === "pendente@recepclinic.com.br" && "e-mail fiscal",
    issuer.mobile_phone === "84000000000" && "celular",
    issuer.street === "A preencher" && "rua",
    issuer.district === "A preencher" && "bairro",
  ].filter(Boolean);
  if (placeholders.length > 0) {
    const message = `Complete os dados do emissor antes de criar a subconta (provisórios: ${placeholders.join(", ")}).`;
    throw new DataError("invalid", message, { asaas: message });
  }
  const token = deps.newToken();
  let created;
  try {
    created = await deps.accounts.createSubaccount({
      name: issuer.legal_name,
      email: issuer.fiscal_email,
      cpfCnpj: issuer.cnpj,
      companyType: issuer.company_type as "LIMITED",
      mobilePhone: issuer.mobile_phone,
      incomeCents: Number(issuer.monthly_income_cents),
      address: { postalCode: issuer.postal_code, street: issuer.street, number: issuer.street_number, complement: issuer.complement, district: issuer.district },
      webhook: { url: deps.webhookUrl, authToken: token, email: deps.webhookEmail },
    });
  } catch (error) {
    throw new DataError("invalid", asaasMessage(error), { asaas: asaasMessage(error) }, { cause: error });
  }
  // A chave só vem agora: se o Vault falhar, tenta de novo antes de desistir.
  let linkError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await deps.store.linkAccount(issuerId, { accountId: created.id, walletId: created.walletId, apiKey: created.apiKey, webhookToken: token, environment: deps.environment, actorId });
      linkError = null;
      break;
    } catch (error) {
      linkError = error;
    }
  }
  if (linkError) {
    const message = `A subconta ${created.id} foi criada no Asaas, mas a chave não foi guardada. Fale com o Asaas para recuperar a chave.`;
    throw new DataError("unexpected", message, { asaas: message }, { cause: linkError });
  }
  // Regras do município já na criação (a tela usa para o certificado e o regime).
  await refreshIssuerFromAsaas(issuerId, deps).catch(() => undefined);
}

/** Situação do cadastro e regras do município, lidas da subconta. */
export async function refreshIssuerFromAsaas(issuerId: string, deps: IssuerAsaasDeps = defaultIssuerAsaasDeps()): Promise<void> {
  const fiscal = await fiscalOf(deps, issuerId);
  try {
    const [status, options] = await Promise.all([fiscal.accountStatus(), fiscal.municipalOptions()]);
    await deps.store.setAccountStatus(issuerId, accountStatusOf(status.general));
    await deps.store.setMunicipalOptions(issuerId, snapshot(options));
  } catch (error) {
    if (error instanceof DataError) throw error;
    throw new DataError("unexpected", asaasMessage(error), {}, { cause: error });
  }
}

export type CredentialInput =
  | { type: "CERTIFICATE"; file: Uint8Array | null; fileName: string; password: string }
  | { type: "USER_AND_PASSWORD"; username: string; password: string }
  | { type: "TOKEN"; accessToken: string }
  | null;

/**
 * Envia a configuração fiscal (e a credencial, quando vier) ao Asaas. O
 * certificado é conferido aqui (mesmo CNPJ do emissor e dentro da validade) e
 * vai direto ao Asaas: não fica no RecepClinic.
 */
export async function sendIssuerFiscalInfo(issuerId: string, credential: CredentialInput, actorId: string, deps: IssuerAsaasDeps = defaultIssuerAsaasDeps()): Promise<void> {
  const issuer = await issuerOrFail(deps, issuerId);
  const fiscal = await fiscalOf(deps, issuerId);
  let validUntil: Date | null = null;
  let cred: FiscalInfoInput["credential"] = null;
  if (credential?.type === "CERTIFICATE") {
    if (!credential.file || credential.file.byteLength === 0) throw new DataError("invalid", "Escolha o arquivo do certificado (.pfx ou .p12).", { pfx: "Escolha o arquivo." });
    if (credential.file.byteLength > MAX_CERTIFICATE_BYTES) throw new DataError("invalid", "O arquivo é grande demais para um certificado A1.", { pfx: "Arquivo grande demais." });
    if (!credential.password) throw new DataError("invalid", "Informe a senha do certificado.", { password: "Informe a senha." });
    let info;
    try {
      info = readCertificate(credential.file, credential.password);
    } catch (error) {
      const message = error instanceof CertificateError ? CERTIFICATE_MESSAGES[error.reason] : CERTIFICATE_MESSAGES.format;
      throw new DataError("invalid", message, { pfx: message });
    }
    if (info.cnpj !== issuer.cnpj) {
      const message = info.cnpj ? "O certificado é de outro CNPJ, diferente do CNPJ deste emissor." : "Este certificado não traz CNPJ: envie o e-CNPJ (A1) do emissor.";
      throw new DataError("invalid", message, { pfx: message });
    }
    if (info.validUntil <= deps.now()) throw new DataError("invalid", "Este certificado já venceu.", { pfx: "Certificado vencido." });
    validUntil = info.validUntil;
    cred = { type: "CERTIFICATE", file: credential.file, fileName: credential.fileName || "certificado.pfx", password: credential.password };
  } else if (credential?.type === "USER_AND_PASSWORD") {
    if (!credential.username || !credential.password) throw new DataError("invalid", "Informe usuário e senha da prefeitura.", { username: "Obrigatório." });
    cred = credential;
  } else if (credential?.type === "TOKEN") {
    if (!credential.accessToken) throw new DataError("invalid", "Informe o token da prefeitura.", { accessToken: "Obrigatório." });
    cred = credential;
  }

  let options: MunicipalOptions | null = null;
  try {
    options = await fiscal.municipalOptions();
    // Já configurado antes: o Asaas é quem conta os RPS; reenviar o número reiniciaria a numeração.
    const current = issuer.fiscal_info_synced_at ? await fiscal.getFiscalInfo() : null;
    const saved = await fiscal.saveFiscalInfo({
      email: issuer.fiscal_email,
      simplesNacional: issuer.simples_nacional,
      municipalInscription: issuer.municipal_registration,
      cnae: issuer.cnae,
      specialTaxRegime: issuer.special_tax_regime,
      serviceListItem: issuer.service_list_item,
      nbsCode: issuer.nbs_code,
      rpsSerie: issuer.rps_series,
      // Depois do primeiro envio o Asaas é quem conta os RPS: reenviar reiniciaria a numeração.
      rpsNumber: current ? null : issuer.rps_next_number,
      nationalPortalTaxCalculationRegime: null,
      credential: cred,
    });
    await deps.store.setFiscalInfo(issuerId, {
      ok: true,
      message: null,
      municipalOptions: snapshot(options),
      certificateSent: cred?.type === "CERTIFICATE" || (saved.certificateSent && !issuer.certificate_sent_at),
      certificateValidUntil: validUntil,
      actorId,
    });
  } catch (error) {
    const message = asaasMessage(error);
    if (!(error instanceof AsaasApiError)) throw new DataError("unexpected", `Erro inesperado ao enviar a configuração fiscal: ${message}`, { asaas: message }, { cause: error });
    const transient = error.status === 0 || error.status >= 500 || error.status === 408 || error.status === 429;
    // Falha passageira (rede, 5xx): não desliga a emissão; é só tentar de novo.
    if (transient) throw new DataError("unexpected", `Não foi possível falar com o Asaas agora; tente de novo. (${message})`, { asaas: message }, { cause: error });
    await deps.store.setFiscalInfo(issuerId, { ok: false, message, municipalOptions: options ? snapshot(options) : null, certificateSent: false, certificateValidUntil: null, actorId });
    throw new DataError("invalid", `O Asaas recusou a configuração fiscal: ${message}`, { asaas: message }, { cause: error });
  }
}
