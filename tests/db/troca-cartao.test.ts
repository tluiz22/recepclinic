import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activateBillingContract, listBillingAudit, saveBillingAccount, saveBillingContractDraft } from "../../src/lib/data/billing";
import { platformBillingCardChangeStore } from "../../src/lib/data/platform";
import { todayIn } from "../../src/lib/clinicTime";
import { adminClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.2g — Troca de cartão: o pedido e a troca da assinatura ficam no contrato,
// gravados só pelo servidor (service role); a trilha registra.
const today = todayIn("America/Sao_Paulo");
const env = { supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!, supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY! };
let fixture: AgendaFixture;
let support: TestUser;
let contractId: string;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica da troca de cartão", "+55619866401");
  support = await createUser("troca-cartao-suporte");
  await makePlatformStaff(support.id);
  await saveBillingAccount(asDb(support), fixture.clinicId, { payerName: "Clínica Ltda", payerDocument: "11222333000181", financeEmail: "fin@teste.local" });
  await saveBillingContractDraft(
    asDb(support),
    fixture.clinicId,
    { billingMode: "asaas", paymentMethod: "credit_card", monthly: "300", setup: "0", firstDueDate: today, startsOn: today, invoicePrice: "0,80", allowanceKind: "ilimitada" },
    {},
    { invoicing: true },
  );
  contractId = (await activateBillingContract(asDb(support), fixture.clinicId)).id;
  await adminClient().from("billing_contracts").update({ asaas_subscription_id: "sub_old" }).eq("id", contractId);
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
});

describe("Troca de cartão (F12.2g)", () => {
  it("ninguém da clínica grava o pedido nem a troca", async () => {
    const { error } = await fixture.admin.client.rpc("billing_finish_card_change", { p_contract_id: contractId, p_new_subscription_id: "sub_x", p_error: "" });
    expect(error).not.toBeNull();
  });

  it("pedido registrado; concluído, a assinatura nova entra no contrato", async () => {
    const store = platformBillingCardChangeStore(env);
    await store.recordCardChangeRequest(contractId, "chk_1", "2027-01-03", fixture.admin.id);
    expect(await store.loadCardChange(contractId)).toMatchObject({ checkoutId: "chk_1", nextDue: "2027-01-03" });
    expect(await store.openCardChanges()).toContain(contractId);
    await store.finishCardChange(contractId, "sub_new", null);
    expect(await store.loadCardChange(contractId)).toBeNull();
    const { data } = await adminClient().from("billing_contracts").select("asaas_subscription_id").eq("id", contractId).single();
    expect(data!.asaas_subscription_id).toBe("sub_new");
    const actions = (await listBillingAudit(asDb(support), fixture.clinicId)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["card_change_requested", "card_changed"]));
  });

  it("não concluído: o pedido sai e a trilha registra a falha", async () => {
    const store = platformBillingCardChangeStore(env);
    await store.recordCardChangeRequest(contractId, "chk_2", "2027-01-03", null);
    await store.finishCardChange(contractId, null, "O Checkout do Asaas não foi concluído.");
    expect(await store.loadCardChange(contractId)).toBeNull();
    expect((await listBillingAudit(asDb(support), fixture.clinicId))[0]).toMatchObject({ action: "card_change_failed", reason: "O Checkout do Asaas não foi concluído." });
  });
});
