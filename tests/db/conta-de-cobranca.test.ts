import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBillingAccount, listBillingAudit, saveBillingAccount, saveBillingContacts, setBillingWhatsappOptIn, type BillingAccountInput } from "../../src/lib/data/billing";
import { addMember, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.1 — Conta de cobrança (faturamento do SaaS). O Suporte cria e altera a
// conta inteira; o Administrador da clínica, só os contatos; só ele autoriza
// ou retira o WhatsApp financeiro. Trocar o telefone retira o opt-in. Ninguém
// grava direto nas tabelas; Recepção, Profissional, bot e outra clínica não
// veem. Cada mudança entra na trilha, com quem fez.
const ACCOUNT: BillingAccountInput = {
  payerName: "Clínica de Teste Ltda",
  payerDocument: "11.222.333/0001-81",
  financeEmail: " Financeiro@Teste.local ",
  financePhone: "(84) 98188-0777",
};

let fixture: AgendaFixture;
let clinicId: string;
let professional: TestUser;
let support: TestUser;
let outsider: TestUser;
let otherClinic: string;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da conta de cobrança", "+55619877000");
  clinicId = fixture.clinicId;
  professional = await createUser("cob-prof");
  await addMember(clinicId, professional.id, ["professional"]);
  support = await createUser("cob-suporte");
  await makePlatformStaff(support.id);
  otherClinic = await createClinic("Outra clínica da conta de cobrança");
  outsider = await createUser("cob-outra");
  await addMember(otherClinic, outsider.id, ["admin"]);
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteClinics([otherClinic]);
  await deleteUsers([professional, support, outsider]);
});

