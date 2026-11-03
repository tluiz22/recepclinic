import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BILLING_CONTRACT_TERMS_VERSION_NF } from "../../src/lib/billingContractText";
import {
  acceptBillingContract,
  activateBillingContract,
  listBillingAudit,
  listBillingContracts,
  noticeStartDate,
  saveBillingAccount,
  saveBillingContractDraft,
  sendBillingContractNotice,
  type ContractDraftInput,
} from "../../src/lib/data/billing";
import { todayIn } from "../../src/lib/clinicTime";
import type { Email } from "../../src/lib/email";
import { createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.2b — Aceite do contrato (item 24 do planejamento-faturamento-saas.md;
// cliente, 30/out e 02/nov/2026). O 1º contrato e a troca do texto pedem o
// aceite do Administrador (data, hora, quem, IP e versão do texto); mudança
// com o mesmo texto vale pelo uso, só começa 30 dias depois da ativação e o
// financeiro recebe os novos termos por e-mail (envio ou falha na trilha).
const today = todayIn("America/Sao_Paulo");
const plusDays = (days: number) => {
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
};
const DRAFT: ContractDraftInput = {
  billingMode: "manual",
  monthly: "299",
  setup: "0",
  firstDueDate: plusDays(-5),
  startsOn: plusDays(-10),
  invoicePrice: "0,80",
  allowanceKind: "ilimitada",
};

let fixture: AgendaFixture;
let clinicId: string;
let support: TestUser;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do aceite", "+55619866001");
  clinicId = fixture.clinicId;
  support = await createUser("aceite-suporte");
  await makePlatformStaff(support.id);
  await saveBillingAccount(asDb(support), clinicId, { payerName: "Clínica Ltda", payerDocument: "11222333000181", financeEmail: "fin@teste.local" });
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
});

const save = (input: Partial<ContractDraftInput> = {}) => saveBillingContractDraft(asDb(support), clinicId, { ...DRAFT, ...input }, {}, { invoicing: true });
const active = async () => (await listBillingContracts(asDb(support), clinicId)).find((c) => c.status === "active")!;

