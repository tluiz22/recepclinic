import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContactCpf, getPatientFinance, saveContactCpf, savePatientFinance } from "../../src/lib/data/finance";
import { anonymizePatient, getPatient, registerPatient } from "../../src/lib/data/patients";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F11.1 — Módulo financeiro: CPF e responsável financeiro fora do cadastro.
// Administrador e Recepção gravam; o Suporte só lê; o Profissional, o bot e
// outra clínica não veem; sem o item, nada grava; CPF conferido no banco;
// anonimizar apaga.
const CPF_A = "52998224725";
const CPF_B = "12345678909";

let fixture: AgendaFixture;
let clinicId: string;
let professional: TestUser;
let support: TestUser;
let outsider: TestUser;
let otherClinic: string;
let offClinic: string;
let offAdmin: TestUser;
let p1: string;
let contactId: string;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do Módulo financeiro", "+55619866");
  clinicId = fixture.clinicId;
  p1 = fixture.ids.p1;
  contactId = (await getPatient(asDb(fixture.admin), clinicId, p1)).contactId;
  professional = await createUser("fin-prof");
  await addMember(clinicId, professional.id, ["professional"]);
  support = await createUser("fin-suporte");
  await makePlatformStaff(support.id);
  otherClinic = await createClinic("Outra clínica do financeiro");
  outsider = await createUser("fin-outra");
  await addMember(otherClinic, outsider.id, ["admin", "reception"]);
  offClinic = await createClinic("Clínica sem o financeiro", []);
  offAdmin = await createUser("fin-sem-item");
  await addMember(offClinic, offAdmin.id, ["admin", "reception"]);
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteClinics([otherClinic, offClinic]);
  await deleteUsers([professional, support, outsider, offAdmin]);
});

describe("Módulo financeiro (F11.1)", () => {
  it("a Recepção grava CPF e responsável; o Administrador lê", async () => {
    const patient = await getPatient(asDb(fixture.reception), clinicId, p1);
    await savePatientFinance(asDb(fixture.reception), clinicId, patient, { cpf: "123.456.789-09", payer: "contact", contactCpf: "529.982.247-25" });
    expect(await getPatientFinance(asDb(fixture.admin), clinicId, p1)).toEqual({ cpf: CPF_B, payer: "contact", payerName: null, payerCpf: null });
    expect(await getContactCpf(asDb(fixture.admin), clinicId, contactId)).toBe(CPF_A);
    const { data } = await adminClient().from("patient_finance").select("updated_by").eq("patient_id", p1).single();
    expect(data?.updated_by).toBe(fixture.reception.id);
  });

  it("outra pessoa precisa de nome e CPF válidos (na tela e no banco)", async () => {
    const patient = await getPatient(asDb(fixture.admin), clinicId, p1);
    expect(await codeOf(() => savePatientFinance(asDb(fixture.admin), clinicId, patient, { payer: "other", payerName: "Pai" }))).toBe("invalid");
    expect(await codeOf(() => savePatientFinance(asDb(fixture.admin), clinicId, patient, { payer: "other", payerName: "Pai", payerCpf: "529.982.247-24" }))).toBe("invalid");
    const { error } = await fixture.admin.client.from("patient_finance").update({ payer: "other" }).eq("patient_id", p1);
    expect(error?.code).toBe("23514");
    const { error: badCpf } = await fixture.admin.client.from("contact_finance").update({ cpf: "11111111111" }).eq("contact_id", contactId);
    expect(badCpf?.code).toBe("23514");
    await savePatientFinance(asDb(fixture.admin), clinicId, patient, { payer: "other", payerName: "Davi Pai", payerCpf: CPF_B });
    expect((await getPatientFinance(asDb(fixture.admin), clinicId, p1)).payerName).toBe("Davi Pai");
  });

  it("o Suporte lê, mas não grava", async () => {
    expect(await getContactCpf(asDb(support), clinicId, contactId)).toBe(CPF_A);
    expect(await codeOf(() => saveContactCpf(asDb(support), clinicId, contactId, CPF_B))).toBe("forbidden");
    expect(await getContactCpf(asDb(fixture.admin), clinicId, contactId)).toBe(CPF_A);
  });

  it("o Profissional não vê nem grava", async () => {
    expect(await getContactCpf(asDb(professional), clinicId, contactId)).toBeNull();
    expect((await getPatientFinance(asDb(professional), clinicId, p1)).cpf).toBeNull();
    expect(await codeOf(() => saveContactCpf(asDb(professional), clinicId, contactId, CPF_B))).toBe("forbidden");
  });

  it("o bot e outra clínica não chegam nos dados", async () => {
    const { data: bot, error } = await clinicServiceClient(clinicId).from("contact_finance").select("cpf");
    expect(bot ?? []).toEqual([]);
    expect(error?.code).toBe("42501");
    const { data: other } = await outsider.client.from("patient_finance").select("cpf").eq("clinic_id", clinicId);
    expect(other).toEqual([]);
    expect(await codeOf(() => saveContactCpf(asDb(outsider), clinicId, contactId, CPF_B))).toBe("forbidden");
  });

  it("sem o item liberado, nada grava", async () => {
    const result = await registerPatient(
      asDb(offAdmin),
      offClinic,
      { fullName: "Paciente Sem Item", birthdate: "1990-01-01", contact: { mode: "self", phone: "+5561986600099" } },
      "2031-03-09",
    );
    if (result.status !== "created") throw new Error(result.status);
    expect(await codeOf(() => saveContactCpf(asDb(offAdmin), offClinic, result.patient.contactId, CPF_A))).toBe("not_enabled");
  });

  it("anonimizar o paciente apaga os dados financeiros dele e do contato", async () => {
    await anonymizePatient(asDb(fixture.admin), clinicId, p1);
    const { data: patientRows } = await adminClient().from("patient_finance").select("patient_id").eq("patient_id", p1);
    const { data: contactRows } = await adminClient().from("contact_finance").select("contact_id").eq("contact_id", contactId);
    expect(patientRows).toEqual([]);
    expect(contactRows).toEqual([]);
  });
});
