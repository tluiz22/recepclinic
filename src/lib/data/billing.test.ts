import { describe, expect, it } from "vitest";
import { changedFields, contractsInForce, contractTermLines, describeAllowance, noticeStartDate, type BillingContract } from "./billing";

// Faturamento (F12.2): qual versão do contrato vale hoje e qual vem depois.
const contract = (over: Partial<BillingContract>): BillingContract => ({
  id: "x",
  version: 1,
  status: "active",
  billingMode: "manual",
  monthlyCents: 29900,
  setupCents: 0,
  paymentMethod: null,
  firstDueDate: "2026-11-10",
  invoiceUnitPriceCents: 80,
  invoiceMonthlyAllowance: 50,
  planSnapshot: {},
  notes: null,
  startsOn: "2026-11-01",
  endsOn: null,
  activatedAt: null,
  termsVersion: "provisorio",
  acceptance: "pending",
  acceptedAt: null,
  acceptedBy: null,
  acceptedIp: null,
  noticeSentAt: null,
  asaasSubscriptionId: null,
  asaasSyncedAt: null,
  asaasSyncError: null,
  ...over,
});

describe("contractsInForce", () => {
  const v1 = contract({ id: "v1", status: "ended", endsOn: "2026-11-30" });
  const v2 = contract({ id: "v2", version: 2, startsOn: "2026-12-01" });

  it("antes do início da nova versão, vale a anterior e a nova é a próxima", () => {
    expect(contractsInForce([v2, v1], "2026-11-15")).toEqual({ current: v1, next: v2 });
  });

  it("no início da nova, ela vale e não há próxima", () => {
    expect(contractsInForce([v2, v1], "2026-12-01")).toEqual({ current: v2, next: null });
  });

  it("rascunho e descartado não valem; antes do 1º início, nada vale", () => {
    const draft = contract({ id: "d", status: "draft", version: null });
    expect(contractsInForce([draft], "2026-11-15")).toEqual({ current: null, next: null });
    expect(contractsInForce([v1], "2026-10-01")).toEqual({ current: null, next: null });
  });
});

describe("textos", () => {
  it("franquia", () => {
    expect(describeAllowance(null)).toBe("ilimitada");
    expect(describeAllowance(1)).toBe("1 nota por mês");
    expect(describeAllowance(50)).toBe("50 notas por mês");
  });

  it("campos mudados na trilha", () => {
    expect(changedFields({ before: { monthly_cents: 1, finance_email: "a" }, after: { monthly_cents: 2, finance_email: "a" } })).toEqual(["mensalidade"]);
    expect(changedFields({ before: null, after: { monthly_cents: 2 } })).toEqual([]);
  });

  it("prazo de 30 dias da mudança (F12.2b), também na virada do ano", () => {
    expect(noticeStartDate("2026-11-02")).toBe("2026-12-02");
    expect(noticeStartDate("2026-12-15")).toBe("2027-01-14");
  });

  it("termos do e-mail da nova versão (F12.2b)", () => {
    const lines = contractTermLines(contract({ paymentMethod: "pix", setupCents: 0 })).map((line) => line.replace(/\s/g, " "));
    expect(lines).toEqual([
      "Mensalidade: R$ 299,00",
      "Implantação: isenta",
      "Forma de pagamento: Pix",
      "Preço por nota fiscal: R$ 0,80",
      "Franquia de notas: 50 notas por mês",
      "Início: 01/11/2026",
      "1º vencimento: 10/11/2026",
    ]);
  });
});
