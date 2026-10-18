import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "../../src/lib/clinicTime";
import { bookAppointment, cancelAppointment } from "../../src/lib/data/agenda/appointments";
import { getContactCpf } from "../../src/lib/data/finance";
import { anonymizePatient, getContact, getPatient } from "../../src/lib/data/patients";
import { deletePayment, listAppointmentPayments, listPatientPayments, listPaymentStates, registerPayment, summarizePayments, type PaymentInput } from "../../src/lib/data/payments";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F11.2 — Pagamentos do atendimento. Vários por atendimento; cancelado não
// recebe novo; nome e CPF de quem pagou ficam no pagamento; CPF opcional (o
// digitado vai para o cadastro); excluir guarda; nada se altera nem se apaga;
// Administrador e Recepção gravam, o Suporte só lê, o Profissional, o bot e
// outra clínica não veem; sem o item, nada grava; a anonimização mantém.
const CPF_A = "52998224725";
const CPF_B = "12345678909";
const today = todayIn("America/Fortaleza");

let fixture: AgendaFixture;
let clinicId: string;
let professional: TestUser;
let support: TestUser;
let outsider: TestUser;
let otherClinic: string;
let appointmentId: string;
let canceledId: string;

const target = async (user: TestUser, appointment: string, status: "scheduled" | "canceled" = "scheduled") => {
  const patient = await getPatient(asDb(user), clinicId, fixture.ids.p1);
  const contact = await getContact(asDb(user), clinicId, patient.contactId);
  return { appointmentId: appointment, status, patient, contact, today };
};
const pay = async (user: TestUser, input: Partial<PaymentInput> = {}, appointment = appointmentId) =>
  registerPayment(asDb(user), clinicId, await target(user, appointment), { amountCents: 10000, method: "pix", paidOn: today, payer: "contact", ...input });

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste de pagamentos", "+55619877000");
  clinicId = fixture.clinicId;
  const book = async (agendaId: string) =>
    (
      await bookAppointment(
        asDb(fixture.reception),
        clinicId,
        { patientId: fixture.ids.p1, serviceId: fixture.ids.consulta, agendaId, locationId: fixture.ids.office, start: at(MON1, "08:00"), channel: "admin", actorId: fixture.reception.id },
        NOW,
      )
    ).appointment.id;
  // Agendas diferentes: o paciente não pode ter dois futuros na mesma.
  appointmentId = await book(fixture.ids.agendaDra);
  canceledId = await book(fixture.ids.agendaDra2);
  await cancelAppointment(asDb(fixture.reception), clinicId, canceledId, { channel: "admin", actorId: fixture.reception.id }, NOW);
  professional = await createUser("pag-prof");
  await addMember(clinicId, professional.id, ["professional"]);
  support = await createUser("pag-suporte");
  await makePlatformStaff(support.id);
  otherClinic = await createClinic("Outra clínica dos pagamentos");
  outsider = await createUser("pag-outra");
  await addMember(otherClinic, outsider.id, ["admin", "reception"]);
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteClinics([otherClinic]);
  await deleteUsers([professional, support, outsider]);
});

