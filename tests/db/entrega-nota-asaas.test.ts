import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asaasFiscalApi } from "../../src/lib/asaas/fiscalApi";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { saveContactCpf, savePayerContact } from "../../src/lib/data/finance";
import { listPaymentInvoices } from "../../src/lib/data/nfse";
import { copyInvoiceFiles, runInvoiceOutbox, type AutoDeliveryDeps } from "../../src/lib/data/nfseAutoDelivery";
import { deliverInvoice, invoicePdf } from "../../src/lib/data/nfseDelivery";
import { handleInvoiceWebhook, issueAsaasInvoice } from "../../src/lib/data/nfseAsaas";
import { getPatient } from "../../src/lib/data/patients";
import { platformInvoiceFiles } from "../../src/lib/data/platform";
import type { SendOutcome } from "../../src/lib/data/whatsapp/messages";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import { adminClient, signInvoicingContract, withDatabase } from "./helpers";
import { asDb, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { fakeDeps, readyIssuer } from "./issuerFixture";
import { newPaidAppointment } from "./paymentFixture";

// N4 — Arquivos e entrega da nota do Asaas: PDF e XML copiados para os buckets
// privados quando a nota sai (pelo webhook também); entrega automática só em
// Produção, pelo WhatsApp, uma vez por destino, com nova tentativa na falha;
// envio manual da nota do Asaas sem e-mail próprio.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
});

let fixture: AgendaFixture;
let deps: ReturnType<typeof fakeDeps>;
let issuer: Awaited<ReturnType<typeof readyIssuer>>;
const sent: { kind: string; to: string }[] = [];
let failNextSend = false;

function fakeSender(): ClinicSender {
  const ok = (): SendOutcome => (failNextSend ? ((failNextSend = false), { sent: false, reason: "falha técnica da Meta" }) : { sent: true, messageId: `wamid.${sent.length}`, body: "nota" });
  return {
    clinicId: "",
    clinicLabel: "da Clínica",
    baseUrl: "http://localhost",
    template: async () => ok(),
    text: async () => ok(),
    list: async () => ok(),
    buttons: async () => ok(),
    uploadDocument: async () => "MEDIA",
    documentTemplate: async (to) => {
      const r = ok();
      if (r.sent) sent.push({ kind: "template", to });
      return r;
    },
    document: async (to) => {
      sent.push({ kind: "document", to });
      return ok();
    },
  } satisfies ClinicSender;
}

let outbox: AutoDeliveryDeps;
const fiscalFor = async (issuerId: string) => asaasFiscalApi({ baseUrl: deps.fake.baseUrl, apiKey: (await deps.issuerDeps.store.apiKey(issuerId))! }, deps.fake.fetch);
const row = (id: string) =>
  withDatabase(async (db) => (await db.query(`select status, pdf_path, xml_path, auto_delivery_status, auto_delivery_attempts from public.nfse_invoices where id = $1`, [id])).rows[0]);

async function issuedNote(): Promise<string> {
  const payment = await newPaidAppointment(fixture);
  await issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps);
  const invoice = (await listPaymentInvoices(asDb(fixture.reception), fixture.clinicId, [payment.id])).get(payment.id)![0];
  const remote = [...deps.fake.invoices.values()].find((i) => i.externalReference === invoice.id)!;
  deps.fake.authorize(remote.id);
  const out = await handleInvoiceWebhook(deps.fake.webhookEvent(remote.id, "INVOICE_AUTHORIZED"), issuer.webhookToken, deps.nfseDeps);
  await out.process!();
  return invoice.id;
}

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da entrega da nota", "+55619833000");
  await signInvoicingContract(fixture.clinicId);
  deps = fakeDeps();
  const files = platformInvoiceFiles(env());
  deps.nfseDeps.afterIssued = (invoiceId, clinicId, remote, fiscal) => copyInvoiceFiles(files, clinicId, invoiceId, remote, fiscal);
  outbox = { files, senderFor: async () => fakeSender(), serviceDb: (clinicId) => createClinicServiceClient(clinicId, env()) };
  issuer = await readyIssuer(fixture, deps, null);
  const db = asDb(fixture.reception);
  const p1 = await getPatient(db, fixture.clinicId, fixture.ids.p1);
  await saveContactCpf(db, fixture.clinicId, p1.contactId, "52998224725");
  await savePayerContact(db, fixture.clinicId, p1, "contact", { email: "mae@teste.local", postalCode: "59600000", street: "Rua", number: "1", complement: null, district: "Centro" });
  await adminClient().from("whatsapp_templates").insert({ clinic_id: fixture.clinicId, template_key: "nfse_document", name: "rc_nota_fiscal_v1", language: "pt_BR", status: "approved", version: 1 });
});

