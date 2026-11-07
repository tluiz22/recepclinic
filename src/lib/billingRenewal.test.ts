import { describe, expect, it } from "vitest";
import { cancellationPreview, ipcaReminder, chargeAction, dueDay, nextDueAfter, recurringConsentText, renewalLine, renewalSummary } from "./billingRenewal";

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

  it("cartão: sem o cartão, espera o passo Cartão; depois, automática; vencida, Pagar", () => {
    const open = { status: "pending", invoiceUrl: "https://fatura" };
    expect(chargeAction(open, "credit_card", false)).toEqual({ kind: "note", label: "Aguarda o cartão (passo Cartão, acima)" });
    expect(chargeAction({ ...open, status: "overdue" }, "credit_card", false)).toEqual({ kind: "link", label: "Informar o cartão e pagar" });
    expect(chargeAction(open, "credit_card", true)).toEqual({ kind: "note", label: "Cobrança automática no cartão" });
    expect(chargeAction({ ...open, status: "overdue" }, "credit_card", true)).toEqual({ kind: "link", label: "Pagar" });
    expect(chargeAction({ ...open, status: "paid" }, "credit_card", true)).toBeNull();
  });

  it("Pix: Pagar com Pix; sem fatura (manual), nada", () => {
    expect(chargeAction({ status: "overdue", invoiceUrl: "https://fatura" }, "pix", false)).toEqual({ kind: "link", label: "Pagar com Pix" });
    expect(chargeAction({ status: "pending", invoiceUrl: null }, null, false)).toBeNull();
  });

  it("cancelamento: próximo vencimento depois de hoje, véspera como último dia; 7 dias = arrependimento", () => {
    expect(nextDueAfter("2026-12-03", "2027-01-20")).toBe("2027-02-03");
    expect(nextDueAfter("2026-12-03", "2026-11-20")).toBe("2026-12-03");
    expect(nextDueAfter("2026-12-03", "2027-02-03")).toBe("2027-03-03");
    expect(nextDueAfter("2027-01-31", "2027-02-10")).toBe("2027-02-28");
    const accepted = new Date("2027-01-15T12:00:00Z");
    expect(cancellationPreview({ acceptance: "explicit", acceptedAt: accepted, firstDueDate: "2026-12-03" }, "2027-01-20", new Date("2027-01-20T12:00:00Z"))).toEqual({
      kind: "withdrawal",
      accessUntil: "2027-01-20",
      nextDue: "2027-02-03",
    });
    expect(cancellationPreview({ acceptance: "explicit", acceptedAt: accepted, firstDueDate: "2026-12-03" }, "2027-01-23", new Date("2027-01-23T12:00:00Z"))).toEqual({
      kind: "cancel",
      accessUntil: "2027-02-02",
      nextDue: "2027-02-03",
    });
    expect(cancellationPreview({ acceptance: "tacit", acceptedAt: null, firstDueDate: "2026-12-03" }, "2027-01-20").kind).toBe("cancel");
  });

  it("reajuste IPCA: lembra 45 dias antes do aniversário; some com a versão nova montada", () => {
    const v1 = { version: 1, status: "active", startsOn: "2026-01-10", cancel: null, activatedAt: new Date("2026-01-05") };
    expect(ipcaReminder([v1], "2026-11-20")).toBeNull();
    expect(ipcaReminder([v1], "2026-11-26")).toEqual({ anniversary: "2027-01-10", daysLeft: 45 });
    expect(ipcaReminder([v1], "2027-01-10")).toEqual({ anniversary: "2027-01-10", daysLeft: 0 });
    // A versão 2 (mudança no meio do ano) não muda o aniversário.
    const ended = { ...v1, status: "ended" };
    const v2 = { version: 2, status: "active", startsOn: "2026-06-01", cancel: null, activatedAt: new Date("2026-05-01") };
    expect(ipcaReminder([ended, v2], "2026-12-20")).toEqual({ anniversary: "2027-01-10", daysLeft: 21 });
    // Reajuste já montado: a versão que começa no aniversário.
    const v3 = { version: 3, status: "active", startsOn: "2027-01-10", cancel: null, activatedAt: new Date("2026-12-01") };
    expect(ipcaReminder([ended, { ...v2, status: "ended" }, v3], "2026-12-20")).toBeNull();
    // Sem contrato ativo, nada.
    expect(ipcaReminder([ended], "2026-12-20")).toBeNull();
  });
});
