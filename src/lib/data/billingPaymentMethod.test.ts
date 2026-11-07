import { describe, expect, it } from "vitest";
import type { AsaasBillingApi, AsaasPayment } from "../asaas/billingApi";
import { switchToPix } from "./billingPaymentMethod";
import type { BillingPaymentMethodStore, BillingSyncSnapshot, CardChangeRequest } from "./platform";

// Troca cartão → Pix (cliente, 07/nov/2026): o Asaas muda antes do contrato; cobranças em aberto passam a Pix.
const snapshot = (method: "credit_card" | "pix" = "credit_card", subscriptionId: string | null = "sub_1"): BillingSyncSnapshot =>
  ({
    clinicId: "cl1",
    clinicName: "Clínica Teste",
    contract: {
      id: "c1",
      version: 1,
      status: "active",
      billingMode: "asaas",
      acceptance: "explicit",
      paymentMethod: method,
      monthlyCents: 30000,
      setupCents: 0,
      firstDueDate: "2026-12-10",
      subscriptionId,
      replacedSubscriptionId: null,
    },
    account: { payerName: "Clínica", payerDocument: "11222333000181", financeEmail: "f@x", financePhone: null, customerId: "cus_1", address: null },
  }) as BillingSyncSnapshot;

type Open = { paymentId: string; kind: "monthly" | "setup" | "other"; status: string; dueDate: string };

function setup(options: { snap?: BillingSyncSnapshot; open?: Open[]; request?: CardChangeRequest | null; types?: Record<string, string> } = {}) {
  const log: string[] = [];
  const types = { ...(options.types ?? {}) };
  const store: BillingPaymentMethodStore = {
    load: async () => options.snap ?? snapshot(),
    upsertCharge: async (c) => void log.push(`upsert ${c.paymentId} ${c.billingType}`),
    openCharges: async () => options.open ?? [],
    loadCardChange: async () => options.request ?? null,
    setPaymentMethod: async (_c, method, actor, kind) => (log.push(`contrato ${method} ${actor} ${kind}`), true),
  };
  const api = {
    setSubscriptionBillingType: async (id: string, type: string) => {
      log.push(`assinatura ${id} ${type}`);
      // updatePendingPayments: as pendentes da assinatura mudam juntas.
      for (const key of Object.keys(types)) if (key.startsWith("pend")) types[key] = type;
    },
    setPaymentBillingType: async (id: string, type: string) => {
      log.push(`cobrança ${id} ${type}`);
      types[id] = type;
    },
    getPayment: async (id: string): Promise<AsaasPayment> => ({
      id,
      subscription: "sub_1",
      externalReference: null,
      dueDate: "2026-12-10",
      valueCents: 30000,
      billingType: types[id] ?? "CREDIT_CARD",
      status: "PENDING",
      paidAt: null,
      invoiceUrl: "https://asaas/i",
      deleted: false,
    }),
  } as unknown as AsaasBillingApi;
  return { store, api, log };
}

const input = { actorId: "u1", actorKind: "clinic" as const, today: "2026-12-01" };

describe("troca cartão → Pix", () => {
  it("muda a assinatura, cada cobrança em aberto que ficou no cartão e só então o contrato", async () => {
    const { store, api, log } = setup({
      open: [
        { paymentId: "pend1", kind: "monthly", status: "pending", dueDate: "2026-12-10" },
        { paymentId: "venc1", kind: "monthly", status: "overdue", dueDate: "2026-11-10" },
      ],
      types: { pend1: "CREDIT_CARD", venc1: "CREDIT_CARD" },
    });
    expect(await switchToPix(store, api, "c1", input)).toEqual({ status: "changed", nextDue: "2026-12-10" });
    expect(log).toEqual([
      "assinatura sub_1 PIX",
      "upsert pend1 PIX",
      "cobrança venc1 PIX",
      "upsert venc1 PIX",
      "contrato pix u1 clinic",
    ]);
  });

  it("já no Pix: nada muda", async () => {
    const { store, api, log } = setup({ snap: snapshot("pix") });
    expect(await switchToPix(store, api, "c1", input)).toEqual({ status: "unchanged" });
    expect(log).toEqual([]);
  });

  it("com troca de cartão em andamento, recusa sem mexer no Asaas", async () => {
    const { store, api, log } = setup({ request: { checkoutId: "chk", requestedAt: new Date(), nextDue: "2026-12-10" } });
    await expect(switchToPix(store, api, "c1", input)).rejects.toThrow("troca de cartão em andamento");
    expect(log).toEqual([]);
  });

  it("sem a assinatura no Asaas ou sem o Asaas configurado, recusa", async () => {
    const noSub = setup({ snap: snapshot("credit_card", null) });
    await expect(switchToPix(noSub.store, noSub.api, "c1", input)).rejects.toThrow("ainda não foi criada");
    const ok = setup();
    await expect(switchToPix(ok.store, null, "c1", input)).rejects.toThrow("Asaas não configurado");
  });

  it("falha no Asaas: o contrato não muda", async () => {
    const { store, api, log } = setup();
    (api as unknown as { setSubscriptionBillingType: () => Promise<void> }).setSubscriptionBillingType = async () => {
      throw new Error("Asaas recusou (400)");
    };
    await expect(switchToPix(store, api, "c1", input)).rejects.toThrow("Asaas recusou");
    expect(log.some((l) => l.startsWith("contrato"))).toBe(false);
  });
});
