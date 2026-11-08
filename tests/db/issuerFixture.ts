import { asaasAccountsApi } from "../../src/lib/asaas/accountsApi";
import { createFakeAsaas, type FakeAsaas, type FakeAsaasOptions } from "../../src/lib/asaas/fake";
import { asaasFiscalApi } from "../../src/lib/asaas/fiscalApi";
import { createIssuerSubaccount, sendIssuerFiscalInfo, type IssuerAsaasDeps } from "../../src/lib/data/fiscalIssuerAsaas";
import { saveFiscalIssuer, setIssuingEnabled, type IssuerInput } from "../../src/lib/data/fiscalIssuers";
import { TOP_UP, type AsaasNfseDeps } from "../../src/lib/data/nfseAsaas";
import { platformAsaasNfse, platformIssuerStore } from "../../src/lib/data/platform";
import { asDb, type AgendaFixture } from "./agendaFixture";
import { makeTestPfx } from "./pfx";

// Emissor pronto para emitir (N3): dados, subconta no Asaas falso, configuração
// e certificado aceitos, cadastro aprovado e emissão ligada.

const localEnv = () => ({ supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!, supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY! });

export const ISSUER_INPUT: IssuerInput = {
  cnpj: "11.222.333/0001-81", legalName: "Clínica Emissora Ltda", fiscalEmail: "fiscal@emissora.teste", mobilePhone: "84988880000", companyType: "LIMITED",
  monthlyIncome: "30000", postalCode: "59600000", street: "Rua A", streetNumber: "1", complement: "", district: "Centro", municipalityIbge: "2408003",
  municipalRegistration: "123", simplesNacional: "false", specialTaxRegime: "0", cnae: "8630503", serviceCode: "04.01.01", serviceName: "Medicina",
  nbsCode: "1.2301.22.00", issRate: "5", pisCofinsTaxStatus: "NONE", taxSituationCode: "200", taxClassificationCode: "200029",
  operationIndicatorCode: "030101", rpsSeries: "2026", rpsNextNumber: "1",
};

export function fakeDeps(options?: FakeAsaasOptions): { fake: FakeAsaas; issuerDeps: IssuerAsaasDeps; nfseDeps: AsaasNfseDeps } {
  const fake = createFakeAsaas(options);
  const accounts = asaasAccountsApi({ baseUrl: fake.baseUrl, apiKey: fake.mainKey }, fake.fetch);
  const fiscalFor = (apiKey: string) => asaasFiscalApi({ baseUrl: fake.baseUrl, apiKey }, fake.fetch);
  const issuers = platformIssuerStore(localEnv());
  let token = 0;
  return {
    fake,
    issuerDeps: { store: issuers, accounts, fiscalFor, environment: "sandbox", webhookUrl: "https://app.teste/api/asaas/notas", webhookEmail: "s@teste.local", newToken: () => `token-do-webhook-${++token}-`.padEnd(40, "x"), now: () => new Date() },
    nfseDeps: { issuers, nfse: platformAsaasNfse(localEnv()), accounts, fiscalFor, topUp: TOP_UP, now: () => new Date() },
  };
}

/** Cria e liga um emissor; devolve o id dele e o id da subconta no Asaas falso. */
export async function readyIssuer(fixture: AgendaFixture, deps: { fake: FakeAsaas; issuerDeps: IssuerAsaasDeps }, professionalId: string | null, input: Partial<IssuerInput> = {}) {
  const db = asDb(fixture.admin);
  const full = { ...ISSUER_INPUT, ...input };
  const id = await saveFiscalIssuer(db, fixture.clinicId, professionalId, full);
  await createIssuerSubaccount(id, fixture.admin.id, deps.issuerDeps);
  const cnpj = full.cnpj.replace(/\D/g, "");
  const account = [...deps.fake.accounts.values()].find((a) => a.cpfCnpj === cnpj)!;
  await sendIssuerFiscalInfo(id, { type: "CERTIFICATE", file: makeTestPfx(cnpj, "s"), fileName: "a1.pfx", password: "s" }, fixture.admin.id, deps.issuerDeps);
  deps.fake.approve(account.id);
  await deps.issuerDeps.store.setAccountStatus(id, "approved");
  await setIssuingEnabled(db, id, true);
  return { issuerId: id, accountId: account.id, webhookToken: account.webhook!.authToken };
}
