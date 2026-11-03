// F12.2e (cliente, 03/nov/2026): a cobrança recorrente explicada na tela
// Assinatura, como o CDC pede (valor, periodicidade e renovação antes do
// aceite; autorização nunca pré-marcada) e a ação de cada cobrança conforme a
// forma de pagamento (cartão: só a 1ª pede o cartão; depois, automática).
import { formatCalendarDate } from "./clinicTime";
import { formatCentsBRL } from "./money";

type PaymentMethod = "pix" | "credit_card";
type ContractLike = {
  monthlyCents: number;
  firstDueDate: string;
  paymentMethod: PaymentMethod | null;
  invoiceUnitPriceCents: number | null;
};

/** A frase da autorização da cobrança recorrente (a 2ª caixa do aceite); fica guardada no contrato. */
export function recurringConsentText(paymentMethod: PaymentMethod | null): string {
  if (paymentMethod === "credit_card") return "Autorizo a cobrança automática da mensalidade no cartão de crédito, todo mês, até o cancelamento.";
  if (paymentMethod === "pix") return "Entendo que a mensalidade é cobrada todo mês, por Pix, até o cancelamento.";
  return "Entendo que a mensalidade é cobrada todo mês, até o cancelamento.";
}

/** Dia do mês do vencimento ("todo dia 3"). */
export function dueDay(firstDueDate: string): number {
  return Number(firstDueDate.slice(8, 10));
}

const HOW: Record<PaymentMethod, string> = {
  credit_card: "cobrados automaticamente no cartão de crédito",
  pix: "cobrados por Pix",
};

/** O resumo da renovação mostrado antes do aceite (sem o link do contrato). */
export function renewalSummary(contract: ContractLike): string {
  const how = contract.paymentMethod ? HOW[contract.paymentMethod] : "cobrados pelo RecepClinic";
  const parts = [
    `A partir de ${formatCalendarDate(contract.firstDueDate, "dd/MM/yyyy")}, ${formatCentsBRL(contract.monthlyCents)} todo dia ${dueDay(contract.firstDueDate)}, ${how}, por prazo indeterminado, até a clínica cancelar.`,
  ];
  if (contract.invoiceUnitPriceCents !== null) parts.push("Notas fiscais acima da franquia entram na cobrança do mês seguinte.");
  parts.push("Cancelamento a qualquer momento, nesta tela, sem multa.");
  return parts.join(" ");
}

/** A linha curta da renovação, fora do aceite. */
export function renewalLine(contract: Pick<ContractLike, "monthlyCents" | "firstDueDate">): string {
  return `Renovação automática: ${formatCentsBRL(contract.monthlyCents)} todo dia ${dueDay(contract.firstDueDate)}, até o cancelamento.`;
}

export type ChargeAction = { kind: "link"; label: string } | { kind: "note"; label: string } | null;

/**
 * O que a cobrança em aberto oferece ao Administrador. No cartão, enquanto
 * nenhuma cobrança foi paga no cartão, é preciso informá-lo; depois, as em dia
 * são automáticas e só a vencida (cartão recusado) volta a pedir o pagamento.
 */
export function chargeAction(
  charge: { status: string; invoiceUrl: string | null },
  paymentMethod: PaymentMethod | null,
  cardOnFile: boolean,
): ChargeAction {
  if (charge.status !== "pending" && charge.status !== "overdue") return null;
  if (paymentMethod === "credit_card") {
    if (charge.status === "pending" && cardOnFile) return { kind: "note", label: "Cobrança automática no cartão" };
    if (!charge.invoiceUrl) return null;
    return { kind: "link", label: cardOnFile ? "Pagar" : "Informar o cartão e pagar" };
  }
  if (!charge.invoiceUrl) return null;
  return { kind: "link", label: paymentMethod === "pix" ? "Pagar com Pix" : "Pagar" };
}

/** Já há cartão no Asaas: alguma cobrança paga no cartão. */
export function hasCardOnFile(charges: { status: string; billingType: string | null }[]): boolean {
  return charges.some((c) => c.status === "paid" && c.billingType === "CREDIT_CARD");
}
