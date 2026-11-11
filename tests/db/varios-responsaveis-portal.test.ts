import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { contactForResponsible } from "../../src/lib/data/patients";
import { linkPatientContact } from "../../src/lib/data/patientContacts";
import { contactHasSelf, findDuplicate, phonePatients } from "../../src/lib/data/portal/booking";
import { cancelMine, findMyAppointment, listMyAppointments, rescheduleMine, rescheduleScope, rescheduleSlots } from "../../src/lib/data/portal/myAppointments";
import { sendAppointmentNotice } from "../../src/lib/data/whatsapp/notices";
import { recordReminderTap } from "../../src/lib/data/whatsapp/reminders";
import { recipientOfAppointment } from "../../src/lib/data/whatsapp/recipient";
import type { ClinicSender } from "../../src/lib/data/whatsapp/send";
import { adminClient, clinicServiceClient } from "./helpers";
import { asDb, at, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// VR3 — portal e mensagens com vários responsáveis (D14; UI-3 e UI-4, cliente, 10/nov/2026): o número vê os pacientes
// de que é responsável, as mensagens vão para quem marcou, quem remarca passa a ser quem marcou e qualquer responsável
// ligado confirma pelo lembrete.

const PREFIX = "+55849912471";
const MOM_PHONE = `${PREFIX}01`;
const DAD_PHONE = `${PREFIX}77`;
const STRANGER = `${PREFIX}88`;
let f: AgendaFixture;
let service: DbClient;
let mom: string;
let dad: string;

const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "Clínica",
  baseUrl: "https://app.exemplo.test",
  template: async () => ({ sent: false, reason: "teste" }),
  text: async () => ({ sent: false, reason: "teste" }),
  list: async () => ({ sent: false, reason: "teste" }),
  buttons: async () => ({ sent: false, reason: "teste" }),
};

const book = async (patientId: string, start: Date, bookedByContactId: string | null, channel: "admin" | "portal" = "portal") =>
  (
    await bookAppointment(asDb(f.reception), f.clinicId, {
      patientId,
      bookedByContactId,
      serviceId: f.ids.consulta,
      agendaId: f.ids.agendaDra,
      start,
      locationId: f.ids.office,
      channel,
      actorId: channel === "admin" ? f.reception.id : null,
      anyTime: true,
      acceptedWarnings: true,
    })
  ).appointment;

const clearFuture = (patientId: string) =>
  adminClient().from("appointments").update({ status: "canceled", canceled_at: new Date().toISOString() }).eq("patient_id", patientId).in("status", ["scheduled", "confirmed"]);

const lastMessagePhone = async (appointmentId: string, messageType: string) => {
  const { data } = await adminClient()
    .from("whatsapp_messages")
    .select("contact_phone")
    .eq("appointment_id", appointmentId)
    .eq("message_type", messageType)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.contact_phone ?? null;
};

const bookedBy = async (appointmentId: string) =>
  (await adminClient().from("appointments").select("booked_by_contact_id").eq("id", appointmentId).single()).data!.booked_by_contact_id;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica do portal com responsáveis", PREFIX);
  service = clinicServiceClient(f.clinicId) as unknown as DbClient;
  const { data } = await adminClient().from("patients").select("contact_id").eq("id", f.ids.p1).single();
  mom = data!.contact_id;
  await adminClient().from("contacts").update({ full_name: "Ana Souza" }).eq("id", mom);
  dad = (await contactForResponsible(asDb(f.admin), f.clinicId, { phone: DAD_PHONE, fullName: "Carlos Souza" })).id;
  await linkPatientContact(asDb(f.reception), f.clinicId, f.ids.p1, dad, "Pai");
});

afterAll(async () => f.cleanup());

describe("Para quem… (UI-3)", () => {
  it("o pai vê a criança pela ligação, com a mãe em 'também com'", async () => {
    const { contact, patients } = await phonePatients(service, f.clinicId, DAD_PHONE);
    expect(contact?.id).toBe(dad);
    expect(patients).toEqual([expect.objectContaining({ id: f.ids.p1, isContactSelf: false, others: ["Ana"], primaryContactId: mom })]);
    const fromMom = await phonePatients(service, f.clinicId, MOM_PHONE);
    expect(fromMom.patients.find((p) => p.id === f.ids.p1)?.others).toEqual(["Carlos (pai)"]);
  });

  it("um número sem a ficha não a vê; 'Para mim' segue pelo 'próprio paciente' da ligação", async () => {
    expect((await phonePatients(service, f.clinicId, STRANGER)).patients).toEqual([]);
    expect(await contactHasSelf(service, f.clinicId, dad)).toBe(false);
  });

  it("ficha parecida: o pai acha a criança mesmo sem ser o principal", async () => {
    const { patients } = await phonePatients(service, f.clinicId, DAD_PHONE);
    const match = await findDuplicate(service, f.clinicId, dad, { name: "Paciente Um", birthdate: "2020-01-01" }, patients);
    expect(match).toMatchObject({ id: f.ids.p1, sameBirthdate: true });
  });
});