afterAll(async () => {
  for (const bucket of ["nfse-pdf", "nfse-xml"]) {
    const { data } = await adminClient().storage.from(bucket).list(fixture.clinicId);
    if (data?.length) await adminClient().storage.from(bucket).remove(data.map((f) => `${fixture.clinicId}/${f.name}`));
  }
  await fixture.cleanup();
});

describe("Arquivos e entrega da nota do Asaas (N4)", () => {
  it("emitida pelo webhook: PDF e XML no bucket; no Sandbox, sem entrega automática", async () => {
    const id = await issuedNote();
    expect(await row(id)).toMatchObject({ status: "issued", pdf_path: `${fixture.clinicId}/${id}.pdf`, xml_path: `${fixture.clinicId}/${id}.xml`, auto_delivery_status: "skipped" });
    const pdf = await invoicePdf(asDb(fixture.reception), fixture.clinicId, id);
    expect(new TextDecoder().decode(pdf.bytes)).toContain("%PDF");
  });

  it("em Produção: a rotina entrega uma vez pelo WhatsApp do contato; rodar de novo não repete", async () => {
    await adminClient().from("fiscal_issuers").update({ environment: "production" }).eq("id", issuer.issuerId);
    const id = await issuedNote();
    expect((await row(id)).auto_delivery_status).toBe("pending");
    sent.length = 0;
    await runInvoiceOutbox(outbox, fiscalFor);
    expect(sent.filter((s) => s.kind === "template")).toHaveLength(1);
    expect((await row(id)).auto_delivery_status).toBe("done");
    await withDatabase((db) => db.query(`update public.nfse_invoices set auto_delivery_status = 'pending' where id = $1`, [id]));
    await runInvoiceOutbox(outbox, fiscalFor);
    expect(sent.filter((s) => s.kind === "template")).toHaveLength(1);
    const deliveries = await withDatabase(async (db) => (await db.query(`select status, automatic from public.nfse_deliveries where invoice_id = $1`, [id])).rows);
    expect(deliveries).toEqual([{ status: "sent", automatic: true }]);
  });

  it("falha técnica: fica 'failed' e a rotina tenta de novo no mesmo envio", async () => {
    const id = await issuedNote();
    failNextSend = true;
    await runInvoiceOutbox(outbox, fiscalFor);
    expect(await row(id)).toMatchObject({ auto_delivery_status: "failed", auto_delivery_attempts: 1 });
    await withDatabase((db) => db.query(`update public.nfse_invoices set auto_delivery_at = now() - interval '11 minutes' where id = $1`, [id]));
    await runInvoiceOutbox(outbox, fiscalFor);
    expect(await row(id)).toMatchObject({ auto_delivery_status: "done", auto_delivery_attempts: 2 });
    const deliveries = await withDatabase(async (db) => (await db.query(`select status from public.nfse_deliveries where invoice_id = $1`, [id])).rows);
    expect(deliveries).toEqual([{ status: "sent" }]);
  });

  it("PDF que não baixou: a rotina busca de novo", async () => {
    const payment = await newPaidAppointment(fixture);
    await issueAsaasInvoice(asDb(fixture.reception), payment.id, deps.nfseDeps);
    const invoice = (await listPaymentInvoices(asDb(fixture.reception), fixture.clinicId, [payment.id])).get(payment.id)![0];
    const remote = [...deps.fake.invoices.values()].find((i) => i.externalReference === invoice.id)!;
    deps.fake.authorize(remote.id);
    const saved = deps.nfseDeps.afterIssued;
    deps.nfseDeps.afterIssued = async () => undefined;
    await (await handleInvoiceWebhook(deps.fake.webhookEvent(remote.id, "INVOICE_AUTHORIZED"), issuer.webhookToken, deps.nfseDeps)).process!();
    deps.nfseDeps.afterIssued = saved;
    expect((await row(invoice.id)).pdf_path).toBeNull();
    await runInvoiceOutbox(outbox, fiscalFor);
    expect((await row(invoice.id)).pdf_path).not.toBeNull();
  });

  it("envio manual da nota do Asaas: WhatsApp sim, e-mail próprio não", async () => {
    const id = await issuedNote();
    const emails: unknown[] = [];
    const lines = await deliverInvoice(asDb(fixture.reception), fixture.clinicId, id, { contact: true, phone: null, email: "outro@teste.local" }, {
      sender: fakeSender(),
      sendEmail: async (e) => void emails.push(e),
    });
    expect(lines.map((l) => l.channel)).toEqual(["whatsapp"]);
    expect(emails).toEqual([]);
  });
});
