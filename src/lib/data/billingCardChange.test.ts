import { describe, expect, it } from "vitest";
import type { AsaasBillingApi, AsaasPayment } from "../asaas/billingApi";
import { finishCardChange, startCardChange } from "./billingCardChange";
import type { BillingCardChangeStore, BillingSyncSnapshot, CardChangeRequest } from "./platform";

// F12.2g: troca de cartão pelo Checkout do Asaas (assinatura nova no cartão
// novo; a antiga sai quando o Checkout termina).
const snapshot: BillingSyncSnapshot = {
  clinicId: "cl1",
  clinicName: "Clínica Teste",
  contract: {
    id: "c1",
    version: 1,
    status: "active",
    billingMode: "asaas",
    acceptance: "explicit",
    paymentMethod: "credit_card",
    monthlyCents: 30000,
    setupCents: 0,
    firstDueDate: "2026-12-03",
    subscriptionId: "sub_old",
    replacedSubscriptionId: null,
  },
  account: { payerName: "Clínica", payerDocument: "11222333000181", financeEmail: "f@x", financePhone: null, customerId: "cus_1" },
} as BillingSyncSnapshot;

function setup(options: { open?: { paymentId: string; kind: "monthly" | "setup" | "other"; status: string; dueDate: string }[]; request?: CardChangeRequest | null; subs?: { id: string; billingType: string; nextDueDate: string; dateCreated: string }[] } = {}) {
  const log: string[] = [];
  const store: BillingCardChangeStore = {
    load: async () => snapshot,
    upsertCharge: async (c) => void log.push(`upsert ${c.paymentId} ${c.rawStatus}`),
    loadCardChange: async () => options.request ?? null,
    recordCardChangeRequest: async (_c, checkout, nextDue) => void log.push(`request ${checkout} ${nextDue}`),
    finishCardChange: async (_c, sub, error) => void log.push(`finish ${sub ?? "-"} ${error ?? ""}`.trim()),
    openCharges: async () => options.open ?? [],
    openCardChanges: async () => [],
  };
  const api = {
    createCardCheckout: async (input: { nextDueDate: string; customer: string }) => {
      log.push(`checkout ${input.customer} ${input.nextDueDate}`);
      return { id: "chk_1", link: "https://sandbox.asaas.com/checkout" };
    },
    listCustomerSubscriptions: async () => options.subs ?? [],
    deleteSubscription: async (id: string) => void log.push(`delete-sub ${id}`),
    getPayment: async (id: string): Promise<AsaasPayment> => ({
      id,
      subscription: "sub_old",
      externalReference: null,
      dueDate: "2027-01-03",
      valueCents: 30000,
      billingType: "CREDIT_CARD",
      status: "PENDING",
      paidAt: null,
      invoiceUrl: null,
      deleted: true,
    }),
  } as unknown as AsaasBillingApi;
  return { store, api, log };
}

const urls = { today: "2026-12-20", actorId: "u1", successUrl: "https://app/ok", cancelUrl: "https://app/no" };

describe("troca de cartão", () => {
  it("abre o Checkout no vencimento da mensalidade em aberto (ou no próximo) e registra o pedido", async () => {
    const withOpen = setup({ open: [{ paymentId: "p1", kind: "monthly", status: "pending", dueDate: "2027-01-03" }] });
    expect(await startCardChange(withOpen.store, withOpen.api, "c1", urls)).toEqual({ link: "https://sandbox.asaas.com/checkout" });
    expect(withOpen.log).toEqual(["checkout cus_1 2027-01-03", "request chk_1 2027-01-03"]);
    const none = setup();
    await startCardChange(none.store, none.api, "c1", urls);
    expect(none.log[0]).toBe("checkout cus_1 2027-01-03");
  });

  it("com cobrança vencida, pede para pagar antes", async () => {
    const { store, api } = setup({ open: [{ paymentId: "p0", kind: "monthly", status: "overdue", dueDate: "2026-12-03" }] });
    await expect(startCardChange(store, api, "c1", urls)).rejects.toThrow(/cobrança vencida/);
  });

  it("concluído: a nova entra, a antiga sai e as cobranças em aberto dela ficam canceladas", async () => {
    const request = { checkoutId: "chk_1", requestedAt: new Date("2026-12-20T15:00:00Z"), nextDue: "2027-01-03" };
    const { store, api, log } = setup({
      request,
      open: [{ paymentId: "p1", kind: "monthly", status: "pending", dueDate: "2027-01-03" }],
      subs: [
        { id: "sub_old", billingType: "CREDIT_CARD", nextDueDate: "2027-01-03", dateCreated: "2026-11-03" },
        { id: "sub_new", billingType: "CREDIT_CARD", nextDueDate: "2027-01-03", dateCreated: "2026-12-20" },
      ],
    });
    expect(await finishCardChange(store, api, "c1", new Date("2026-12-20T16:00:00Z"))).toEqual({ status: "changed" });
    expect(log).toEqual(["delete-sub sub_old", "upsert p1 DELETED", "finish sub_new"]);
  });

  it("sem a assinatura nova: espera; depois de 1 dia, descarta o pedido", async () => {
    const request = { checkoutId: "chk_1", requestedAt: new Date("2026-12-20T15:00:00Z"), nextDue: "2027-01-03" };
    const waiting = setup({ request });
    expect(await finishCardChange(waiting.store, waiting.api, "c1", new Date("2026-12-20T16:00:00Z"))).toEqual({ status: "pending" });
    expect(waiting.log).toEqual([]);
    const late = setup({ request });
    expect(await finishCardChange(late.store, late.api, "c1", new Date("2026-12-22T16:00:00Z"))).toEqual({ status: "expired" });
    expect(late.log).toEqual(["finish - O Checkout do Asaas não foi concluído."]);
    expect(await finishCardChange(setup().store, setup().api, "c1")).toEqual({ status: "none" });
  });
});