describe("Pagamentos (F11.2)", () => {
  it("vários pagamentos num atendimento, com quem pagou gravado e a soma contra o preço", async () => {
    const first = await pay(fixture.reception, { amountCents: 10000, method: "pix" });
    expect(first.payerName).toBe("Resp. Paciente Um");
    expect(first.payerCpf).toBeNull();
    expect(first.patientId).toBe(fixture.ids.p1);
    await pay(fixture.admin, { amountCents: 20000, method: "credit_card", payer: "other", payerName: "Davi Pai", payerCpf: "123.456.789-09" });
    const payments = await listAppointmentPayments(asDb(fixture.admin), clinicId, appointmentId);
    expect(payments.map((p) => [p.method, p.payerName, p.payerCpf])).toEqual([
      ["pix", "Resp. Paciente Um", null],
      ["credit_card", "Davi Pai", CPF_B],
    ]);
    expect(summarizePayments(30000, payments)).toEqual({ priceCents: 30000, paidCents: 30000, remainingCents: 0, overPrice: false });
    expect((await listPaymentStates(asDb(fixture.admin), clinicId, [appointmentId, canceledId])).get(appointmentId)).toBe("paid");
    const { data } = await adminClient().from("payments").select("created_by").eq("id", first.id).single();
    expect(data?.created_by).toBe(fixture.reception.id);
  });

  it("o CPF digitado para o contato vai também para o cadastro financeiro", async () => {
    const patient = await getPatient(asDb(fixture.admin), clinicId, fixture.ids.p1);
    const payment = await pay(fixture.reception, { amountCents: 5000, payerCpf: "529.982.247-25" });
    expect(payment.payerCpf).toBe(CPF_A);
    expect(await getContactCpf(asDb(fixture.admin), clinicId, patient.contactId)).toBe(CPF_A);
    // Com o CPF no cadastro, ele vale (o digitado é ignorado).
    expect((await pay(fixture.reception, { amountCents: 1000, payerCpf: CPF_B })).payerCpf).toBe(CPF_A);
  });

  it("recusa valor, forma, data futura, CPF inválido e outra pessoa sem nome (na tela e no banco)", async () => {
    expect(await codeOf(() => pay(fixture.reception, { amountCents: 0 }))).toBe("invalid");
    expect(await codeOf(() => pay(fixture.reception, { amountCents: Number.NaN }))).toBe("invalid");
    expect(await codeOf(() => pay(fixture.reception, { method: "cheque" }))).toBe("invalid");
    expect(await codeOf(() => pay(fixture.reception, { paidOn: addDays(today, 1) }))).toBe("invalid");
    expect(await codeOf(() => pay(fixture.reception, { payer: "other", payerName: "" }))).toBe("invalid");
    expect(await codeOf(() => pay(fixture.reception, { payer: "other", payerName: "Pai", payerCpf: "529.982.247-24" }))).toBe("invalid");
    const row = { clinic_id: clinicId, appointment_id: appointmentId, patient_id: fixture.ids.p1, amount_cents: 100, method: "pix", payer: "other", payer_name: "Pai" };
    const { error: future } = await fixture.reception.client.from("payments").insert({ ...row, paid_on: addDays(today, 1) });
    expect(future?.code).toBe("P0001");
    const { error: badCpf } = await fixture.reception.client.from("payments").insert({ ...row, paid_on: today, payer_cpf: "11111111111" });
    expect(badCpf?.code).toBe("23514");
  });

  it("atendimento cancelado não recebe pagamento novo (na tela e no banco)", async () => {
    const t = await target(fixture.reception, canceledId, "canceled");
    expect(await codeOf(() => registerPayment(asDb(fixture.reception), clinicId, t, { amountCents: 100, method: "pix", paidOn: today, payer: "contact" }))).toBe(
      "invalid",
    );
    const { error } = await fixture.reception.client
      .from("payments")
      .insert({ clinic_id: clinicId, appointment_id: canceledId, patient_id: fixture.ids.p1, amount_cents: 100, method: "pix", paid_on: today, payer: "other", payer_name: "Pai" });
    expect(error?.code).toBe("P0001");
  });

  it("não se altera nem se apaga: excluir guarda quem e quando, uma vez só", async () => {
    const payment = await pay(fixture.reception, { amountCents: 700 });
    const { error: changed } = await fixture.admin.client.from("payments").update({ amount_cents: 1 }).eq("id", payment.id);
    expect(changed?.code).toBe("P0001");
    await fixture.admin.client.from("payments").delete().eq("id", payment.id);
    await deletePayment(asDb(fixture.reception), clinicId, payment.id);
    const { data } = await adminClient().from("payments").select("deleted_at, deleted_by, amount_cents").eq("id", payment.id).single();
    expect(data?.deleted_at).not.toBeNull();
    expect(data?.deleted_by).toBe(fixture.reception.id);
    expect(data?.amount_cents).toBe(700);
    expect(await codeOf(() => deletePayment(asDb(fixture.reception), clinicId, payment.id))).toBe("not_found");
    const payments = await listAppointmentPayments(asDb(fixture.admin), clinicId, appointmentId);
    expect(payments.find((p) => p.id === payment.id)?.deletedAt).not.toBeNull();
    expect(summarizePayments(30000, payments).paidCents).toBe(36000);
  });

  it("o Suporte lê, mas não grava nem exclui", async () => {
    const [payment] = await listAppointmentPayments(asDb(support), clinicId, appointmentId);
    expect(payment).toBeDefined();
    expect(await codeOf(() => pay(support))).toBe("forbidden");
    expect(await codeOf(() => deletePayment(asDb(support), clinicId, payment.id))).toBe("not_found");
  });

  it("o Profissional, o bot e outra clínica não veem nem gravam", async () => {
    expect(await listAppointmentPayments(asDb(professional), clinicId, appointmentId)).toEqual([]);
    const { error: profInsert } = await professional.client
      .from("payments")
      .insert({ clinic_id: clinicId, appointment_id: appointmentId, patient_id: fixture.ids.p1, amount_cents: 100, method: "pix", paid_on: today, payer: "other", payer_name: "X" });
    expect(profInsert?.code).toBe("42501");
    const { data: bot, error } = await clinicServiceClient(clinicId).from("payments").select("id");
    expect(bot ?? []).toEqual([]);
    expect(error?.code).toBe("42501");
    const { data: other } = await outsider.client.from("payments").select("id").eq("clinic_id", clinicId);
    expect(other).toEqual([]);
  });

  it("sem o item liberado, nada grava", async () => {
    await adminClient().from("clinic_features").delete().eq("clinic_id", clinicId).eq("feature_key", "finance");
    try {
      expect(await codeOf(() => pay(fixture.reception))).toBe("not_enabled");
    } finally {
      await adminClient().from("clinic_features").insert({ clinic_id: clinicId, feature_key: "finance" });
    }
  });

  it("anonimizar o paciente mantém os pagamentos (prazo fiscal)", async () => {
    const before = await listPatientPayments(asDb(fixture.admin), clinicId, fixture.ids.p1);
    await anonymizePatient(asDb(fixture.admin), clinicId, fixture.ids.p1);
    const after = await listPatientPayments(asDb(fixture.admin), clinicId, fixture.ids.p1);
    expect(after.map((p) => [p.id, p.payerName, p.payerCpf])).toEqual(before.map((p) => [p.id, p.payerName, p.payerCpf]));
  });
});
