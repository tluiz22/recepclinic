import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bookAppointment,
  cancelAppointment,
  cancelAppointments,
  recordAttendance,
  rescheduleAppointment,
} from "../../src/lib/data/agenda/appointments";
import type { DbClient } from "../../src/lib/data/clients";
import { registerPatient } from "../../src/lib/data/patients";
import { asDb, at, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient, clinicServiceClient } from "./helpers";

// M1 do redesign das Métricas (22/out/2026): marcar, remarcar, cancelar e
// registrar o comparecimento gravam a trilha no próprio banco (gatilho), na
// mesma transação da mudança, sem evento repetido.

let fixture: AgendaFixture;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da trilha", "849333500");
});

afterAll(async () => {
  await fixture.cleanup();
});

// Um paciente por caso: a trava de duplicidade não deixa dois futuros.
let phone = 10;
async function newPatient(): Promise<string> {
  phone += 1;
  const result = await registerPatient(
    asDb(fixture.admin),
    fixture.clinicId,
    { fullName: `Paciente da Trilha ${phone}`, birthdate: "2020-01-01", contact: { mode: "new", fullName: `Resp. ${phone}`, phone: `849333500${phone}` } },
    "2031-03-09",
  );
  if (result.status !== "created") throw new Error(result.status);
  return result.patient.id;
}

async function trail(appointmentId: string) {
  const { data } = await adminClient()
    .from("appointment_events")
    .select("event_type, channel, actor_id, details")
    .eq("appointment_id", appointmentId)
    .order("id");
  return data ?? [];
}

describe("trilha do atendimento na mesma transação (M1)", () => {
  const book = async (date: string, time: string, extra: Record<string, unknown> = {}, db: DbClient = asDb(fixture.admin)) =>
    bookAppointment(
      db,
      fixture.clinicId,
      {
        patientId: await newPatient(),
        serviceId: fixture.ids.consulta,
        agendaId: fixture.ids.agendaDra,
        start: at(date, time),
        locationId: fixture.ids.office,
        channel: "admin",
        actorId: fixture.admin.id,
        ...extra,
      },
      NOW,
    ).then((r) => r.appointment);

  it("marcar grava um só 'created', com quem fez e o canal", async () => {
    const appointment = await book(MON1, "08:00");
    expect(await trail(appointment.id)).toEqual([{ event_type: "created", channel: "admin", actor_id: fixture.admin.id, details: {} }]);
  });

  it("o canal fino vem junto com a mudança (link de agendamento) e o contexto nunca fica gravado", async () => {
    const appointment = await book(MON1, "09:00", { channel: "whatsapp_bot", trailChannel: "booking_link", actorId: null }, clinicServiceClient(fixture.clinicId) as unknown as DbClient);
    expect(await trail(appointment.id)).toEqual([{ event_type: "created", channel: "booking_link", actor_id: null, details: {} }]);
    const { data } = await adminClient().from("appointments").select("trail_context").eq("clinic_id", fixture.clinicId).not("trail_context", "is", null);
    expect(data).toEqual([]);
  });

  it("remarcar grava de quando para quando; o lembrete reenviado depois não gera evento", async () => {
    const appointment = await book(MON1, "10:00");
    await rescheduleAppointment(asDb(fixture.admin), fixture.clinicId, appointment.id, { start: at(MON2, "10:30"), locationId: fixture.ids.office, channel: "admin", actorId: fixture.admin.id }, NOW);
    await adminClient().from("appointments").update({ reminder_sent_at: NOW.toISOString() }).eq("id", appointment.id);
    const events = await trail(appointment.id);
    expect(events.map((e) => e.event_type)).toEqual(["created", "rescheduled"]);
    expect(events[1]).toEqual({
      event_type: "rescheduled",
      channel: "admin",
      actor_id: fixture.admin.id,
      details: { from: at(MON1, "10:00").toISOString(), to: at(MON2, "10:30").toISOString() },
    });
  });

  it("cancelar em massa grava o canal do bloqueio, uma vez só", async () => {
    const appointment = await book(MON2, "08:00");
    const result = await cancelAppointments(asDb(fixture.admin), fixture.clinicId, [appointment.id], { channel: "admin", trailChannel: "schedule_block", actorId: fixture.admin.id }, NOW);
    expect(result.canceled).toHaveLength(1);
    expect(await cancelAppointment(asDb(fixture.admin), fixture.clinicId, appointment.id, { channel: "admin", actorId: fixture.admin.id }, NOW)).toBeNull();
    const events = await trail(appointment.id);
    expect(events.filter((e) => e.event_type === "canceled")).toEqual([{ event_type: "canceled", channel: "schedule_block", actor_id: fixture.admin.id, details: {} }]);
  });

  it("comparecimento: registrar o mesmo duas vezes conta uma; trocar vira correção", async () => {
    const appointment = await book(MON2, "09:00");
    await recordAttendance(asDb(fixture.reception), fixture.clinicId, appointment.id, "completed", fixture.reception.id);
    await recordAttendance(asDb(fixture.reception), fixture.clinicId, appointment.id, "completed", fixture.reception.id);
    await recordAttendance(asDb(fixture.admin), fixture.clinicId, appointment.id, "no_show", fixture.admin.id);
    const events = (await trail(appointment.id)).filter((e) => e.event_type.startsWith("attendance"));
    expect(events).toEqual([
      { event_type: "attendance_recorded", channel: "admin", actor_id: fixture.reception.id, details: { status: "completed" } },
      { event_type: "attendance_corrected", channel: "admin", actor_id: fixture.admin.id, details: { from: "completed", to: "no_show" } },
    ]);
  });

  it("mudança que o banco recusa não deixa evento", async () => {
    const first = await book(MON2, "11:00");
    const second = await book(MON2, "11:30");
    const { error } = await asDb(fixture.admin).from("appointments").update({ scheduled_at: first.scheduledAt.toISOString() }).eq("id", second.id);
    expect(error?.code).toBe("23P01");
    expect((await trail(second.id)).map((e) => e.event_type)).toEqual(["created"]);
  });

  it("turma: o contexto também chega pela função do banco", async () => {
    const { appointment } = await bookAppointment(
      asDb(fixture.admin),
      fixture.clinicId,
      {
        patientId: await newPatient(),
        serviceId: fixture.ids.turma,
        agendaId: fixture.ids.agendaExams,
        start: at(MON1, "10:00"),
        locationId: fixture.ids.office,
        channel: "admin",
        trailChannel: "booking_link",
        actorId: fixture.admin.id,
      },
      NOW,
    );
    expect(await trail(appointment.id)).toEqual([{ event_type: "created", channel: "booking_link", actor_id: fixture.admin.id, details: {} }]);
  });
});
