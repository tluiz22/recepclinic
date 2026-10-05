import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { listPatientAppointments } from "../../src/lib/data/agenda/view";
import { listContactsPage, listPatientsPage, setPatientActive } from "../../src/lib/data/patients";
import { asDb, at, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F4.7 — listas da tela de Pacientes (busca, desativados, contagem) e o
// histórico do paciente.

let fixture: AgendaFixture;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste de pacientes do painel", "849555200");
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("lista de pacientes", () => {
  it("busca pelo nome ou pelo telefone do contato; conta o total", async () => {
    const { clinicId, reception } = fixture;
    const all = await listPatientsPage(asDb(reception), clinicId);
    expect(all).toMatchObject({ total: 3, page: 1, pageCount: 1 });
    expect(all.items.map((p) => p.fullName)).toEqual(["Paciente Dois", "Paciente Três", "Paciente Um"]);
    expect(all.items[0].contact.fullName).toBe("Resp. Paciente Dois");

    expect((await listPatientsPage(asDb(reception), clinicId, { query: "três" })).items.map((p) => p.fullName)).toEqual(["Paciente Três"]);
    expect((await listPatientsPage(asDb(reception), clinicId, { query: "5520003" })).items.map((p) => p.fullName)).toEqual(["Paciente Três"]);
  });

  it("desativado só aparece em 'Mostrar desativados'", async () => {
    const { clinicId, admin, reception, ids } = fixture;
    await setPatientActive(asDb(admin), clinicId, ids.p2, false);
    expect((await listPatientsPage(asDb(reception), clinicId)).total).toBe(2);
    expect((await listPatientsPage(asDb(reception), clinicId, { includeInactive: true })).total).toBe(3);
    const contacts = await listContactsPage(asDb(reception), clinicId);
    expect(contacts.items.find((c) => c.fullName === "Resp. Paciente Dois")?.patientNames).toEqual([]);
    await setPatientActive(asDb(admin), clinicId, ids.p2, true);
  });
});

it("histórico do paciente: do mais recente ao mais antigo", async () => {
  const { clinicId, admin, ids } = fixture;
  const book = (time: string) =>
    bookAppointment(asDb(admin), clinicId, { patientId: ids.p1, serviceId: ids.exame, agendaId: ids.agendaExams, start: at(MON1, time), locationId: ids.office, channel: "admin", actorId: admin.id }, NOW);
  await book("08:00");
  const history = await listPatientAppointments(asDb(admin), clinicId, ids.p1);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ serviceName: "Exame", agendaName: "Exames", patientName: "Paciente Um" });
});
