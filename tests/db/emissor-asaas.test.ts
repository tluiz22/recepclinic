import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asaasAccountsApi } from "../../src/lib/asaas/accountsApi";
import { createFakeAsaas, type FakeAsaas } from "../../src/lib/asaas/fake";
import { asaasFiscalApi } from "../../src/lib/asaas/fiscalApi";
import { createIssuerSubaccount, refreshIssuerFromAsaas, sendIssuerFiscalInfo, type IssuerAsaasDeps } from "../../src/lib/data/fiscalIssuerAsaas";
import { getFiscalIssuer, saveFiscalIssuer, setIssuingEnabled, type IssuerInput } from "../../src/lib/data/fiscalIssuers";
import { platformIssuerStore } from "../../src/lib/data/platform";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { makeTestPfx } from "./pfx";

// N2b — Emissor × Asaas (falso): o Suporte cria a subconta (chave e token no
// Vault, webhook das notas), a situação e as regras do município vêm da
// subconta, a configuração fiscal e o certificado vão direto ao Asaas (o
// certificado é conferido antes: CNPJ do emissor e validade).

const INPUT: IssuerInput = {
  cnpj: "11.222.333/0001-81", legalName: "Clínica Asaas Ltda", fiscalEmail: "fiscal@asaas.teste", mobilePhone: "84988880000", companyType: "LIMITED",
  monthlyIncome: "30000", postalCode: "59600000", street: "Rua A", streetNumber: "1", complement: "", district: "Centro", municipalityIbge: "2408003",
  municipalRegistration: "123", simplesNacional: "false", specialTaxRegime: "0", cnae: "8630503", serviceCode: "04.01.01", serviceName: "Medicina",
  nbsCode: "1.2301.22.00", issRate: "5", pisCofinsTaxStatus: "NONE", taxSituationCode: "200", taxClassificationCode: "200029",
  operationIndicatorCode: "030101", rpsSeries: "2026", rpsNextNumber: "1",
};

let fixture: AgendaFixture;
let fake: FakeAsaas;
let deps: IssuerAsaasDeps;
let issuerId: string;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do emissor no Asaas", "+55619866000");
  fake = createFakeAsaas();
  deps = {
    store: platformIssuerStore({ supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!, supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY! }),
    accounts: asaasAccountsApi({ baseUrl: fake.baseUrl, apiKey: fake.mainKey }, fake.fetch),
    fiscalFor: (apiKey) => asaasFiscalApi({ baseUrl: fake.baseUrl, apiKey }, fake.fetch),
    environment: "sandbox",
    webhookUrl: "https://app.teste/api/asaas/notas",
    webhookEmail: "suporte@teste.local",
    newToken: () => "w".repeat(43),
    now: () => new Date(),
  };
  issuerId = await saveFiscalIssuer(asDb(fixture.admin), fixture.clinicId, null, INPUT);
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("Emissor no Asaas (N2b)", () => {
  it("cria a subconta com o webhook e o token próprios; não cria duas vezes", async () => {
    await createIssuerSubaccount(issuerId, fixture.admin.id, deps);
    const issuer = await getFiscalIssuer(asDb(fixture.admin), issuerId);
    expect(issuer).toMatchObject({ hasAccount: true, accountStatus: "pending", environment: "sandbox" });
    expect(issuer?.municipalOptions).toMatchObject({ authenticationType: "CERTIFICATE", supportsCancellation: true });
    const account = [...fake.accounts.values()][0];
    expect(account.webhook).toEqual({ url: "https://app.teste/api/asaas/notas", authToken: "w".repeat(43) });
    expect(await deps.store.apiKey(issuerId)).toBe(account.apiKey);
    expect(await codeOf(() => createIssuerSubaccount(issuerId, fixture.admin.id, deps))).toBe("invalid");
  });

  it("certificado de outro CNPJ ou vencido é recusado antes de ir ao Asaas", async () => {
    const before = fake.calls.filter((c) => c.path === "/fiscalInfo").length;
    expect(await codeOf(() => sendIssuerFiscalInfo(issuerId, { type: "CERTIFICATE", file: makeTestPfx("11444777000161", "s"), fileName: "a.pfx", password: "s" }, fixture.admin.id, deps))).toBe("invalid");
    const expired = makeTestPfx("11222333000181", "s", { validFrom: new Date(Date.now() - 400 * 86_400_000), validUntil: new Date(Date.now() - 86_400_000) });
    expect(await codeOf(() => sendIssuerFiscalInfo(issuerId, { type: "CERTIFICATE", file: expired, fileName: "a.pfx", password: "s" }, fixture.admin.id, deps))).toBe("invalid");
    expect(await codeOf(() => sendIssuerFiscalInfo(issuerId, { type: "CERTIFICATE", file: makeTestPfx("11222333000181", "s"), fileName: "a.pfx", password: "errada" }, fixture.admin.id, deps))).toBe("invalid");
    expect(fake.calls.filter((c) => c.path === "/fiscalInfo").length).toBe(before);
  });

  it("envia configuração e certificado; aprovado, a emissão liga", async () => {
    await sendIssuerFiscalInfo(issuerId, { type: "CERTIFICATE", file: makeTestPfx("11222333000181", "s"), fileName: "a1.pfx", password: "s" }, fixture.admin.id, deps);
    let issuer = await getFiscalIssuer(asDb(fixture.admin), issuerId);
    expect(issuer).toMatchObject({ fiscalInfoStatus: "configured", certificateSentAt: expect.any(Date), certificateValidUntil: expect.any(Date) });
    const sent = [...fake.accounts.values()][0].fiscalInfo!;
    expect(sent).toMatchObject({ email: "fiscal@asaas.teste", cnae: "8630503", serviceListItem: "04.01", nbsCode: "1.2301.22.00", rpsSerie: "2026", certificateSent: true });
    expect(JSON.stringify(sent)).not.toContain('"s"');
    // Ainda sem aprovação.
    expect(await codeOf(() => setIssuingEnabled(asDb(fixture.admin), issuerId, true))).toBe("invalid");
    fake.approve([...fake.accounts.values()][0].id);
    await refreshIssuerFromAsaas(issuerId, deps);
    issuer = await getFiscalIssuer(asDb(fixture.admin), issuerId);
    expect(issuer?.accountStatus).toBe("approved");
    await setIssuingEnabled(asDb(fixture.admin), issuerId, true);
    expect((await getFiscalIssuer(asDb(fixture.admin), issuerId))?.issuingEnabled).toBe(true);
  });

  it("falha passageira (5xx) não registra recusa nem desliga a emissão", async () => {
    fake.failNext(/^\/fiscalInfo$/, 503, "Indisponível.");
    expect(await codeOf(() => sendIssuerFiscalInfo(issuerId, null, fixture.admin.id, deps))).toBe("unexpected");
    expect((await getFiscalIssuer(asDb(fixture.admin), issuerId))?.fiscalInfoStatus).not.toBe("error");
  });

  it("recusa do Asaas fica registrada e desliga a emissão", async () => {
    fake.failNext(/^\/fiscalInfo$/, 400, "Inscrição municipal inválida.");
    expect(await codeOf(() => sendIssuerFiscalInfo(issuerId, null, fixture.admin.id, deps))).toBe("invalid");
    const issuer = await getFiscalIssuer(asDb(fixture.admin), issuerId);
    expect(issuer).toMatchObject({ fiscalInfoStatus: "error", issuingEnabled: false });
    expect(issuer?.fiscalInfoMessage).toContain("Inscrição municipal inválida");
  });
});
