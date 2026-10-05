import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, recordAttendance } from "../../src/lib/data/agenda/appointments";
import { buildDayItems, listAgendaAppointments, listNoShowStats } from "../../src/lib/data/agenda/view";
import { asDb, at, MON1, MON2, MON3, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { addMember, adminClient, createUser, deleteUsers, type TestUser } from "./helpers";

// F4.5 — leitura da Agenda: cada atendimento com paciente, contato, serviço,
// local e agenda; turma agrupada; acesso por agenda (D6); selo de faltas.

let fixture: AgendaFixture;
let doctor: TestUser;
const tz = "America/Fortaleza";

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da agenda do painel", "849666100");
  const { clinicId, ids, admin } = fixture;
  doctor = await createUser("ag-medica");
  await addMember(clinicId, doctor.id, ["professional"]);
  await adminClient().from("clinic_members").update({ agenda_scope: "restricted" }).eq("clinic_id", clinicId).eq("user_id", doctor.id);
  const { data: dra } = await adminClient().from("agendas").select("professional_id").eq("id", ids.agendaDra).single();
  await adminClient().from("professionals").update({ user_id: doctor.id }).eq("id", dra!.professional_id);

  const book = (patientId: string, serviceId: string, agendaId: string, date: string, time: string) =>
    bookAppointment(asDb(admin), clinicId, { patientId, serviceId, agendaId, start: at(date, time), locationId: ids.office, channel: "admin", actorId: admin.id }, NOW);
  await book(ids.p1, ids.consulta, ids.agendaDra, MON1, "08:00");
  await book(ids.p2, ids.consulta, ids.agendaDra2, MON1, "08:00");
  await book(ids.p1, ids.turma, ids.agendaExams, MON1, "10:00");
  await book(ids.p2, ids.turma, ids.agendaExams, MON1, "10:00");
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([doctor]);
});

describe("agenda do dia", () => {
  it("traz paciente, contato, serviço, local e agenda; a turma vira um item só", async () => {
    const { clinicId, ids, reception } = fixture;
    const all = await listAgendaAppointments(asDb(reception), clinicId, {
      fromDate: MON1,
      toDate: MON1,
      timeZone: tz,
      agendaIds: [ids.agendaDra, ids.agendaDra2, ids.agendaExams],
    });
    expect(all).toHaveLength(4);
    expect(all.find((a) => a.agendaId === ids.agendaDra)).toMatchObject({ patientName: "Paciente Um", contactName: "Resp. Paciente Um", serviceName: "Consulta", locationName: "Consultório", category: "consultation" });
    expect(all.map((a) => a.agendaName).sort()).toEqual(["Dr. Segundo", "Dra. Agenda", "Exames", "Exames"]);
    const items = buildDayItems(all, []);
    expect(items.map((i) => i.kind)).toEqual(["appointment", "appointment", "group"]);
  });

  it("o Profissional só vê a própria agenda, mesmo pedindo as outras", async () => {
    const { clinicId, ids } = fixture;
    const seen = await listAgendaAppointments(asDb(doctor), clinicId, {
      fromDate: MON1,
      toDate: MON1,
      timeZone: tz,
      agendaIds: [ids.agendaDra, ids.agendaDra2, ids.agendaExams],
    });
    expect(seen.map((a) => a.agendaId)).toEqual([ids.agendaDra]);
  });
});

it("selo de faltas: só com 2 ou mais faltas e em pelo menos metade dos registrados", async () => {
  const { clinicId, ids, admin } = fixture;
  const book = (date: string) =>
    bookAppointment(asDb(admin), clinicId, { patientId: ids.p3, serviceId: ids.consulta, agendaId: ids.agendaDra2, start: at(date, "08:00"), locationId: ids.office, channel: "admin", actorId: admin.id }, NOW);
  const first = await book(MON2);
  await recordAttendance(asDb(admin), clinicId, first.appointment.id, "no_show", admin.id);
  expect((await listNoShowStats(asDb(admin), clinicId, [ids.p3])).has(ids.p3)).toBe(false);
  const second = await book(MON3);
  await recordAttendance(asDb(admin), clinicId, second.appointment.id, "no_show", admin.id);
  expect((await listNoShowStats(asDb(admin), clinicId, [ids.p3])).get(ids.p3)).toEqual({ noShows: 2, total: 2 });
});
