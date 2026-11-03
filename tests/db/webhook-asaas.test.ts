import { BILLING_CONTRACT_TERMS_VERSION_NF } from "../../src/lib/billingContractText";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AsaasBillingApi, AsaasPayment } from "../../src/lib/asaas/billingApi";
import { acceptBillingContract, activateBillingContract, listBillingCharges, saveBillingAccount, saveBillingContractDraft } from "../../src/lib/data/billing";
import { processBillingEvents, reconcileBilling } from "../../src/lib/data/billingEvents";
import { platformBillingEventStore } from "../../src/lib/data/platform";
import { todayIn } from "../../src/lib/clinicTime";
import { adminClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.5 — Fila do webhook do Asaas e conciliação, no banco de verdade com um
// Asaas de mentira: evento repetido é ignorado; o processamento consulta a
// cobrança; falha volta para a fila até 10 vezes; só o Suporte lê a fila.
const today = todayIn("America/Sao_Paulo");
const stamp = Date.now();
const store = () => platformBillingEventStore({ supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!, supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY! });

let fixture: AgendaFixture;
let clinicId: string;
let support: TestUser;
let contractId: string;
let current: AsaasPayment;

const api = (): AsaasBillingApi => ({
  findCustomer: async () => `cus_w_${stamp}`,
  createCustomer: async () => `cus_w_${stamp}`,
  findSubscription: async () => `sub_w_${stamp}`,
  createSubscription: async () => `sub_w_${stamp}`,
  findPayment: async () => null,
  createPayment: async () => {
    throw new Error("não usado");
  },
  listSubscriptionPayments: async () => [current],
  getPayment: async () => current,
});

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do webhook", "+55619866005");
  clinicId = fixture.clinicId;
  support = await createUser("webhook-suporte");
  await makePlatformStaff(support.id);
  await saveBillingAccount(asDb(support), clinicId, { payerName: "Clínica Ltda", payerDocument: "11222333000181", financeEmail: "fin@teste.local" });
  await saveBillingContractDraft(
    asDb(support),
    clinicId,
    { billingMode: "asaas", monthly: "199", setup: "0", paymentMethod: "pix", firstDueDate: today, startsOn: today, invoicePrice: "0", allowanceKind: "ilimitada" },
    {},
    { invoicing: true },
  );
  contractId = (await activateBillingContract(asDb(support), clinicId)).id;
  await acceptBillingContract(asDb(fixture.admin), clinicId, contractId, BILLING_CONTRACT_TERMS_VERSION_NF, null, "Autorizo a cobrança mensal.");
  current = { id: `pay_w_${stamp}`, subscription: `sub_w_${stamp}`, externalReference: null, dueDate: today, valueCents: 19900, billingType: "PIX", status: "PENDING", paidAt: null, invoiceUrl: "https://f" };
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
  await adminClient().from("billing_provider_events").delete().like("provider_event_id", `evt_${stamp}_%`);
});

describe("Webhook do Asaas (F12.5)", () => {
  it("conciliação cria o que falta e liga a assinatura", async () => {
    // O banco lista este contrato; a conciliação do teste roda só nele (os outros testes têm os seus).
    expect(await store().contractsToReconcile()).toContain(contractId);
    const own = { ...store(), contractsToReconcile: async () => [contractId] };
    const result = await reconcileBilling(own, api(), today);
    expect(result).toEqual({ contracts: 1, failed: 0 });
    expect((await listBillingCharges(asDb(support), clinicId)).map((c) => c.status)).toEqual(["pending"]);
    expect(await store().contractForPayment(`sub_w_${stamp}`, null)).toBe(contractId);
    expect(await store().contractForPayment(null, `setup:${contractId}`)).toBe(contractId);
    expect(await store().contractForPayment(null, "setup:lixo")).toBeNull();
  });

  it("evento repetido é ignorado; processar consulta o estado real", async () => {
    const event = { providerEventId: `evt_${stamp}_1`, event: "PAYMENT_RECEIVED", resourceId: current.id, payload: { payment: current.id } };
    expect(await store().recordEvent(event)).toBe(true);
    expect(await store().recordEvent(event)).toBe(false);
    current = { ...current, status: "RECEIVED", paidAt: `${today}T12:00:00-03:00` };
    const summary = await processBillingEvents(store(), api(), 500);
    expect(summary.processed).toBeGreaterThanOrEqual(1);
    expect((await listBillingCharges(asDb(support), clinicId))[0]).toMatchObject({ status: "paid" });
    const { data } = await adminClient().from("billing_provider_events").select("status, attempts").eq("provider_event_id", event.providerEventId).single();
    expect(data).toEqual({ status: "processed", attempts: 1 });
  });

  it("falha volta para a fila até 10 tentativas", async () => {
    const id = `evt_${stamp}_2`;
    await store().recordEvent({ providerEventId: id, event: "PAYMENT_OVERDUE", resourceId: "pay_falha", payload: {} });
    const broken = api();
    broken.getPayment = async () => {
      throw new Error("Asaas fora do ar");
    };
    await processBillingEvents(store(), broken, 500);
    const row = async () => (await adminClient().from("billing_provider_events").select("id, status, attempts, last_error").eq("provider_event_id", id).single()).data!;
    expect(await row()).toMatchObject({ status: "failed", attempts: 1, last_error: "Asaas fora do ar" });
    await adminClient().from("billing_provider_events").update({ attempts: 10 }).eq("provider_event_id", id);
    expect((await store().openEvents(500)).map((e) => e.providerEventId)).not.toContain(id);
  });

  it("só o Suporte lê a fila; ninguém grava pela API", async () => {
    expect((await support.client.from("billing_provider_events").select("id").like("provider_event_id", `evt_${stamp}_%`)).data?.length).toBe(2);
    expect((await fixture.admin.client.from("billing_provider_events").select("id")).data).toEqual([]);
    const { error } = await support.client.rpc("billing_record_provider_event", { p_provider_event_id: "x", p_event: "x", p_resource_id: null, p_payload: {} });
    expect(error?.code).toBe("42501");
  });
});
