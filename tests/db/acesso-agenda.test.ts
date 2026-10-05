import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bookAppointment,
  cancelAppointment,
  cancelAppointments,
  findReturnOrigin,
  getAppointment,
  listUpcomingAppointments,
  recordAttendance,
  rescheduleAppointment,
  setPresenceConfirmed,
} from "../../src/lib/data/agenda/appointments";
import {
  getFreeSlots,
  getFreeSlotsAnyAgenda,
  getGroupSessions,
  getNextAvailableDates,
} from "../../src/lib/data/agenda/slots";
import { setMemberAgendaAccess } from "../../src/lib/data/config/agendas";
import { addClinicHoliday } from "../../src/lib/data/config/holidays";
import { adminClient } from "./helpers";
import { asDb, at, codeOf, MON1, MON2, MON3, MON4, NOW, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";
import type { TestUser } from "./helpers";

// F3.6a — horários livres e marcação, numa clínica criada para o teste
// (tests/db/agendaFixture.ts).
let fixture: AgendaFixture;
let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let ids: AgendaIds;
const db = asDb;

const book = (patient: string, service: string, agenda: string, start: Date, extra: Record<string, unknown> = {}, now = NOW) =>
  bookAppointment(db(reception), clinicId, { patientId: patient, serviceId: service, agendaId: agenda, start, channel: "admin", actorId: reception.id, ...extra }, now);

const times = (slots: { start: Date }[]) =>
  slots.map((slot) => slot.start.toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" }));

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste de agenda", "859888800");
  ({ clinicId, admin, reception, ids } = fixture);
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("horários livres", () => {
  it("consulta: janelas da agenda, na duração do serviço, no fuso da clínica", async () => {
    const slots = await getFreeSlots(db(reception), clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, date: MON1 }, NOW);
    expect(times(slots)).toEqual(["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30"]);
    expect(slots[0].start.toISOString()).toBe("2031-03-10T11:00:00.000Z");
    expect(new Set(slots.map((s) => s.locationId))).toEqual(new Set([ids.office, ids.home]));
  });

  it("filtra por local; serviço fora da agenda ou turma não tem horários individuais", async () => {
    expect(times(await getFreeSlots(db(reception), clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, date: MON1, locationId: ids.home }, NOW))).toEqual([
      "14:00",
      "14:30",
    ]);
    expect(await getFreeSlots(db(reception), clinicId, { serviceId: ids.exame, agendaId: ids.agendaDra, date: MON1 }, NOW)).toEqual([]);
    expect(await getFreeSlots(db(reception), clinicId, { serviceId: ids.turma, agendaId: ids.agendaExams, date: MON1 }, NOW)).toEqual([]);
  });

  it("feriado da clínica e bloqueio tiram horários", async () => {
    await addClinicHoliday(db(admin), clinicId, { date: MON4, description: "Recesso" });
    expect(await getFreeSlots(db(reception), clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, date: MON4 }, NOW)).toEqual([]);

    await adminClient().from("schedule_blocks").insert({
      clinic_id: clinicId,
      agenda_id: ids.agendaDra,
      starts_at: at(MON3, "08:00").toISOString(),
      ends_at: at(MON3, "11:00").toISOString(),
      reason: "Congresso",
    });
    expect(times(await getFreeSlots(db(reception), clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, date: MON3, locationId: ids.office }, NOW))).toEqual([
      "11:00",
      "11:30",
    ]);
  });

  it("próximas datas com vaga pulam o feriado", async () => {
    const dates = await getNextAvailableDates(db(reception), clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, count: 4 }, NOW);
    expect(dates.map((d) => d.date)).toEqual([MON1, MON2, MON3, "2031-04-07"]);
  });

  it("primeiro horário disponível entre as agendas do serviço (D2)", async () => {
    const slots = await getFreeSlotsAnyAgenda(db(reception), clinicId, { serviceId: ids.consulta, date: MON1, locationId: ids.office }, NOW);
    expect(times(slots).slice(0, 3)).toEqual(["08:00", "08:30", "09:00"]);
    // 08:00 existe nas duas agendas: aparece uma vez, na primeira em ordem de nome (Dr. Segundo).
    expect(slots[0].agendaId).toBe(ids.agendaDra2);
  });
});

