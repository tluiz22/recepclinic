import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activateBillingContract, listBillingAudit, saveBillingAccount, saveBillingContractDraft } from "../../src/lib/data/billing";
import { platformBillingCardChangeStore, platformBillingPaymentMethodStore } from "../../src/lib/data/platform";
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

  it("troca cartão → Pix (cliente, 07/nov/2026): só o servidor; o cartão sai do contrato e a trilha guarda quem pediu", async () => {
    const denied = await fixture.admin.client.rpc("billing_set_payment_method", { p_contract_id: contractId, p_method: "pix", p_actor: fixture.admin.id, p_actor_kind: "clinic" });
    expect(denied.error).not.toBeNull();
    await adminClient().from("billing_contracts").update({ card_registered_at: new Date().toISOString(), card_last4: "4242" }).eq("id", contractId);
    const store = platformBillingPaymentMethodStore(env);
    expect(await store.setPaymentMethod(contractId, "pix", fixture.admin.id, "clinic")).toBe(true);
    expect(await store.setPaymentMethod(contractId, "pix", fixture.admin.id, "clinic")).toBe(false);
    const { data } = await adminClient().from("billing_contracts").select("payment_method, card_registered_at, card_last4").eq("id", contractId).single();
    expect(data).toEqual({ payment_method: "pix", card_registered_at: null, card_last4: null });
    const last = (await listBillingAudit(asDb(support), fixture.clinicId))[0];
    expect(last).toMatchObject({ action: "payment_method_changed", actorKind: "clinic", actorId: fixture.admin.id });
    expect(last.before).toMatchObject({ payment_method: "credit_card", card_last4: "4242" });
  });

  it("Pix → cartão: concluído o Checkout, a forma vira cartão, com o cartão cadastrado, em nome de quem pediu", async () => {
    const store = platformBillingCardChangeStore(env);
    await store.recordCardChangeRequest(contractId, "chk_3", "2027-01-03", fixture.admin.id);
    await store.finishCardChange(contractId, "sub_card", null);
    const { data } = await adminClient().from("billing_contracts").select("payment_method, card_registered_at, asaas_subscription_id").eq("id", contractId).single();
    expect(data!.payment_method).toBe("credit_card");
    expect(data!.card_registered_at).not.toBeNull();
    expect(data!.asaas_subscription_id).toBe("sub_card");
    const last = (await listBillingAudit(asDb(support), fixture.clinicId))[0];
    expect(last).toMatchObject({ action: "payment_method_changed", actorKind: "clinic", actorId: fixture.admin.id });
    expect(last.after).toEqual({ payment_method: "credit_card" });
  });
});