describe("Conta de cobrança (F12.1)", () => {
  it("antes do Suporte cadastrar, o Administrador não tem conta nem altera contatos", async () => {
    expect(await getBillingAccount(asDb(fixture.admin), clinicId)).toBeNull();
    expect(await codeOf(() => saveBillingContacts(asDb(fixture.admin), clinicId, { financeEmail: "a@b.co" }))).toBe("invalid");
  });

  it("só o Suporte cria a conta; a trilha registra", async () => {
    expect(await codeOf(() => saveBillingAccount(asDb(fixture.admin), clinicId, ACCOUNT))).toBe("forbidden");
    await saveBillingAccount(asDb(support), clinicId, ACCOUNT);
    const account = await getBillingAccount(asDb(fixture.admin), clinicId);
    expect(account).toMatchObject({
      payerName: "Clínica de Teste Ltda",
      payerDocument: "11222333000181",
      financeEmail: "financeiro@teste.local",
      financePhone: "+5584981880777",
      whatsappOptIn: null,
    });
    const [entry] = await listBillingAudit(asDb(fixture.admin), clinicId);
    expect(entry).toMatchObject({ action: "account_created", actorKind: "support", actorId: support.id, before: null });
  });

  it("CPF também vale; documento, e-mail e telefone inválidos são recusados", async () => {
    expect(await codeOf(() => saveBillingAccount(asDb(support), clinicId, { ...ACCOUNT, payerDocument: "11.222.333/0001-80" }))).toBe("invalid");
    expect(await codeOf(() => saveBillingAccount(asDb(support), clinicId, { ...ACCOUNT, financeEmail: "sem-arroba" }))).toBe("invalid");
    expect(await codeOf(() => saveBillingAccount(asDb(support), clinicId, { ...ACCOUNT, financePhone: "123" }))).toBe("invalid");
    expect(await codeOf(() => saveBillingAccount(asDb(support), clinicId, { ...ACCOUNT, payerName: " " }))).toBe("invalid");
    // O banco confere de novo, sem a validação da aplicação.
    const { error } = await support.client.rpc("save_billing_account", {
      p_clinic_id: clinicId,
      p_payer_name: "X",
      p_payer_document: "12345678900",
      p_finance_email: "a@b.co",
      p_finance_phone: "",
    });
    expect(error?.hint).toBe("billing_payer_document");
  });

  it("o Administrador altera só os contatos; Recepção, Profissional e outra clínica não", async () => {
    await saveBillingContacts(asDb(fixture.admin), clinicId, { financeEmail: "contas@teste.local", financePhone: "(84) 98188-0777" });
    expect((await getBillingAccount(asDb(fixture.admin), clinicId))!.financeEmail).toBe("contas@teste.local");
    for (const user of [fixture.reception, professional, outsider]) {
      expect(await codeOf(() => saveBillingContacts(asDb(user), clinicId, { financeEmail: "x@y.co" }))).toBe("forbidden");
    }
    const [entry] = await listBillingAudit(asDb(fixture.admin), clinicId);
    expect(entry).toMatchObject({ action: "contacts_updated", actorKind: "clinic", actorId: fixture.admin.id });
    expect(entry.before).toMatchObject({ finance_email: "financeiro@teste.local" });
    expect(entry.after).toMatchObject({ finance_email: "contas@teste.local" });
  });

  it("salvar sem mudança não entra na trilha", async () => {
    const before = (await listBillingAudit(asDb(support), clinicId)).length;
    await saveBillingContacts(asDb(fixture.admin), clinicId, { financeEmail: "contas@teste.local", financePhone: "84981880777" });
    expect((await listBillingAudit(asDb(support), clinicId)).length).toBe(before);
  });

  it("opt-in do WhatsApp: só o Administrador da clínica (o Suporte não); trocar o telefone retira", async () => {
    expect(await codeOf(() => setBillingWhatsappOptIn(asDb(support), clinicId, true))).toBe("forbidden");
    expect(await codeOf(() => setBillingWhatsappOptIn(asDb(fixture.reception), clinicId, true))).toBe("forbidden");
    await setBillingWhatsappOptIn(asDb(fixture.admin), clinicId, true);
    const account = await getBillingAccount(asDb(fixture.admin), clinicId);
    expect(account!.whatsappOptIn?.version).toMatch(/^provisorio-/);
    expect((await listBillingAudit(asDb(fixture.admin), clinicId))[0]).toMatchObject({ action: "whatsapp_opt_in", actorId: fixture.admin.id });

    await saveBillingAccount(asDb(support), clinicId, { ...ACCOUNT, financePhone: "(84) 99999-0000" });
    expect((await getBillingAccount(asDb(fixture.admin), clinicId))!.whatsappOptIn).toBeNull();
    const [entry] = await listBillingAudit(asDb(fixture.admin), clinicId);
    expect(entry).toMatchObject({ action: "account_updated", actorKind: "support" });
    expect(entry.reason).toContain("opt-in");
  });

  it("opt-in exige telefone; retirar volta para só e-mail", async () => {
    await setBillingWhatsappOptIn(asDb(fixture.admin), clinicId, true);
    await setBillingWhatsappOptIn(asDb(fixture.admin), clinicId, false);
    expect((await getBillingAccount(asDb(fixture.admin), clinicId))!.whatsappOptIn).toBeNull();
    expect((await listBillingAudit(asDb(fixture.admin), clinicId))[0].action).toBe("whatsapp_opt_out");

    await saveBillingContacts(asDb(fixture.admin), clinicId, { financeEmail: "contas@teste.local", financePhone: "" });
    expect(await codeOf(() => setBillingWhatsappOptIn(asDb(fixture.admin), clinicId, true))).toBe("invalid");
  });

  it("ninguém grava direto; Recepção, Profissional, bot e outra clínica não leem", async () => {
    for (const user of [fixture.admin, support]) {
      const update = await user.client.from("billing_accounts").update({ payer_name: "Outro" }).eq("clinic_id", clinicId).select("clinic_id");
      expect(update.error?.code).toBe("42501");
      const insert = await user.client.from("billing_audit_log").insert({ clinic_id: clinicId, actor_kind: "clinic", action: "account_updated" });
      expect(insert.error?.code).toBe("42501");
    }
    for (const user of [fixture.reception, professional, outsider]) {
      expect((await user.client.from("billing_accounts").select("clinic_id").eq("clinic_id", clinicId)).data).toEqual([]);
      expect((await user.client.from("billing_audit_log").select("id").eq("clinic_id", clinicId)).data).toEqual([]);
    }
    const bot = clinicServiceClient(clinicId);
    expect((await bot.from("billing_accounts").select("clinic_id")).error?.code).toBe("42501");
    expect((await bot.rpc("save_billing_contacts", { p_clinic_id: clinicId, p_finance_email: "a@b.co", p_finance_phone: "" })).error?.code).toBe("42501");
  });
});
