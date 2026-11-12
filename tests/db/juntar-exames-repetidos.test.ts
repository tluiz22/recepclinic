import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { addAvailabilityWindow } from "../../src/lib/data/config/availability";
import { createService, setServiceLocations } from "../../src/lib/data/config/services";
import { adminClient, withDatabase } from "./helpers";
import { asDb, at, MON1, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// Migração 20270110120000 (cliente, 10/nov): os exames da Equipe com o mesmo nome e modo viram um só. Fica o ativo; os
// atendimentos e os horários só do outro passam para ele (vindos de um desativado, desativados); o outro é apagado.

const MIGRATION = readFileSync(new URL("../../supabase/migrations/20270110120000_juntar_exames_repetidos.sql", import.meta.url), "utf8");
let f: AgendaFixture;
let copy: string;
let groupCopy: string;
let appointmentId: string;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Exames repetidos", "+55849912392");
  const a = asDb(f.admin);
  const exam = { durationMinutes: 20, priceCents: 15000, returnDeadlineDays: null, preparationInstructions: null, category: "exam" as const };
  // A cópia, como a das duas migrações de 08/nov: mesmo nome (com outra caixa e espaços), na Equipe.
  copy = (await createService(a, f.clinicId, { ...exam, name: " EXAME ", schedulingMode: "individual" }, { team: true })).id;
  await setServiceLocations(a, f.clinicId, copy, [{ locationId: f.ids.office, priceCents: null }]);
  // Mesmo nome, mas turma: não é repetido.
  groupCopy = (await createService(a, f.clinicId, { ...exam, name: "Exame", schedulingMode: "group" }, { team: true })).id;
  // Um horário igual ao do exame que fica (08:00–09:00) e um só da cópia (09:00–10:00).
  const window = (startTime: string, endTime: string) =>
    addAvailabilityWindow(a, f.clinicId, { agendaId: f.ids.agendaExams, locationId: f.ids.office, serviceId: copy, weekday: 1, startTime, endTime, capacity: null });
  await window("08:00", "09:00");
  await window("09:00", "10:00");
  appointmentId = (
    await bookAppointment(asDb(f.reception), f.clinicId, {
      patientId: f.ids.p1,
      serviceId: copy,
      agendaId: f.ids.agendaExams,
      start: at(MON1, "09:00"),
      locationId: f.ids.office,
      channel: "admin",
      actorId: f.reception.id,
      anyTime: true,
      acceptedWarnings: true,
    })
  ).appointment.id;
  // A cópia desativada (como no staging); os horários só dela saem junto.
  await adminClient().from("services").update({ is_active: false }).eq("id", copy);
  await withDatabase((db) => db.query(MIGRATION));
});

afterAll(async () => f.cleanup());

describe("juntar os exames repetidos da Equipe", () => {
  it("fica o ativo; a cópia some e o atendimento dela passa para ele", async () => {
    const { data: services } = await adminClient().from("services").select("id").in("id", [f.ids.exame, copy, groupCopy]);
    expect(services!.map((s) => s.id).sort()).toEqual([f.ids.exame, groupCopy].sort());
    const { data: appointment } = await adminClient().from("appointments").select("service_id").eq("id", appointmentId).single();
    expect(appointment!.service_id).toBe(f.ids.exame);
  });

  it("horários: o igual sai; o só da cópia passa desativado (não abre vaga nova)", async () => {
    const { data: windows } = await adminClient().from("availability_windows").select("start_time, end_time, is_active").eq("service_id", f.ids.exame).order("start_time");
    expect(windows).toEqual([
      { start_time: "08:00:00", end_time: "09:00:00", is_active: true },
      { start_time: "09:00:00", end_time: "10:00:00", is_active: false },
    ]);
  });

  it("rodar de novo não muda nada", async () => {
    await withDatabase((db) => db.query(MIGRATION));
    const { count } = await adminClient().from("services").select("id", { count: "exact", head: true }).eq("clinic_id", f.clinicId).eq("category", "exam");
    expect(count).toBe(3); // Exame, Turma e a turma "Exame"
  });
});
