import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPayerContact, savePatientFinance, savePayerContact, saveContactCpf, setPaymentPayerContact, type PayerContact } from "../../src/lib/data/finance";
import { getPatient } from "../../src/lib/data/patients";
import { listAppointmentPayments } from "../../src/lib/data/payments";
import { adminClient, createUser, addMember, deleteUsers, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { newPaidAppointment } from "./paymentFixture";

// N3a — Tomador da nota (seção 13.6): e-mail e endereço de quem paga no
// Financeiro (contato ou paciente) e retrato no pagamento; o pagamento segue
// imutável fora deles; só Administrador e Recepção gravam.

const CONTACT: PayerContact = { email: "mae@teste.local", postalCode: "59600000", street: "Rua Um", number: "10", complement: null, district: "Centro" };
const OTHER: PayerContact = { email: "pai@teste.local", postalCode: "59610000", street: "Rua Dois", number: "20", complement: "Ap 1", district: "Alto" };

let fixture: AgendaFixture;
let professional: TestUser;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do tomador", "+55619855000");
  professional = await createUser("tom-prof");
  await addMember(fixture.clinicId, professional.id, ["professional"]);
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([professional]);
});

describe("Tomador da nota (N3a)", () => {
  it("o contato guarda e-mail e endereço; o pagamento novo leva o retrato", async () => {
    const db = asDb(fixture.reception);
    const patient = await getPatient(db, fixture.clinicId, fixture.ids.p1);
    await saveContactCpf(db, fixture.clinicId, patient.contactId, "52998224725");
    await savePayerContact(db, fixture.clinicId, patient, "contact", CONTACT);
    expect(await getPayerContact(db, fixture.clinicId, patient, "contact")).toEqual(CONTACT);
    const payment = await newPaidAppointment(fixture);
    expect(payment.payerContact).toEqual(CONTACT);
  });

  it("outra pessoa: o retrato só vem quando o CPF é o do responsável guardado", async () => {
    const db = asDb(fixture.reception);
    const patient = await getPatient(db, fixture.clinicId, fixture.ids.p2);
    await savePatientFinance(db, fixture.clinicId, patient, { payer: "other", payerName: "Pai", payerCpf: "39053344705" });
    await savePayerContact(db, fixture.clinicId, patient, "other", OTHER);
    const same = await newPaidAppointment(fixture, { patientId: fixture.ids.p2, payer: "other", payerName: "Pai", payerCpf: "39053344705" });
    expect(same.payerContact).toEqual(OTHER);
    const another = await newPaidAppointment(fixture, { patientId: fixture.ids.p2, payer: "other", payerName: "Tia", payerCpf: "11144477735" });
    expect(another.payerContact).toBeNull();
  });

  it("completa o pagamento sem tomador e guarda no Financeiro; o resto do pagamento não muda", async () => {
    const db = asDb(fixture.reception);
    const patient = await getPatient(db, fixture.clinicId, fixture.ids.p3);
    const payment = await newPaidAppointment(fixture, { patientId: fixture.ids.p3 });
    expect(payment.payerContact).toBeNull();
    await setPaymentPayerContact(db, payment.id, CONTACT);
    const [after] = (await listAppointmentPayments(db, fixture.clinicId, payment.appointmentId)).filter((p) => p.id === payment.id);
    expect(after.payerContact).toEqual(CONTACT);
    expect(after.amountCents).toBe(payment.amountCents);
    expect(await getPayerContact(db, fixture.clinicId, patient, "contact")).toEqual(CONTACT);
    // Direto na tabela: continua imutável.
    const { error } = await db.from("payments").update({ payer_email: "x@y.z" }).eq("id", payment.id);
    expect(error).not.toBeNull();
    const { error: amount } = await adminClient().from("payments").update({ amount_cents: 1 }).eq("id", payment.id);
    expect(amount?.message).toContain("não se altera");
  });

  it("o Profissional não grava; endereço incompleto é recusado pelo banco", async () => {
    const payment = await newPaidAppointment(fixture);
    expect(await codeOf(() => setPaymentPayerContact(asDb(professional), payment.id, OTHER))).toBe("forbidden");
    expect(await codeOf(() => setPaymentPayerContact(asDb(fixture.reception), payment.id, { ...OTHER, district: "" }))).toBe("invalid");
  });
});
