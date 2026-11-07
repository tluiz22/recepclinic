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
    expect(nf).toMatch(/preço unitário/);
    expect(nf).toMatch(/franquia/);
    expect(nf).toMatch(/Emissão de notas fiscais/);
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
    expect(billingContractTerms("provisorio-2026-11-03b")).toBeNull();
  });

  it("F12.2d: renovação automática, forma de pagamento, IPCA, arrependimento e cancelamento na tela", () => {
    for (const version of [BILLING_CONTRACT_TERMS_VERSION, BILLING_CONTRACT_TERMS_VERSION_NF]) {
      const all = text(version);
      expect(all).toMatch(/prazo indeterminado/);
      expect(all).toMatch(/renova automaticamente a cada mês/);
      expect(all).toMatch(/cobrança automática da mensalidade nesse cartão/);
      expect(all).toMatch(/IPCA/);
      expect(all).toMatch(/7 dias corridos, contados do aceite/);
      expect(all).toMatch(/Cancelar a assinatura/);
    }
    expect(billingContractTerms(BILLING_CONTRACT_TERMS_VERSION)).toHaveLength(12);
    expect(billingContractTerms(BILLING_CONTRACT_TERMS_VERSION_NF)).toHaveLength(13);
  });

  it("cliente, 07/nov: a Meta cobra as mensagens direto da clínica, fora da mensalidade", () => {
    for (const version of [BILLING_CONTRACT_TERMS_VERSION, BILLING_CONTRACT_TERMS_VERSION_NF]) {
      const sections = billingContractTerms(version)!;
      expect(sections[3].title).toBe("4. Mensagens do WhatsApp e cobranças da Meta");
      const meta = JSON.stringify(sections[3]);
      expect(meta).toMatch(/A Meta cobra diretamente da clínica/);
      expect(meta).toMatch(/não fazem parte da mensalidade/);
      expect(meta).toMatch(/Configurações › WhatsApp/);
      expect(meta).toMatch(/impedir ou limitar o envio/);
    }
  });

  it("cliente, 07/nov: texto completo (13 seções com nota; a de notas é a 6) e lista na proteção de dados", () => {
    const nf = billingContractTerms(BILLING_CONTRACT_TERMS_VERSION_NF)!.map((s) => s.title);
    expect(nf[5]).toBe("6. Emissão de notas fiscais");
    expect(nf[10]).toBe("11. Disponibilidade do serviço e serviços de terceiros");
    expect(nf[12]).toBe("13. Aceite do contrato");
    const plain = billingContractTerms(BILLING_CONTRACT_TERMS_VERSION)!;
    expect(plain[5].title).toBe("6. Reajuste e mudança de valores");
    const data = plain.find((s) => s.title.endsWith("Proteção de dados pessoais"))!;
    const list = data.paragraphs.find((p) => Array.isArray(p));
    expect(list).toHaveLength(5);
  });
});
