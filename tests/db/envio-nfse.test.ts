import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "../../src/lib/clinicTime";
import type { Email } from "../../src/lib/email";
import { formatCentsBRL } from "../../src/lib/money";
import { saveContactCpf } from "../../src/lib/data/finance";
import { saveFiscalSettings, setFiscalEnvironment, uploadFiscalCertificate } from "../../src/lib/data/fiscal";
import { issueNfse, listPaymentInvoices, type NfseDeps } from "../../src/lib/data/nfse";
import { deliverAfterIssue, deliverInvoice, getSavedDestinations, invoicePdf, listInvoiceDeliveries, type DeliveryDeps } from "../../src/lib/data/nfseDelivery";
import { anonymizePatient, getContact, getPatient } from "../../src/lib/data/patients";
import { registerPayment } from "../../src/lib/data/payments";
import type { SendOutcome } from "../../src/lib/data/whatsapp/messages";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import { gzipBase64, type SefinTransport } from "../../src/lib/nfse/client";
import { addMember, adminClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { makeTestPfx } from "./pfx";

// F11.5 — Envio da nota: o PDF (do XML guardado) pelo WhatsApp do contato,
// por outro número e por e-mail (PDF e XML); template aprovado ou janela
// aberta; cada envio registrado; destinos guardados no Financeiro; envio
// automático só em Produção; o Profissional não vê; a anonimização apaga os
// destinos.
const CNPJ = "11222333000181";
const today = todayIn("America/Fortaleza");
const PFX = makeTestPfx(CNPJ, "senha");
const NFSE_XML = readFileSync(new URL("../../src/lib/nfse/fixtures/nfse-exemplo.xml", import.meta.url), "utf8");

let fixture: AgendaFixture;
let clinicId: string;
let professional: TestUser;
let support: TestUser;
let seq = 0;

const receita: NfseDeps = {
  transport: (async () => ({ status: 201, body: { chaveAcesso: String(++seq).padStart(50, "8"), nfseXmlGZipB64: gzipBase64(NFSE_XML) } })) as SefinTransport,
  loadCertificate: async () => ({ pfx: PFX, password: "senha" }),
  now: () => new Date(),
};

type Sent = { kind: string; to: string; template?: string; params?: string[]; filename?: string };
function fakeDeps(): { deps: DeliveryDeps; sent: Sent[]; emails: Email[] } {
  const sent: Sent[] = [];
  const emails: Email[] = [];
  const ok = (body: string): SendOutcome => ({ sent: true, messageId: `wamid.${sent.length}`, body });
  const sender = {
    clinicId: "",
    clinicLabel: "da Clínica",
    baseUrl: "http://localhost",
    template: async () => ok(""),
    text: async () => ok(""),
    list: async () => ok(""),
    buttons: async () => ok(""),
    uploadDocument: async (file) => {
      sent.push({ kind: "upload", to: "", filename: file.filename });
      return "MEDIA";
    },
    documentTemplate: async (to, _key, template, params, document) => {
      sent.push({ kind: "template", to, template: template.name, params, filename: document.filename });
      return ok("nota");
    },
    document: async (to, document) => {
      sent.push({ kind: "document", to, filename: document.filename });
      return ok("nota");
    },
  } satisfies ClinicSender;
  return { deps: { sender, sendEmail: async (email) => void emails.push(email) }, sent, emails };
}

async function issuedInvoice(): Promise<{ invoiceId: string; patientId: string }> {
  const db = asDb(fixture.reception);
  const { data: appointment, error } = await adminClient()
    .from("appointments")
    .insert({
      clinic_id: clinicId,
      patient_id: fixture.ids.p1,
      service_id: fixture.ids.consulta,
      agenda_id: fixture.ids.agendaDra,
      location_id: fixture.ids.office,
      scheduled_at: new Date(Date.UTC(2026, 0, 5, 11) + seq * 3_600_000).toISOString(),
      duration_minutes: 30,
      booking_channel: "admin",
      status: "completed",
    })
    .select("id, status")
    .single();
  if (error) throw error;
  const patient = await getPatient(db, clinicId, fixture.ids.p1);
  const contact = await getContact(db, clinicId, patient.contactId);
  const payment = await registerPayment(db, clinicId, { appointmentId: appointment.id, status: appointment.status, patient, contact, today }, { amountCents: 30000, method: "pix", paidOn: today, payer: "contact" });
  await issueNfse(db, clinicId, payment.id, receita);
  const [invoice] = (await listPaymentInvoices(db, clinicId, [payment.id])).get(payment.id)!;
  return { invoiceId: invoice.id, patientId: fixture.ids.p1 };
}

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do envio da nota", "+55619911");
  clinicId = fixture.clinicId;
  professional = await createUser("envio-prof");
  await addMember(clinicId, professional.id, ["professional"]);
  support = await createUser("envio-suporte");
  await makePlatformStaff(support.id);
  await saveFiscalSettings(asDb(fixture.admin), clinicId, {
    cnpj: CNPJ,
    legalName: "Clínica do Envio Ltda",
    municipalityIbge: "2408003",
    simplesNacional: "not_optant",
    specialRegime: "none",
    serviceCode: "04.01.01",
    issRate: "2",
  });
  await uploadFiscalCertificate(asDb(fixture.admin), clinicId, { pfx: PFX, password: "senha", acceptedTerms: true });
  const p1 = await getPatient(asDb(fixture.admin), clinicId, fixture.ids.p1);
  await saveContactCpf(asDb(fixture.admin), clinicId, p1.contactId, "52998224725");
});

