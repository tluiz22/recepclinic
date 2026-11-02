import { describe, expect, it } from "vitest";
import type { AsaasBillingApi, AsaasPayment } from "../asaas/billingApi";
import { asaasMobilePhone, subscriptionStart, syncContractWithAsaas } from "./billingAsaas";
import type { BillingChargeInput, BillingStore, BillingSyncSnapshot } from "./platform";

// F12.4: a cobrança nasce no Asaas no aceite (itens 28 e 29; cliente, 02/nov/2026).
const TODAY = "2026-11-02";

function snapshot(over: Partial<BillingSyncSnapshot["contract"]> = {}, account: Partial<NonNullable<BillingSyncSnapshot["account"]>> = {}): BillingSyncSnapshot {
  return {
    clinicId: "clinic-1",
    clinicName: "Clínica Sorriso",
    contract: {
      id: "contract-1",
      version: 1,
      status: "active",
      billingMode: "asaas",
      acceptance: "explicit",
      paymentMethod: "pix",
      monthlyCents: 29900,
      setupCents: 29700,
      firstDueDate: "2026-11-10",
      subscriptionId: null,
      replacedSubscriptionId: null,
      ...over,
    },
    account: { payerName: "Clínica Ltda", payerDocument: "11222333000181", financeEmail: "fin@x.y", financePhone: "+5584988880000", customerId: null, ...account },
  };
}

function memoryStore(snap: BillingSyncSnapshot | null) {
  const log: string[] = [];
  const charges: BillingChargeInput[] = [];
  let syncError: string | null | undefined;
  const store: BillingStore = {
    load: async () => snap,
    linkCustomer: async (_c, id) => void log.push(`customer:${id}`),
    linkSubscription: async (_c, id) => void log.push(`subscription:${id}`),
    upsertCharge: async (c) => void charges.push(c),
    recordSync: async (_c, error) => void (syncError = error),
  };
  return { store, log, charges, syncError: () => syncError };
}

const payment = (id: string, over: Partial<AsaasPayment> = {}): AsaasPayment => ({
  id,
  subscription: null,
  externalReference: null,
  dueDate: TODAY,
  valueCents: 29700,
  billingType: "PIX",
  status: "PENDING",
  paidAt: null,
  invoiceUrl: `https://fatura/${id}`,
  ...over,
});

function fakeApi(found: { customer?: string; subscription?: string; setup?: AsaasPayment } = {}) {
  const calls: { name: string; args: unknown }[] = [];
  const api: AsaasBillingApi = {
    findCustomer: async () => found.customer ?? null,
    createCustomer: async (args) => (calls.push({ name: "createCustomer", args }), "cus_new"),
    findSubscription: async () => found.subscription ?? null,
    createSubscription: async (args) => (calls.push({ name: "createSubscription", args }), "sub_new"),
    findPayment: async () => found.setup ?? null,
    createPayment: async (args) => (calls.push({ name: "createPayment", args }), payment("pay_setup")),
    listSubscriptionPayments: async () => [payment("pay_m1", { dueDate: "2026-11-10", valueCents: 29900 })],
    getPayment: async (id) => payment(id),
  };
  return { api, calls };
}

describe("cobrança no Asaas no aceite (F12.4)", () => {
  it("cria cliente, assinatura e a implantação que vence hoje; copia as cobranças", async () => {
    const memory = memoryStore(snapshot());
    const { api, calls } = fakeApi();
    expect(await syncContractWithAsaas(memory.store, api, "contract-1", TODAY)).toEqual({ status: "synced" });
    expect(memory.log).toEqual(["customer:cus_new", "subscription:sub_new"]);
    expect(calls.map((c) => c.name)).toEqual(["createCustomer", "createSubscription", "createPayment"]);
    expect(calls[0].args).toMatchObject({ cpfCnpj: "11222333000181", mobilePhone: "84988880000", externalReference: "clinic-1" });
    expect(calls[1].args).toMatchObject({ customer: "cus_new", billingType: "PIX", valueCents: 29900, nextDueDate: "2026-11-10", externalReference: "contract-1" });
    expect(calls[2].args).toMatchObject({ valueCents: 29700, dueDate: TODAY, externalReference: "setup:contract-1" });
    expect(memory.charges.map((c) => [c.paymentId, c.kind])).toEqual([
      ["pay_setup", "setup"],
      ["pay_m1", "monthly"],
    ]);
    expect(memory.syncError()).toBeNull();
  });

  it("de novo, acha o que já existe no Asaas e não duplica", async () => {
    const memory = memoryStore(snapshot({ subscriptionId: null }, { customerId: null }));
    const { api, calls } = fakeApi({ customer: "cus_old", subscription: "sub_old", setup: payment("pay_setup_old") });
    await syncContractWithAsaas(memory.store, api, "contract-1", TODAY);
    expect(calls).toEqual([]);
    expect(memory.log).toEqual(["customer:cus_old", "subscription:sub_old"]);
  });

  it("implantação isenta não gera cobrança; 1º vencimento que já passou vira hoje", async () => {
    const memory = memoryStore(snapshot({ setupCents: 0, firstDueDate: "2026-10-30" }));
    const { api, calls } = fakeApi();
    await syncContractWithAsaas(memory.store, api, "contract-1", TODAY);
    expect(calls.map((c) => c.name)).toEqual(["createCustomer", "createSubscription"]);
    expect(calls[1].args).toMatchObject({ nextDueDate: TODAY });
  });

  it("não faz nada: manual, sem aceite, encerrado ou mudança de versão", async () => {
    const { api, calls } = fakeApi();
    for (const over of [{ billingMode: "manual" }, { acceptance: "pending" }, { status: "ended" }, { replacedSubscriptionId: "sub_v1" }]) {
      const result = await syncContractWithAsaas(memoryStore(snapshot(over)).store, api, "contract-1", TODAY);
      expect(result.status).toBe("skipped");
    }
    expect(calls).toEqual([]);
  });

  it("sem Asaas configurado ou com erro: fica registrado para tentar de novo", async () => {
    const memory = memoryStore(snapshot());
    expect(await syncContractWithAsaas(memory.store, null, "contract-1", TODAY)).toMatchObject({ status: "failed" });
    expect(memory.syncError()).toMatch(/não configurado/);
    const { api } = fakeApi();
    api.createSubscription = async () => {
      throw new Error("Asaas recusou (400): cliente inválido");
    };
    const second = memoryStore(snapshot());
    expect(await syncContractWithAsaas(second.store, api, "contract-1", TODAY)).toEqual({ status: "failed", reason: "Asaas recusou (400): cliente inválido" });
    expect(second.syncError()).toBe("Asaas recusou (400): cliente inválido");
    expect(second.log).toEqual(["customer:cus_new"]);
  });

  it("detalhes", () => {
    expect(asaasMobilePhone("+5584988880000")).toBe("84988880000");
    expect(asaasMobilePhone("+351912345678")).toBeNull();
    expect(asaasMobilePhone(null)).toBeNull();
    expect(subscriptionStart("2026-11-10", TODAY)).toBe("2026-11-10");
    expect(subscriptionStart("2026-11-01", TODAY)).toBe(TODAY);
  });
});
