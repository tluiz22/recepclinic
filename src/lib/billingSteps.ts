// Passo a passo da Assinatura (F12.2e; F12.2i, cliente, 04/nov/2026):
// Contrato → Cartão (ou Pagamento, no Pix) → WhatsApp (opcional) → Pronto.

type StepContract = {
  status: string;
  billingMode: string;
  acceptance: string | null;
  paymentMethod: string | null;
  cardRegisteredAt: Date | null;
  paymentStepDismissedAt: Date | null;
};

/**
 * O passo do pagamento que falta no contrato aceito: no cartão, até o cartão
 * estar ligado à assinatura (sem "Informar depois"); no Pix, enquanto a
 * implantação estiver em aberto e a clínica não escolheu "Pagar depois".
 */
export function paymentStep(contract: StepContract | null, openSetup: boolean): "card" | "pix" | null {
  if (!contract || contract.status !== "active" || contract.billingMode !== "asaas") return null;
  if (contract.acceptance !== "explicit" && contract.acceptance !== "tacit") return null;
  if (contract.paymentMethod === "credit_card") return contract.cardRegisteredAt ? null : "card";
  if (contract.paymentMethod === "pix") return openSetup && !contract.paymentStepDismissedAt ? "pix" : null;
  return null;
}

export type StepKey = "contract" | "payment" | "whatsapp";
export type Step = { key: StepKey | "done"; label: string; done: boolean };

/** Os passos mostrados (o do pagamento e o do WhatsApp só quando fazem parte). */
export function subscriptionSteps(input: {
  current: StepKey;
  payment: "card" | "pix" | null;
  whatsapp: boolean;
}): { steps: Step[]; position: number; total: number } {
  const steps: Step[] = [{ key: "contract", label: input.current === "contract" ? "Contrato" : "Contrato aceito", done: input.current !== "contract" }];
  if (input.payment) {
    const label = input.payment === "card" ? "Cartão" : "Pagamento";
    steps.push({ key: "payment", label, done: input.current === "whatsapp" });
  }
  if (input.whatsapp) steps.push({ key: "whatsapp", label: "WhatsApp (opcional)", done: false });
  steps.push({ key: "done", label: "Pronto", done: false });
  const actions = steps.filter((s) => s.key !== "done");
  return { steps, position: actions.findIndex((s) => s.key === input.current) + 1, total: actions.length };
}
