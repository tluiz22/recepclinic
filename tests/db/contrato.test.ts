import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activateBillingContract,
  discardBillingContractDraft,
  getDefaultInvoicePrice,
  listBillingAudit,
  listBillingContracts,
  saveBillingAccount,
  saveBillingContractDraft,
  setDefaultInvoicePrice,
  type ContractDraftInput,
} from "../../src/lib/data/billing";
import { clinicServiceClient, createUser, deleteUsers, makePlatformStaff, withDatabase, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.2 — Contrato (faturamento do SaaS). Só o Suporte escreve: rascunho (um
// por clínica), descarte e ativação (exige a conta de cobrança). Ativo não
// muda: nova versão começa depois da vigente, que termina na véspera. O
// Administrador lê o vigente e os encerrados, não o rascunho; Recepção e bot
// não leem. Preço padrão por nota: só o Suporte. Preço por nota e franquia só
// com a emissão de nota fiscal liberada (item "finance"; cliente, 30/out/2026).
const DRAFT: ContractDraftInput = {
  billingMode: "asaas",
  monthly: "299,00",
  setup: "297",
  paymentMethod: "pix",
  firstDueDate: "2031-01-10",
  startsOn: "2031-01-01",
  invoicePrice: "0,80",
  allowanceKind: "limitada",
  allowance: "50",
  notes: "Negociado na visita.",
};
const SNAPSHOT = { kind: "complete", label: "Completo", tableMonthlyCents: 29900, professionals: 1 };

let fixture: AgendaFixture;
let clinicId: string;
let support: TestUser;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do contrato", "+55619866000");
  clinicId = fixture.clinicId;
  support = await createUser("contrato-suporte");
  await makePlatformStaff(support.id);
  await setInvoicing(true);
});

const setInvoicing = (on: boolean) =>
  withDatabase((db) =>
    on
      ? db.query(`insert into public.clinic_features (clinic_id, feature_key) values ($1, 'finance') on conflict do nothing`, [clinicId])
      : db.query(`delete from public.clinic_features where clinic_id = $1 and feature_key = 'finance'`, [clinicId]),
  );

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
});

const save = (input: Partial<ContractDraftInput> = {}, user = support) => saveBillingContractDraft(asDb(user), clinicId, { ...DRAFT, ...input }, SNAPSHOT, { invoicing: true });

describe("Preço padrão por nota (F12.2)", () => {
  it("só o Suporte define; o Administrador não lê nem grava", async () => {
    await setDefaultInvoicePrice(asDb(support), "0,80");
    expect(await getDefaultInvoicePrice(asDb(support))).toBe(80);
    expect(await codeOf(() => setDefaultInvoicePrice(asDb(fixture.admin), "1"))).toBe("forbidden");
    expect(await getDefaultInvoicePrice(asDb(fixture.admin))).toBeNull();
    expect(await codeOf(() => setDefaultInvoicePrice(asDb(support), "abc"))).toBe("invalid");
  });
});

