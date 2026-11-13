import { describe, expect, it } from "vitest";
import { asaasAccountsApi } from "./accountsApi";
import { createFakeAsaas } from "./fake";
import { asaasFiscalApi, invoiceState } from "./fiscalApi";
import { AsaasApiError, asaasCall } from "./http";
import { maskPersonalData } from "../log";

// N1: base Asaas da nota fiscal (conta principal + subconta), contra o Asaas falso.

const customer = {
  name: "Maria Pagadora",
  cpfCnpj: "52998224725",
  email: "maria@exemplo.com",
  postalCode: "59600000",
  street: "Rua A",
  number: "10",
  complement: null,
  district: "Centro",
  externalReference: "pagador-1",
};

const taxes = {
  retainIss: false,
  iss: 5,
  pis: 0,
  cofins: 0,
  csll: 0,
  inss: 0,
  ir: 0,
  nbsCode: "1.2301.22.00",
  taxSituationCode: "200",
  taxClassificationCode: "200029",
  operationIndicatorCode: "030101",
  pisCofinsTaxStatus: "NONE",
};

async function setup(options?: Parameters<typeof createFakeAsaas>[0]) {
  const fake = createFakeAsaas(options);
  const main = asaasAccountsApi({ baseUrl: fake.baseUrl, apiKey: fake.mainKey }, fake.fetch);
  const sub = await main.createSubaccount({
    name: "Clínica Teste",
    email: "fiscal@clinica.com",
    cpfCnpj: "11222333000181",
    companyType: "LIMITED",
    mobilePhone: "84988880000",
    incomeCents: 5_000_000,
    address: { postalCode: "59600000", street: "Rua B", number: "1", complement: null, district: "Centro" },
    webhook: { url: "https://app.exemplo/api/asaas/notas", authToken: "t".repeat(40), email: "suporte@exemplo.com" },
  });
  const fiscal = asaasFiscalApi({ baseUrl: fake.baseUrl, apiKey: sub.apiKey }, fake.fetch);
  return { fake, main, sub, fiscal };
}

describe("Asaas da nota fiscal (N1)", () => {
  it("cria a subconta com o webhook das notas e devolve a chave", async () => {
    const { fake, sub } = await setup();
    expect(sub.apiKey).toMatch(/^\$aact_/);
    const account = fake.accounts.get(sub.id);
    expect(account?.webhook?.url).toBe("https://app.exemplo/api/asaas/notas");
  });

  it("CNPJ repetido: o Asaas recusa e a subconta existente é achada pelo CNPJ", async () => {
    const { main, sub } = await setup();
    await expect(
      main.createSubaccount({
        name: "Outra",
        email: "x@y.z",
        cpfCnpj: "11222333000181",
        companyType: "LIMITED",
        mobilePhone: "84988880000",
        incomeCents: 1,
        address: { postalCode: "59600000", street: "R", number: "1", complement: null, district: "C" },
        webhook: null,
      }),
    ).rejects.toBeInstanceOf(AsaasApiError);
    expect(await main.findSubaccount("11222333000181")).toEqual({ id: sub.id, walletId: sub.walletId });
  });

  it("regras do município e configuração fiscal com certificado (multipart, sem eco da senha)", async () => {
    const { fiscal } = await setup();
    const options = await fiscal.municipalOptions();
    expect(options).toMatchObject({ authenticationType: "CERTIFICATE", supportsCancellation: true });
    const info = await fiscal.saveFiscalInfo({
      email: "fiscal@clinica.com",
      simplesNacional: false,
      municipalInscription: "12345",
      cnae: "8630503",
      specialTaxRegime: "0",
      serviceListItem: "04.01",
      nbsCode: "1.2301.22.00",
      rpsSerie: "2026",
      rpsNumber: 1,
      nationalPortalTaxCalculationRegime: null,
      credential: { type: "CERTIFICATE", file: new Uint8Array([1, 2, 3]), fileName: "a1.pfx", password: "segredo" },
    });
    expect(info).toMatchObject({ certificateSent: true, simplesNacional: false, rpsNumber: 1 });
    expect(JSON.stringify(info)).not.toContain("segredo");
  });

  it("nota: sem aprovação recusa; aprovada sai como pending (SYNCHRONIZED) e é achada pela referência", async () => {
    const { fake, sub, fiscal } = await setup();
    await fiscal.saveFiscalInfo({ email: "f@c.com", simplesNacional: false, municipalInscription: null, cnae: null, specialTaxRegime: null, serviceListItem: null, nbsCode: null, rpsSerie: null, rpsNumber: null, nationalPortalTaxCalculationRegime: null, credential: null });
    const cus = await fiscal.upsertCustomer(customer);
    expect(await fiscal.upsertCustomer(customer)).toBe(cus);
    const draft = await fiscal.createInvoice({
      customer: cus,
      serviceDescription: "Consulta. Paciente: Ana. Atendimento em 01/11/2026.",
      observations: "",
      valueCents: 42_500,
      effectiveDate: "2026-11-01",
      municipalServiceCode: "04.01.01",
      municipalServiceName: "Medicina",
      externalReference: "nota-local-1",
      taxes,
    });
    expect(draft.state).toBe("pending");
    expect(fake.invoices.get(draft.id)?.body).toMatchObject({ value: 425, taxes: { operationIndicatorCode: "030101", pisCofinsTaxStatus: "NONE" } });
    await expect(fiscal.authorizeInvoice(draft.id)).rejects.toThrow(/cadastro geral aprovado/);
    fake.approve(sub.id);
    expect((await fiscal.authorizeInvoice(draft.id)).state).toBe("pending");
    fake.authorize(draft.id);
    const found = await fiscal.findInvoice("nota-local-1");
    expect(found).toMatchObject({ id: draft.id, state: "authorized" });
    expect(found?.pdfUrl).toBeTruthy();
    expect(new TextDecoder().decode(await fiscal.download(found!.pdfUrl!))).toContain("%PDF");
    expect(await fiscal.balanceCents()).toBe(-49);
    const canceling = await fiscal.cancelInvoice(draft.id);
    expect(canceling.state).toBe("canceling");
  });

  it("reposição do saldo: transferência da principal para a carteira da subconta", async () => {
    const { main, sub, fiscal } = await setup();
    const t = await main.transferToWallet(sub.walletId, 1_000, "reposicao-1");
    expect(t).toMatchObject({ status: "DONE", valueCents: 1_000 });
    expect(await fiscal.balanceCents()).toBe(1_000);
  });

  it("estados desconhecidos ficam pending; erro sem resposta vira status 0", async () => {
    expect(invoiceState("SYNCHRONIZED")).toBe("pending");
    expect(invoiceState("ALGO_NOVO")).toBe("pending");
    expect(invoiceState("CANCELLATION_DENIED")).toBe("cancel_denied");
    const failing = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    await expect(asaasCall({ baseUrl: "https://x/v3", apiKey: "k" }, failing, "GET", "/a")).rejects.toMatchObject({ status: 0 });
  });

  it("chave do Asaas nunca aparece no log", () => {
    expect(maskPersonalData("falhou com $aact_YTU5YTE0M2M2N2I4MTliNzk0YTI5N2U5MzdjNWZmNDQ6OjAwMDA=")).toBe("falhou com [chave Asaas]");
  });
});
