import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "../../src/lib/clinicTime";
import { saveContactCpf } from "../../src/lib/data/finance";
import { listFiscalAudit, saveFiscalSettings, setFiscalEnvironment, uploadFiscalCertificate } from "../../src/lib/data/fiscal";
import { cancelNfse, checkNfse, issueNfse, listPaymentInvoices, type NfseDeps } from "../../src/lib/data/nfse";
import { getContact, getPatient } from "../../src/lib/data/patients";
import { deletePayment, registerPayment } from "../../src/lib/data/payments";
import { gunzipBase64, gzipBase64, type SefinTransport } from "../../src/lib/nfse/client";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { makeTestPfx } from "./pfx";

// F11.4 — Emissão e cancelamento da NFS-e, com uma Receita simulada: o banco
// reserva e confere, o servidor assina e envia, o banco grava o resultado e a
// trilha. Uma nota ativa por pagamento; pagamento com nota não se exclui;
// resposta perdida = consultar antes de repetir; só o Administrador cancela;
// só o Suporte troca o ambiente; quem não é da clínica não vê nada.
const CNPJ = "11222333000181";
const CPF_MAE = "52998224725";
const today = todayIn("America/Fortaleza");
const PFX = makeTestPfx(CNPJ, "senha");

let fixture: AgendaFixture;
let clinicId: string;
let professional: TestUser;
let support: TestUser;
let outsider: TestUser;
let otherClinic: string;
let seq = 0;

type Seen = { method: string; path: string; xml?: string };
/** Receita simulada: responde cada chamada com o que o teste mandar. */
function sefin(reply: (req: Seen) => { status: number; body: unknown }, seen: Seen[] = []): NfseDeps {
  const transport: SefinTransport = async (_env, _keys, req) => {
    const encoded = req.body?.dpsXmlGZipB64 ?? req.body?.pedidoRegistroEventoXmlGZipB64;
    const call = { method: req.method, path: req.path, xml: encoded ? gunzipBase64(encoded) : undefined };
    seen.push(call);
    return reply(call);
  };
  return { transport, loadCertificate: async () => ({ pfx: PFX, password: "senha" }), now: () => new Date() };
}
const key = (n: number) => String(n).padStart(50, "9");
const issued = (n: number) => ({ status: 201, body: { chaveAcesso: key(n), nfseXmlGZipB64: gzipBase64(`<NFSe><infNFSe><nNFSe>${n}</nNFSe></infNFSe></NFSe>`) } });

/** Um atendimento que já aconteceu (compareceu) e o pagamento dele, pela Recepção. */
async function newPayment(input: { payer?: string; payerName?: string; payerCpf?: string } = {}) {
  const db = asDb(fixture.reception);
  const { data: appointment, error } = await adminClient()
    .from("appointments")
    .insert({
      clinic_id: clinicId,
      patient_id: fixture.ids.p1,
      service_id: fixture.ids.consulta,
      agenda_id: fixture.ids.agendaDra,
      location_id: fixture.ids.office,
      scheduled_at: new Date(Date.UTC(2026, 0, 5, 11, 0) + seq++ * 3_600_000).toISOString(),
      duration_minutes: 30,
      booking_channel: "admin",
      status: "completed",
    })
    .select("id, status")
    .single();
  if (error) throw error;
  const patient = await getPatient(db, clinicId, fixture.ids.p1);
  const contact = await getContact(db, clinicId, patient.contactId);
  return registerPayment(db, clinicId, { appointmentId: appointment.id, status: appointment.status, patient, contact, today }, { amountCents: 30000, method: "pix", paidOn: today, payer: "contact", ...input });
}

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da emissão", "+55619900");
  clinicId = fixture.clinicId;
  professional = await createUser("nfse-prof");
  await addMember(clinicId, professional.id, ["professional"]);
  support = await createUser("nfse-suporte");
  await makePlatformStaff(support.id);
  otherClinic = await createClinic("Outra clínica da emissão");
  outsider = await createUser("nfse-outra");
  await addMember(otherClinic, outsider.id, ["admin", "reception"]);
  await saveFiscalSettings(asDb(fixture.admin), clinicId, {
    cnpj: CNPJ,
    legalName: "Clínica da Emissão Ltda",
    municipalRegistration: "123",
    municipalityIbge: "2408003",
    simplesNacional: "me_epp",
    simplesRegime: "1",
    simplesTotalRate: "6",
    specialRegime: "none",
    serviceCode: "04.01.01",
    issRate: "2",
  });
  await uploadFiscalCertificate(asDb(fixture.admin), clinicId, { pfx: PFX, password: "senha", acceptedTerms: true });
  const p1 = await getPatient(asDb(fixture.admin), clinicId, fixture.ids.p1);
  await saveContactCpf(asDb(fixture.admin), clinicId, p1.contactId, CPF_MAE);
});

afterAll(async () => {
  const { data } = await adminClient().storage.from("nfse-xml").list(clinicId);
  if (data?.length) await adminClient().storage.from("nfse-xml").remove(data.map((f) => `${clinicId}/${f.name}`));
  await fixture.cleanup();
  await deleteClinics([otherClinic]);
  await deleteUsers([professional, support, outsider]);
});

