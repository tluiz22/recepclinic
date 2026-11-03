import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BILLING_CONTRACT_TERMS_VERSION, BILLING_CONTRACT_TERMS_VERSION_NF } from "../../src/lib/billingContractText";
import {
  acceptBillingContract,
  activateBillingContract,
  listBillingAudit,
  listBillingContracts,
  saveBillingAccount,
  saveBillingContractDraft,
  type ContractDraftInput,
} from "../../src/lib/data/billing";
import { todayIn } from "../../src/lib/clinicTime";
import { adminClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.2c — Contrato e nota fiscal (cliente, 03/nov/2026). O texto só fala de
// nota fiscal quando o contrato cobra nota; liberar ou desligar o Módulo
// financeiro na Matriz monta o rascunho da nova versão para o Suporte ativar,
// e a clínica assina na tela; a emissão espera o contrato com nota assinado.
const today = todayIn("America/Sao_Paulo");
const plusDays = (days: number) => {
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
};
const DRAFT: ContractDraftInput = { billingMode: "manual", monthly: "299", setup: "0", firstDueDate: plusDays(-5), startsOn: plusDays(-10) };

let fixture: AgendaFixture;
let clinicId: string;
let support: TestUser;

const features = async () => {
  const { data } = await adminClient().from("clinic_features").select("feature_key").eq("clinic_id", clinicId);
  return (data ?? []).map((r) => r.feature_key as string);
};
const setFinance = async (on: boolean) => {
  const current = (await features()).filter((k) => k !== "finance");
  const { error } = await support.client.rpc("set_clinic_features", { p_clinic_id: clinicId, p_features: on ? [...current, "finance"] : current });
  if (error) throw error;
};
const contracts = () => listBillingContracts(asDb(support), clinicId);
const signed = async () => (await fixture.admin.client.rpc("billing_invoicing_signed", { p_clinic_id: clinicId })).data;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do contrato com nota", "+55619866101");
  clinicId = fixture.clinicId;
  support = await createUser("contrato-nf-suporte");
  await makePlatformStaff(support.id);
  await saveBillingAccount(asDb(support), clinicId, { payerName: "Clínica Ltda", payerDocument: "11222333000181", financeEmail: "fin@teste.local" });
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
});

describe("Contrato e nota fiscal (F12.2c)", () => {
  it("sem o Módulo financeiro: contrato e texto sem nota; sem contrato com nota, não emite", async () => {
    await setFinance(false);
    expect(await contracts()).toHaveLength(0);
    await saveBillingContractDraft(asDb(support), clinicId, DRAFT, {}, { invoicing: false });
    const active = await activateBillingContract(asDb(support), clinicId);
    expect(active).toMatchObject({ termsVersion: BILLING_CONTRACT_TERMS_VERSION, invoiceUnitPriceCents: null, acceptance: "pending" });
    await acceptBillingContract(asDb(fixture.admin), clinicId, active.id, BILLING_CONTRACT_TERMS_VERSION, null, "Autorizo a cobrança mensal.");
    expect(await signed()).toBe(false);
  });

  it("liberou o módulo: rascunho com nota a partir da vigente; ativado, pede o aceite e só então emite", async () => {
    await setFinance(true);
    const draft = (await contracts()).find((c) => c.status === "draft")!;
    const { data: settings } = await adminClient().from("billing_settings").select("default_invoice_unit_price_cents").single();
    expect(draft).toMatchObject({ monthlyCents: 29900, setupCents: 0, startsOn: today, invoiceUnitPriceCents: settings!.default_invoice_unit_price_cents });
    expect(draft.notes).toContain("liberar o Módulo financeiro");
    expect((await listBillingAudit(asDb(support), clinicId))[0]).toMatchObject({ action: "contract_draft_saved" });

    // O Suporte confere o preço por nota e ativa: texto com nota, aceite na tela.
    await saveBillingContractDraft(asDb(support), clinicId, { ...DRAFT, startsOn: today, firstDueDate: today, invoicePrice: "0,80", allowanceKind: "ilimitada" }, {}, { invoicing: true });
    const active = await activateBillingContract(asDb(support), clinicId);
    expect(active).toMatchObject({ termsVersion: BILLING_CONTRACT_TERMS_VERSION_NF, invoiceUnitPriceCents: 80, acceptance: "pending" });
    expect(await signed()).toBe(false);
    await acceptBillingContract(asDb(fixture.admin), clinicId, active.id, BILLING_CONTRACT_TERMS_VERSION_NF, null, "Autorizo a cobrança mensal.");
    expect(await signed()).toBe(true);
  });

  it("desligou o módulo: rascunho sem nota; rascunho existente acompanha o módulo", async () => {
    await setFinance(false);
    let draft = (await contracts()).find((c) => c.status === "draft")!;
    expect(draft).toMatchObject({ invoiceUnitPriceCents: null, invoiceMonthlyAllowance: null });
    expect(draft.notes).toContain("desligar o Módulo financeiro");
    await setFinance(true);
    draft = (await contracts()).find((c) => c.status === "draft")!;
    const { data: settings } = await adminClient().from("billing_settings").select("default_invoice_unit_price_cents").single();
    expect(draft.invoiceUnitPriceCents).toBe(settings!.default_invoice_unit_price_cents);
    expect((await contracts()).filter((c) => c.status === "draft")).toHaveLength(1);
  });

  it("a ativação confere a nota fiscal com o módulo e com o texto", async () => {
    // Módulo liberado, rascunho sem preço por nota (gravado por fora): recusa.
    await adminClient().from("billing_contracts").update({ invoice_unit_price_cents: null, invoice_monthly_allowance: null }).eq("clinic_id", clinicId).eq("status", "draft");
    let result = await support.client.rpc("activate_billing_contract", { p_clinic_id: clinicId, p_terms_version: BILLING_CONTRACT_TERMS_VERSION });
    expect(result.error?.hint).toBe("billing_invoice_price");
    // Com preço, o texto sem nota é recusado.
    await adminClient().from("billing_contracts").update({ invoice_unit_price_cents: 80 }).eq("clinic_id", clinicId).eq("status", "draft");
    result = await support.client.rpc("activate_billing_contract", { p_clinic_id: clinicId, p_terms_version: BILLING_CONTRACT_TERMS_VERSION });
    expect(result.error?.hint).toBe("billing_terms_version");
    // Módulo desligado, rascunho com preço por nota: recusa (outro texto, para não cair nos 30 dias).
    await adminClient().from("clinic_features").delete().eq("clinic_id", clinicId).eq("feature_key", "finance");
    await adminClient().from("billing_contracts").update({ invoice_unit_price_cents: 80 }).eq("clinic_id", clinicId).eq("status", "draft");
    result = await support.client.rpc("activate_billing_contract", { p_clinic_id: clinicId, p_terms_version: "outro-texto-nf" });
    expect(result.error?.hint).toBe("billing_invoice_disabled");
  });

  it("quem não lê o Financeiro não consulta o contrato com nota", async () => {
    const outsider = await createUser("contrato-nf-fora");
    try {
      expect((await outsider.client.rpc("billing_invoicing_signed", { p_clinic_id: clinicId })).data).toBe(false);
    } finally {
      await deleteUsers([outsider]);
    }
  });
});
