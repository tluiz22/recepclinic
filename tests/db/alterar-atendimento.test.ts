import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bookAppointment,
  cancelAppointment,
  changeAppointment,
  getAppointment,
  setPresenceConfirmed,
  type Appointment,
  type ChangeInput,
} from "../../src/lib/data/agenda/appointments";
import { adminClient } from "./helpers";
import { asDb, at, codeOf, MON1, MON3, NOW, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";
import type { TestUser } from "./helpers";

// C4 Alterar atendimento (cliente, 28/out/2026): serviço, agenda, local,
// convênio, endereço, data e hora de um atendimento marcado.
let fixture: AgendaFixture;
let clinicId: string;
let reception: TestUser;
let ids: AgendaIds;
const db = asDb;

const book = async (patient: string, service: string, agenda: string, start: Date, extra: Record<string, unknown> = {}) =>
  (
    await bookAppointment(
      db(reception),
      clinicId,
      // A equipe marca em qualquer horário (C2): a grade do dia muda com os atendimentos de 20 min.
      { patientId: patient, serviceId: service, agendaId: agenda, start, channel: "admin", actorId: reception.id, anyTime: true, acceptedWarnings: true, ...extra },
      NOW,
    )
  ).appointment;

const change = (a: Appointment, input: Partial<ChangeInput>, now = NOW) =>
  changeAppointment(
    db(reception),
    clinicId,
    a.id,
    {
      serviceId: a.serviceId,
      agendaId: a.agendaId,
      locationId: a.locationId,
      start: a.scheduledAt,
      insurancePlanId: a.insurancePlanId,
      homeVisitAddress: a.homeVisitAddress,
      actorId: reception.id,
      changes: [{ label: "Teste", from: "a", to: "b" }],
      ...input,
    },
    now,
  );

let third: Appointment;

const trail = async (id: string) =>
  (await adminClient().from("appointment_events").select("event_type, details").eq("appointment_id", id).order("occurred_at")).data ?? [];

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste de alterar", "859888700");
  ({ clinicId, reception, ids } = fixture);
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("alterar atendimento", () => {
  it("troca o serviço no mesmo horário: duração e valor novos, presença mantida, trilha 'changed'", async () => {
    const a = await book(ids.p1, ids.consulta, ids.agendaDra, at(MON3, "09:00"), { locationId: ids.office });
    await setPresenceConfirmed(db(reception), clinicId, a.id, true, reception.id, NOW);
    const result = await change(a, { serviceId: ids.retorno, changes: [{ label: "Serviço", from: "Consulta · 30 min", to: "Retorno · 20 min" }] });
    expect(result.scheduleChanged).toBe(false);
    expect(result.appointment).toMatchObject({ serviceId: ids.retorno, durationMinutes: 20, priceCents: 0 });
    expect(result.appointment.patientConfirmedAt).not.toBeNull();
    const events = await trail(a.id);
    expect(events.map((e) => e.event_type)).toEqual(["created", "presence_confirmed", "changed"]);
    expect(events[2].details).toEqual({ changes: [{ label: "Serviço", from: "Consulta · 30 min", to: "Retorno · 20 min" }] });
  });

  it("troca agenda e horário: presença zerada, um evento só ('changed', não 'rescheduled')", async () => {
    const a = await book(ids.p2, ids.consulta, ids.agendaDra, at(MON3, "10:00"), { locationId: ids.office });
    await setPresenceConfirmed(db(reception), clinicId, a.id, true, reception.id, NOW);
    const result = await change(a, { agendaId: ids.agendaDra2, start: at(MON3, "08:00") });
    expect(result.scheduleChanged).toBe(true);
    expect(result.appointment).toMatchObject({ agendaId: ids.agendaDra2, patientConfirmedAt: null });
    expect(result.appointment.scheduledAt.toISOString()).toBe(at(MON3, "08:00").toISOString());
    expect((await trail(a.id)).map((e) => e.event_type)).toEqual(["created", "presence_confirmed", "changed"]);
  });

  it("horário ocupado na agenda nova é recusado; o próprio horário não conta", async () => {
    third = await book(ids.p3, ids.consulta, ids.agendaDra, at(MON3, "11:00"), { locationId: ids.office });
    expect(await codeOf(() => change(third, { agendaId: ids.agendaDra2, start: at(MON3, "08:00") }))).toBe("conflict");
    // Mesmo horário, só o convênio/endereço: passa (não se choca com ele mesmo).
    const same = await change(third, { start: at(MON3, "11:00") });
    expect(same.scheduleChanged).toBe(false);
    // Duplicidade: o Paciente Um já tem Retorno na Dra. Agenda.
    const other = await book(ids.p1, ids.consulta, ids.agendaDra2, at(MON3, "08:30"), { locationId: ids.office });
    expect(await codeOf(() => change(other, { agendaId: ids.agendaDra, start: at(MON3, "11:30") }))).toBe("duplicate");
    // Já em duplicidade (consulta e retorno na mesma agenda): corrigir sem trocar serviço nem agenda passa.
    const twin = await getAppointment(db(reception), clinicId, other.id);
    await adminClient().from("appointments").update({ agenda_id: ids.agendaDra, scheduled_at: at(MON3, "11:30").toISOString() }).eq("id", twin.id);
    const fixed = await change(await getAppointment(db(reception), clinicId, twin.id), { homeVisitAddress: null });
    expect(fixed.scheduleChanged).toBe(false);
    await cancelAppointment(db(reception), clinicId, twin.id, { channel: "admin", actorId: reception.id }, NOW);
  });

  it("local domiciliar exige o endereço e muda o valor", async () => {
    const a = await getAppointment(db(reception), clinicId, third.id);
    expect(await codeOf(() => change(a, { agendaId: ids.agendaDra, locationId: ids.home, start: at(MON3, "14:00") }))).toBe("invalid");
    const result = await change(a, { agendaId: ids.agendaDra, locationId: ids.home, start: at(MON3, "14:00"), homeVisitAddress: "Rua B, 2" });
    expect(result.appointment).toMatchObject({ locationId: ids.home, homeVisitAddress: "Rua B, 2", priceCents: 45000 });
  });

  it("turma: confere a vaga sem contar o próprio atendimento", async () => {
    await book(ids.p1, ids.turma, ids.agendaExams, at(MON3, "10:00"));
    const other = await book(ids.p2, ids.turma, ids.agendaExams, at(MON3, "10:00"));
    const a = await book(ids.p3, ids.consulta, ids.agendaDra2, at(MON1, "08:00"), { locationId: ids.office });
    const toGroup = { serviceId: ids.turma, agendaId: ids.agendaExams, locationId: ids.office, start: at(MON3, "10:00") };
    expect(await codeOf(() => change(a, toGroup))).toBe("conflict");
    await cancelAppointment(db(reception), clinicId, other.id, { channel: "admin", actorId: reception.id }, NOW);
    const result = await change(a, toGroup);
    expect(result.appointment).toMatchObject({ serviceId: ids.turma, isGroupSession: true, durationMinutes: 60, priceCents: 9000 });
    expect((await trail(a.id)).map((e) => e.event_type)).toEqual(["created", "changed"]);
  });

  it("atendimento que já passou ou cancelado não é alterado (por enquanto)", async () => {
    const a = await book(ids.p2, ids.consulta, ids.agendaDra, at(MON1, "08:00"), { locationId: ids.office });
    expect(await codeOf(() => change(a, { serviceId: ids.retorno }, at(MON1, "09:00")))).toBe("invalid");
    await cancelAppointment(db(reception), clinicId, a.id, { channel: "admin", actorId: reception.id }, NOW);
    expect(await codeOf(() => change(a, { serviceId: ids.retorno }))).toBe("invalid");
  });
});
