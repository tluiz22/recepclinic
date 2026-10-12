import { describe, expect, it } from "vitest";
import { canReceivePayment, paymentState, summarizePayments } from "./payments";

// Pagamentos (F11.2): soma contra o preço, selo da Agenda e quem recebe pagamento novo.
const p = (amountCents: number, deleted = false) => ({ amountCents, deletedAt: deleted ? new Date() : null });

describe("pagamentos do atendimento", () => {
  it("soma os que valem (sem os excluídos) e mostra o que falta", () => {
    expect(summarizePayments(30000, [p(10000), p(5000, true)])).toEqual({ priceCents: 30000, paidCents: 10000, remainingCents: 20000, overPrice: false });
    expect(summarizePayments(30000, [])).toEqual({ priceCents: 30000, paidCents: 0, remainingCents: 30000, overPrice: false });
  });

  it("acima do preço: falta zero e o aviso", () => {
    expect(summarizePayments(30000, [p(20000), p(15000)])).toEqual({ priceCents: 30000, paidCents: 35000, remainingCents: 0, overPrice: true });
  });

  it("atendimento sem preço: nada falta e nunca fica acima", () => {
    expect(summarizePayments(null, [p(5000)])).toEqual({ priceCents: null, paidCents: 5000, remainingCents: null, overPrice: false });
  });

  it("selo: pago, em parte ou nada", () => {
    expect(paymentState(30000, 0)).toBe("none");
    expect(paymentState(30000, 10000)).toBe("partial");
    expect(paymentState(30000, 30000)).toBe("paid");
    expect(paymentState(30000, 40000)).toBe("paid");
    expect(paymentState(null, 100)).toBe("paid");
    expect(paymentState(0, 0)).toBe("none");
  });

  it("marcado, confirmado e compareceu recebem; cancelado e falta, não", () => {
    expect(["scheduled", "confirmed", "completed"].every((s) => canReceivePayment(s as never))).toBe(true);
    expect(canReceivePayment("canceled")).toBe(false);
    expect(canReceivePayment("no_show")).toBe(false);
  });
});
