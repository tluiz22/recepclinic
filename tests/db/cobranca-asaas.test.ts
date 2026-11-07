import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AsaasBillingApi, AsaasPayment } from "../../src/lib/asaas/billingApi";
import { BILLING_CONTRACT_TERMS_VERSION_NF } from "../../src/lib/billingContractText";
import {
  acceptBillingContract,
  activateBillingContract,
  canSuspendForNonPayment,
  getBillingAccount,
  listBillingAudit,
  listBillingCharges,
  listBillingContracts,
  saveBillingAccount,
  saveBillingContractDraft,
} from "../../src/lib/data/billing";
import { syncContractWithAsaas } from "../../src/lib/data/billingAsaas";
import { platformBillingStore } from "../../src/lib/data/platform";
import { activeSuspensionReasons, listClinicSuspensions, releaseClinicSuspension, suspendClinic } from "../../src/lib/data/suspension";
import { adminClient } from "./helpers";
import { todayIn } from "../../src/lib/clinicTime";
import { clinicServiceClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.4 — Cobrança no Asaas (itens 28 e 29; cliente, 02/nov/2026), com um
// Asaas de mentira e o banco de verdade: o servidor grava pelo espelho (service
// role), o Suporte e o Administrador leem, a Recepção e o bot não; a
// inadimplência só a partir do 15º dia de atraso.
const today = todayIn("America/Sao_Paulo");
const daysAgo = (n: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const store = () => platformBillingStore({ supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!, supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY! });
const stamp = Date.now();

let fixture: AgendaFixture;
let clinicId: string;
let support: TestUser;
let contractId: string;
let monthly: AsaasPayment;

const api = (): AsaasBillingApi => ({
  findCustomer: async () => null,
  createCustomer: async () => `cus_${stamp}`,
  updateCustomerAddress: async () => {}, setSubscriptionLatePayment: async () => {}, setSubscriptionBillingType: async () => {}, setPaymentBillingType: async () => {},
  findSubscription: async () => null,
  createSubscription: async () => `sub_${stamp}`,
  findPayment: async () => null,
  createPayment: async (input) => ({ id: `pay_setup_${stamp}`, subscription: null, externalReference: input.externalReference, dueDate: input.dueDate, valueCents: input.valueCents, billingType: "PIX", status: "PENDING", paidAt: null, invoiceUrl: "https://sandbox.asaas.com/i/setup" }),
  listSubscriptionPayments: async () => [monthly],
  getPayment: async () => monthly,
  endSubscriptionOn: async () => {}, deleteSubscription: async () => {}, deletePayment: async () => {}, refundPayment: async () => {}, createCardCheckout: async () => ({ id: "chk", link: "" }), listCustomerSubscriptions: async () => [], setSubscriptionCard: async () => ({ last4: null }), getSubscriptionCard: async () => null,
});

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do Asaas", "+55619866004");
  clinicId = fixture.clinicId;
  support = await createUser("asaas-suporte");
  await makePlatformStaff(support.id);
  await saveBillingAccount(asDb(support), clinicId, { payerName: "Clínica Ltda", payerDocument: "11222333000181", financeEmail: "fin@teste.local" });
  await saveBillingContractDraft(
    asDb(support),
    clinicId,
    { billingMode: "asaas", monthly: "299", setup: "297", paymentMethod: "pix", firstDueDate: daysAgo(-8), startsOn: today, invoicePrice: "0", allowanceKind: "ilimitada" },
    {},
    { invoicing: true },
  );
  contractId = (await activateBillingContract(asDb(support), clinicId)).id;
  monthly = { id: `pay_m_${stamp}`, subscription: `sub_${stamp}`, externalReference: null, dueDate: daysAgo(-8), valueCents: 29900, billingType: "PIX", status: "PENDING", paidAt: null, invoiceUrl: "https://sandbox.asaas.com/i/m1" };
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
});

