import { describe, expect, it } from "vitest";
import type { AsaasBillingApi, AsaasPayment } from "../asaas/billingApi";
import { parseAsaasWebhook, processBillingEvents, webhookTokenMatches } from "./billingEvents";
import type { BillingChargeInput, BillingEventStore, BillingProviderEvent } from "./platform";

// F12.5: webhook do Asaas, fila e processamento pelo estado real da cobrança.
const payment = (over: Partial<AsaasPayment> = {}): AsaasPayment => ({
  id: "pay_1",
  subscription: "sub_1",
  externalReference: null,
  dueDate: "2026-11-10",
  valueCents: 29900,
  billingType: "PIX",
  status: "RECEIVED",
  paidAt: "2026-11-09T12:00:00-03:00",
  invoiceUrl: "https://f",
  ...over,
});

function memory(events: BillingProviderEvent[], contracts: Record<string, string>) {
  const finished: [string, string, string | null][] = [];
  const charges: BillingChargeInput[] = [];
  const store = {
    openEvents: async () => events,
    finishEvent: async (id: string, status: string, error: string | null) => void finished.push([id, status, error]),
    contractForPayment: async (sub: string | null, ref: string | null) => contracts[sub ?? ref ?? ""] ?? null,
    upsertCharge: async (c: BillingChargeInput) => void charges.push(c),
  } as unknown as BillingEventStore;
  return { store, finished, charges };
}

const event = (id: string, name: string, resourceId: string | null = "pay_1"): BillingProviderEvent => ({ id, providerEventId: `evt_${id}`, event: name, resourceId, attempts: 0 });

describe("webhook do Asaas (F12.5)", () => {
  it("token em tempo constante; sem token configurado, recusa", () => {
    expect(webhookTokenMatches("abc", "abc")).toBe(true);
    expect(webhookTokenMatches("abd", "abc")).toBe(false);
    expect(webhookTokenMatches("ab", "abc")).toBe(false);
    expect(webhookTokenMatches(null, "abc")).toBe(false);
    expect(webhookTokenMatches("abc", null)).toBe(false);
  });

  it("lê só o mínimo do aviso", () => {
    expect(
      parseAsaasWebhook({ id: "evt_1", event: "PAYMENT_RECEIVED", payment: { id: "pay_1", subscription: "sub_1", status: "RECEIVED", customer: "cus_1", value: 299, description: "x" } }),
    ).toEqual({ providerEventId: "evt_1", event: "PAYMENT_RECEIVED", resourceId: "pay_1", payload: { payment: "pay_1", subscription: "sub_1", externalReference: null, status: "RECEIVED" } });
    expect(parseAsaasWebhook({ event: "PAYMENT_RECEIVED" })).toBeNull();
    expect(parseAsaasWebhook("lixo")).toBeNull();
  });

  it("processa pelo estado real; implantação pela referência; o resto ignora", async () => {
    const api = {
      getPayment: async (id: string) =>
        id === "pay_setup" ? payment({ id, subscription: null, externalReference: "setup:c1", status: "PENDING", paidAt: null }) : id === "pay_x" ? payment({ id, subscription: "sub_outro" }) : payment({ id }),
    } as unknown as AsaasBillingApi;
    const m = memory(
      [event("1", "PAYMENT_CONFIRMED"), event("2", "PAYMENT_CREATED", "pay_setup"), event("3", "SUBSCRIPTION_UPDATED", "sub_1"), event("4", "PAYMENT_RECEIVED", "pay_x")],
      { sub_1: "c1", "setup:c1": "c1" },
    );
    expect(await processBillingEvents(m.store, api)).toEqual({ processed: 2, ignored: 2, failed: 0 });
    expect(m.charges.map((c) => [c.paymentId, c.kind, c.rawStatus])).toEqual([
      ["pay_1", "monthly", "RECEIVED"],
      ["pay_setup", "setup", "PENDING"],
    ]);
    expect(m.finished.map(([id, status]) => [id, status])).toEqual([
      ["1", "processed"],
      ["2", "processed"],
      ["3", "ignored"],
      ["4", "ignored"],
    ]);
  });

  it("erro na API ou sem Asaas: falhou, para tentar de novo", async () => {
    const api = {
      getPayment: async () => {
        throw new Error("Asaas fora do ar");
      },
    } as unknown as AsaasBillingApi;
    const m = memory([event("1", "PAYMENT_RECEIVED")], { sub_1: "c1" });
    expect(await processBillingEvents(m.store, api)).toEqual({ processed: 0, ignored: 0, failed: 1 });
    expect(m.finished[0]).toEqual(["1", "failed", "Asaas fora do ar"]);
    const n = memory([event("2", "PAYMENT_RECEIVED")], {});
    await processBillingEvents(n.store, null);
    expect(n.finished[0][1]).toBe("failed");
  });
});