describe("mensagens para quem marcou", () => {
  it("o pai marca: a confirmação e os avisos vão para ele", async () => {
    await clearFuture(f.ids.p1);
    const appt = await book(f.ids.p1, at(MON1, "08:00"), dad);
    expect(await bookedBy(appt.id)).toBe(dad);
    expect((await recipientOfAppointment(service, f.clinicId, appt.id))?.phone).toBe(DAD_PHONE);
    await sendAppointmentNotice(service, f.clinicId, appt.id, "confirmation", sender, NOW);
    expect(await lastMessagePhone(appt.id, "appointment_confirmation")).toBe(DAD_PHONE);
  });

  it("sem quem marcou, o banco põe o principal", async () => {
    await clearFuture(f.ids.p1);
    const appt = await book(f.ids.p1, at(MON1, "08:30"), null, "admin");
    expect(await bookedBy(appt.id)).toBe(mom);
  });

  it("toque 'Confirmar' do lembrete: vale de qualquer responsável ligado, não de um estranho", async () => {
    await clearFuture(f.ids.p1);
    const appt = await book(f.ids.p1, at(MON1, "09:00"), dad);
    await adminClient().from("appointments").update({ reminder_sent_at: NOW.toISOString() }).eq("id", appt.id);
    expect(await recordReminderTap(service, f.clinicId, { button: "confirm", appointmentId: appt.id, phone: STRANGER, waMessageId: null }, NOW)).toEqual({ result: "inactive" });
    expect(await recordReminderTap(service, f.clinicId, { button: "confirm", appointmentId: appt.id, phone: MOM_PHONE, waMessageId: null }, NOW)).toMatchObject({ result: "recorded", confirmedNow: true });
  });
});

describe("Minhas consultas (UI-4)", () => {
  it("'Marcada por' só com mais de um responsável", async () => {
    await clearFuture(f.ids.p1);
    await clearFuture(f.ids.p2);
    const byDad = await book(f.ids.p1, at(MON1, "10:00"), dad);
    const single = await book(f.ids.p2, at(MON1, "10:30"), null);
    const fromMom = await listMyAppointments(service, f.clinicId, MOM_PHONE, NOW);
    expect(fromMom.find((i) => i.id === byDad.id)?.bookedByText).toBe("Marcada por Carlos (pai), que recebe os avisos");
    const fromDad = await listMyAppointments(service, f.clinicId, DAD_PHONE, NOW);
    expect(fromDad.map((i) => [i.id, i.bookedByText])).toEqual([[byDad.id, "Marcada por você"]]);
    // Paciente Dois tem um responsável só: nada muda.
    expect((await listMyAppointments(service, f.clinicId, `${PREFIX}02`, NOW)).find((i) => i.id === single.id)?.bookedByText).toBeNull();
  });

  it("marcada pela recepção: diz para quem vão os avisos", async () => {
    await clearFuture(f.ids.p1);
    const appt = await book(f.ids.p1, at(MON1, "11:00"), dad, "admin");
    const item = await findMyAppointment(service, f.clinicId, MOM_PHONE, appt.id, { now: NOW });
    expect(item?.bookedByText).toBe("Marcada pela recepção, com avisos para Carlos (pai)");
  });

  it("quem remarca passa a ser quem marcou; quem cancela recebe o aviso do cancelamento", async () => {
    await clearFuture(f.ids.p1);
    const appt = await book(f.ids.p1, at(MON1, "14:00"), dad);
    const item = (await findMyAppointment(service, f.clinicId, MOM_PHONE, appt.id, { now: NOW }))!;
    const scope = await rescheduleScope(service, f.clinicId, item, { timeZone: "America/Fortaleza", sessionId: null, rebook: false, now: NOW });
    const [slot] = await rescheduleSlots(service, f.clinicId, item, scope, MON2, NOW);
    const outcome = await rescheduleMine(service, f.clinicId, { item, slot, scope, rebook: false, leadHours: null, sender, phone: MOM_PHONE }, NOW);
    expect(outcome).toMatchObject({ status: "done" });
    expect(await bookedBy(appt.id)).toBe(mom);
    expect(await lastMessagePhone(appt.id, "appointment_reschedule")).toBe(MOM_PHONE);

    const again = (await findMyAppointment(service, f.clinicId, DAD_PHONE, appt.id, { now: NOW }))!;
    expect(again.bookedByText).toBe("Marcada por Ana, que recebe os avisos");
    expect(await cancelMine(service, f.clinicId, { item: again, leadHours: null, sender, phone: DAD_PHONE }, NOW)).toMatchObject({ status: "done" });
    expect(await lastMessagePhone(appt.id, "appointment_cancellation")).toBe(DAD_PHONE);
  });
});