describe("marcar", () => {
  it("marca no horário livre, com preço do local, e o horário sai da lista", async () => {
    const { appointment } = await book(ids.p1, ids.consulta, ids.agendaDra, at(MON1, "08:00"));
    expect(appointment).toMatchObject({ status: "scheduled", priceCents: 30000, locationId: ids.office, durationMinutes: 30, bookingChannel: "admin" });
    const slots = await getFreeSlots(db(reception), clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, date: MON1 }, NOW);
    expect(times(slots)[0]).toBe("08:30");

    const { data: trail } = await adminClient().from("appointment_events").select("event_type, channel, actor_id").eq("appointment_id", appointment.id);
    expect(trail).toEqual([{ event_type: "created", channel: "admin", actor_id: reception.id }]);
  });

  it("horário ocupado ou fora da janela é recusado", async () => {
    expect(await codeOf(() => book(ids.p2, ids.consulta, ids.agendaDra, at(MON1, "08:00")))).toBe("conflict");
    expect(await codeOf(() => book(ids.p2, ids.consulta, ids.agendaDra, at(MON1, "07:00")))).toBe("conflict");
    expect(await codeOf(() => book(ids.p2, ids.consulta, ids.agendaDra, at(MON1, "08:10")))).toBe("conflict");
  });

  it("duplicidade por agenda: consulta futura na mesma agenda trava; em outra agenda e exame, não", async () => {
    expect(await codeOf(() => book(ids.p1, ids.consulta, ids.agendaDra, at(MON2, "08:00")))).toBe("duplicate");
    expect(await codeOf(() => book(ids.p1, ids.retorno, ids.agendaDra, at(MON2, "09:00")))).toBe("duplicate");
    await book(ids.p1, ids.consulta, ids.agendaDra2, at(MON1, "08:00"));
    await book(ids.p1, ids.exame, ids.agendaExams, at(MON1, "08:00"));
    expect(await codeOf(() => book(ids.p1, ids.exame, ids.agendaExams, at(MON2, "08:00")))).toBe("duplicate");
  });

  it("domiciliar exige endereço e usa o preço do local", async () => {
    expect(await codeOf(() => book(ids.p2, ids.consulta, ids.agendaDra, at(MON1, "14:00")))).toBe("invalid");
    const { appointment } = await book(ids.p2, ids.consulta, ids.agendaDra, at(MON1, "14:00"), { homeVisitAddress: "Rua B, 2" });
    expect(appointment).toMatchObject({ locationId: ids.home, priceCents: 45000, homeVisitAddress: "Rua B, 2" });
  });

  it("turma: vagas contadas, lotada recusa e some da lista", async () => {
    const sessions = await getGroupSessions(db(reception), clinicId, { serviceId: ids.turma, agendaId: ids.agendaExams, count: 2 }, NOW);
    expect(sessions.map((s) => [s.date, s.time, s.remaining])).toEqual([
      [MON1, "10:00", 2],
      [MON2, "10:00", 2],
    ]);
    await book(ids.p2, ids.turma, ids.agendaExams, at(MON1, "10:00"));
    await book(ids.p3, ids.turma, ids.agendaExams, at(MON1, "10:00"));
    expect(await codeOf(() => book(ids.p1, ids.turma, ids.agendaExams, at(MON1, "10:00")))).toBe("conflict");
    const after = await getGroupSessions(db(reception), clinicId, { serviceId: ids.turma, agendaId: ids.agendaExams, count: 1 }, NOW);
    expect(after[0].date).toBe(MON2);
  });
});

describe("remarcar e cancelar", () => {
  it("remarca para outro horário (inclusive cruzando o próprio), zera a presença e vai para a trilha", async () => {
    const [p1Upcoming] = (await listUpcomingAppointments(db(reception), clinicId, [ids.p1], NOW)).get(ids.p1)!.filter((a) => a.agendaId === ids.agendaDra);
    await setPresenceConfirmed(db(reception), clinicId, p1Upcoming.id, true, reception.id, NOW);
    const moved = await rescheduleAppointment(db(reception), clinicId, p1Upcoming.id, { start: at(MON1, "08:30"), channel: "admin", actorId: reception.id }, NOW);
    expect(moved.scheduledAt.toISOString()).toBe(at(MON1, "08:30").toISOString());
    expect(moved.patientConfirmedAt).toBeNull();
    const { data: trail } = await adminClient()
      .from("appointment_events")
      .select("event_type, details")
      .eq("appointment_id", p1Upcoming.id)
      .order("occurred_at");
    expect(trail?.map((e) => e.event_type)).toEqual(["created", "presence_confirmed", "rescheduled"]);
    expect(await codeOf(() => rescheduleAppointment(db(reception), clinicId, p1Upcoming.id, { start: at(MON1, "14:00"), channel: "admin", actorId: null }, NOW))).toBe(
      "conflict",
    );
  });

  it("cancelar é atômico e libera o horário", async () => {
    const { appointment } = await book(ids.p3, ids.consulta, ids.agendaDra, at(MON2, "10:00"));
    const first = await cancelAppointment(db(reception), clinicId, appointment.id, { channel: "admin", actorId: reception.id }, NOW);
    expect(first?.status).toBe("canceled");
    expect(await cancelAppointment(db(reception), clinicId, appointment.id, { channel: "whatsapp_bot", actorId: null }, NOW)).toBeNull();
    const slots = await getFreeSlots(db(reception), clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, date: MON2, locationId: ids.office }, NOW);
    expect(times(slots)).toContain("10:00");
  });

  it("cancelar vários (dia inteiro) marca como cancelamento da clínica", async () => {
    const a1 = (await book(ids.p3, ids.consulta, ids.agendaDra2, at(MON2, "08:00"))).appointment;
    const result = await cancelAppointments(db(reception), clinicId, [a1.id, a1.id], { channel: "admin", trailChannel: "mass_cancel", actorId: reception.id }, NOW);
    expect(result.canceled.map((a) => a.id)).toEqual([a1.id]);
    expect(result.skipped).toBe(1);
    const { data } = await adminClient().from("appointments").select("mass_canceled").eq("id", a1.id).single();
    expect(data?.mass_canceled).toBe(true);
  });
});

