import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activateBillingContract,
  dismissBillingPaymentStep,
  listBillingAudit,
  listBillingContracts,
  listClinicIdsWithoutCard,
  saveBillingAccount,
  saveBillingContractDraft,
} from "../../src/lib/data/billing";
import { platformBillingCardRegisterStore } from "../../src/lib/data/platform";
import { todayIn } from "../../src/lib/clinicTime";
import { adminClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.2i — Passo Cartão da Assinatura: o cartão ligado à assinatura fica no
// contrato (só o servidor grava), a trilha registra, e o Suporte vê "Sem
// cartão". No Pix, "Pagar depois" é só do Administrador da clínica.
const today = todayIn("America/Sao_Paulo");
const env = { supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!, supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY! };
let fixture: AgendaFixture;
let support: TestUser;
let contractId: string;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do cartão da assinatura", "+55619866402");
  support = await createUser("cartao-assinatura-suporte");
  await makePlatformStaff(support.id);
  await saveBillingAccount(asDb(support), fixture.clinicId, { payerName: "Clínica Ltda", payerDocument: "11222333000181", financeEmail: "fin@teste.local" });
  await saveBillingContractDraft(
    asDb(support),
    fixture.clinicId,
    { billingMode: "asaas", paymentMethod: "credit_card", monthly: "300", setup: "297", firstDueDate: today, startsOn: today, invoicePrice: "0,80", allowanceKind: "ilimitada" },
    {},
    { invoicing: true },
  );
  contractId = (await activateBillingContract(asDb(support), fixture.clinicId)).id;
  await adminClient()
    .from("billing_contracts")
    .update({ asaas_subscription_id: "sub_1", acceptance: "explicit", accepted_at: new Date().toISOString(), accepted_ip: "10.0.0.1" })
    .eq("id", contractId);
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
});

describe("Cartão da assinatura (F12.2i)", () => {
  it("sem o cartão: na lista da conciliação e com o selo do Suporte", async () => {
    expect(await platformBillingCardRegisterStore(env).contractsWithoutCard()).toContain(contractId);
    expect(await listClinicIdsWithoutCard(asDb(support))).toContain(fixture.clinicId);
    expect(await platformBillingCardRegisterStore(env).cardRegistration(contractId)).toMatchObject({ registeredAt: null, acceptedIp: "10.0.0.1" });
  });

  it("ninguém da clínica grava o cartão", async () => {
    const { error } = await fixture.admin.client.rpc("billing_record_card_registered", { p_contract_id: contractId, p_last4: "8829", p_source: "setup" });
    expect(error).not.toBeNull();
  });

  it("cadastrado: final no contrato, trilha e sai da conciliação e do selo", async () => {
    const store = platformBillingCardRegisterStore(env);
    await store.recordCardRegistered(contractId, "8829", "setup");
    const contract = (await listBillingContracts(asDb(support), fixture.clinicId)).find((c) => c.id === contractId)!;
    expect(contract.cardRegisteredAt).not.toBeNull();
    expect(contract.cardLast4).toBe("8829");
    expect((await listBillingAudit(asDb(support), fixture.clinicId))[0]).toMatchObject({ action: "card_registered" });
    expect(await store.contractsWithoutCard()).not.toContain(contractId);
    expect(await listClinicIdsWithoutCard(asDb(support))).not.toContain(fixture.clinicId);
  });

  it("troca depois do cadastro: só o final muda, sem outra linha na trilha", async () => {
    const before = (await listBillingAudit(asDb(support), fixture.clinicId)).length;
    await platformBillingCardRegisterStore(env).recordCardRegistered(contractId, "1111", "checkout");
    const contract = (await listBillingContracts(asDb(support), fixture.clinicId)).find((c) => c.id === contractId)!;
    expect(contract.cardLast4).toBe("1111");
    expect((await listBillingAudit(asDb(support), fixture.clinicId)).length).toBe(before);
  });

  it("Pix, \"Pagar depois\": o Administrador grava; a Recepção não", async () => {
    await expect(dismissBillingPaymentStep(asDb(fixture.reception), fixture.clinicId, contractId)).rejects.toThrow();
    await dismissBillingPaymentStep(asDb(fixture.admin), fixture.clinicId, contractId);
    const contract = (await listBillingContracts(asDb(support), fixture.clinicId)).find((c) => c.id === contractId)!;
    expect(contract.paymentStepDismissedAt).not.toBeNull();
  });
});
