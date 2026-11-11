import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { getGroupSessions } from "../../src/lib/data/agenda/slots";
import { addAvailabilityWindow } from "../../src/lib/data/config/availability";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// Turmas na faixa (cliente, 11/nov/2026): a faixa de um exame em turma abre uma turma a cada duração do exame
// (13:00–16:00 com 60 min: 13:00, 14:00 e 15:00); o banco (book_group_session) confere igual.

let f: AgendaFixture;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica do teste das turmas na faixa", "849555400");
  await addAvailabilityWindow(asDb(f.admin), f.clinicId, {
    agendaId: f.ids.agendaExams,
    locationId: f.ids.office,
    serviceId: f.ids.turma,
    weekday: 1,
    startTime: "13:00",
    endTime: "16:00",
    capacity: 2,
  });
});

afterAll(async () => {
  await f.cleanup();
});

describe("turmas na faixa", () => {
  it("uma turma a cada 60 min da faixa, além da faixa de uma turma só (10:00–11:00)", async () => {
    const sessions = await getGroupSessions(asDb(f.reception), f.clinicId, { serviceId: f.ids.turma, agendaId: f.ids.agendaExams, count: 4 }, NOW);
    expect(sessions.map((s) => `${s.date} ${s.time}`)).toEqual([`${MON1} 10:00`, `${MON1} 13:00`, `${MON1} 14:00`, `${MON1} 15:00`]);
  });

  it("marca na turma do meio da faixa; fora do passo, recusa", async () => {
    const book = (time: string, patientId = f.ids.p1) =>
      bookAppointment(
        asDb(f.reception),
        f.clinicId,
        { patientId, serviceId: f.ids.turma, agendaId: f.ids.agendaExams, start: at(MON1, time), channel: "admin", actorId: null },
        NOW,
      );
    const { appointment } = await book("14:00");
    expect(appointment.scheduledAt.getTime()).toBe(at(MON1, "14:00").getTime());
    expect(await codeOf(() => book("14:30", f.ids.p3))).toBe("conflict");

    const rpc = await f.reception.client.rpc("book_group_session", {
      p_service_id: f.ids.turma,
      p_agenda_id: f.ids.agendaExams,
      p_location_id: f.ids.office,
      p_patient_id: f.ids.p2,
      p_scheduled_at: at(MON1, "15:30").toISOString(),
      p_booking_channel: "admin",
    });
    expect(rpc.error?.message).toBe("no_window");
    const ok = await f.reception.client.rpc("book_group_session", {
      p_service_id: f.ids.turma,
      p_agenda_id: f.ids.agendaExams,
      p_location_id: f.ids.office,
      p_patient_id: f.ids.p2,
      p_scheduled_at: at(MON1, "15:00").toISOString(),
      p_booking_channel: "admin",
    });
    expect(ok.error).toBeNull();
  });
});