describe("Aceite do contrato (F12.2b)", () => {
  it("o 1º contrato fica aguardando o aceite, com a versão do texto", async () => {
    await save();
    const contract = await activateBillingContract(asDb(support), clinicId);
    expect(contract).toMatchObject({ version: 1, acceptance: "pending", termsVersion: BILLING_CONTRACT_TERMS_VERSION_NF, acceptedAt: null });
  });

  it("só o Administrador da clínica aceita; texto diferente do mostrado é recusado", async () => {
    const contract = await active();
    expect(await codeOf(() => acceptBillingContract(asDb(fixture.reception), clinicId, contract.id, BILLING_CONTRACT_TERMS_VERSION_NF, "203.0.113.7", "Autorizo a cobrança mensal."))).toBe("forbidden");
    expect(await codeOf(() => acceptBillingContract(asDb(support), clinicId, contract.id, BILLING_CONTRACT_TERMS_VERSION_NF, "203.0.113.7", "Autorizo a cobrança mensal."))).toBe("forbidden");
    const { error } = await fixture.admin.client.rpc("accept_billing_contract", {
      p_clinic_id: clinicId,
      p_contract_id: contract.id,
      p_terms_version: "outro-texto",
      p_ip: "",
      p_recurring_consent: "Autorizo a cobrança mensal.",
    });
    expect(error?.hint).toBe("billing_terms_changed");
  });

  it("aceite grava data, quem, IP e fica na trilha; aceitar de novo não muda nada", async () => {
    const { id } = await active();
    await acceptBillingContract(asDb(fixture.admin), clinicId, id, BILLING_CONTRACT_TERMS_VERSION_NF, "203.0.113.7", "Autorizo a cobrança mensal.");
    const contract = await active();
    expect(contract).toMatchObject({ acceptance: "explicit", acceptedBy: fixture.admin.id, acceptedIp: "203.0.113.7" });
    expect(contract.acceptedAt).toBeInstanceOf(Date);
    expect((await listBillingAudit(asDb(fixture.admin), clinicId))[0]).toMatchObject({ action: "contract_accepted", actorKind: "clinic" });
    await acceptBillingContract(asDb(fixture.admin), clinicId, id, BILLING_CONTRACT_TERMS_VERSION_NF, "198.51.100.1", "Autorizo a cobrança mensal.");
    expect((await active()).acceptedIp).toBe("203.0.113.7");
  });

  it("mudança com o mesmo texto: só 30 dias depois da ativação; vale pelo uso", async () => {
    await save({ monthly: "349", startsOn: plusDays(29), firstDueDate: plusDays(29) });
    const { error } = await support.client.rpc("activate_billing_contract", { p_clinic_id: clinicId, p_terms_version: BILLING_CONTRACT_TERMS_VERSION_NF });
    expect(error?.hint).toBe("billing_notice_period");
    expect(noticeStartDate(today)).toBe(plusDays(30));
    await save({ monthly: "349", startsOn: plusDays(30), firstDueDate: plusDays(30) });
    const v2 = await activateBillingContract(asDb(support), clinicId);
    expect(v2).toMatchObject({ version: 2, acceptance: "tacit", acceptedAt: null, noticeSentAt: null });
  });

  it("o e-mail dos novos termos vai ao financeiro; envio e falha ficam na trilha", async () => {
    const v2 = await active();
    const failed = await sendBillingContractNotice(asDb(support), { id: clinicId, name: "Clínica do teste" }, v2, {
      sendEmail: async () => {
        throw new Error("SMTP fora do ar");
      },
      link: "https://teste.local/admin/configuracoes/assinatura",
    });
    expect(failed).toMatchObject({ sent: false, reason: "SMTP fora do ar" });
    expect((await active()).noticeSentAt).toBeNull();
    expect((await listBillingAudit(asDb(support), clinicId))[0]).toMatchObject({ action: "contract_notice_failed" });

    const sent: Email[] = [];
    const ok = await sendBillingContractNotice(asDb(support), { id: clinicId, name: "Clínica do teste" }, v2, {
      sendEmail: async (email) => {
        sent.push(email);
      },
      link: "https://teste.local/admin/configuracoes/assinatura",
    });
    expect(ok).toEqual({ sent: true, to: "fin@teste.local" });
    expect(sent[0].to).toBe("fin@teste.local");
    expect(sent[0].text).toMatch(/R\$\s349,00/);
    expect(sent[0].text).toContain("vale como aceite");
    expect((await active()).noticeSentAt).toBeInstanceOf(Date);
    expect((await listBillingAudit(asDb(support), clinicId))[0]).toMatchObject({ action: "contract_notice_sent", actorKind: "support" });
    // Só o Suporte registra o aviso.
    expect(await codeOf(() => sendBillingContractNotice(asDb(fixture.admin), { id: clinicId, name: "x" }, v2, { sendEmail: async () => {}, link: "x" }))).toBe("forbidden");
  });

  it("texto do contrato trocado: a nova versão pede aceite de novo, sem o prazo de 30 dias", async () => {
    await save({ monthly: "399", startsOn: plusDays(31), firstDueDate: plusDays(31) });
    const { error } = await support.client.rpc("activate_billing_contract", { p_clinic_id: clinicId, p_terms_version: "texto-do-advogado-nf" });
    expect(error).toBeNull();
    const v3 = await active();
    expect(v3).toMatchObject({ version: 3, acceptance: "pending", termsVersion: "texto-do-advogado-nf" });
    // IP inválido não impede o aceite (fica sem IP).
    const accepted = await fixture.admin.client.rpc("accept_billing_contract", { p_clinic_id: clinicId, p_contract_id: v3.id, p_terms_version: "texto-do-advogado-nf", p_ip: "lixo", p_recurring_consent: "Autorizo a cobrança mensal." });
    expect(accepted.error).toBeNull();
    expect(await active()).toMatchObject({ acceptance: "explicit", acceptedIp: null });
  });
});
