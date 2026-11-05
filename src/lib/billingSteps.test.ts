import { describe, expect, it } from "vitest";
import { paymentStep, subscriptionSteps } from "./billingSteps";

// F12.2i (cliente, 04/nov/2026): Contrato → Cartão (ou Pagamento) → WhatsApp → Pronto.
const contract = (over: Partial<Parameters<typeof paymentStep>[0] & object> = {}) => ({
  status: "active",
  billingMode: "asaas",
  acceptance: "explicit",
  paymentMethod: "credit_card",
  cardRegisteredAt: null,
  paymentStepDismissedAt: null,
  ...over,
});

describe("passo do pagamento", () => {
  it("cartão: até o cartão estar na assinatura, sem pular", () => {
    expect(paymentStep(contract(), false)).toBe("card");
    expect(paymentStep(contract(), true)).toBe("card");
    expect(paymentStep(contract({ cardRegisteredAt: new Date() }), true)).toBeNull();
  });

  it("Pix: só com a implantação em aberto e até \"Pagar depois\"", () => {
    expect(paymentStep(contract({ paymentMethod: "pix" }), true)).toBe("pix");
    expect(paymentStep(contract({ paymentMethod: "pix" }), false)).toBeNull();
    expect(paymentStep(contract({ paymentMethod: "pix", paymentStepDismissedAt: new Date() }), true)).toBeNull();
  });

  it("sem aceite, manual ou sem contrato: não há o passo", () => {
    expect(paymentStep(contract({ acceptance: "pending" }), true)).toBeNull();
    expect(paymentStep(contract({ billingMode: "manual" }), true)).toBeNull();
    expect(paymentStep(null, true)).toBeNull();
  });
});

describe("os passos mostrados", () => {
  it("contrato no cartão, com o WhatsApp: 3 passos e o Pronto", () => {
    const flow = subscriptionSteps({ current: "contract", payment: "card", whatsapp: "pending" });
    expect(flow.steps.map((s) => s.label)).toEqual(["Contrato", "Cartão", "WhatsApp (opcional)", "Pronto"]);
    expect([flow.position, flow.total]).toEqual([1, 3]);
  });

  it("no WhatsApp, o contrato e o cartão aparecem feitos", () => {
    const flow = subscriptionSteps({ current: "whatsapp", payment: "card", whatsapp: "pending" });
    expect(flow.steps.map((s) => s.done)).toEqual([true, true, false, false]);
    expect(flow.remaining).toBe(1);
    expect([flow.position, flow.total]).toEqual([3, 3]);
  });

  it("WhatsApp já respondido: aparece com o visto e não conta como falta", () => {
    const flow = subscriptionSteps({ current: "payment", payment: "card", whatsapp: "dismissed" });
    expect(flow.steps.map((s) => s.label)).toEqual(["Contrato aceito", "Cartão", "WhatsApp: só e-mail", "Pronto"]);
    expect(flow.steps.map((s) => s.done)).toEqual([true, false, true, false]);
    expect([flow.position, flow.total, flow.remaining]).toEqual([2, 3, 1]);
    expect(subscriptionSteps({ current: "payment", payment: "card", whatsapp: "authorized" }).steps[2].label).toBe("WhatsApp autorizado");
  });

  it("Pix sem a conta (Suporte): Pagamento é o passo 2 de 2", () => {
    const flow = subscriptionSteps({ current: "payment", payment: "pix", whatsapp: null });
    expect(flow.steps.map((s) => s.label)).toEqual(["Contrato aceito", "Pagamento", "Pronto"]);
    expect([flow.position, flow.total]).toEqual([2, 2]);
  });
});
