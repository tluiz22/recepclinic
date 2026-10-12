import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "../../src/lib/clinicTime";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { generateDmed, getDmedSettings, loadDmedYear, saveDmedSettings, type DmedSettingsInput } from "../../src/lib/data/dmed";
import { saveContactCpf } from "../../src/lib/data/finance";
import { listFiscalAudit, saveFiscalSettings } from "../../src/lib/data/fiscal";
import { anonymizePatient, getContact, getPatient } from "../../src/lib/data/patients";
import { registerPayment } from "../../src/lib/data/payments";
import { adminClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F11.6 — DMED: só o Administrador da clínica salva os responsáveis e gera;
// o Suporte vê; entram os pagamentos do ano com CPF de quem pagou, sem os
// excluídos; os sem CPF e os de paciente anonimizado ficam de fora; cada
// arquivo gerado vai para a trilha fiscal (sem CPF); sem o item, nada grava.
const CPF_MAE = "52998224725";
const CPF_TIO = "12345678909";
const today = todayIn("America/Fortaleza");
const year = Number(today.slice(0, 4));
const SETTINGS: DmedSettingsInput = {
  fillerCpf: "111.444.777-35",
  fillerName: "Contador de Teste",
  fillerDdd: "84",
  fillerPhone: "98888-0000",
  fillerEmail: "contador@teste.local",
  legalResponsibleCpf: CPF_MAE,
};

let fixture: AgendaFixture;
let clinicId: string;
let support: TestUser;

const payFor = async (patientId: string, time: string, input: { amountCents: number; payer: string; payerName?: string; payerCpf?: string }) => {
  const db = asDb(fixture.reception);
  const { appointment } = await bookAppointment(
    db,
    clinicId,
    { patientId, serviceId: fixture.ids.consulta, agendaId: fixture.ids.agendaDra, locationId: fixture.ids.office, start: at(MON1, time), channel: "admin", actorId: fixture.reception.id },
    NOW,
  );
  const patient = await getPatient(db, clinicId, patientId);
  const contact = await getContact(db, clinicId, patient.contactId);
  return registerPayment(db, clinicId, { appointmentId: appointment.id, status: appointment.status, patient, contact, today }, { method: "pix", paidOn: today, ...input });
};

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da DMED", "+55619899");
  clinicId = fixture.clinicId;
  support = await createUser("dmed-suporte");
  await makePlatformStaff(support.id);
  await saveFiscalSettings(asDb(fixture.admin), clinicId, {
    cnpj: "11222333000181",
    legalName: "Clínica da DMED Ltda",
    municipalityIbge: "2408003",
    simplesNacional: "me_epp",
    specialRegime: "none",
    serviceCode: "04.01.01",
    issRate: "2",
  });
  const p1 = await getPatient(asDb(fixture.admin), clinicId, fixture.ids.p1);
  await saveContactCpf(asDb(fixture.admin), clinicId, p1.contactId, CPF_MAE);
  await payFor(fixture.ids.p1, "08:00", { amountCents: 30000, payer: "contact" });
  await payFor(fixture.ids.p2, "09:00", { amountCents: 15000, payer: "other", payerName: "Tio", payerCpf: CPF_TIO });
  await payFor(fixture.ids.p3, "10:00", { amountCents: 9000, payer: "other", payerName: "Sem CPF" });
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
});

describe("DMED (F11.6)", () => {
  it("só o Administrador salva os responsáveis; o Suporte lê; a Recepção não", async () => {
    expect(await codeOf(() => saveDmedSettings(asDb(fixture.reception), clinicId, SETTINGS))).toBe("forbidden");
    expect(await codeOf(() => saveDmedSettings(asDb(support), clinicId, SETTINGS))).toBe("forbidden");
    await saveDmedSettings(asDb(fixture.admin), clinicId, SETTINGS);
    expect(await getDmedSettings(asDb(support), clinicId)).toMatchObject({ fillerCpf: "11144477735", fillerPhone: "988880000", legalResponsibleCpf: CPF_MAE });
    expect(await getDmedSettings(asDb(fixture.reception), clinicId)).toBeNull();
    expect(await codeOf(() => saveDmedSettings(asDb(fixture.admin), clinicId, { ...SETTINGS, fillerCpf: "111" }))).toBe("invalid");
  });

  it("o ano: quem pagou com CPF entra; sem CPF fica de fora", async () => {
    const data = await loadDmedYear(asDb(fixture.admin), clinicId, year);
    expect(data.responsibles.map((r) => [r.cpf, r.name, r.beneficiaries.map((b) => [b.name, b.cents])])).toEqual([
      [CPF_TIO, "Tio", [["Paciente Dois", 15000]]],
      [CPF_MAE, "Resp. Paciente Um", [["Paciente Um", 30000]]],
    ]);
    expect(data.totalCents).toBe(45000);
    expect(data.leftOut.map((p) => [p.payerName, p.reason])).toEqual([["Sem CPF", "no_cpf"]]);
    expect((await loadDmedYear(asDb(fixture.admin), clinicId, year - 1)).payments).toEqual([]);
  });

  it("gera o arquivo e registra na trilha (sem CPF); a Recepção e o Suporte não geram", async () => {
    const file = await generateDmed(asDb(fixture.admin), clinicId, year, year);
    expect(file.fileName).toBe(`DMED_${year}_11222333000181.txt`);
    const lines = file.content.split("\r\n");
    expect(lines[0]).toBe(`Dmed|${year + 1}|${year}|N|||`);
    expect(lines).toContain(`RPPSS|${CPF_TIO}|Tio||`);
    expect(lines).toContain("BRPPSS||20200101|Paciente Dois|15000|");
    expect(lines.at(-2)).toBe("FIMDmed|");
    const [entry] = await listFiscalAudit(asDb(fixture.admin), clinicId);
    expect(entry.event).toBe("dmed_generated");
    expect(entry.details).toEqual({ year, responsibles: 2, total_cents: 45000, left_out: 1 });
    expect(await codeOf(() => generateDmed(asDb(fixture.reception), clinicId, year, year))).toBe("invalid");
    expect(await codeOf(() => generateDmed(asDb(support), clinicId, year, year))).toBe("forbidden");
    expect(await codeOf(() => generateDmed(asDb(fixture.admin), clinicId, year + 1, year))).toBe("invalid");
  });

  it("beneficiário anonimizado fica de fora", async () => {
    await anonymizePatient(asDb(fixture.admin), clinicId, fixture.ids.p2);
    const data = await loadDmedYear(asDb(fixture.admin), clinicId, year);
    expect(data.leftOut.map((p) => p.reason).sort()).toEqual(["anonymized", "no_cpf"]);
    expect(data.responsibles.map((r) => r.cpf)).toEqual([CPF_MAE]);
  });

  it("sem o item liberado, nada grava", async () => {
    await adminClient().from("clinic_features").delete().eq("clinic_id", clinicId).eq("feature_key", "finance");
    try {
      expect(await codeOf(() => saveDmedSettings(asDb(fixture.admin), clinicId, SETTINGS))).toBe("not_enabled");
      expect(await codeOf(() => generateDmed(asDb(fixture.admin), clinicId, year, year))).toBe("not_enabled");
    } finally {
      await adminClient().from("clinic_features").insert({ clinic_id: clinicId, feature_key: "finance" });
    }
  });
});
