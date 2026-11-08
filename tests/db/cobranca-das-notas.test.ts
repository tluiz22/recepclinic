import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asaasBillingApi } from "../../src/lib/asaas/billingApi";
import { saveContactCpf, savePayerContact } from "../../src/lib/data/finance";
import { acceptIssuerContract, getIssuerContract, previousPeriod, runFiscalBilling, saveIssuerContract } from "../../src/lib/data/fiscalBilling";
import { setIssuerPayer } from "../../src/lib/data/fiscalIssuers";
import { listPaymentInvoices } from "../../src/lib/data/nfse";
import { asaasReadiness, issueAsaasInvoice } from "../../src/lib/data/nfseAsaas";
import { getPatient } from "../../src/lib/data/patients";
import { platformFiscalBilling } from "../../src/lib/data/platform";
import { addMember, adminClient, createUser, deleteUsers, makePlatformStaff, signInvoicingContract, withDatabase, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { fakeDeps, readyIssuer } from "./issuerFixture";
import { newPaidAppointment } from "./paymentFixture";

// N4b — Cobrança das notas por pagador: contrato de notas do profissional
// (Suporte define, ele aceita; sem aceite não emite), apuração do mês (franquia
// da clínica para quem ela paga; taxa + excedente do profissional), cobrança no
// Asaas com vencimento junto da mensalidade, suspensão com 15 dias e liberação.

const localEnv = () => ({ supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!, supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY! });

let fixture: AgendaFixture;
let deps: ReturnType<typeof fakeDeps>;
let clinicIssuer: Awaited<ReturnType<typeof readyIssuer>>;
let proIssuer: Awaited<ReturnType<typeof readyIssuer>>;
let draId: string;
let draUser: TestUser;
let support: TestUser;

async function issued(agendaId: string, serviceId: string) {
  const payment = await newPaidAppointment(fixture, { agendaId, serviceId });
  await issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps);
  const invoice = (await listPaymentInvoices(asDb(fixture.reception), fixture.clinicId, [payment.id])).get(payment.id)![0];
  const remote = [...deps.fake.invoices.values()].find((i) => i.externalReference === invoice.id)!;
  deps.fake.authorize(remote.id);
  await withDatabase((db) => db.query(`update public.nfse_invoices set status = 'issued', issued_at = $2 where id = $1`, [invoice.id, "2031-01-15T15:00:00Z"]));
  return invoice.id;
}

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da cobrança das notas", "+55619822000");
  await signInvoicingContract(fixture.clinicId); // R$ 1,00 por nota, sem franquia
  await adminClient().from("billing_contracts").update({ invoice_monthly_allowance: 1, first_due_date: "2030-12-20" }).eq("clinic_id", fixture.clinicId);
  const { data } = await adminClient().from("agendas").select("id, professional_id").eq("id", fixture.ids.agendaDra).single();
  draId = data!.professional_id as string;
  draUser = await createUser("cob-dra");
  await addMember(fixture.clinicId, draUser.id, ["professional"]);
  await adminClient().from("professionals").update({ user_id: draUser.id }).eq("id", draId);
  support = await createUser("cob-suporte");
  await makePlatformStaff(support.id);
  deps = fakeDeps();
  clinicIssuer = await readyIssuer(fixture, deps, null);
  proIssuer = await readyIssuer(fixture, deps, draId, { cnpj: "45.723.174/0001-10", legalName: "Dra. Agenda Ltda" });
  await setIssuerPayer(asDb(fixture.admin), proIssuer.issuerId, "professional");
  const db = asDb(fixture.reception);
  const p1 = await getPatient(db, fixture.clinicId, fixture.ids.p1);
  await saveContactCpf(db, fixture.clinicId, p1.contactId, "52998224725");
  await savePayerContact(db, fixture.clinicId, p1, "contact", { email: "m@teste.local", postalCode: "59600000", street: "Rua", number: "1", complement: null, district: "Centro" });
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([draUser, support]);
});

