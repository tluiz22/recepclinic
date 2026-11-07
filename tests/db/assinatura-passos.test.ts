import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BILLING_CONTRACT_TERMS_VERSION_NF } from "../../src/lib/billingContractText";
import { recurringConsentText } from "../../src/lib/billingRenewal";
import {
  acceptBillingContract,
  activateBillingContract,
  dismissBillingWhatsappPrompt,
  getBillingAccount,
  listBillingAudit,
  listBillingContracts,
  saveBillingAccount,
  saveBillingContractDraft,
} from "../../src/lib/data/billing";
import { todayIn } from "../../src/lib/clinicTime";
import { createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F12.2e — Assinatura em passo a passo (cliente, 03/nov/2026): o aceite leva
// a autorização da cobrança mensal (CDC) e o "Agora não" do WhatsApp fica
// registrado; só o Administrador da clínica faz os dois.
const today = todayIn("America/Sao_Paulo");

let fixture: AgendaFixture;
let clinicId: string;
let support: TestUser;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do passo a passo", "+55619866201");
  clinicId = fixture.clinicId;
  support = await createUser("passos-suporte");
  await makePlatformStaff(support.id);
  await saveBillingAccount(asDb(support), clinicId, { payerName: "Clínica Ltda", payerDocument: "11222333000181", financeEmail: "fin@teste.local" });
  await saveBillingContractDraft(
    asDb(support),
    clinicId,
    { billingMode: "manual", monthly: "300", setup: "0", firstDueDate: today, startsOn: today, invoicePrice: "0,80", allowanceKind: "ilimitada" },
    {},
    { invoicing: true },
  );
  await activateBillingContract(asDb(support), clinicId);
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
});

describe("Assinatura em passo a passo (F12.2e)", () => {
  it("sem a autorização da cobrança mensal, o aceite é recusado", async () => {
    const contract = (await listBillingContracts(asDb(fixture.admin), clinicId))[0];
    const { error } = await fixture.admin.client.rpc("accept_billing_contract", {
      p_clinic_id: clinicId,
      p_contract_id: contract.id,
      p_terms_version: BILLING_CONTRACT_TERMS_VERSION_NF,
      p_ip: "",
      p_recurring_consent: "  ",
    });
    expect(error?.hint).toBe("billing_recurring_consent");
  });

  it("o aceite guarda a frase da autorização e a trilha registra", async () => {
    const contract = (await listBillingContracts(asDb(fixture.admin), clinicId))[0];
    const consent = recurringConsentText(null);
    await acceptBillingContract(asDb(fixture.admin), clinicId, contract.id, BILLING_CONTRACT_TERMS_VERSION_NF, "203.0.113.9", consent);
    const saved = (await listBillingContracts(asDb(fixture.admin), clinicId))[0];
    expect(saved).toMatchObject({ acceptance: "explicit", recurringConsent: consent });
    const entry = (await listBillingAudit(asDb(fixture.admin), clinicId)).find((a) => a.action === "contract_accepted");
    expect(entry?.reason).toContain(consent);
  });

  it("\"Agora não\" do WhatsApp: só o Administrador; fica registrado", async () => {
    expect(await codeOf(() => dismissBillingWhatsappPrompt(asDb(fixture.reception), clinicId))).toBe("forbidden");
    expect(await codeOf(() => dismissBillingWhatsappPrompt(asDb(support), clinicId))).toBe("forbidden");
    expect((await getBillingAccount(asDb(fixture.admin), clinicId))?.whatsappPromptDismissedAt).toBeNull();
    await dismissBillingWhatsappPrompt(asDb(fixture.admin), clinicId);
    const first = (await getBillingAccount(asDb(fixture.admin), clinicId))?.whatsappPromptDismissedAt;
    expect(first).toBeInstanceOf(Date);
    await dismissBillingWhatsappPrompt(asDb(fixture.admin), clinicId);
    expect((await getBillingAccount(asDb(fixture.admin), clinicId))?.whatsappPromptDismissedAt?.getTime()).toBe(first!.getTime());
  });
});
