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

/** Próximo vencimento depois de hoje (mesmo dia do mês do 1º vencimento); igual a app.billing_next_due. */
export function nextDueAfter(firstDueDate: string, today: string): string {
  const [y, m, d] = firstDueDate.split("-").map(Number);
  for (let months = 0; ; months += 1) {
    // Mês sem o dia (ex.: 31): o último dia do mês, como o Postgres faz.
    const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
    const due = new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
    if (due > today) return due;
  }
}

/** Véspera de uma data (AAAA-MM-DD). */
export function dayBefore(date: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/**
 * O que o cancelamento faz hoje (F12.2f; igual a cancel_billing_subscription):
 * até 7 dias do aceite, arrependimento (devolve tudo, acesso acaba hoje);
 * depois, acesso até a véspera do próximo vencimento, que continua devido.
 */
export function cancellationPreview(
  contract: { acceptance: string | null; acceptedAt: Date | null; firstDueDate: string },
  today: string,
  now: Date = new Date(),
): { kind: "cancel" | "withdrawal"; accessUntil: string; nextDue: string } {
  const withdrawal = contract.acceptance === "explicit" && !!contract.acceptedAt && now.getTime() - contract.acceptedAt.getTime() <= 7 * 24 * 60 * 60 * 1000;
  const nextDue = nextDueAfter(contract.firstDueDate, today);
  return { kind: withdrawal ? "withdrawal" : "cancel", accessUntil: withdrawal ? today : dayBefore(nextDue), nextDue };
}

/**
 * F12.2h (cliente, 03/nov/2026): lembrete do reajuste anual pelo IPCA para o
 * Suporte, 45 dias antes do aniversário do contrato (início da 1ª versão, sem
 * contar o que veio antes de um cancelamento). Some quando já há uma versão
 * que começa no aniversário ou depois (o reajuste já foi montado).
 */
export const IPCA_REMINDER_DAYS = 45;

export function ipcaReminder(
  contracts: { version: number | null; status: string; startsOn: string; cancel: unknown | null; activatedAt: Date | null }[],
  today: string,
): { anniversary: string; daysLeft: number } | null {
  const versions = contracts.filter((c) => c.version !== null && (c.status === "active" || c.status === "ended"));
  if (!versions.some((c) => c.status === "active")) return null;
  const lastCancel = versions.filter((c) => c.cancel).map((c) => c.activatedAt?.getTime() ?? 0).sort((a, b) => b - a)[0] ?? -1;
  const current = versions.filter((c) => !c.cancel && (c.activatedAt?.getTime() ?? 0) > lastCancel);
  if (current.length === 0) return null;
  const start = current.map((c) => c.startsOn).sort()[0];
  const [y, m, d] = start.split("-").map(Number);
  let anniversary = "";
  for (let years = 1; ; years += 1) {
    const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
    anniversary = new Date(Date.UTC(y + years, m - 1, Math.min(d, last))).toISOString().slice(0, 10);
    if (anniversary >= today) break;
  }
  const daysLeft = Math.round((Date.parse(`${anniversary}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (daysLeft > IPCA_REMINDER_DAYS) return null;
  if (current.some((c) => c.status === "active" && c.startsOn >= anniversary)) return null;
  return { anniversary, daysLeft };
}