describe("Cobrança das notas (N4b)", () => {
  it("sem o contrato de notas aceito, o emissor do profissional pagador não emite", async () => {
    const payment = await newPaidAppointment(fixture, { agendaId: fixture.ids.agendaDra, serviceId: fixture.ids.consulta });
    expect((await asaasReadiness(asDb(fixture.reception), payment.appointmentId)).reason).toContain("contrato de notas");
    expect(await codeOf(() => issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps))).toBe("invalid");
  });

  it("o Suporte define os valores; o próprio profissional aceita; mudou valor, volta para o aceite", async () => {
    expect(await codeOf(() => saveIssuerContract(asDb(fixture.admin), proIssuer.issuerId, { feeCents: 1500, unitPriceCents: 99, allowance: 1 }))).toBe("forbidden");
    await saveIssuerContract(asDb(support), proIssuer.issuerId, { feeCents: 1500, unitPriceCents: 99, allowance: 1 });
    expect(await codeOf(() => acceptIssuerContract(asDb(fixture.admin), proIssuer.issuerId, true))).toBe("forbidden");
    await acceptIssuerContract(asDb(draUser), proIssuer.issuerId, true);
    expect((await getIssuerContract(asDb(draUser), proIssuer.issuerId))?.status).toBe("active");
    await saveIssuerContract(asDb(support), proIssuer.issuerId, { feeCents: 1500, unitPriceCents: 89, allowance: 1 });
    expect((await getIssuerContract(asDb(draUser), proIssuer.issuerId))?.status).toBe("draft");
    await acceptIssuerContract(asDb(draUser), proIssuer.issuerId, true);
  });

  it("apura o mês: clínica com franquia; profissional com taxa + excedente; cria no Asaas; não duplica", async () => {
    await issued(fixture.ids.agendaDra2, fixture.ids.consulta2); // clínica
    await issued(fixture.ids.agendaDra2, fixture.ids.consulta2); // clínica
    await issued(fixture.ids.agendaDra2, fixture.ids.consulta2); // clínica
    await issued(fixture.ids.agendaDra, fixture.ids.consulta); // profissional
    await issued(fixture.ids.agendaDra, fixture.ids.consulta); // profissional
    await withDatabase((db) =>
      db.query(
        `insert into public.billing_accounts (clinic_id, payer_name, payer_document, finance_email, asaas_customer_id) values ($1, 'Clínica', '11222333000181', 'f@c.local', $2)
         on conflict (clinic_id) do update set asaas_customer_id = excluded.asaas_customer_id`,
        [fixture.clinicId, `cus_clinica_${fixture.clinicId.slice(0, 8)}`],
      ),
    );
    await adminClient().from("billing_contracts").update({ billing_mode: "asaas", payment_method: "pix" }).eq("clinic_id", fixture.clinicId);
    deps.fake.mainCustomers.set(`cus_clinica_${fixture.clinicId.slice(0, 8)}`, { id: `cus_clinica_${fixture.clinicId.slice(0, 8)}`, cpfCnpj: "11222333000181", body: {} });
    const store = platformFiscalBilling(localEnv());
    const api = asaasBillingApi({ baseUrl: deps.fake.baseUrl, apiKey: deps.fake.mainKey, webhookToken: null }, deps.fake.fetch);
    expect(previousPeriod("2031-02-03")).toBe("2031-01-01");
    const r = await runFiscalBilling("2031-02-03", { store, api });
    expect(r).toMatchObject({ created: 2, failed: 0 });
    const rows = await withDatabase(async (db) => (await db.query(`select issuer_id, notes_count, allowance, fee_cents, amount_cents, due_date::text, status, asaas_payment_id from public.fiscal_usage_charges where clinic_id = $1 order by issuer_id nulls first`, [fixture.clinicId])).rows);
    expect(rows[0]).toMatchObject({ issuer_id: null, notes_count: 3, allowance: 1, amount_cents: 200, due_date: "2031-02-20", status: "pending" });
    expect(rows[1]).toMatchObject({ issuer_id: proIssuer.issuerId, notes_count: 2, fee_cents: 1500, amount_cents: 1500 + 89, due_date: "2031-02-20", status: "pending" });
    const proPayment = deps.fake.payments.get(rows[1].asaas_payment_id)!;
    expect(deps.fake.mainCustomers.get(proPayment.customer)?.cpfCnpj).toBe("45723174000110");
    expect(proPayment.description).toContain("Asaas");
    expect((await runFiscalBilling("2031-02-04", { store, api })).created).toBe(0);
    expect(deps.fake.payments.size).toBe(2);
  });

  it("vencida há 15 dias: suspende só a emissão do profissional; paga, libera", async () => {
    const store = platformFiscalBilling(localEnv());
    const api = asaasBillingApi({ baseUrl: deps.fake.baseUrl, apiKey: deps.fake.mainKey, webhookToken: null }, deps.fake.fetch);
    const { rows } = await withDatabase((db) => db.query(`select id, asaas_payment_id from public.fiscal_usage_charges where issuer_id = $1`, [proIssuer.issuerId]));
    deps.fake.setPaymentStatus(rows[0].asaas_payment_id, "OVERDUE");
    await withDatabase((db) => db.query(`update public.fiscal_usage_charges set last_synced_at = null where id = $1`, [rows[0].id]));
    await runFiscalBilling("2031-03-07", { store, api }, new Date("2031-03-07T12:00:00Z"));
    const pro = await withDatabase(async (db) => (await db.query(`select suspended_at from public.fiscal_issuers where id = $1`, [proIssuer.issuerId])).rows[0]);
    expect(pro.suspended_at).not.toBeNull();
    const clinicRow = await withDatabase(async (db) => (await db.query(`select suspended_at from public.fiscal_issuers where id = $1`, [clinicIssuer.issuerId])).rows[0]);
    expect(clinicRow.suspended_at).toBeNull();
    const payment = await newPaidAppointment(fixture, { agendaId: fixture.ids.agendaDra, serviceId: fixture.ids.consulta });
    expect(await codeOf(() => issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps))).toBe("invalid");

    deps.fake.setPaymentStatus(rows[0].asaas_payment_id, "RECEIVED");
    await withDatabase((db) => db.query(`update public.fiscal_usage_charges set last_synced_at = null where id = $1`, [rows[0].id]));
    await runFiscalBilling("2031-03-08", { store, api }, new Date("2031-03-08T12:00:00Z"));
    const after = await withDatabase(async (db) => (await db.query(`select suspended_at from public.fiscal_issuers where id = $1`, [proIssuer.issuerId])).rows[0]);
    expect(after.suspended_at).toBeNull();
    expect((await issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps)).status).toBe("issuing");
  });

  it("o profissional vê só as cobranças dele; a Recepção não vê nenhuma", async () => {
    const { data: mine } = await asDb(draUser).from("fiscal_usage_charges").select("issuer_id").eq("clinic_id", fixture.clinicId);
    expect(mine?.every((r) => r.issuer_id === proIssuer.issuerId) && mine.length > 0).toBe(true);
    const { data: rec } = await asDb(fixture.reception).from("fiscal_usage_charges").select("id").eq("clinic_id", fixture.clinicId);
    expect(rec).toEqual([]);
    const { data: admin } = await asDb(fixture.admin).from("fiscal_usage_charges").select("id").eq("clinic_id", fixture.clinicId);
    expect(admin?.length).toBe(2);
  });
});
