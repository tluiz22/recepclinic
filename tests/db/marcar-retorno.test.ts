import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, cancelAppointment, recordAttendance } from "../../src/lib/data/agenda/appointments";
import { listReturnReady } from "../../src/lib/data/agenda/returnReady";
import { listAgendaAppointmentsByIds } from "../../src/lib/data/agenda/view";
import { registerPatient } from "../../src/lib/data/patients";
import { asDb, at, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// "Marcar retorno" no cartão da Consulta realizada (cliente, 19/out/2026): só
// na Consulta apta, pelas 7 regras do bot. Retorno da fixture: só na agenda da
// Dra. Agenda, prazo de 30 dias.

let fixture: AgendaFixture;
const tz = "America/Fortaleza";
const PHONE = "849666300";
const AFTER = at(MON1, "12:00");
const c = {} as Record<"p1" | "p2Dra2" | "p3Home" | "p4NoShow" | "p5Pending", string>;
let p4: string;
let p5: string;

const db = () => asDb(fixture.admin);
const book = (patientId: string, serviceId: string, agendaId: string, date: string, time: string, now: Date, home = false) =>
  bookAppointment(
    db(),
    fixture.clinicId,
    {
      patientId,
      serviceId,
      agendaId,
      start: at(date, time),
      locationId: home ? fixture.ids.home : fixture.ids.office,
      homeVisitAddress: home ? "Rua B, 2" : null,
      channel: "admin",
      actorId: fixture.admin.id,
    },
    now,
  ).then((r) => r.appointment.id);
const complete = (id: string) => recordAttendance(db(), fixture.clinicId, id, "completed", fixture.admin.id);
const cancel = (id: string, now: Date) => cancelAppointment(db(), fixture.clinicId, id, { channel: "admin", actorId: fixture.admin.id }, now);
const ready = async (ids: string[], now: Date) =>
  listReturnReady(asDb(fixture.reception), fixture.clinicId, await listAgendaAppointmentsByIds(asDb(fixture.reception), fixture.clinicId, ids), tz, now);

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do Marcar retorno", PHONE);
  const { ids, clinicId } = fixture;
  const patient = async (fullName: string, phone: string) => {
    const result = await registerPatient(db(), clinicId, { fullName, birthdate: "2020-01-01", contact: { mode: "new", fullName: `Resp. ${fullName}`, phone } }, "2031-03-09");
    if (result.status !== "created") throw new Error(result.status);
    return result.patient.id;
  };
  p4 = await patient("Paciente Quatro", `${PHONE}04`);
  p5 = await patient("Paciente Cinco", `${PHONE}05`);

  c.p1 = await book(ids.p1, ids.consulta, ids.agendaDra, MON1, "08:00", NOW);
  c.p2Dra2 = await book(ids.p2, ids.consulta, ids.agendaDra2, MON1, "08:00", NOW);
  c.p3Home = await book(ids.p3, ids.consulta, ids.agendaDra, MON1, "14:00", NOW, true);
  c.p4NoShow = await book(p4, ids.consulta, ids.agendaDra, MON1, "08:30", NOW);
  c.p5Pending = await book(p5, ids.consulta, ids.agendaDra, MON1, "09:00", NOW);
  await complete(c.p1);
  await complete(c.p2Dra2);
  await complete(c.p3Home);
  await recordAttendance(db(), clinicId, c.p4NoShow, "no_show", fixture.admin.id);
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("Marcar retorno: Consulta apta", () => {
  it("só a Consulta já começada (com ou sem Compareceu), sem falta, não domiciliar, numa agenda com Retorno", async () => {
    const result = await ready(Object.values(c), AFTER);
    expect([...result.keys()]).toEqual([c.p1, c.p5Pending]);
    expect(result.get(c.p1)).toEqual({ serviceId: fixture.ids.retorno });
  });

  it("a partir do horário de início da Consulta (cliente, 19/out/2026)", async () => {
    expect((await ready([c.p5Pending], at(MON1, "08:59"))).has(c.p5Pending)).toBe(false);
    expect((await ready([c.p5Pending], at(MON1, "09:00"))).has(c.p5Pending)).toBe(true);
  });

  it("dentro do prazo do Retorno (30 dias, inclusive)", async () => {
    expect((await ready([c.p1], at("2031-04-09", "18:00"))).has(c.p1)).toBe(true);
    expect((await ready([c.p1], at("2031-04-10", "08:00"))).has(c.p1)).toBe(false);
  });

  it("com Consulta futura na mesma agenda, não; cancelada, volta", async () => {
    const future = await book(fixture.ids.p1, fixture.ids.consulta, fixture.ids.agendaDra, MON2, "08:00", AFTER);
    expect((await ready([c.p1], AFTER)).has(c.p1)).toBe(false);
    await cancel(future, AFTER);
    expect((await ready([c.p1], AFTER)).has(c.p1)).toBe(true);
  });

  it("com Retorno ligado, não; Retorno cancelado não conta", async () => {
    const later = at(MON2, "12:00");
    const retorno = await book(fixture.ids.p1, fixture.ids.retorno, fixture.ids.agendaDra, MON2, "09:00", AFTER);
    expect((await ready([c.p1], AFTER)).has(c.p1)).toBe(false);
    expect((await ready([c.p1], later)).has(c.p1)).toBe(false);
    await cancel(retorno, AFTER);
    expect((await ready([c.p1], later)).has(c.p1)).toBe(true);
  });

  it("só a última Consulta do paciente na agenda", async () => {
    const later = at(MON2, "12:00");
    const second = await book(fixture.ids.p1, fixture.ids.consulta, fixture.ids.agendaDra, MON2, "10:00", AFTER);
    await complete(second);
    const result = await ready([c.p1, second], later);
    expect([...result.keys()]).toEqual([second]);
  });
});
