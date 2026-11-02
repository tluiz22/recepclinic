import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { listFreeGaps } from "../../src/lib/data/agenda/slots";
import { addAvailabilityWindow } from "../../src/lib/data/config/availability";
import { asDb, at, NOW, MON1, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// Linhas "Livre" da Agenda › Dia (cliente, 02/nov/2026): o passo é a duração do serviço de cada janela, e a agenda de
// exames também tem linhas.
let fixture: AgendaFixture;
beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste de horários livres", "859999900");
});
afterAll(async () => {
  await fixture.cleanup();
});

const WED = "2031-03-12";
const times = (gaps: { agendaId: string; time: string }[], agendaId: string) => gaps.filter((g) => g.agendaId === agendaId).map((g) => g.time).sort();

describe("horários livres por serviço", () => {
  it("a agenda de exames mostra as linhas, no passo do exame", async () => {
    const { ids, admin, clinicId } = fixture;
    const gaps = await listFreeGaps(asDb(admin), clinicId, { date: MON1, agendaIds: [ids.agendaExams], timeZone: "America/Fortaleza" }, NOW);
    expect(times(gaps, ids.agendaExams)).toEqual(["08:00", "08:20", "08:40", "10:00"]);
  });

  it("a sessão de turma sem ninguém marcado vira linha com as vagas; com gente, deixa de ser linha livre", async () => {
    const { ids, admin, clinicId } = fixture;
    const a = asDb(admin);
    const gaps = await listFreeGaps(a, clinicId, { date: MON1, agendaIds: [ids.agendaExams], timeZone: "America/Fortaleza" }, NOW);
    const turma = gaps.find((g) => g.time === "10:00");
    expect(turma?.group).toMatchObject({ serviceId: ids.turma, serviceName: "Turma", spots: 2 });
    await bookAppointment(a, clinicId, { patientId: ids.p1, serviceId: ids.turma, agendaId: ids.agendaExams, start: at(MON1, "10:00"), channel: "admin", actorId: admin.id }, NOW);
    const after = await listFreeGaps(a, clinicId, { date: MON1, agendaIds: [ids.agendaExams], timeZone: "America/Fortaleza" }, NOW);
    expect(times(after, ids.agendaExams)).toEqual(["08:00", "08:20", "08:40"]);
  });

  it("cada janela usa a duração do seu serviço", async () => {
    const { ids, admin, clinicId } = fixture;
    const a = asDb(admin);
    const win = (serviceId: string, startTime: string, endTime: string) =>
      addAvailabilityWindow(a, clinicId, { agendaId: ids.agendaDra, locationId: ids.office, serviceId, weekday: 3, startTime, endTime, capacity: null });
    await win(ids.retorno, "13:00", "13:40"); // Retorno: 20 min
    await win(ids.consulta, "13:40", "15:10"); // Consulta: 30 min
    const gaps = await listFreeGaps(a, clinicId, { date: WED, agendaIds: [ids.agendaDra], timeZone: "America/Fortaleza" }, NOW);
    expect(times(gaps, ids.agendaDra)).toEqual(["13:00", "13:20", "13:40", "14:10", "14:40"]);
  });
});
