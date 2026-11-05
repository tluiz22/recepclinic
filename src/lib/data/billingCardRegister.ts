import type { AsaasBillingApi } from "../asaas/billingApi";
import { finishCardChange, startCardChange } from "./billingCardChange";
import { DataError } from "./errors";
import type { BillingCardRegisterStore } from "./platform";

// Passo Cartão da Assinatura (F12.2i; cliente, 04/nov/2026). O passo só
// termina com o cartão ligado à assinatura das mensalidades no Asaas.
// - Com implantação em aberto: a clínica paga a implantação na página do
//   Asaas; o pagamento traz o token do cartão e o servidor o liga à
//   assinatura, sem cobrar nada (sandbox, 04/nov/2026: pagar a cobrança avulsa
//   NÃO liga o cartão à assinatura sozinho).
// - Sem implantação: o Checkout do Asaas, como na troca de cartão (F12.2g):
//   cartão cadastrado e 1ª mensalidade só no vencimento.
// O RecepClinic não guarda o cartão nem o token: só o final (decisão 11.9).

export type CardRegisterStart = { link: string; mode: "invoice" | "checkout" };
export type CardRegisterStatus = { status: "registered" } | { status: "pending" } | { status: "none" } | { status: "failed"; reason: string };

/** O Asaas recebe o IP no formato IPv4 quando há (local: "::1" → 127.0.0.1; "::ffff:1.2.3.4" → 1.2.3.4). */
export function asaasIp(ip: string | null): string | null {
  if (!ip) return null;
  const clean = ip.trim().replace(/\/\d+$/, "");
  if (clean === "::1") return "127.0.0.1";
  return clean.replace(/^::ffff:/i, "");
}

const PAID = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);

export async function startCardRegistration(
  store: BillingCardRegisterStore,
  api: AsaasBillingApi | null,
  contractId: string,
  input: { today: string; actorId: string | null; successUrl: string; cancelUrl: string },
): Promise<CardRegisterStart> {
  const registration = await store.cardRegistration(contractId);
  if (!registration) throw new DataError("not_found", "Cartão: contrato não encontrado");
  if (registration.registeredAt) throw new DataError("invalid", "Cartão: o cartão já está cadastrado. Para usar outro, \"Trocar o cartão\".");
  if (!api) throw new DataError("invalid", "Cartão: Asaas não configurado neste ambiente");
  const setup = (await store.openCharges(contractId)).find((c) => c.kind === "setup");
  if (setup) {
    const payment = await api.getPayment(setup.paymentId);
    if (payment.invoiceUrl) return { link: payment.invoiceUrl, mode: "invoice" };
  }
  const started = await startCardChange(store, api, contractId, { ...input, purpose: "register" });
  return { link: started.link, mode: "checkout" };
}

/** Confere no Asaas se o cartão já foi informado e, se foi, liga-o à assinatura. */
export async function confirmCardRegistration(
  store: BillingCardRegisterStore,
  api: AsaasBillingApi | null,
  contractId: string,
  remoteIp: string | null,
  now: Date = new Date(),
): Promise<CardRegisterStatus> {
  const registration = await store.cardRegistration(contractId);
  if (!registration) return { status: "none" };
  if (registration.registeredAt) return { status: "registered" };
  if (!api) return { status: "failed", reason: "Asaas não configurado neste ambiente" };
  try {
    // Sem implantação: o Checkout em andamento.
    if (await store.loadCardChange(contractId)) {
      const finished = await finishCardChange(store, api, contractId, now);
      if (finished.status === "changed") {
        const subscription = (await store.load(contractId))?.contract.subscriptionId ?? null;
        const card = subscription ? await api.getSubscriptionCard(subscription) : null;
        await store.recordCardRegistered(contractId, card?.last4 ?? null, "checkout");
        return { status: "registered" };
      }
      if (finished.status === "pending") return { status: "pending" };
      if (finished.status === "failed") return finished;
    }
    // Com implantação: paga no cartão, o token vai para a assinatura.
    if (!registration.setupPaymentId) return { status: "none" };
    const payment = await api.getPayment(registration.setupPaymentId);
    if (!PAID.has(payment.status)) return { status: "pending" };
    const token = payment.card?.token ?? null;
    if (!token) return { status: "failed", reason: "A implantação foi paga, mas o Asaas não devolveu o cartão." };
    const snapshot = await store.load(contractId);
    const subscription = snapshot?.contract.subscriptionId ?? null;
    if (!subscription) return { status: "failed", reason: "Contrato sem assinatura no Asaas" };
    const ip = asaasIp(remoteIp ?? registration.acceptedIp);
    if (!ip) return { status: "failed", reason: "Sem o IP de quem informou o cartão" };
    const card = await api.setSubscriptionCard(subscription, token, ip);
    await store.upsertCharge({
      contractId,
      paymentId: payment.id,
      kind: "setup",
      dueDate: payment.dueDate,
      valueCents: payment.valueCents,
      billingType: payment.billingType,
      rawStatus: payment.status,
      paidAt: payment.paidAt,
      invoiceUrl: payment.invoiceUrl,
    });
    await store.recordCardRegistered(contractId, card.last4 ?? payment.card?.last4 ?? null, "setup");
    return { status: "registered" };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
