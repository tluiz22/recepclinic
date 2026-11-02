import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, getAppointment } from "../../src/lib/data/agenda/appointments";
import { migrateAgenda } from "../../src/lib/data/config/agendas";
import { addAvailabilityWindow } from "../../src/lib/data/config/availability";
import { setServiceAgendas } from "../../src/lib/data/config/services";
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

  it("recusa quando a nova agenda não atende um serviço da antiga", async () => {
    const { ids, admin, clinicId } = fixture;
    await addAvailabilityWindow(asDb(admin), clinicId, { agendaId: ids.agendaDra, locationId: ids.office, serviceId: ids.retorno, weekday: 1, startTime: "13:00", endTime: "14:00", capacity: null });
    expect(await codeOf(() => migrateAgenda(asDb(admin), ids.agendaDra, ids.agendaDra2, false))).toBe("invalid");
  });

  it("conta na prévia e migra horários e atendimentos, deixando o conflito", async () => {
    const { ids, admin, clinicId } = fixture;
    const a = asDb(admin);
    await setServiceAgendas(a, clinicId, ids.retorno, [ids.agendaDra, ids.agendaDra2]);
    const book = (patient: string, agenda: string, time: string) =>
      bookAppointment(a, clinicId, { patientId: patient, serviceId: ids.consulta, agendaId: agenda, start: at(MON1, time), channel: "admin", actorId: admin.id }, NOW);
    const moves = (await book(ids.p1, ids.agendaDra, "08:30")).appointment;
    const clash = (await book(ids.p2, ids.agendaDra, "08:00")).appointment;
    await book(ids.p3, ids.agendaDra2, "08:00");

    const preview = await migrateAgenda(a, ids.agendaDra, ids.agendaDra2, false);
    expect(preview).toMatchObject({ windows: 3, appointments: 1, applied: false });
    expect(preview.conflicts).toHaveLength(1);

    const done = await migrateAgenda(a, ids.agendaDra, ids.agendaDra2, true);
    expect(done.applied).toBe(true);
    expect((await getAppointment(a, clinicId, moves.id)).agendaId).toBe(ids.agendaDra2);
    expect((await getAppointment(a, clinicId, clash.id)).agendaId).toBe(ids.agendaDra);
    const { count } = await adminClient().from("availability_windows").select("id", { count: "exact", head: true }).eq("agenda_id", ids.agendaDra);
    expect(count).toBe(0);
    const { data } = await adminClient().from("appointment_events").select("details").eq("appointment_id", moves.id).eq("event_type", "changed");
    expect(JSON.stringify(data)).toContain("Dr. Segundo");
  });
});