describe("Cobrança no Asaas (F12.4)", () => {
  it("antes do aceite, nada vai ao Asaas", async () => {
    expect(await syncContractWithAsaas(store(), api(), contractId, today)).toMatchObject({ status: "skipped" });
  });

  it("aceito: cliente, assinatura e as cobranças no espelho, na trilha", async () => {
    await acceptBillingContract(asDb(fixture.admin), clinicId, contractId, BILLING_CONTRACT_TERMS_VERSION_NF, null, "Autorizo a cobrança mensal.");
    expect(await syncContractWithAsaas(store(), api(), contractId, today)).toEqual({ status: "synced" });
    expect((await getBillingAccount(asDb(support), clinicId))?.asaasCustomerId).toBe(`cus_${stamp}`);
    const contract = (await listBillingContracts(asDb(support), clinicId)).find((c) => c.id === contractId)!;
    expect(contract).toMatchObject({ asaasSubscriptionId: `sub_${stamp}`, asaasSyncError: null });
    expect(contract.asaasSyncedAt).toBeInstanceOf(Date);
    const charges = await listBillingCharges(asDb(fixture.admin), clinicId);
    expect(charges.map((c) => [c.kind, c.valueCents, c.status])).toEqual([
      ["monthly", 29900, "pending"],
      ["setup", 29700, "pending"],
    ]);
    expect(charges.find((c) => c.kind === "setup")?.dueDate).toBe(today);
    const actions = (await listBillingAudit(asDb(support), clinicId)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["asaas_customer_linked", "asaas_subscription_created", "charge_created"]));
  });

  it("rodar de novo atualiza a situação sem duplicar; paga = RECEIVED", async () => {
    monthly = { ...monthly, status: "RECEIVED", paidAt: `${today}T12:00:00-03:00` };
    await syncContractWithAsaas(store(), api(), contractId, today);
    const charges = await listBillingCharges(asDb(support), clinicId);
    expect(charges).toHaveLength(2);
    expect(charges.find((c) => c.kind === "monthly")).toMatchObject({ status: "paid" });
    expect((await listBillingAudit(asDb(support), clinicId))[0].action).toBe("charge_updated");
  });

  it("Recepção e bot não leem as cobranças; ninguém grava direto", async () => {
    expect((await fixture.reception.client.from("billing_charges").select("id").eq("clinic_id", clinicId)).data).toEqual([]);
    expect((await clinicServiceClient(clinicId).from("billing_charges").select("id")).error?.code).toBe("42501");
    const { error } = await support.client.rpc("billing_upsert_asaas_charge", {
      p_contract_id: contractId, p_payment_id: "x", p_kind: "other", p_due_date: today, p_value_cents: 1, p_billing_type: "PIX", p_raw_status: "PENDING", p_paid_at: null, p_invoice_url: null,
    });
    expect(error?.code).toBe("42501");
  });

  it("falha no Asaas fica no contrato e na trilha", async () => {
    const broken = api();
    broken.listSubscriptionPayments = async () => {
      throw new Error("Asaas fora do ar");
    };
    expect(await syncContractWithAsaas(store(), broken, contractId, today)).toMatchObject({ status: "failed" });
    const contract = (await listBillingContracts(asDb(support), clinicId)).find((c) => c.id === contractId)!;
    expect(contract.asaasSyncError).toBe("Asaas fora do ar");
    expect((await listBillingAudit(asDb(support), clinicId))[0]).toMatchObject({ action: "asaas_sync_failed", reason: "Asaas fora do ar" });
  });

  it("inadimplência: só com cobrança em aberto a partir do 15º dia de atraso", async () => {
    const overdue = (days: number): AsaasPayment => ({ ...monthly, id: `pay_old_${days}_${stamp}`, dueDate: daysAgo(days), status: "OVERDUE", paidAt: null });
    const withOverdue = (payment: AsaasPayment) => {
      const a = api();
      a.listSubscriptionPayments = async () => [monthly, payment];
      return a;
    };
    await syncContractWithAsaas(store(), withOverdue(overdue(14)), contractId, today);
    expect(await canSuspendForNonPayment(asDb(support), clinicId)).toBe(false);
    expect(await codeOf(() => suspendClinic(asDb(support), clinicId, { reason: "non_payment", note: "Atraso." }))).toBe("invalid");
    await syncContractWithAsaas(store(), withOverdue(overdue(15)), contractId, today);
    expect(await canSuspendForNonPayment(asDb(support), clinicId)).toBe(true);
    expect(await canSuspendForNonPayment(asDb(fixture.admin), clinicId)).toBe(false);
    await suspendClinic(asDb(support), clinicId, { reason: "non_payment", note: "15 dias de atraso." });
    expect((await listBillingAudit(asDb(support), clinicId))[0]).toMatchObject({ action: "clinic_suspended" });
  });

  it("reativação automática (F12.6): só sem vencida em aberto, e só a inadimplência", async () => {
    const status = async () => (await adminClient().from("clinics").select("status").eq("id", clinicId).single()).data!.status;
    await suspendClinic(asDb(support), clinicId, { reason: "administrative", note: "Outro motivo." });
    const paid = (days: number): AsaasPayment => ({ ...monthly, id: `pay_old_${days}_${stamp}`, dueDate: daysAgo(days), status: "RECEIVED", paidAt: `${today}T12:00:00-03:00` });
    const sync = (payments: AsaasPayment[]) => {
      const a = api();
      a.listSubscriptionPayments = async () => payments;
      return syncContractWithAsaas(store(), a, contractId, today);
    };
    // Pagou a de 15 dias, a de 14 segue vencida: continua suspensa por inadimplência.
    await sync([monthly, paid(15)]);
    expect(await activeSuspensionReasons(asDb(support), clinicId)).toEqual(["non_payment", "administrative"]);
    // Pagou todas: o sistema libera a inadimplência; o motivo administrativo segura a suspensão.
    await sync([monthly, paid(15), paid(14)]);
    expect(await activeSuspensionReasons(asDb(support), clinicId)).toEqual(["administrative"]);
    expect(await status()).toBe("suspended");
    const released = (await listClinicSuspensions(asDb(support), clinicId)).find((s) => s.reason === "non_payment")!;
    expect(released).toMatchObject({ releasedBy: null });
    expect(released.releaseNote).toMatch(/Pagamento reconhecido/);
    const audit = await listBillingAudit(asDb(support), clinicId);
    expect(audit.find((e) => e.action === "suspension_released")).toMatchObject({ actorKind: "system" });
    // Liberado o último motivo, volta a ficar ativa.
    await releaseClinicSuspension(asDb(support), (await listClinicSuspensions(asDb(support), clinicId)).find((s) => !s.releasedAt)!.id, "Resolvido.");
    expect(await status()).toBe("active");
  });

  it("o contrato guarda a versão do texto aceita", async () => {
    const contract = (await listBillingContracts(asDb(support), clinicId)).find((c) => c.id === contractId)!;
    expect(contract.termsVersion).toBe(BILLING_CONTRACT_TERMS_VERSION_NF);
  });
});
