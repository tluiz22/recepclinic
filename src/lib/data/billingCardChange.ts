import type { AsaasBillingApi } from "../asaas/billingApi";
import { nextDueAfter } from "../billingRenewal";
import { DataError } from "./errors";
import type { BillingCardChangeStore } from "./platform";

// Troca de cartão pelo Administrador (F12.2g; cliente, 03/nov/2026). O Asaas
// não troca o cartão de uma assinatura sem receber o cartão; para o RecepClinic
// não ver o cartão (decisão 11.9), "Trocar o cartão" abre o Checkout do Asaas,
// que cria uma assinatura nova no cartão novo com a 1ª cobrança no próximo
// vencimento (nada é cobrado na hora; sandbox, 03/nov/2026). Concluído o
// Checkout, a assinatura antiga sai (com as cobranças em aberto dela) e a nova
// entra no contrato. O Asaas não leva a nossa referência para a assinatura do
// Checkout: a nova é a do mesmo cliente, no cartão, criada depois do pedido e
// com o vencimento pedido.

export type CardChangeStart = { link: string };
export type CardChangeFinish = { status: "changed" } | { status: "pending" } | { status: "expired" } | { status: "none" } | { status: "failed"; reason: string };

const EXPIRY_MS = 24 * 60 * 60 * 1000;

export async function startCardChange(
  store: BillingCardChangeStore,
  api: AsaasBillingApi | null,
  contractId: string,
  input: { today: string; actorId: string | null; successUrl: string; cancelUrl: string; purpose?: "change" | "register" },
): Promise<CardChangeStart> {
  const snapshot = await store.load(contractId);
  const contract = snapshot?.contract;
  if (!snapshot || !contract || contract.status !== "active") throw new DataError("not_found", "Troca de cartão: não há assinatura ativa");
  if (contract.billingMode !== "asaas" || contract.paymentMethod !== "credit_card" || !contract.subscriptionId || !snapshot.account?.customerId) {
    throw new DataError("invalid", "Troca de cartão: a assinatura não é no cartão de crédito");
  }
  if (!api) throw new DataError("invalid", "Troca de cartão: Asaas não configurado neste ambiente");
  const open = await store.openCharges(contractId);
  if (open.some((c) => c.status === "overdue")) {
    throw new DataError("invalid", "Troca de cartão: há cobrança vencida. Pague-a primeiro em \"Pagar\" (dá para usar outro cartão); depois troque o cartão.");
  }
  // A próxima mensalidade em aberto (que passa para o cartão novo), ou a próxima a gerar.
  const pendingMonthly = open.filter((c) => c.kind === "monthly" && c.dueDate >= input.today).map((c) => c.dueDate).sort()[0];
  const nextDue = pendingMonthly ?? nextDueAfter(contract.firstDueDate, input.today);
  const checkout = await api.createCardCheckout({
    customer: snapshot.account.customerId,
    valueCents: contract.monthlyCents,
    nextDueDate: nextDue,
    itemName: "Mensalidade RecepClinic",
    description: `Mensalidade do RecepClinic (${snapshot.clinicName}), ${input.purpose === "register" ? "no cartão" : "no cartão novo"}, a partir de ${nextDue.split("-").reverse().join("/")}.`,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    externalReference: `card:${contractId}`,
  });
  await store.recordCardChangeRequest(contractId, checkout.id, nextDue, input.actorId);
  return { link: checkout.link };
}

export async function finishCardChange(store: BillingCardChangeStore, api: AsaasBillingApi | null, contractId: string, now: Date = new Date()): Promise<CardChangeFinish> {
  const request = await store.loadCardChange(contractId);
  if (!request) return { status: "none" };
  const snapshot = await store.load(contractId);
  const oldSubscription = snapshot?.contract.subscriptionId ?? null;
  const customer = snapshot?.account?.customerId ?? null;
  if (!api || !snapshot || !oldSubscription || !customer) return { status: "failed", reason: "Asaas não configurado ou contrato sem assinatura" };
  try {
    const requestedOn = request.requestedAt.toISOString().slice(0, 10);
    const created = (await api.listCustomerSubscriptions(customer)).find(
      (sub) => sub.id !== oldSubscription && sub.billingType === "CREDIT_CARD" && sub.dateCreated.slice(0, 10) >= requestedOn && sub.nextDueDate >= request.nextDue,
    );
    if (!created) {
      if (now.getTime() - request.requestedAt.getTime() > EXPIRY_MS) {
        await store.finishCardChange(contractId, null, "O Checkout do Asaas não foi concluído.");
        return { status: "expired" };
      }
      return { status: "pending" };
    }
    // Sai a assinatura antiga; o Asaas remove junto as cobranças em aberto dela.
    const open = await store.openCharges(contractId);
    await api.deleteSubscription(oldSubscription);
    for (const charge of open) {
      const payment = await api.getPayment(charge.paymentId);
      if (payment.subscription !== oldSubscription) continue;
      await store.upsertCharge({
        contractId,
        paymentId: charge.paymentId,
        kind: charge.kind,
        dueDate: payment.dueDate,
        valueCents: payment.valueCents,
        billingType: payment.billingType,
        rawStatus: payment.deleted ? "DELETED" : payment.status,
        paidAt: payment.paidAt,
        invoiceUrl: payment.invoiceUrl,
      });
    }
    await store.finishCardChange(contractId, created.id, null);
    return { status: "changed" };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
