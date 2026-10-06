import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, recordAttendance } from "../../src/lib/data/agenda/appointments";
import { listFrequentNoShows, listMetricsRows, overview, ownAgendaIds } from "../../src/lib/data/metrics";
import { asDb, at, MON1, MON2, MON3, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { addMember, adminClient, createUser, deleteUsers, type TestUser } from "./helpers";

// F4.9 — Métricas: leitura do período por agenda e por paciente, faltosos e
// as agendas do próprio Profissional (Métricas pessoais, D11).

let fixture: AgendaFixture;
let doctor: TestUser;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste das métricas", "849333400");
  const { clinicId, ids, admin } = fixture;
  doctor = await createUser("mt-medica");
  await addMember(clinicId, doctor.id, ["professional"]);
  const { data: agenda } = await adminClient().from("agendas").select("professional_id").eq("id", ids.agendaDra2).single();
  await adminClient().from("professionals").update({ user_id: doctor.id }).eq("id", agenda!.professional_id);
  const book = async (patientId: string, date: string, status?: "completed" | "no_show") => {
    const { appointment } = await bookAppointment(
      asDb(admin),
      clinicId,
      { patientId, serviceId: ids.consulta, agendaId: ids.agendaDra, start: at(date, "08:00"), locationId: ids.office, channel: "admin", actorId: admin.id },
      NOW,
    );
    if (status) await recordAttendance(asDb(admin), clinicId, appointment.id, status, admin.id);
  };
  await book(ids.p1, MON1, "no_show");
  await book(ids.p1, MON2, "no_show");
  await book(ids.p2, MON3, "completed");
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([doctor]);
});

describe("métricas", () => {
  const period = { start: at(MON1, "00:00"), end: at("2031-04-01", "00:00") };

  it("lê o período nas agendas escolhidas, com o valor gravado na marcação", async () => {
    const { clinicId, ids, admin } = fixture;
    const rows = await listMetricsRows(asDb(admin), clinicId, { ...period, agendaIds: [ids.agendaDra] });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ serviceName: "Consulta", locationName: "Consultório", priceCents: 30000, bookingChannel: "admin" });
    expect(overview(rows, at("2031-04-01", "00:00"))).toMatchObject({ total: 3, completed: 1, noShow: 2, noShowRate: 2 / 3 });
    expect(await listMetricsRows(asDb(admin), clinicId, { ...period, agendaIds: [ids.agendaDra2] })).toEqual([]);
    expect(await listMetricsRows(asDb(admin), clinicId, { ...period, agendaIds: [ids.agendaDra], patientIds: [ids.p2] })).toHaveLength(1);
  });

  it("faltosos: só quem passa na regra", async () => {
    const { clinicId, ids, admin } = fixture;
    const frequent = await listFrequentNoShows(asDb(admin), clinicId, [ids.agendaDra]);
    expect(frequent.map((f) => [f.patientName, f.noShows, f.total])).toEqual([["Paciente Um", 2, 2]]);
  });

  it("métricas pessoais: as agendas do cadastro de profissional ligado ao login", async () => {
    const { clinicId, ids } = fixture;
    expect(await ownAgendaIds(asDb(doctor), clinicId, doctor.id)).toEqual([ids.agendaDra2]);
  });
});
