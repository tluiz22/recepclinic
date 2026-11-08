import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, getAppointment } from "../../src/lib/data/agenda/appointments";
import { migrateAgenda } from "../../src/lib/data/config/agendas";
import { addAvailabilityWindow } from "../../src/lib/data/config/availability";
import { adminClient } from "./helpers";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// Migrar de agenda (cliente, 02/nov/2026): horários e atendimentos futuros passam para a nova agenda.
let fixture: AgendaFixture;
beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste de migração", "859888800");
});
afterAll(async () => {
  await fixture.cleanup();
});

describe("migrar de agenda", () => {
  it("só o Administrador migra", async () => {
    const { ids, reception } = fixture;
    await expect(migrateAgenda(asDb(reception), ids.agendaDra, ids.agendaDra2, false)).rejects.toBeTruthy();
  });

  it("recusa quando a nova agenda é a da equipe e o serviço não é exame", async () => {
    const { ids, admin, clinicId } = fixture;
    await addAvailabilityWindow(asDb(admin), clinicId, { agendaId: ids.agendaDra, locationId: ids.office, serviceId: ids.retorno, weekday: 1, startTime: "13:00", endTime: "14:00", capacity: null });
    expect(await codeOf(() => migrateAgenda(asDb(admin), ids.agendaDra, ids.agendaExams, false))).toBe("invalid");
  });

  it("por serviço: só o escolhido migra; a prévia diz qual serviço recebe e qual será copiado (MS)", async () => {
    const { ids, admin } = fixture;
    const a = asDb(admin);
    const list = await migrateAgenda(a, ids.agendaDra, ids.agendaDra2, false, []);
    expect(list.appointments).toBe(0);
    // O Dr. Segundo não tem Retorno: a migração cria a cópia.
    expect(list.services.find((x) => x.id === ids.retorno)).toMatchObject({ target_attends: true, creates_copy: true, target_service: null, windows: 1 });
    expect((await migrateAgenda(a, ids.agendaDra, ids.agendaDra2, false, [ids.consulta])).windows).toBe(0);
    const { count } = await adminClient().from("availability_windows").select("id", { count: "exact", head: true }).eq("agenda_id", ids.agendaDra).eq("service_id", ids.retorno);
    expect(count).toBe(1);
  });

  it("migra horários e atendimentos para o serviço do novo profissional (ou a cópia), deixando o conflito", async () => {
    const { ids, admin, clinicId } = fixture;
    const a = asDb(admin);
    const book = (patient: string, service: string, agenda: string, time: string) =>
      bookAppointment(a, clinicId, { patientId: patient, serviceId: service, agendaId: agenda, start: at(MON1, time), channel: "admin", actorId: admin.id }, NOW);
    const moves = (await book(ids.p1, ids.consulta, ids.agendaDra, "08:30")).appointment;
    const clash = (await book(ids.p2, ids.consulta, ids.agendaDra, "08:00")).appointment;
    await book(ids.p3, ids.consulta2, ids.agendaDra2, "08:00");

    const preview = await migrateAgenda(a, ids.agendaDra, ids.agendaDra2, false);
    expect(preview).toMatchObject({ windows: 3, appointments: 1, applied: false });
    expect(preview.conflicts).toHaveLength(1);
    expect(preview.services.find((x) => x.id === ids.consulta)).toMatchObject({ target_service: "Consulta", creates_copy: false });

    const done = await migrateAgenda(a, ids.agendaDra, ids.agendaDra2, true);
    expect(done.applied).toBe(true);
    expect(await getAppointment(a, clinicId, moves.id)).toMatchObject({ agendaId: ids.agendaDra2, serviceId: ids.consulta2 });
    expect((await getAppointment(a, clinicId, clash.id)).agendaId).toBe(ids.agendaDra);
    const { count } = await adminClient().from("availability_windows").select("id", { count: "exact", head: true }).eq("agenda_id", ids.agendaDra);
    expect(count).toBe(0);
    // A cópia do Retorno é do Dr. Segundo e recebeu o horário.
    const { data: copies } = await adminClient().from("services").select("id, professional_id").eq("clinic_id", clinicId).eq("name", "Retorno").neq("id", ids.retorno);
    expect(copies).toHaveLength(1);
    const { count: copyWindows } = await adminClient().from("availability_windows").select("id", { count: "exact", head: true }).eq("agenda_id", ids.agendaDra2).eq("service_id", copies![0].id);
    expect(copyWindows).toBe(1);
    const { data } = await adminClient().from("appointment_events").select("details").eq("appointment_id", moves.id).eq("event_type", "changed");
    expect(JSON.stringify(data)).toContain("Dr. Segundo");
  });
});