describe("Emissão da NFS-e (F11.4)", () => {
  it("a Recepção emite: DPS assinada no CPF de quem pagou; nota, XML guardado e trilha", async () => {
    const payment = await newPayment();
    const seen: Seen[] = [];
    const result = await issueNfse(asDb(fixture.reception), clinicId, payment.id, sefin(() => issued(1), seen));
    expect(result).toEqual({ status: "issued", message: "Nota fiscal nº 1 emitida." });
    expect(seen[0].path).toBe("/nfse");
    expect(seen[0].xml).toContain(`<toma><CPF>${CPF_MAE}</CPF><xNome>Resp. Paciente Um</xNome></toma>`);
    expect(seen[0].xml).toContain("<nDPS>1</nDPS>");
    expect(seen[0].xml).toContain("<tpAmb>2</tpAmb>");
    expect(seen[0].xml).toContain("Paciente: Paciente Um.");
    expect(seen[0].xml).toContain("<SignatureValue>");
    const [invoice] = (await listPaymentInvoices(asDb(fixture.admin), clinicId, [payment.id])).get(payment.id)!;
    expect(invoice).toMatchObject({ status: "issued", nfseNumber: "1", accessKey: key(1), hasXml: true, environment: "restricted" });
    const { data: xml } = await fixture.reception.client.storage.from("nfse-xml").download(`${clinicId}/${invoice.id}.xml`);
    expect(await xml?.text()).toContain("<nNFSe>1</nNFSe>");
    const events = (await listFiscalAudit(asDb(fixture.admin), clinicId)).map((e) => e.event);
    expect(events.slice(0, 2)).toEqual(["nfse_issued", "nfse_issue_requested"]);

    // Uma nota ativa por pagamento; pagamento com nota não se exclui.
    expect(await codeOf(() => issueNfse(asDb(fixture.reception), clinicId, payment.id, sefin(() => issued(9))))).toBe("invalid");
    expect(await codeOf(() => deletePayment(asDb(fixture.reception), clinicId, payment.id))).toBe("invalid");
  });

  it("recusada: guarda o código da Receita e deixa emitir de novo, com outro número", async () => {
    const payment = await newPayment();
    const result = await issueNfse(asDb(fixture.reception), clinicId, payment.id, sefin(() => ({ status: 400, body: { erros: [{ Codigo: "E0712", Descricao: "Tributos" }] } })));
    expect(result.status).toBe("rejected");
    expect(result.message).toContain("E0712");
    const seen: Seen[] = [];
    await issueNfse(asDb(fixture.reception), clinicId, payment.id, sefin(() => issued(3), seen));
    expect(seen[0].xml).toContain("<nDPS>3</nDPS>");
    const invoices = (await listPaymentInvoices(asDb(fixture.admin), clinicId, [payment.id])).get(payment.id)!;
    expect(invoices.map((n) => [n.status, n.errorCode])).toEqual([
      ["issued", null],
      ["rejected", "E0712"],
    ]);
  });

  it("sem resposta: fica emitindo; conferir na Receita acha a nota (ou libera para emitir de novo)", async () => {
    const lost = await newPayment();
    const down = sefin(() => {
      throw new Error("ECONNRESET");
    });
    expect((await issueNfse(asDb(fixture.reception), clinicId, lost.id, down)).status).toBe("issuing");
    expect(await codeOf(() => issueNfse(asDb(fixture.reception), clinicId, lost.id, sefin(() => issued(9))))).toBe("invalid");
    const [pending] = (await listPaymentInvoices(asDb(fixture.admin), clinicId, [lost.id])).get(lost.id)!;
    const found = sefin((req) => (req.path.startsWith("/dps/") ? { status: 200, body: { chaveAcesso: key(4) } } : issued(4)));
    expect(await checkNfse(asDb(fixture.reception), clinicId, pending.id, found)).toEqual({ status: "issued", message: "Nota fiscal nº 4 emitida." });

    const other = await newPayment();
    await issueNfse(asDb(fixture.reception), clinicId, other.id, down);
    const [stuck] = (await listPaymentInvoices(asDb(fixture.admin), clinicId, [other.id])).get(other.id)!;
    expect((await checkNfse(asDb(fixture.reception), clinicId, stuck.id, sefin(() => ({ status: 404, body: null })))).status).toBe("rejected");
    expect((await issueNfse(asDb(fixture.reception), clinicId, other.id, sefin(() => issued(6)))).status).toBe("issued");
  });

  it("só o Administrador cancela, com motivo; depois dá para emitir de novo", async () => {
    const payment = await newPayment();
    await issueNfse(asDb(fixture.reception), clinicId, payment.id, sefin(() => issued(7)));
    const [invoice] = (await listPaymentInvoices(asDb(fixture.admin), clinicId, [payment.id])).get(payment.id)!;
    const reason = { code: 1, text: "CPF do tomador errado" };
    expect(await codeOf(() => cancelNfse(asDb(fixture.reception), clinicId, invoice.id, reason, "America/Fortaleza", sefin(() => ({ status: 201, body: {} }))))).toBe("forbidden");
    expect(await codeOf(() => cancelNfse(asDb(fixture.admin), clinicId, invoice.id, { code: 1, text: "curto" }, "America/Fortaleza", sefin(() => ({ status: 201, body: {} }))))).toBe("invalid");
    const seen: Seen[] = [];
    expect((await cancelNfse(asDb(fixture.admin), clinicId, invoice.id, reason, "America/Fortaleza", sefin(() => ({ status: 201, body: {} }), seen))).status).toBe("canceled");
    expect(seen[0].path).toBe(`/nfse/${key(7)}/eventos`);
    expect(seen[0].xml).toContain(`<infPedReg Id="PRE${key(7)}101101">`);
    expect(seen[0].xml).toContain("<cMotivo>1</cMotivo><xMotivo>CPF do tomador errado</xMotivo>");
    expect((await issueNfse(asDb(fixture.reception), clinicId, payment.id, sefin(() => issued(8)))).status).toBe("issued");
  });

  it("cancelamento recusado: a nota continua emitida, com o erro", async () => {
    const payment = await newPayment();
    await issueNfse(asDb(fixture.reception), clinicId, payment.id, sefin(() => issued(10)));
    const [invoice] = (await listPaymentInvoices(asDb(fixture.admin), clinicId, [payment.id])).get(payment.id)!;
    const result = await cancelNfse(asDb(fixture.admin), clinicId, invoice.id, { code: 9, text: "Pagamento devolvido ao paciente" }, "America/Fortaleza", sefin(() => ({ status: 400, body: { erros: [{ Codigo: "E1235", Descricao: "Prazo expirado" }] } })));
    expect(result.status).toBe("issued");
    const [after] = (await listPaymentInvoices(asDb(fixture.admin), clinicId, [payment.id])).get(payment.id)!;
    expect(after).toMatchObject({ status: "issued", errorCode: "E1235" });
  });

  it("sem CPF de quem pagou, a nota não sai", async () => {
    const payment = await newPayment({ payer: "other", payerName: "Sem CPF" });
    expect(await codeOf(() => issueNfse(asDb(fixture.reception), clinicId, payment.id, sefin(() => issued(99))))).toBe("invalid");
  });

  it("o Profissional e outra clínica não emitem nem veem; ninguém grava direto", async () => {
    const payment = await newPayment();
    expect(await codeOf(() => issueNfse(asDb(professional), clinicId, payment.id, sefin(() => issued(99))))).toBe("forbidden");
    expect(await codeOf(() => issueNfse(asDb(outsider), clinicId, payment.id, sefin(() => issued(99))))).toBe("forbidden");
    expect((await listPaymentInvoices(asDb(professional), clinicId, [payment.id])).size).toBe(0);
    const { data } = await outsider.client.from("nfse_invoices").select("id").eq("clinic_id", clinicId);
    expect(data).toEqual([]);
    const { error } = await fixture.admin.client.from("nfse_invoices").update({ status: "canceled" }).eq("clinic_id", clinicId);
    expect(error?.code).toBe("42501");
    const { error: finish } = await fixture.reception.client.rpc("finish_nfse_issue", { p_invoice_id: "00000000-0000-4000-8000-000000000000", p_outcome: "issued" });
    expect(finish?.code).toBe("42501");
  });

  it("só o Suporte passa para Produção; a numeração recomeça no outro ambiente; a trilha registra", async () => {
    expect(await codeOf(() => setFiscalEnvironment(asDb(fixture.admin), clinicId, "production"))).toBe("forbidden");
    await setFiscalEnvironment(asDb(support), clinicId, "production");
    expect((await listFiscalAudit(asDb(fixture.admin), clinicId))[0]).toMatchObject({ event: "environment_changed", details: { from: "restricted", to: "production" } });
    const payment = await newPayment();
    const seen: Seen[] = [];
    await issueNfse(asDb(fixture.reception), clinicId, payment.id, sefin(() => issued(11), seen));
    expect(seen[0].xml).toContain("<tpAmb>1</tpAmb>");
    expect(seen[0].xml).toContain("<nDPS>1</nDPS>");
    await setFiscalEnvironment(asDb(support), clinicId, "restricted");
  });

  it("sem certificado ou sem o item, nada sai", async () => {
    const payment = await newPayment();
    await adminClient().from("clinic_features").delete().eq("clinic_id", clinicId).eq("feature_key", "finance");
    try {
      expect(await codeOf(() => issueNfse(asDb(fixture.reception), clinicId, payment.id, sefin(() => issued(99))))).toBe("not_enabled");
    } finally {
      await adminClient().from("clinic_features").insert({ clinic_id: clinicId, feature_key: "finance" });
    }
    await fixture.admin.client.rpc("revoke_fiscal_certificate", { p_clinic_id: clinicId });
    expect(await codeOf(() => issueNfse(asDb(fixture.reception), clinicId, payment.id, sefin(() => issued(99))))).toBe("invalid");
  });
});
