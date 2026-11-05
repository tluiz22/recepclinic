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

/**
 * Os passos mostrados. O WhatsApp aparece sempre que o Administrador vê o
 * passo a passo (cliente, 04/nov/2026): já respondido, com o visto ("WhatsApp
 * autorizado" ou "WhatsApp: só e-mail"). O pagamento, quando faz parte.
 */
export function subscriptionSteps(input: {
  current: StepKey;
  payment: "card" | "pix" | null;
  whatsapp: "pending" | "authorized" | "dismissed" | null;
}): { steps: Step[]; position: number; total: number; remaining: number } {
  const order: StepKey[] = ["contract", "payment", "whatsapp"];
  const after = (key: StepKey) => order.indexOf(input.current) > order.indexOf(key);
  const steps: Step[] = [{ key: "contract", label: input.current === "contract" ? "Contrato" : "Contrato aceito", done: input.current !== "contract" }];
  if (input.payment) steps.push({ key: "payment", label: input.payment === "card" ? "Cartão" : "Pagamento", done: after("payment") });
  if (input.whatsapp) {
    const answered = input.whatsapp !== "pending";
    const label = input.whatsapp === "authorized" ? "WhatsApp autorizado" : input.whatsapp === "dismissed" ? "WhatsApp: só e-mail" : "WhatsApp (opcional)";
    steps.push({ key: "whatsapp", label, done: answered || after("whatsapp") });
  }
  steps.push({ key: "done", label: "Pronto", done: false });
  const actions = steps.filter((s) => s.key !== "done");
  const position = actions.findIndex((s) => s.key === input.current) + 1;
  // Os que ainda faltam: o atual e os seguintes não feitos.
  const remaining = actions.filter((s, i) => i + 1 >= position && !(s.done && s.key !== input.current)).length;
  return { steps, position, total: actions.length, remaining };
}