describe("retorno (mesma agenda, prazo do serviço)", () => {
  it("liga à última consulta da mesma agenda e avisa quando já foi usada", async () => {
    // p2 teve consulta domiciliar em MON1 (14:00). Uma semana depois, faz o retorno.
    const later = at(MON2, "07:00");
    const origin = await findReturnOrigin(db(reception), clinicId, { patientId: ids.p2, agendaId: ids.agendaDra, returnServiceId: ids.retorno }, later);
    expect(origin).toMatchObject({ date: MON1, lastDate: "2031-04-09", isHomeVisit: true, alreadyUsed: false });

    const { appointment, returnWarnings } = await book(ids.p2, ids.retorno, ids.agendaDra, at(MON2, "09:00"), {}, later);
    expect(appointment.originAppointmentId).toBe(origin!.id);
    expect(appointment.priceCents).toBe(0);
    expect(returnWarnings).toEqual(["A consulta de origem (10/03/2031) foi domiciliar: consulta domiciliar não dá direito a retorno."]);

    const again = await findReturnOrigin(db(reception), clinicId, { patientId: ids.p2, agendaId: ids.agendaDra, returnServiceId: ids.retorno }, later);
    expect(again?.alreadyUsed).toBe(true);
  });

  it("consulta em outra agenda não é origem", async () => {
    // p2 só tem consulta com a Dra. Agenda: para o Dr. Segundo, não há origem.
    const later = at(MON2, "07:00");
    expect(await findReturnOrigin(db(reception), clinicId, { patientId: ids.p2, agendaId: ids.agendaDra2, returnServiceId: ids.retorno }, later)).toBeNull();
    expect(
      (await findReturnOrigin(db(reception), clinicId, { patientId: ids.p2, agendaId: ids.agendaDra, returnServiceId: ids.retorno }, later))?.date,
    ).toBe(MON1);
  });
});

describe("presença e comparecimento", () => {
  it("realizado, correção para falta e trilha; cancelado não recebe", async () => {
    const { appointment } = await book(ids.p3, ids.exame, ids.agendaExams, at(MON1, "08:20"));
    await recordAttendance(db(reception), clinicId, appointment.id, "completed", reception.id);
    await recordAttendance(db(reception), clinicId, appointment.id, "no_show", reception.id);
    const { data: trail } = await adminClient().from("appointment_events").select("event_type, details").eq("appointment_id", appointment.id).order("occurred_at");
    expect(trail).toEqual([
      { event_type: "created", details: {} },
      { event_type: "attendance_recorded", details: { status: "completed" } },
      { event_type: "attendance_corrected", details: { from: "completed", to: "no_show" } },
    ]);
    const canceled = (await book(ids.p2, ids.exame, ids.agendaExams, at(MON1, "08:40"))).appointment;
    await cancelAppointment(db(reception), clinicId, canceled.id, { channel: "admin", actorId: null }, NOW);
    expect(await codeOf(() => recordAttendance(db(reception), clinicId, canceled.id, "completed", null))).toBe("invalid");
    expect((await getAppointment(db(reception), clinicId, canceled.id)).status).toBe("canceled");
  });
});

describe("acesso às agendas (D6)", () => {
  it("recepção restrita não vê nem marca na agenda que não tem", async () => {
    await setMemberAgendaAccess(db(admin), clinicId, reception.id, "restricted", [ids.agendaExams]);
    try {
      expect(await getFreeSlots(db(reception), clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, date: MON2 }, NOW)).toEqual([]);
      expect(await codeOf(() => book(ids.p3, ids.consulta, ids.agendaDra, at(MON2, "11:00")))).toBe("invalid");
    } finally {
      await setMemberAgendaAccess(db(admin), clinicId, reception.id, "all", []);
    }
  });
});
