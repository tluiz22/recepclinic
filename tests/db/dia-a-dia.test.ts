import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, recordAttendance } from "../../src/lib/data/agenda/appointments";
import { cancelByClinic } from "../../src/lib/data/agenda/blocks";
import { listTrail, loadActorLabels } from "../../src/lib/data/agenda/trail";
import { dismissRebooking, listAwaitingRebooking, listPendingAttendance, listRecordedPage, listRemindersOfDay } from "../../src/lib/data/daily";
import { asDb, at, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// F4.8 — Resumo do Dia: nome de quem fez, aguardando remarcação ("Desistiu"
// e remarcar tiram da lista), lembretes do dia, comparecimento a registrar e
// registrado.

let fixture: AgendaFixture;
const tz = "America/Fortaleza";

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do dia a dia", "849444300");
  await adminClient().from("clinic_members").update({ display_name: "Maria" }).eq("clinic_id", fixture.clinicId).eq("user_id", fixture.reception.id);
});

afterAll(async () => {
  await fixture.cleanup();
});

const book = (patientId: string, serviceId: string, agendaId: string, date: string, time: string, actor = fixture.reception) =>
  bookAppointment(asDb(actor), fixture.clinicId, { patientId, serviceId, agendaId, start: at(date, time), locationId: fixture.ids.office, channel: "admin", actorId: actor.id }, NOW);

it("quem fez: o nome na clínica para toda a equipe; sem nome, o e-mail", async () => {
  const { clinicId, admin, reception } = fixture;
  const labels = await loadActorLabels(asDb(reception), clinicId, [reception.id, admin.id]);
  expect(labels.get(reception.id)).toMatchObject({ name: "Maria", roles: ["reception"], isSupport: false });
  expect(labels.get(admin.id)).toMatchObject({ name: admin.email, roles: ["admin"] });
});

describe("aguardando remarcação", () => {
  it("cancelado pela clínica entra; remarcar a mesma jornada tira; 'Desistiu' tira e fica na trilha", async () => {
    const { clinicId, ids, admin } = fixture;
    const first = await book(ids.p1, ids.consulta, ids.agendaDra, MON1, "08:00");
    const second = await book(ids.p2, ids.consulta, ids.agendaDra, MON1, "09:00");
    await cancelByClinic(asDb(admin), clinicId, [first.appointment.id, second.appointment.id], admin.id, NOW);
    expect((await listAwaitingRebooking(asDb(admin), clinicId, NOW)).map((a) => a.id).sort()).toEqual([first.appointment.id, second.appointment.id].sort());

    // Remarcou numa agenda em que já tinha consulta cancelada: sai da lista.
    await book(ids.p1, ids.consulta, ids.agendaDra, MON2, "08:00");
    expect((await listAwaitingRebooking(asDb(admin), clinicId, NOW)).map((a) => a.id)).toEqual([second.appointment.id]);

    await dismissRebooking(asDb(admin), clinicId, second.appointment.id, admin.id, NOW);
    expect(await listAwaitingRebooking(asDb(admin), clinicId, NOW)).toEqual([]);
    const trail = await listTrail(asDb(admin), clinicId, second.appointment.id, tz);
    expect(trail.map((e) => e.text)).toEqual([
      "Marcado pelo painel por Maria (Recepção)",
      expect.stringMatching(/^Cancelado pela clínica \(cancelamento em massa\) por /),
      expect.stringMatching(/^Marcado como "Desistiu"/),
    ]);
  });
});

it("lembretes do dia: agrupados pelo botão tocado ou pela entrega", async () => {
  const { clinicId, ids, admin } = fixture;
  const a = await book(ids.p3, ids.exame, ids.agendaExams, MON1, "08:00");
  const sentAt = at(MON1, "07:00").toISOString();
  const { error } = await adminClient()
    .from("whatsapp_messages")
    .insert({ clinic_id: clinicId, appointment_id: a.appointment.id, direction: "outbound", message_type: "appointment_reminder", status: "failed", created_at: sentAt });
  expect(error).toBeNull();
  const reminders = await listRemindersOfDay(asDb(admin), clinicId, MON1, tz);
  expect(reminders.map((r) => [r.appointment.patientName, r.group])).toEqual([["Paciente Três", "not_delivered"]]);
});

it("a registrar e registradas", async () => {
  const { clinicId, ids, admin } = fixture;
  const later = new Date(at(MON2, "12:00"));
  const pending = await listPendingAttendance(asDb(admin), clinicId, later);
  expect(pending.map((a) => a.patientName)).toContain("Paciente Três");
  const exam = pending.find((a) => a.patientName === "Paciente Três")!;
  await recordAttendance(asDb(admin), clinicId, exam.id, "completed", admin.id);
  expect((await listPendingAttendance(asDb(admin), clinicId, later)).some((a) => a.id === exam.id)).toBe(false);
  const recorded = await listRecordedPage(asDb(admin), clinicId, 1);
  expect(recorded.items.map((a) => a.id)).toContain(exam.id);
  expect(recorded.total).toBeGreaterThan(0);
  void ids;
});

describe("retorno só de consulta já iniciada (cliente, 05/out)", () => {
  it("o banco recusa retorno antes do início da consulta de origem ou de outro paciente", async () => {
    const { clinicId, ids } = fixture;
    const consult = await book(ids.p3, ids.consulta, ids.agendaDra, MON2, "10:00");
    const insertReturn = (patientId: string, date: string, time: string) =>
      adminClient().from("appointments").insert({
        clinic_id: clinicId,
        patient_id: patientId,
        service_id: ids.retorno,
        agenda_id: ids.agendaDra,
        location_id: ids.office,
        scheduled_at: at(date, time).toISOString(),
        duration_minutes: 20,
        booking_channel: "admin",
        origin_appointment_id: consult.appointment.id,
      });
    const before = await insertReturn(ids.p3, MON1, "10:00");
    expect(before.error?.message).toBe("O retorno precisa ser depois do início da consulta de origem.");
    const otherPatient = await insertReturn(ids.p2, "2031-03-31", "10:00");
    expect(otherPatient.error?.message).toBe("O retorno precisa ser de uma consulta do mesmo paciente.");
    const ok = await insertReturn(ids.p3, "2031-03-31", "10:00");
    expect(ok.error).toBeNull();
  });
});
