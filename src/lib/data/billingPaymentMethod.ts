import type { AsaasBillingApi } from "../asaas/billingApi";
import { DataError } from "./errors";
import type { BillingPaymentMethodStore } from "./platform";

// Troca da forma de pagamento (cliente, 07/nov/2026; plano do faturamento, "Troca cartão ↔ Pix"). Cartão → Pix: o
// Administrador ou o Suporte; a assinatura do Asaas passa a Pix junto com as cobranças pendentes
// (updatePendingPayments) e cada cobrança em aberto que ficou no cartão (vencida ou implantação) muda uma a uma
// (conferido no sandbox, 07/nov/2026). Só depois o contrato muda (o cartão sai dele), com registro na trilha.
// Pix → cartão é o Checkout da troca de cartão (billingCardChange.ts, purpose "switch").

export type PixSwitchResult = { status: "changed"; nextDue: string | null } | { status: "unchanged" };

export async function switchToPix(
  store: BillingPaymentMethodStore,
  api: AsaasBillingApi | null,
  contractId: string,
  input: { actorId: string | null; actorKind: "clinic" | "support"; today: string },
): Promise<PixSwitchResult> {
  const snapshot = await store.load(contractId);
  const contract = snapshot?.contract;
  if (!snapshot || !contract || contract.status !== "active" || contract.billingMode !== "asaas") {
    throw new DataError("not_found", "Forma de pagamento: não há assinatura ativa no Asaas");
  }
  if (contract.paymentMethod === "pix") return { status: "unchanged" };
  if (!contract.subscriptionId) throw new DataError("invalid", "Forma de pagamento: a assinatura ainda não foi criada no Asaas. Tente de novo em instantes.");
  if (await store.loadCardChange(contractId)) {
    throw new DataError("invalid", "Forma de pagamento: há uma troca de cartão em andamento. Conclua ou espere 1 dia e tente de novo.");
  }
  if (!api) throw new DataError("invalid", "Forma de pagamento: Asaas não configurado neste ambiente");

  await api.setSubscriptionBillingType(contract.subscriptionId, "PIX");
  const open = await store.openCharges(contractId);
  for (const charge of open) {
    let payment = await api.getPayment(charge.paymentId);
    if (!payment.deleted && payment.billingType !== "PIX") {
      await api.setPaymentBillingType(charge.paymentId, "PIX");
      payment = await api.getPayment(charge.paymentId);
    }
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
  await store.setPaymentMethod(contractId, "pix", input.actorId, input.actorKind);
  const nextDue = open.filter((c) => c.kind === "monthly" && c.dueDate >= input.today).map((c) => c.dueDate).sort()[0] ?? null;
  return { status: "changed", nextDue };
}
