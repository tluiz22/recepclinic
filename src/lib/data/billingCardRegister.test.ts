import { describe, expect, it } from "vitest";
import type { AsaasBillingApi, AsaasPayment } from "../asaas/billingApi";
import { asaasIp, confirmCardRegistration, startCardRegistration } from "./billingCardRegister";
import type { BillingCardRegisterStore, BillingSyncSnapshot, CardChangeRequest, CardRegistration } from "./platform";

// F12.2i: passo Cartão. Com implantação, o cartão que a pagou vai para a
// assinatura (token); sem implantação, o Checkout do Asaas (como a troca).
const snapshot = {
  clinicId: "cl1",
  clinicName: "Clínica Teste",
  contract: {
    id: "c1",
    version: 1,
    status: "active",
    billingMode: "asaas",
    acceptance: "explicit",
    paymentMethod: "credit_card",
    monthlyCents: 29900,
    setupCents: 29700,
    firstDueDate: "2026-11-14",
    subscriptionId: "sub_1",
    replacedSubscriptionId: null,
  },
  account: { payerName: "Clínica", payerDocument: "11222333000181", financeEmail: "f@x", financePhone: null, customerId: "cus_1" },
} as BillingSyncSnapshot;

const payment = (over: Partial<AsaasPayment> = {}): AsaasPayment => ({
  id: "pay_setup",
  subscription: null,
  externalReference: "setup:c1",
  dueDate: "2026-11-04",
  valueCents: 29700,
  billingType: "CREDIT_CARD",
  status: "PENDING",
  paidAt: null,
  invoiceUrl: "https://sandbox.asaas.com/i/setup",
  card: null,
  ...over,
});

function setup(
  options: {
    registration?: Partial<CardRegistration> | null;
    open?: { paymentId: string; kind: "monthly" | "setup" | "other"; status: string; dueDate: string }[];
    payment?: AsaasPayment;
    request?: CardChangeRequest | null;
    subs?: { id: string; billingType: string; nextDueDate: string; dateCreated: string }[];
  } = {},
) {
  const log: string[] = [];
  const store: BillingCardRegisterStore = {
    load: async () => snapshot,
    upsertCharge: async (c) => void log.push(`upsert ${c.paymentId} ${c.rawStatus}`),
    loadCardChange: async () => options.request ?? null,
    recordCardChangeRequest: async (_c, checkout, nextDue) => void log.push(`request ${checkout} ${nextDue}`),
    finishCardChange: async (_c, sub, error) => void log.push(`finish ${sub ?? "-"} ${error ?? ""}`.trim()),
    openCharges: async () => options.open ?? [],
    openCardChanges: async () => [],
    cardRegistration: async () =>
      options.registration === null ? null : { registeredAt: null, acceptedIp: "10.0.0.1", setupPaymentId: "pay_setup", ...options.registration },
    recordCardRegistered: async (_c, last4, source) => void log.push(`registered ${last4 ?? "-"} ${source}`),
    contractsWithoutCard: async () => [],
  };
  const api = {
    getPayment: async () => options.payment ?? payment(),
    setSubscriptionCard: async (sub: string, token: string, ip: string) => {
      log.push(`card ${sub} ${token} ${ip}`);
      return { last4: "8829" };
    },
    getSubscriptionCard: async () => ({ last4: "1111" }),
    createCardCheckout: async (input: { nextDueDate: string }) => {
      log.push(`checkout ${input.nextDueDate}`);
      return { id: "chk_1", link: "https://sandbox.asaas.com/checkout" };
    },
    listCustomerSubscriptions: async () => options.subs ?? [],
    deleteSubscription: async (id: string) => void log.push(`delete-sub ${id}`),
  } as unknown as AsaasBillingApi;
  return { store, api, log };
}

const urls = { today: "2026-11-04", actorId: "u1", successUrl: "https://app/ok", cancelUrl: "https://app/no" };

