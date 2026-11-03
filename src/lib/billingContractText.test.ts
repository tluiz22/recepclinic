import { describe, expect, it } from "vitest";
import {
  BILLING_CONTRACT_TERMS_VERSION,
  BILLING_CONTRACT_TERMS_VERSION_NF,
  billingContractTerms,
  billingTermsVersionFor,
} from "./billingContractText";

// Cliente, 03/nov/2026: o contrato só fala de nota fiscal quando cobra nota.
const text = (version: string) => JSON.stringify(billingContractTerms(version));

describe("texto do contrato", () => {
  it("sem nota fiscal, o texto não fala de nota", () => {
    expect(text(BILLING_CONTRACT_TERMS_VERSION)).not.toMatch(/nota/i);
  });

  it("com nota fiscal, o texto fala do preço por nota, da franquia e da emissão", () => {
    const nf = text(BILLING_CONTRACT_TERMS_VERSION_NF);
    expect(nf).toMatch(/preço por nota/);
    expect(nf).toMatch(/franquia/);
    expect(nf).toMatch(/Emissão de nota fiscal/);
  });

  it("seções numeradas em sequência", () => {
    for (const version of [BILLING_CONTRACT_TERMS_VERSION, BILLING_CONTRACT_TERMS_VERSION_NF]) {
      billingContractTerms(version)!.forEach((section, index) => expect(section.title.startsWith(`${index + 1}. `)).toBe(true));
    }
  });

  it("a versão segue o preço por nota; versão antiga não tem texto aqui", () => {
    expect(billingTermsVersionFor({ invoiceUnitPriceCents: 80 })).toBe(BILLING_CONTRACT_TERMS_VERSION_NF);
    expect(billingTermsVersionFor({ invoiceUnitPriceCents: null })).toBe(BILLING_CONTRACT_TERMS_VERSION);
    expect(billingTermsVersionFor({ invoiceUnitPriceCents: 0 })).toBe(BILLING_CONTRACT_TERMS_VERSION_NF);
    expect(billingContractTerms("provisorio-2026-11-02")).toBeNull();
    expect(billingContractTerms("provisorio-2026-11-03")).toBeNull();
  });

  it("F12.2d: renovação automática, forma de pagamento, IPCA, arrependimento e cancelamento na tela", () => {
    for (const version of [BILLING_CONTRACT_TERMS_VERSION, BILLING_CONTRACT_TERMS_VERSION_NF]) {
      const all = text(version);
      expect(all).toMatch(/prazo indeterminado/);
      expect(all).toMatch(/renova automaticamente todo mês/);
      expect(all).toMatch(/cobrança automática da mensalidade nesse cartão/);
      expect(all).toMatch(/IPCA/);
      expect(all).toMatch(/Em até 7 dias do aceite/);
      expect(all).toMatch(/Cancelar a assinatura/);
    }
    expect(billingContractTerms(BILLING_CONTRACT_TERMS_VERSION)).toHaveLength(9);
    expect(billingContractTerms(BILLING_CONTRACT_TERMS_VERSION_NF)).toHaveLength(10);
  });
});
