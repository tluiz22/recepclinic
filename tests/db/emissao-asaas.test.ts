import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveContactCpf, savePayerContact, setPaymentPayerContact } from "../../src/lib/data/finance";
import { setProfessionalRoute } from "../../src/lib/data/fiscalIssuers";
import { listPaymentInvoices } from "../../src/lib/data/nfse";
import { asaasReadiness, cancelAsaasInvoice, checkAsaasInvoice, handleInvoiceWebhook, issueAsaasInvoice, reconcileAsaasInvoices } from "../../src/lib/data/nfseAsaas";
import { getPatient } from "../../src/lib/data/patients";
import { adminClient, signInvoicingContract, withDatabase } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { fakeDeps, readyIssuer } from "./issuerFixture";
import { newPaidAppointment } from "./paymentFixture";

// N3b — Emissão pelo Asaas (falso), pelo emissor do atendimento: pedido aceito
// fica "emitindo" até o webhook (token da subconta) ou a conciliação; recusa,
// sem resposta e repetição; cancelamento; profissional com CNPJ próprio e o
// que não emite (N-P1); reposição do saldo da subconta.

const PAYER = { email: "mae@teste.local", postalCode: "59600000", street: "Rua Um", number: "10", complement: null, district: "Centro" };

let fixture: AgendaFixture;
let deps: ReturnType<typeof fakeDeps>;
let clinicIssuer: Awaited<ReturnType<typeof readyIssuer>>;
let draId: string;
let dr2Id: string;