describe("aviso ao outro responsável (VR4)", () => {
  it("sem o modelo aprovado, nada sai", async () => {
    await clearFuture(f.ids.p1);
    const appt = await book(f.ids.p1, at(MON1, "15:00"), dad);
    const item = (await findMyAppointment(service, f.clinicId, MOM_PHONE, appt.id, { now: NOW }))!;
    expect(await cancelMine(service, f.clinicId, { item, leadHours: null, sender, phone: MOM_PHONE }, NOW)).toMatchObject({ status: "done" });
    expect(await lastMessagePhone(appt.id, "appointment_canceled_by_other")).toBeNull();
  });

  it("com o modelo aprovado: quem marcou recebe quando outro remarca ou cancela; quem mexe no que marcou, não", async () => {
    await adminClient().from("whatsapp_templates").insert([
      { clinic_id: f.clinicId, template_key: "rescheduled_by_other", name: "rc_remarcada_por_outro_v1", language: "pt_BR", status: "approved" },
      { clinic_id: f.clinicId, template_key: "canceled_by_other", name: "rc_cancelada_por_outro_v1", language: "pt_BR", status: "approved" },
    ]);
    await clearFuture(f.ids.p1);
    const appt = await book(f.ids.p1, at(MON1, "15:30"), dad);
    // A mãe remarca a consulta que o pai marcou: o pai recebe.
    const item = (await findMyAppointment(service, f.clinicId, MOM_PHONE, appt.id, { now: NOW }))!;
    const scope = await rescheduleScope(service, f.clinicId, item, { timeZone: "America/Fortaleza", sessionId: null, rebook: false, now: NOW });
    const [slot] = await rescheduleSlots(service, f.clinicId, item, scope, MON2, NOW);
    expect(await rescheduleMine(service, f.clinicId, { item, slot, scope, rebook: false, leadHours: null, sender, phone: MOM_PHONE }, NOW)).toMatchObject({ status: "done" });
    expect(await lastMessagePhone(appt.id, "appointment_rescheduled_by_other")).toBe(DAD_PHONE);
    const { data } = await adminClient().from("whatsapp_messages").select("body").eq("appointment_id", appt.id).eq("message_type", "appointment_rescheduled_by_other").single();
    expect(data!.body).toMatch(/Ana remarcou o atendimento de Paciente/);

    // Agora a mãe é quem marcou; ela mesma cancela: só o aviso dela, nada para o pai.
    const again = (await findMyAppointment(service, f.clinicId, MOM_PHONE, appt.id, { now: NOW }))!;
    expect(await cancelMine(service, f.clinicId, { item: again, leadHours: null, sender, phone: MOM_PHONE }, NOW)).toMatchObject({ status: "done" });
    expect(await lastMessagePhone(appt.id, "appointment_canceled_by_other")).toBeNull();

    // O pai cancela a que a mãe marcou: a mãe recebe.
    await clearFuture(f.ids.p1);
    const byMom = await book(f.ids.p1, at(MON1, "16:00"), mom);
    const fromDad = (await findMyAppointment(service, f.clinicId, DAD_PHONE, byMom.id, { now: NOW }))!;
    expect(await cancelMine(service, f.clinicId, { item: fromDad, leadHours: null, sender, phone: DAD_PHONE }, NOW)).toMatchObject({ status: "done" });
    expect(await lastMessagePhone(byMom.id, "appointment_canceled_by_other")).toBe(MOM_PHONE);
  });
});