describe("passo Cartão: abrir a página do Asaas", () => {
  it("com implantação em aberto: a fatura da implantação", async () => {
    const { store, api, log } = setup({ open: [{ paymentId: "pay_setup", kind: "setup", status: "pending", dueDate: "2026-11-04" }] });
    expect(await startCardRegistration(store, api, "c1", urls)).toEqual({ link: "https://sandbox.asaas.com/i/setup", mode: "invoice" });
    expect(log).toEqual([]);
  });

  it("sem implantação: o Checkout, com a 1ª cobrança no vencimento (nada agora)", async () => {
    const { store, api, log } = setup();
    expect(await startCardRegistration(store, api, "c1", urls)).toEqual({ link: "https://sandbox.asaas.com/checkout", mode: "checkout" });
    expect(log).toEqual(["checkout 2026-11-14", "request chk_1 2026-11-14"]);
  });

  it("cartão já cadastrado: recusa (é \"Trocar o cartão\")", async () => {
    const { store, api } = setup({ registration: { registeredAt: new Date() } });
    await expect(startCardRegistration(store, api, "c1", urls)).rejects.toThrow(/já está cadastrado/);
  });
});

describe("passo Cartão: confirmar", () => {
  it("implantação ainda não paga: espera", async () => {
    const { store, api, log } = setup();
    expect(await confirmCardRegistration(store, api, "c1", "1.2.3.4")).toEqual({ status: "pending" });
    expect(log).toEqual([]);
  });

  it("implantação paga no cartão: o token vai para a assinatura, com o IP de quem informou", async () => {
    const { store, api, log } = setup({ payment: payment({ status: "CONFIRMED", paidAt: "2026-11-04T12:00:00-03:00", card: { token: "tok_1", last4: "8829" } }) });
    expect(await confirmCardRegistration(store, api, "c1", "1.2.3.4")).toEqual({ status: "registered" });
    expect(log).toEqual(["card sub_1 tok_1 1.2.3.4", "upsert pay_setup CONFIRMED", "registered 8829 setup"]);
  });

  it("pela conciliação (sem IP): usa o IP do aceite", async () => {
    const { store, api, log } = setup({ payment: payment({ status: "RECEIVED", card: { token: "tok_1", last4: "8829" } }) });
    await confirmCardRegistration(store, api, "c1", null);
    expect(log[0]).toBe("card sub_1 tok_1 10.0.0.1");
  });

  it("paga sem o token do cartão: falha (vai para Sistema › Erros)", async () => {
    const { store, api } = setup({ payment: payment({ status: "CONFIRMED", card: null }) });
    expect(await confirmCardRegistration(store, api, "c1", "1.2.3.4")).toMatchObject({ status: "failed" });
  });

  it("sem implantação: o Checkout concluído liga a assinatura nova e guarda o final", async () => {
    const request = { checkoutId: "chk_1", requestedAt: new Date("2026-11-04T15:00:00Z"), nextDue: "2026-11-14" };
    const { store, api, log } = setup({
      registration: { setupPaymentId: null },
      request,
      subs: [{ id: "sub_new", billingType: "CREDIT_CARD", nextDueDate: "2026-11-14", dateCreated: "2026-11-04" }],
    });
    expect(await confirmCardRegistration(store, api, "c1", "1.2.3.4", new Date("2026-11-04T15:05:00Z"))).toEqual({ status: "registered" });
    expect(log).toEqual(["delete-sub sub_1", "finish sub_new", "registered 1111 checkout"]);
  });

  it("já cadastrado: nada a fazer", async () => {
    const { store, api, log } = setup({ registration: { registeredAt: new Date() } });
    expect(await confirmCardRegistration(store, api, "c1", "1.2.3.4")).toEqual({ status: "registered" });
    expect(log).toEqual([]);
  });
});

describe("IP para o Asaas", () => {
  it("IPv4 quando há; o local vira 127.0.0.1", () => {
    expect(asaasIp("::1")).toBe("127.0.0.1");
    expect(asaasIp("::ffff:10.0.0.7")).toBe("10.0.0.7");
    expect(asaasIp("177.10.20.30/32")).toBe("177.10.20.30");
    expect(asaasIp(null)).toBeNull();
  });
});