const invoiceOf = async (paymentId: string) => (await listPaymentInvoices(asDb(fixture.reception), fixture.clinicId, [paymentId])).get(paymentId)?.[0];
const row = (id: string) =>
  withDatabase(async (db) => (await db.query(`select status, issuer_id, asaas_invoice_id, nfse_number, error_message from public.nfse_invoices where id = $1`, [id])).rows[0]);

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da emissão pelo Asaas", "+55619844000");
  await signInvoicingContract(fixture.clinicId);
  const { data } = await adminClient().from("agendas").select("id, professional_id").in("id", [fixture.ids.agendaDra, fixture.ids.agendaDra2]);
  draId = data!.find((a) => a.id === fixture.ids.agendaDra)!.professional_id as string;
  dr2Id = data!.find((a) => a.id === fixture.ids.agendaDra2)!.professional_id as string;
  deps = fakeDeps();
  clinicIssuer = await readyIssuer(fixture, deps, null);
  const db = asDb(fixture.reception);
  const p1 = await getPatient(db, fixture.clinicId, fixture.ids.p1);
  await saveContactCpf(db, fixture.clinicId, p1.contactId, "52998224725");
  await savePayerContact(db, fixture.clinicId, p1, "contact", PAYER);
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("Emissão pelo Asaas (N3b)", () => {
  it("emite pelo emissor da clínica: tomador, nota com a referência local, saldo reposto; o webhook confirma", async () => {
    expect((await asaasReadiness(asDb(fixture.reception), (await newPaidAppointment(fixture)).appointmentId)).ready).toBe(true);
    const payment = await newPaidAppointment(fixture);
    const result = await issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps);
    expect(result.status).toBe("issuing");
    const invoice = await invoiceOf(payment.id);
    expect(invoice).toMatchObject({ provider: "asaas", issuerId: clinicIssuer.issuerId, status: "issuing", environment: "sandbox" });
    const remote = [...deps.fake.invoices.values()].find((i) => i.externalReference === invoice!.id)!;
    expect(remote.body).toMatchObject({ value: 300, municipalServiceCode: "04.01.01", municipalServiceName: "Medicina", effectiveDate: payment.paidOn });
    expect(String(remote.body.serviceDescription)).toMatch(/^Consulta\. Paciente: .+\. Atendimento em \d{2}\/\d{2}\/\d{4}\.$/);
    const customer = deps.fake.customers.get(remote.customer)!;
    expect(customer.body).toMatchObject({ cpfCnpj: "52998224725", email: "mae@teste.local", postalCode: "59600000", notificationDisabled: true });
    // Saldo zerado na subconta: a principal repôs até o alvo.
    expect(deps.fake.transfers.at(-1)).toMatchObject({ valueCents: 1000 });

    deps.fake.authorize(remote.id);
    const event = deps.fake.webhookEvent(remote.id, "INVOICE_AUTHORIZED", "evt_auth_1");
    const out = await handleInvoiceWebhook(event, clinicIssuer.webhookToken, deps.nfseDeps);
    expect(out.status).toBe(200);
    await out.process!();
    expect(await row(invoice!.id)).toMatchObject({ status: "issued", asaas_invoice_id: remote.id, nfse_number: remote.number });
    // Repetido: gravado uma vez, nada muda.
    const again = await handleInvoiceWebhook(event, clinicIssuer.webhookToken, deps.nfseDeps);
    expect(again.process).toBeUndefined();
    // Token errado ou de outra subconta: recusado.
    expect((await handleInvoiceWebhook(deps.fake.webhookEvent(remote.id, "INVOICE_AUTHORIZED", "evt_x"), "token-errado", deps.nfseDeps)).status).toBe(401);
    // Não emite duas notas para o mesmo pagamento.
    expect(await codeOf(() => issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps))).toBe("invalid");
  });

  it("recusa da prefeitura vira 'recusada' pela conciliação; dá para emitir de novo", async () => {
    const payment = await newPaidAppointment(fixture);
    await issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps);
    const invoice = await invoiceOf(payment.id);
    const remote = [...deps.fake.invoices.values()].find((i) => i.externalReference === invoice!.id)!;
    deps.fake.reject(remote.id, "Código de serviço inválido.");
    await withDatabase((db) => db.query(`update public.nfse_invoices set checked_at = now() - interval '10 minutes' where id = $1`, [invoice!.id]));
    await reconcileAsaasInvoices(deps.nfseDeps);
    expect(await row(invoice!.id)).toMatchObject({ status: "rejected", error_message: "Código de serviço inválido." });
    expect((await issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps)).status).toBe("issuing");
  });

  it("sem resposta do Asaas: fica emitindo; a conciliação procura pela referência e não duplica", async () => {
    const payment = await newPaidAppointment(fixture);
    deps.fake.timeoutNext(/\/authorize$/);
    expect((await issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps)).status).toBe("issuing");
    const invoice = await invoiceOf(payment.id);
    const before = deps.fake.invoices.size;
    await withDatabase((db) => db.query(`update public.nfse_invoices set checked_at = now() - interval '10 minutes' where id = $1`, [invoice!.id]));
    await reconcileAsaasInvoices(deps.nfseDeps);
    expect(deps.fake.invoices.size).toBe(before);
    const remote = [...deps.fake.invoices.values()].find((i) => i.externalReference === invoice!.id)!;
    expect(remote.status).toBe("SYNCHRONIZED");
    deps.fake.authorize(remote.id);
    expect((await checkAsaasInvoice(asDb(fixture.reception), fixture.clinicId, invoice!.id, deps.nfseDeps)).status).toBe("issued");
  });

  it("recusa do Asaas no pedido (4xx) vira 'não emitida' com o motivo", async () => {
    const payment = await newPaidAppointment(fixture);
    deps.fake.failNext(/^\/invoices$/, 400, "Valor inválido.");
    const result = await issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps);
    expect(result).toMatchObject({ status: "rejected" });
    expect(result.message).toContain("Valor inválido");
  });

  it("cancelar: só o Administrador; a prefeitura confirma ou nega", async () => {
    const payment = await newPaidAppointment(fixture);
    await issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps);
    const invoice = await invoiceOf(payment.id);
    const remote = [...deps.fake.invoices.values()].find((i) => i.externalReference === invoice!.id)!;
    deps.fake.authorize(remote.id);
    await checkAsaasInvoice(asDb(fixture.reception), fixture.clinicId, invoice!.id, deps.nfseDeps);
    expect(await codeOf(() => cancelAsaasInvoice(asDb(fixture.reception), invoice!.id, "Valor lançado errado no caixa", deps.nfseDeps))).toBe("forbidden");
    expect(await codeOf(() => cancelAsaasInvoice(asDb(fixture.admin), invoice!.id, "curto", deps.nfseDeps))).toBe("invalid");
    expect((await cancelAsaasInvoice(asDb(fixture.admin), invoice!.id, "Valor lançado errado no caixa", deps.nfseDeps)).status).toBe("canceling");
    deps.fake.finishCancel(remote.id, true);
    expect((await checkAsaasInvoice(asDb(fixture.admin), fixture.clinicId, invoice!.id, deps.nfseDeps)).status).toBe("issued");
    await cancelAsaasInvoice(asDb(fixture.admin), invoice!.id, "Valor lançado errado no caixa", deps.nfseDeps);
    deps.fake.finishCancel(remote.id);
    const out = await handleInvoiceWebhook(deps.fake.webhookEvent(remote.id, "INVOICE_CANCELED"), clinicIssuer.webhookToken, deps.nfseDeps);
    await out.process!();
    expect((await row(invoice!.id)).status).toBe("canceled");
    // Pagamento com nota cancelada pode ser excluído; com nota ativa, não (regra antiga, segue).
  });

  it("profissional com CNPJ próprio emite pelo emissor dele; o que 'não emite' é barrado", async () => {
    const pro = await readyIssuer(fixture, deps, draId, { cnpj: "45.723.174/0001-10", legalName: "Dra. Agenda Ltda" });
    const payment = await newPaidAppointment(fixture, { agendaId: fixture.ids.agendaDra });
    await issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps);
    expect((await invoiceOf(payment.id))?.issuerId).toBe(pro.issuerId);
    const remote = [...deps.fake.invoices.values()].at(-1)!;
    expect(remote.accountId).toBe(pro.accountId);
    // Token de outra subconta não vale para esta nota.
    expect((await handleInvoiceWebhook(deps.fake.webhookEvent(remote.id, "INVOICE_AUTHORIZED"), clinicIssuer.webhookToken, deps.nfseDeps)).status).toBe(401);

    await setProfessionalRoute(asDb(fixture.admin), fixture.clinicId, dr2Id, "none");
    const none = await newPaidAppointment(fixture, { agendaId: fixture.ids.agendaDra2, serviceId: fixture.ids.consulta2 });
    expect((await asaasReadiness(asDb(fixture.reception), none.appointmentId)).reason).toContain("não emite");
    expect(await codeOf(() => issueAsaasInvoice(asDb(fixture.reception), none.id, deps.nfseDeps))).toBe("invalid");
    await setProfessionalRoute(asDb(fixture.admin), fixture.clinicId, dr2Id, "clinic");
    await issueAsaasInvoice(asDb(fixture.reception), none.id, deps.nfseDeps);
    expect((await invoiceOf(none.id))?.issuerId).toBe(clinicIssuer.issuerId);
  });

  it("sem e-mail e endereço de quem pagou: pede antes; com eles, emite", async () => {
    const payment = await newPaidAppointment(fixture, { patientId: fixture.ids.p3 });
    if (!payment.payerCpf) return; // p3 sem CPF no contato: o caso do CPF já é coberto pela F11.
    expect(await codeOf(() => issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps))).toBe("invalid");
    await setPaymentPayerContact(asDb(fixture.reception), payment.id, PAYER);
    expect((await issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps)).status).toBe("issuing");
  });

  it("emissão desligada barra", async () => {
    const payment = await newPaidAppointment(fixture, { agendaId: fixture.ids.agendaDra2, serviceId: fixture.ids.consulta2 });
    const { error } = await adminClient().from("fiscal_issuers").update({ issuing_enabled: false }).eq("id", clinicIssuer.issuerId);
    expect(error).toBeNull();
    expect(await codeOf(() => issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps))).toBe("invalid");
    expect((await asaasReadiness(asDb(fixture.reception), payment.appointmentId)).ready).toBe(false);
    await adminClient().from("fiscal_issuers").update({ issuing_enabled: true }).eq("id", clinicIssuer.issuerId);
  });
});