describe("Contrato (F12.2)", () => {
  it("só o Suporte monta o rascunho; o Administrador não grava nem vê o rascunho", async () => {
    expect(await codeOf(() => save({}, fixture.admin))).toBe("forbidden");
    await save();
    const [draft] = await listBillingContracts(asDb(support), clinicId);
    expect(draft).toMatchObject({
      status: "draft",
      version: null,
      billingMode: "asaas",
      monthlyCents: 29900,
      setupCents: 29700,
      paymentMethod: "pix",
      invoiceUnitPriceCents: 80,
      invoiceMonthlyAllowance: 50,
      planSnapshot: SNAPSHOT,
    });
    expect(await listBillingContracts(asDb(fixture.admin), clinicId)).toEqual([]);
    // Salvar de novo altera o mesmo rascunho.
    await save({ allowanceKind: "ilimitada", allowance: "" });
    const contracts = await listBillingContracts(asDb(support), clinicId);
    expect(contracts).toHaveLength(1);
    expect(contracts[0].invoiceMonthlyAllowance).toBeNull();
  });

  it("recusa dados inválidos, também no banco", async () => {
    expect(await codeOf(() => save({ monthly: "0" }))).toBe("invalid");
    expect(await codeOf(() => save({ paymentMethod: null }))).toBe("invalid");
    expect(await codeOf(() => save({ firstDueDate: "2030-12-31" }))).toBe("invalid");
    expect(await codeOf(() => save({ allowanceKind: "limitada", allowance: "" }))).toBe("invalid");
    const { error } = await support.client.rpc("save_billing_contract_draft", {
      p_clinic_id: clinicId,
      p_billing_mode: "asaas",
      p_monthly_cents: 100,
      p_setup_cents: 0,
      p_payment_method: "boleto",
      p_first_due_date: "2031-01-10",
      p_invoice_unit_price_cents: 0,
      p_invoice_monthly_allowance: null,
      p_starts_on: "2031-01-01",
      p_plan_snapshot: {},
      p_notes: "",
    });
    expect(error?.hint).toBe("billing_payment_method");
  });

  it("ativar exige a conta de cobrança; ativo, o Administrador vê (sem as observações virem do rascunho)", async () => {
    expect(await codeOf(() => activateBillingContract(asDb(support), clinicId))).toBe("invalid");
    await saveBillingAccount(asDb(support), clinicId, { payerName: "Clínica Ltda", payerDocument: "11222333000181", financeEmail: "fin@teste.local" });
    expect(await codeOf(() => activateBillingContract(asDb(fixture.admin), clinicId))).toBe("forbidden");
    await activateBillingContract(asDb(support), clinicId);
    const [active] = await listBillingContracts(asDb(fixture.admin), clinicId);
    expect(active).toMatchObject({ status: "active", version: 1, startsOn: "2031-01-01" });
    expect((await listBillingAudit(asDb(support), clinicId))[0]).toMatchObject({ action: "contract_activated", actorKind: "support" });
  });

  it("nova versão: começa depois da vigente; ao ativar, a anterior termina na véspera", async () => {
    expect(await codeOf(() => save({ startsOn: "2031-01-01", firstDueDate: "2031-01-10" }))).toBe("invalid");
    await save({ billingMode: "manual", paymentMethod: null, monthly: "349", setup: "0", startsOn: "2031-03-01", firstDueDate: "2031-03-10" });
    await activateBillingContract(asDb(support), clinicId);
    const contracts = await listBillingContracts(asDb(fixture.admin), clinicId);
    const v1 = contracts.find((c) => c.version === 1)!;
    const v2 = contracts.find((c) => c.version === 2)!;
    expect(v1).toMatchObject({ status: "ended", endsOn: "2031-02-28" });
    expect(v2).toMatchObject({ status: "active", billingMode: "manual", paymentMethod: null, monthlyCents: 34900, setupCents: 0 });
    const actions = (await listBillingAudit(asDb(support), clinicId)).slice(0, 2).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["contract_ended", "contract_activated"]));
  });

  it("descartar o rascunho; sem rascunho, nada a descartar ou ativar", async () => {
    await save({ startsOn: "2031-06-01", firstDueDate: "2031-06-10" });
    await discardBillingContractDraft(asDb(support), clinicId);
    const statuses = (await listBillingContracts(asDb(support), clinicId)).map((c) => c.status).sort();
    expect(statuses).toEqual(["active", "canceled", "ended"]);
    expect(await codeOf(() => discardBillingContractDraft(asDb(support), clinicId))).toBe("invalid");
    expect(await codeOf(() => activateBillingContract(asDb(support), clinicId))).toBe("invalid");
  });

  it("sem a emissão de nota fiscal, o contrato não tem preço por nota nem franquia (também no banco)", async () => {
    await setInvoicing(false);
    await save({ startsOn: "2031-08-01", firstDueDate: "2031-08-10" });
    const draft = (await listBillingContracts(asDb(support), clinicId)).find((c) => c.status === "draft")!;
    expect(draft).toMatchObject({ invoiceUnitPriceCents: null, invoiceMonthlyAllowance: null });
    await discardBillingContractDraft(asDb(support), clinicId);
    await setInvoicing(true);
    // Com a nota liberada, o banco exige o preço.
    const { error } = await support.client.rpc("save_billing_contract_draft", {
      p_clinic_id: clinicId,
      p_billing_mode: "manual",
      p_monthly_cents: 100,
      p_setup_cents: 0,
      p_payment_method: "",
      p_first_due_date: "2031-08-10",
      p_invoice_unit_price_cents: null,
      p_invoice_monthly_allowance: null,
      p_starts_on: "2031-08-01",
      p_plan_snapshot: {},
      p_notes: "",
    });
    expect(error?.hint).toBe("billing_invoice_price");
  });

  it("ninguém grava direto; Recepção e bot não leem", async () => {
    for (const user of [fixture.admin, support]) {
      const { error } = await user.client.from("billing_contracts").update({ monthly_cents: 1 }).eq("clinic_id", clinicId);
      expect(error?.code).toBe("42501");
    }
    expect((await fixture.reception.client.from("billing_contracts").select("id").eq("clinic_id", clinicId)).data).toEqual([]);
    expect((await clinicServiceClient(clinicId).from("billing_contracts").select("id")).error?.code).toBe("42501");
  });
});
