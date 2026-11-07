import type { AsaasBillingApi, AsaasPayment } from "../asaas/billingApi";
import type { BillingCancelStore } from "./platform";

// Cancelamento da assinatura no Asaas (F12.2f; contrato aprovado em
// 03/nov/2026). Depois que o Administrador cancela (o banco já encerrou o
// contrato), o servidor ajusta o Asaas:
// - cancelamento normal: a assinatura termina no próximo vencimento (a
//   mensalidade desse dia ainda sai; nada depois); cobrança em aberto com
//   vencimento depois dele é removida;
// - arrependimento (até 7 dias do aceite): estorna as cobranças pagas, remove
//   as em aberto e a assinatura.
// Falha fica no contrato e na trilha; a conciliação diária tenta de novo.
// Cada passo pode repetir: removido ou estornado de novo não muda nada.

export type CancelSyncResult = { status: "synced" } | { status: "skipped"; reason: string } | { status: "failed"; reason: string };

const OPEN = new Set(["pending", "overdue"]);

export async function applyCancellationInAsaas(store: BillingCancelStore, api: AsaasBillingApi | null, contractId: string): Promise<CancelSyncResult> {
  const snapshot = await store.loadCancel(contractId);
  if (!snapshot) return { status: "skipped", reason: "contrato não cancelado" };
  if (snapshot.billingMode !== "asaas" || !snapshot.subscriptionId) return { status: "skipped", reason: "sem cobrança no Asaas" };
  const fail = async (reason: string): Promise<CancelSyncResult> => {
    await store.recordCancelSync(contractId, reason);
    return { status: "failed", reason };
  };
  if (!api) return fail("Asaas não configurado neste ambiente (ASAAS_API_KEY e ASAAS_BASE_URL)");

  try {
    const touched: string[] = [];
    if (snapshot.kind === "withdrawal") {
      for (const charge of snapshot.charges) {
        if (charge.status === "paid") {
          await api.refundPayment(charge.paymentId);
          touched.push(charge.paymentId);
        } else if (OPEN.has(charge.status)) {
          await api.deletePayment(charge.paymentId);
          touched.push(charge.paymentId);
        }
      }
      await api.deleteSubscription(snapshot.subscriptionId);
    } else {
      await api.endSubscriptionOn(snapshot.subscriptionId, snapshot.nextDue!);
      for (const charge of snapshot.charges) {
        if (charge.kind === "monthly" && OPEN.has(charge.status) && charge.dueDate > snapshot.nextDue!) {
          await api.deletePayment(charge.paymentId);
          touched.push(charge.paymentId);
        }
      }
    }
    // O espelho acompanha o Asaas (estornada, removida).
    for (const paymentId of touched) {
      const payment: AsaasPayment = await api.getPayment(paymentId);
      const kind = snapshot.charges.find((c) => c.paymentId === paymentId)!.kind;
      await store.upsertCharge({
        contractId,
        paymentId,
        kind,
        dueDate: payment.dueDate,
        valueCents: payment.valueCents,
        billingType: payment.billingType,
        rawStatus: payment.deleted ? "DELETED" : payment.status,
        paidAt: payment.paidAt,
        invoiceUrl: payment.invoiceUrl,
      });
    }
    await store.recordCancelSync(contractId, null);
    return { status: "synced" };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
