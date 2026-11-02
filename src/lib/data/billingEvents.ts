import { timingSafeEqual } from "node:crypto";
import type { AsaasBillingApi } from "../asaas/billingApi";
import { syncContractWithAsaas } from "./billingAsaas";
import type { BillingEventStore } from "./platform";

// Webhook do Asaas e fila de eventos (F12.5, faturamento do SaaS; seção 5,
// recomendações 4 e 5, do planejamento-faturamento-saas.md). O aviso só diz
// "algo mudou": a cobrança é consultada na API antes de mexer no espelho (o
// estado real, decisão 11.2), então a ordem e a repetição dos avisos não
// importam. Conciliação: todo contrato automático aceito é sincronizado de novo.

/** Compara o token do cabeçalho em tempo constante. */
export function webhookTokenMatches(received: string | null, expected: string | null): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type ParsedWebhook = { providerEventId: string; event: string; resourceId: string | null; payload: Record<string, unknown> };

/** Lê o corpo do webhook: id e tipo do evento e o mínimo da cobrança (sem dado pessoal). */
export function parseAsaasWebhook(body: unknown): ParsedWebhook | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as { id?: unknown; event?: unknown; payment?: Record<string, unknown> | null; subscription?: Record<string, unknown> | null };
  if (typeof raw.id !== "string" || !raw.id || typeof raw.event !== "string" || !raw.event) return null;
  const payment = raw.payment && typeof raw.payment === "object" ? raw.payment : null;
  const subscription = raw.subscription && typeof raw.subscription === "object" ? raw.subscription : null;
  const pick = (source: Record<string, unknown> | null, key: string) => (source && typeof source[key] === "string" ? (source[key] as string) : null);
  const resourceId = pick(payment, "id") ?? pick(subscription, "id");
  return {
    providerEventId: raw.id,
    event: raw.event,
    resourceId,
    payload: {
      payment: pick(payment, "id"),
      subscription: pick(payment, "subscription") ?? pick(subscription, "id"),
      externalReference: pick(payment, "externalReference"),
      status: pick(payment, "status"),
    },
  };
}

export type EventsSummary = { processed: number; ignored: number; failed: number };

/** Processa a fila (pendentes e falhas com menos de 10 tentativas). */
export async function processBillingEvents(store: BillingEventStore, api: AsaasBillingApi | null, limit = 50): Promise<EventsSummary> {
  const summary: EventsSummary = { processed: 0, ignored: 0, failed: 0 };
  for (const event of await store.openEvents(limit)) {
    if (!event.event.startsWith("PAYMENT_") || !event.resourceId) {
      // Eventos de assinatura e outros: a conciliação diária cobre.
      await store.finishEvent(event.id, "ignored", null);
      summary.ignored++;
      continue;
    }
    if (!api) {
      await store.finishEvent(event.id, "failed", "Asaas não configurado neste ambiente");
      summary.failed++;
      continue;
    }
    try {
      const payment = await api.getPayment(event.resourceId);
      const contractId = await store.contractForPayment(payment.subscription, payment.externalReference);
      if (!contractId) {
        await store.finishEvent(event.id, "ignored", "cobrança sem contrato do RecepClinic");
        summary.ignored++;
        continue;
      }
      await store.upsertCharge({
        contractId,
        paymentId: payment.id,
        kind: payment.subscription ? "monthly" : "setup",
        dueDate: payment.dueDate,
        valueCents: payment.valueCents,
        billingType: payment.billingType,
        rawStatus: payment.status,
        paidAt: payment.paidAt,
        invoiceUrl: payment.invoiceUrl,
      });
      await store.finishEvent(event.id, "processed", null);
      summary.processed++;
    } catch (error) {
      await store.finishEvent(event.id, "failed", error instanceof Error ? error.message : String(error));
      summary.failed++;
    }
  }
  return summary;
}

/** Conciliação diária: sincroniza de novo cada contrato automático aceito. */
export async function reconcileBilling(store: BillingEventStore, api: AsaasBillingApi | null, today: string): Promise<{ contracts: number; failed: number }> {
  const ids = await store.contractsToReconcile();
  let failed = 0;
  for (const id of ids) {
    const result = await syncContractWithAsaas(store, api, id, today);
    if (result.status === "failed") failed++;
  }
  return { contracts: ids.length, failed };
}
