import { describe, expect, it } from "vitest";
import { chargeAction, dueDay, hasCardOnFile, recurringConsentText, renewalLine, renewalSummary } from "./billingRenewal";

// F12.2e (cliente, 03/nov/2026): renovação explicada antes do aceite e a ação
// de cada cobrança conforme a forma de pagamento.
const contract = { monthlyCents: 30000, firstDueDate: "2026-12-03", paymentMethod: "credit_card" as const, invoiceUnitPriceCents: null };

describe("renovação da assinatura", () => {
  it("a frase da autorização segue a forma de pagamento", () => {
    expect(recurringConsentText("credit_card")).toMatch(/cobrança automática da mensalidade no cartão de crédito/);
    expect(recurringConsentText("pix")).toMatch(/por Pix/);
    expect(recurringConsentText(null)).toMatch(/todo mês, até o cancelamento/);
  });

  it("o resumo diz valor, dia, forma, prazo indeterminado e o cancelamento", () => {
    const text = renewalSummary(contract);
    expect(text).toContain("A partir de 03/12/2026");
    expect(text).toMatch(/R\$\s?300,00 todo dia 3, cobrados automaticamente no cartão de crédito, por prazo indeterminado/);
    expect(text).toContain("Cancelamento a qualquer momento");
    expect(text).not.toContain("nota");
    expect(renewalSummary({ ...contract, paymentMethod: "pix", invoiceUnitPriceCents: 80 })).toMatch(/por Pix.*Notas fiscais acima da franquia/);
    expect(renewalLine(contract)).toMatch(/Renovação automática: R\$\s?300,00 todo dia 3/);
    expect(dueDay("2026-12-28")).toBe(28);
  });

  it("cartão: a 1ª pede o cartão; depois, automática; vencida (recusada), Pagar", () => {
    const open = { status: "pending", invoiceUrl: "https://fatura" };
    expect(chargeAction(open, "credit_card", false)).toEqual({ kind: "link", label: "Informar o cartão e pagar" });
    expect(chargeAction(open, "credit_card", true)).toEqual({ kind: "note", label: "Cobrança automática no cartão" });
    expect(chargeAction({ ...open, status: "overdue" }, "credit_card", true)).toEqual({ kind: "link", label: "Pagar" });
    expect(chargeAction({ ...open, status: "paid" }, "credit_card", true)).toBeNull();
  });

  it("Pix: Pagar com Pix; sem fatura (manual), nada", () => {
    expect(chargeAction({ status: "overdue", invoiceUrl: "https://fatura" }, "pix", false)).toEqual({ kind: "link", label: "Pagar com Pix" });
    expect(chargeAction({ status: "pending", invoiceUrl: null }, null, false)).toBeNull();
  });

  it("cartão já informado = alguma cobrança paga no cartão", () => {
    expect(hasCardOnFile([{ status: "paid", billingType: "PIX" }])).toBe(false);
    expect(hasCardOnFile([{ status: "paid", billingType: "CREDIT_CARD" }])).toBe(true);
  });
});
