import { BILLING_CONTRACT_TERMS_VERSION_NF } from "../../src/lib/billingContractText";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AsaasBillingApi, AsaasPayment } from "../../src/lib/asaas/billingApi";
import { acceptBillingContract, activateBillingContract, saveBillingAccount, saveBillingContractDraft } from "../../src/lib/data/billing";
import { syncContractWithAsaas } from "../../src/lib/data/billingAsaas";
import { sendBillingNotices } from "../../src/lib/data/billingNotices";
import { platformBillingNoticeStore, platformBillingStore } from "../../src/lib/data/platform";
import type { Email } from "../../src/lib/email";
import { todayIn } from "../../src/lib/clinicTime";
import { adminClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.7 — Avisos de cobrança no banco de verdade: o mais recente que cabe,
// sem repetir; pago cancela o atraso e gera o de pagamento reconhecido.
const today = todayIn("America/Sao_Paulo");
const daysAgo = (n: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const env = { supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!, supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY! };
const stamp = Date.now();

let fixture: AgendaFixture;
let clinicId: string;
let support: TestUser;
let contractId: string;
let payments: AsaasPayment[];

const pay = (id: string, dueDays: number, status = "OVERDUE"): AsaasPayment => ({
  id: `${id}_${stamp}`, subscription: `sub_av_${stamp}`, externalReference: null, dueDate: daysAgo(dueDays), valueCents: 29900, billingType: "PIX", status, paidAt: status === "RECEIVED" ? `${today}T12:00:00-03:00` : null, invoiceUrl: "https://fatura",
});
const api = (): AsaasBillingApi => ({
  findCustomer: async () => `cus_av_${stamp}`,
  createCustomer: async () => `cus_av_${stamp}`,
  findSubscription: async () => `sub_av_${stamp}`,
  createSubscription: async () => `sub_av_${stamp}`,
  findPayment: async () => null,
  createPayment: async () => {
    throw new Error("não usado");
  },
  listSubscriptionPayments: async () => payments,
  getPayment: async () => payments[0],
  endSubscriptionOn: async () => {}, deleteSubscription: async () => {}, deletePayment: async () => {}, refundPayment: async () => {}, createCardCheckout: async () => ({ id: "chk", link: "" }), listCustomerSubscriptions: async () => [],
});
const sync = () => syncContractWithAsaas(platformBillingStore(env), api(), contractId, today);
const notices = async () =>
  ((await adminClient().from("billing_notifications").select("kind, status, charge_id, billing_charges!inner(asaas_payment_id)").eq("clinic_id", clinicId)).data ?? []).map(
    (n: { kind: string; status: string; billing_charges: { asaas_payment_id: string } | { asaas_payment_id: string }[] }) => {
      const charge = Array.isArray(n.billing_charges) ? n.billing_charges[0] : n.billing_charges;
      return `${charge.asaas_payment_id.split("_")[0]}:${n.kind}:${n.status}`;
    },
  ).sort();

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste dos avisos", "+55619866006");
  clinicId = fixture.clinicId;
  support = await createUser("avisos-suporte");
  await makePlatformStaff(support.id);
  await saveBillingAccount(asDb(support), clinicId, { payerName: "Clínica Ltda", payerDocument: "11222333000181", financeEmail: "fin-avisos@teste.local" });
  await saveBillingContractDraft(
    asDb(support),
    clinicId,
    { billingMode: "asaas", monthly: "299", setup: "0", paymentMethod: "pix", firstDueDate: today, startsOn: today, invoicePrice: "0", allowanceKind: "ilimitada" },
    {},
    { invoicing: true },
  );
  contractId = (await activateBillingContract(asDb(support), clinicId)).id;
  await acceptBillingContract(asDb(fixture.admin), clinicId, contractId, BILLING_CONTRACT_TERMS_VERSION_NF, null, "Autorizo a cobrança mensal.");
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
});

describe("Avisos de cobrança (F12.7)", () => {
  it("agenda só o aviso mais recente que cabe, sem repetir", async () => {
    payments = [pay("a", 8), pay("b", 2), pay("c", 3)];
    await sync();
    const store = platformBillingNoticeStore(env);
    await store.scheduleOverdue();
    await store.scheduleOverdue();
    expect(await notices()).toEqual(["a:overdue_d7:pending", "c:overdue_d3:pending"]);
  });

  it("envia ao financeiro, com a data da suspensão possível", async () => {
    const sent: Email[] = [];
    const summary = await sendBillingNotices(platformBillingNoticeStore(env), { sendEmail: async (e) => void sent.push(e), panelLink: "https://painel" }, 500);
    expect(summary.sent).toBeGreaterThanOrEqual(2);
    const mine = sent.filter((e) => e.to === "fin-avisos@teste.local");
    expect(mine).toHaveLength(2);
    expect(mine.every((e) => e.text.includes("pode ser suspensa a partir de"))).toBe(true);
    expect(await notices()).toEqual(["a:overdue_d7:sent", "c:overdue_d3:sent"]);
  });

  it("pagou: aviso de pagamento reconhecido; o de atraso pendente é cancelado", async () => {
    payments = [pay("a", 8), pay("b", 2), pay("c", 3)];
    await adminClient().from("billing_notifications").update({ status: "pending" }).eq("clinic_id", clinicId).eq("kind", "overdue_d7");
    payments = [pay("a", 8, "RECEIVED"), pay("b", 2), pay("c", 3)];
    await sync();
    expect(await notices()).toEqual(["a:overdue_d7:canceled", "a:payment_confirmed:pending", "c:overdue_d3:sent"]);
    const sent: Email[] = [];
    await sendBillingNotices(platformBillingNoticeStore(env), { sendEmail: async (e) => void sent.push(e), panelLink: "https://painel" }, 500);
    expect(sent.find((e) => e.to === "fin-avisos@teste.local")?.subject).toMatch(/^Pagamento reconhecido/);
  });

  it("e-mail fora do ar: falhou, tenta de novo depois", async () => {
    payments = [pay("a", 8, "RECEIVED"), pay("b", 14), pay("c", 3)];
    await sync();
    await platformBillingNoticeStore(env).scheduleOverdue();
    await sendBillingNotices(platformBillingNoticeStore(env), { sendEmail: async () => { throw new Error("SMTP fora"); }, panelLink: "x" }, 500);
    expect(await notices()).toContain("b:overdue_d14:failed");
  });
});
