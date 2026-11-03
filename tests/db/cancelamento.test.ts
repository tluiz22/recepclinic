import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BILLING_CONTRACT_TERMS_VERSION_NF } from "../../src/lib/billingContractText";
import { cancellationPreview } from "../../src/lib/billingRenewal";
import {
  acceptBillingContract,
  activateBillingContract,
  cancelBillingSubscription,
  listBillingAudit,
  listBillingContracts,
  listCanceledClinicIds,
  saveBillingAccount,
  saveBillingContractDraft,
} from "../../src/lib/data/billing";
import { todayIn } from "../../src/lib/clinicTime";
import { adminClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.2f — Cancelamento da assinatura pelo Administrador (cliente, 03/nov/2026):
// arrependimento até 7 dias do aceite (acesso acaba na hora: suspensa por fim
// do contrato) e cancelamento normal (acesso até a véspera do próximo
// vencimento; a rotina suspende depois). Motivo obrigatório.
const today = todayIn("America/Sao_Paulo");
const plusDays = (days: number) => {
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
};

let support: TestUser;
const fixtures: AgendaFixture[] = [];

async function signedClinic(name: string, phone: string): Promise<AgendaFixture> {
  const fixture = await setupAgendaClinic(name, phone);
  fixtures.push(fixture);
  await saveBillingAccount(asDb(support), fixture.clinicId, { payerName: "Clínica Ltda", payerDocument: "11222333000181", financeEmail: "fin@teste.local" });
  await saveBillingContractDraft(
    asDb(support),
    fixture.clinicId,
    { billingMode: "manual", monthly: "300", setup: "0", firstDueDate: plusDays(-20), startsOn: plusDays(-30), invoicePrice: "0,80", allowanceKind: "ilimitada" },
    {},
    { invoicing: true },
  );
  const contract = await activateBillingContract(asDb(support), fixture.clinicId);
  await acceptBillingContract(asDb(fixture.admin), fixture.clinicId, contract.id, BILLING_CONTRACT_TERMS_VERSION_NF, null, "Entendo que a mensalidade é cobrada todo mês, até o cancelamento.");
  return fixture;
}

const clinicStatus = async (clinicId: string) => (await adminClient().from("clinics").select("status").eq("id", clinicId).single()).data!.status;
const openSuspensions = async (clinicId: string) =>
  (await adminClient().from("clinic_suspensions").select("reason").eq("clinic_id", clinicId).is("released_at", null)).data!.map((r) => r.reason);

beforeAll(async () => {
  support = await createUser("cancelamento-suporte");
  await makePlatformStaff(support.id);
});

afterAll(async () => {
  for (const fixture of fixtures) await fixture.cleanup();
  await deleteUsers([support]);
});

describe("Cancelamento da assinatura (F12.2f)", () => {
  it("só o Administrador cancela; o motivo é obrigatório e \"Outro\" pede o comentário", async () => {
    const fixture = await signedClinic("Clínica do cancelamento (regras)", "+55619866301");
    expect(await codeOf(() => cancelBillingSubscription(asDb(fixture.reception), fixture.clinicId, { reason: "price", comment: null }))).toBe("forbidden");
    expect(await codeOf(() => cancelBillingSubscription(asDb(support), fixture.clinicId, { reason: "price", comment: null }))).toBe("forbidden");
    expect(await codeOf(() => cancelBillingSubscription(asDb(fixture.admin), fixture.clinicId, { reason: "xyz", comment: null }))).toBe("invalid");
    expect(await codeOf(() => cancelBillingSubscription(asDb(fixture.admin), fixture.clinicId, { reason: "other", comment: " " }))).toBe("invalid");
    const { error } = await fixture.admin.client.rpc("cancel_billing_subscription", { p_clinic_id: fixture.clinicId, p_reason: "other", p_comment: "" });
    expect(error?.hint).toBe("billing_cancel_comment");
  });

  it("arrependimento (até 7 dias do aceite): acesso acaba hoje, clínica suspensa, rascunho sai", async () => {
    const fixture = await signedClinic("Clínica do arrependimento", "+55619866302");
    await saveBillingContractDraft(
      asDb(support),
      fixture.clinicId,
      { billingMode: "manual", monthly: "350", setup: "0", firstDueDate: plusDays(40), startsOn: plusDays(35), invoicePrice: "0,80", allowanceKind: "ilimitada" },
      {},
      { invoicing: true },
    );
    const result = await cancelBillingSubscription(asDb(fixture.admin), fixture.clinicId, { reason: "other", comment: "Testando outro sistema." });
    expect(result).toMatchObject({ kind: "withdrawal", accessUntil: today });
    const contracts = await listBillingContracts(asDb(support), fixture.clinicId);
    const canceled = contracts.find((c) => c.id === result.contractId)!;
    expect(canceled).toMatchObject({ status: "ended", endsOn: today, cancel: { kind: "withdrawal", reason: "other", comment: "Testando outro sistema." } });
    expect(contracts.some((c) => c.status === "draft")).toBe(false);
    expect(await clinicStatus(fixture.clinicId)).toBe("suspended");
    expect(await openSuspensions(fixture.clinicId)).toEqual(["contract_ended"]);
    expect((await listBillingAudit(asDb(support), fixture.clinicId)).some((a) => a.action === "contract_canceled")).toBe(true);
    expect((await listCanceledClinicIds(asDb(support))).has(fixture.clinicId)).toBe(true);
    // Sem assinatura ativa, nada a cancelar de novo.
    const again = await fixture.admin.client.rpc("cancel_billing_subscription", { p_clinic_id: fixture.clinicId, p_reason: "price", p_comment: "" });
    expect(again.error?.hint).toBe("billing_cancel_missing");
  });

  it("cancelamento normal: usa até a véspera do próximo vencimento; a rotina suspende depois", async () => {
    const fixture = await signedClinic("Clínica do cancelamento normal", "+55619866303");
    // Aceite há 10 dias: fora do prazo de arrependimento.
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await adminClient().from("billing_contracts").update({ accepted_at: tenDaysAgo }).eq("clinic_id", fixture.clinicId).eq("status", "active");
    const before = (await listBillingContracts(asDb(fixture.admin), fixture.clinicId))[0];
    const expected = cancellationPreview(before, today);
    const result = await cancelBillingSubscription(asDb(fixture.admin), fixture.clinicId, { reason: "price", comment: null });
    expect(result).toMatchObject({ kind: "cancel", accessUntil: expected.accessUntil, nextDue: expected.nextDue });
    const canceled = (await listBillingContracts(asDb(fixture.admin), fixture.clinicId)).find((c) => c.id === result.contractId)!;
    expect(canceled).toMatchObject({ status: "ended", endsOn: expected.accessUntil, cancel: { kind: "cancel", reason: "price", nextDue: expected.nextDue } });
    expect(await clinicStatus(fixture.clinicId)).toBe("active");

    // Ainda no período: a rotina não mexe.
    expect((await adminClient().rpc("billing_suspend_ended_contracts")).error).toBeNull();
    expect(await clinicStatus(fixture.clinicId)).toBe("active");
    // Passou do último dia: suspensa por fim do contrato.
    await adminClient().from("billing_contracts").update({ ends_on: plusDays(-1) }).eq("id", result.contractId);
    const { data: count } = await adminClient().rpc("billing_suspend_ended_contracts");
    expect(count).toBeGreaterThanOrEqual(1);
    expect(await clinicStatus(fixture.clinicId)).toBe("suspended");
    expect(await openSuspensions(fixture.clinicId)).toEqual(["contract_ended"]);
  });
});