afterAll(async () => {
  const { data } = await adminClient().storage.from("nfse-xml").list(clinicId);
  if (data?.length) await adminClient().storage.from("nfse-xml").remove(data.map((f) => `${clinicId}/${f.name}`));
  await fixture.cleanup();
  await deleteUsers([professional, support]);
});

describe("Envio da nota (F11.5)", () => {
  it("o PDF sai do XML guardado (uma página)", async () => {
    const { invoiceId } = await issuedInvoice();
    const pdf = await invoicePdf(asDb(fixture.reception), clinicId, invoiceId);
    expect(pdf.filename).toBe("NFSe_123.pdf");
    expect(Buffer.from(pdf.bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("sem template aprovado e conversa fechada: o WhatsApp não sai; o e-mail vai com PDF e XML; tudo registrado", async () => {
    const { invoiceId } = await issuedInvoice();
    const { deps, sent, emails } = fakeDeps();
    const lines = await deliverInvoice(asDb(fixture.reception), clinicId, invoiceId, { contact: true, phone: "(84) 98888-0001", email: "Pai@Exemplo.com" }, deps);
    expect(lines.map((l) => [l.channel, l.destination, l.ok])).toEqual([
      ["whatsapp", "+5561991101", false],
      ["whatsapp", "+5584988880001", false],
      ["email", "pai@exemplo.com", true],
    ]);
    expect(lines[0].reason).toContain("template da nota ainda não foi aprovado");
    expect(sent.filter((s) => s.kind === "template")).toEqual([]);
    expect(emails[0].subject).toBe("Nota fiscal nº 123 – Clínica do teste do envio da nota");
    expect(emails[0].attachments?.map((a) => a.filename)).toEqual(["NFSe_123.pdf", "NFSe_123.xml"]);
    const recorded = (await listInvoiceDeliveries(asDb(fixture.admin), clinicId, [invoiceId])).get(invoiceId)!;
    expect(recorded.map((d) => [d.channel, d.status]).sort()).toEqual([
      ["email", "sent"],
      ["whatsapp", "failed"],
      ["whatsapp", "failed"],
    ]);
  });

  it("com o template aprovado: o PDF sobe uma vez e vai com o texto aprovado para cada número", async () => {
    await adminClient().from("whatsapp_templates").insert({ clinic_id: clinicId, template_key: "nfse_document", name: "rc_nota_fiscal_v1", language: "pt_BR", status: "approved", version: 1 });
    const { invoiceId } = await issuedInvoice();
    const { deps, sent } = fakeDeps();
    const lines = await deliverInvoice(asDb(fixture.reception), clinicId, invoiceId, { contact: true, phone: "84988880001" }, deps);
    expect(lines.every((l) => l.ok)).toBe(true);
    expect(sent.filter((s) => s.kind === "upload")).toHaveLength(1);
    expect(sent.filter((s) => s.kind === "template")).toEqual([
      { kind: "template", to: "+5561991101", template: "rc_nota_fiscal_v1", params: ["Resp.", "da Clínica do teste do envio da nota", "123", formatCentsBRL(30000), "Paciente Um", expect.any(String)], filename: "NFSe_123.pdf" },
      { kind: "template", to: "+5584988880001", template: "rc_nota_fiscal_v1", params: ["Resp.", "da Clínica do teste do envio da nota", "123", formatCentsBRL(30000), "Paciente Um", expect.any(String)], filename: "NFSe_123.pdf" },
    ]);
  });

  it("recusa número ou e-mail inválido e envio sem destino", async () => {
    const { invoiceId } = await issuedInvoice();
    const { deps } = fakeDeps();
    expect(await codeOf(() => deliverInvoice(asDb(fixture.reception), clinicId, invoiceId, { contact: false, phone: "123" }, deps))).toBe("invalid");
    expect(await codeOf(() => deliverInvoice(asDb(fixture.reception), clinicId, invoiceId, { contact: false, email: "sem-arroba" }, deps))).toBe("invalid");
    expect(await codeOf(() => deliverInvoice(asDb(fixture.reception), clinicId, invoiceId, { contact: false }, deps))).toBe("invalid");
  });

  it("guarda os destinos; o automático só vale em Produção, com o contato e os guardados com \"enviar sempre\"", async () => {
    const test = await issuedInvoice();
    const { deps, sent, emails } = fakeDeps();
    await deliverInvoice(asDb(fixture.reception), clinicId, test.invoiceId, { contact: false, phone: "84988880002", email: "mae@exemplo.com", save: true, autoSend: true }, deps);
    expect(await getSavedDestinations(asDb(fixture.reception), clinicId, fixture.ids.p1)).toEqual({ phone: "+5584988880002", email: "mae@exemplo.com", autoSend: true });
    sent.length = 0;
    emails.length = 0;
    expect(await deliverAfterIssue(asDb(fixture.reception), clinicId, test.invoiceId, deps)).toEqual([]);

    await setFiscalEnvironment(asDb(support), clinicId, "production");
    try {
      const real = await issuedInvoice();
      const lines = await deliverAfterIssue(asDb(fixture.reception), clinicId, real.invoiceId, deps);
      expect(lines.map((l) => l.destination)).toEqual(["+5561991101", "+5584988880002", "mae@exemplo.com"]);
      const recorded = (await listInvoiceDeliveries(asDb(fixture.admin), clinicId, [real.invoiceId])).get(real.invoiceId)!;
      expect(recorded.every((d) => d.automatic)).toBe(true);
    } finally {
      await setFiscalEnvironment(asDb(support), clinicId, "restricted");
    }
  });

  it("o Profissional não vê os envios; ninguém altera; a anonimização apaga os destinos", async () => {
    const { invoiceId } = await issuedInvoice();
    const { deps } = fakeDeps();
    await deliverInvoice(asDb(fixture.reception), clinicId, invoiceId, { contact: false, email: "tio@exemplo.com" }, deps);
    expect((await listInvoiceDeliveries(asDb(professional), clinicId, [invoiceId])).size).toBe(0);
    const { error } = await fixture.admin.client.from("nfse_deliveries").update({ destination: "x" }).eq("invoice_id", invoiceId);
    expect(error?.code).toBe("42501");
    await anonymizePatient(asDb(fixture.admin), clinicId, fixture.ids.p1);
    const after = (await listInvoiceDeliveries(asDb(fixture.admin), clinicId, [invoiceId])).get(invoiceId)!;
    expect(after.map((d) => d.destination)).toEqual(["anonimizado"]);
    expect((await getSavedDestinations(asDb(fixture.admin), clinicId, fixture.ids.p1)).email).toBeNull();
  });
});
