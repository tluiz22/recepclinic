import { describe, expect, it } from "vitest";
import type { AsaasBillingApi, AsaasPayment } from "../asaas/billingApi";
import { applyCancellationInAsaas } from "./billingCancel";
import type { BillingCancelSnapshot, BillingCancelStore, BillingChargeInput } from "./platform";

// F12.2f: o ajuste do cancelamento no Asaas (arrependimento estorna e remove;
// cancelamento termina a assinatura no próximo vencimento).
function setup(snapshot: BillingCancelSnapshot | null, failOn?: string) {
  const calls: string[] = [];
  const upserts: BillingChargeInput[] = [];
  const synced: (string | null)[] = [];
  const store: BillingCancelStore = {
    loadCancel: async () => snapshot,
    recordCancelSync: async (_id, error) => void synced.push(error),
    upsertCharge: async (charge) => void upserts.push(charge),
    cancelsToSync: async () => [],
    suspendEnded: async () => 0,
  };
  const step = (name: string) => async () => {
    if (failOn === name) throw new Error(`falhou ${name}`);
  };
  const api = {
    refundPayment: async (id: string) => (await step("refund")(), void calls.push(`refund ${id}`)),
    deletePayment: async (id: string) => void calls.push(`delete ${id}`),
    deleteSubscription: async (id: string) => void calls.push(`delete-sub ${id}`),
    endSubscriptionOn: async (id: string, date: string) => void calls.push(`end ${id} ${date}`),
    getPayment: async (id: string): Promise<AsaasPayment> => ({
      id,
      subscription: "sub_1",
      externalReference: null,
      dueDate: "2027-02-03",
      valueCents: 30000,
      billingType: "PIX",
      status: id === "pay_paid" ? "REFUNDED" : "PENDING",
      paidAt: null,
      invoiceUrl: null,
      deleted: id !== "pay_paid",
    }),
  } as unknown as AsaasBillingApi;
  return { store, api, calls, upserts, synced };
}

const base: BillingCancelSnapshot = {
  contractId: "c1",
  kind: "withdrawal",
  billingMode: "asaas",
  subscriptionId: "sub_1",
  nextDue: "2027-02-03",
  charges: [
    { paymentId: "pay_paid", kind: "setup", status: "paid", dueDate: "2027-01-15" },
    { paymentId: "pay_open", kind: "monthly", status: "pending", dueDate: "2027-02-03" },
    { paymentId: "pay_gone", kind: "monthly", status: "canceled", dueDate: "2027-01-01" },
  ],
};

describe("cancelamento no Asaas", () => {
  it("arrependimento: estorna a paga, remove a em aberto e a assinatura; o espelho acompanha", async () => {
    const { store, api, calls, upserts, synced } = setup(base);
    expect(await applyCancellationInAsaas(store, api, "c1")).toEqual({ status: "synced" });
    expect(calls).toEqual(["refund pay_paid", "delete pay_open", "delete-sub sub_1"]);
    expect(upserts.map((u) => [u.paymentId, u.rawStatus])).toEqual([
      ["pay_paid", "REFUNDED"],
      ["pay_open", "DELETED"],
    ]);
    expect(synced).toEqual([null]);
  });

  it("cancelamento: a assinatura termina no próximo vencimento; mensalidade depois dele sai", async () => {
    const { store, api, calls } = setup({
      ...base,
      kind: "cancel",
      charges: [
        { paymentId: "pay_now", kind: "monthly", status: "pending", dueDate: "2027-02-03" },
        { paymentId: "pay_later", kind: "monthly", status: "pending", dueDate: "2027-03-03" },
        { paymentId: "pay_old", kind: "setup", status: "overdue", dueDate: "2026-12-01" },
      ],
    });
    expect(await applyCancellationInAsaas(store, api, "c1")).toEqual({ status: "synced" });
    expect(calls).toEqual(["end sub_1 2027-02-03", "delete pay_later"]);
  });

  it("modo manual ou sem assinatura: nada a fazer; falha fica registrada", async () => {
    expect((await applyCancellationInAsaas(setup({ ...base, billingMode: "manual" }).store, setup(null).api, "c1")).status).toBe("skipped");
    expect((await applyCancellationInAsaas(setup(null).store, setup(null).api, "c1")).status).toBe("skipped");
    const failing = setup(base, "refund");
    expect(await applyCancellationInAsaas(failing.store, failing.api, "c1")).toEqual({ status: "failed", reason: "falhou refund" });
    expect(failing.synced).toEqual(["falhou refund"]);
    const noApi = setup(base);
    expect((await applyCancellationInAsaas(noApi.store, null, "c1")).status).toBe("failed");
  });
});
