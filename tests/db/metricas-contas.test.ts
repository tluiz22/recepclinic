import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, cancelAppointment, recordAttendance, rescheduleAppointment } from "../../src/lib/data/agenda/appointments";
import { buildFunnelReportFromSessions, listFunnelSessions } from "../../src/lib/data/botFunnel";
import type { DbClient } from "../../src/lib/data/clients";
import { registerPatient } from "../../src/lib/data/patients";
import {
  listActivity,
  listAttendance,
  listReminderOutcomes,
  listReturnOpportunities,
  listReturnRights,
  loadPerformance,
  summarizePerformance,
} from "../../src/lib/data/performance";
import { asDb, at, MON1, MON2, MON3, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";

// M2 do redesign das Métricas (22/out/2026): as contas no banco, conferidas
// contra um cenário com o resultado conhecido de antemão. Também o RLS
// (Profissional só na própria agenda; outra clínica não vê nada).
//
// Cenário (Consulta na agenda da Dra., salvo dito; um paciente por atendimento):
//   A1 seg1 08:00 compareceu · lembrete confirmado · retorno marcado (seg2 08:00)
//   A2 seg1 08:30 faltou · dois lembretes, o toque foi antes do segundo
//   A3 seg1 09:00 cancelado pela clínica · tocou em "cancelar" no lembrete
//   A4 seg1 09:30 sem registro · lembrete não entregue
//   A5 seg1 10:00 pelo WhatsApp, compareceu · lembrete sem toque
//   A6 seg1 10:30 remarcado para seg3 08:00 pela equipe
//   A7 seg1 08:00 na agenda do Dr. Segundo, compareceu · sem lembrete

let fixture: AgendaFixture;
let doctor: TestUser;
let outsider: TestUser;
let otherClinic: string;
const ids: Record<string, string> = {};
const patients: Record<string, string> = {};

let phone = 10;
async function newPatient(label: string): Promise<string> {
  phone += 1;
  const result = await registerPatient(
    asDb(fixture.admin),
    fixture.clinicId,
    { fullName: `Paciente ${label}`, birthdate: "1990-01-01", contact: { mode: "new", fullName: `Resp. ${label}`, phone: `849333600${phone}` } },
    "2031-03-09",
  );
  if (result.status !== "created") throw new Error(result.status);
  return result.patient.id;
}

async function message(appointmentId: string, direction: "outbound" | "inbound", type: string, at: Date, status: string | null = null) {
  const { error } = await adminClient().from("whatsapp_messages").insert({
    clinic_id: fixture.clinicId,
    appointment_id: appointmentId,
    direction,
    message_type: type,
    status,
    created_at: at.toISOString(),
  });
  if (error) throw error;
}

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste das contas", "849333600");
  const { clinicId, ids: f, admin } = fixture;
  const db = asDb(admin);

  doctor = await createUser("mc-medico");
  await addMember(clinicId, doctor.id, ["professional"]);
  const { data: agenda } = await adminClient().from("agendas").select("professional_id").eq("id", f.agendaDra2).single();
  await adminClient().from("professionals").update({ user_id: doctor.id }).eq("id", agenda!.professional_id);

  otherClinic = await createClinic("Outra clínica (contas)");
  outsider = await createUser("mc-outra");
  await addMember(otherClinic, outsider.id, ["admin"]);

  const book = async (key: string, time: string, extra: Record<string, unknown> = {}) => {
    patients[key] = await newPatient(key);
    const { appointment } = await bookAppointment(
      db,
      clinicId,
      { patientId: patients[key], serviceId: f.consulta, agendaId: f.agendaDra, start: at(MON1, time), locationId: f.office, channel: "admin", actorId: admin.id, ...extra },
      NOW,
    );
    ids[key] = appointment.id;
  };
  await book("A1", "08:00");
  await book("A2", "08:30");
  await book("A3", "09:00");
  await book("A4", "09:30");
  await book("A5", "10:00", { channel: "whatsapp_bot", actorId: null });
  await book("A6", "10:30");
  await book("A7", "08:00", { agendaId: f.agendaDra2 });

  await recordAttendance(db, clinicId, ids.A1, "completed", admin.id);
  await recordAttendance(db, clinicId, ids.A2, "no_show", admin.id);
  // Cancelado agora (a contagem dos cancelamentos é pela data do cancelamento).
  await cancelAppointment(db, clinicId, ids.A3, { channel: "admin", actorId: admin.id }, new Date());
  await recordAttendance(db, clinicId, ids.A5, "completed", admin.id);
  await rescheduleAppointment(db, clinicId, ids.A6, { start: at(MON3, "08:00"), locationId: f.office, channel: "admin", actorId: admin.id }, NOW);
  await recordAttendance(db, clinicId, ids.A7, "completed", admin.id);

  // Retorno da A1, ligado a ela.
  const { appointment: ret } = await bookAppointment(
    db,
    clinicId,
    { patientId: patients.A1, serviceId: f.retorno, agendaId: f.agendaDra, start: at(MON2, "08:00"), locationId: f.office, originAppointmentId: ids.A1, channel: "admin", actorId: admin.id },
    at(MON1, "12:00"),
  );
  ids.R1 = ret.id;

  // Lembretes (véspera, 10h).
  const eve = at("2031-03-09", "10:00");
  const later = at("2031-03-09", "15:00");
  await message(ids.A1, "outbound", "appointment_reminder", eve, "read");
  await message(ids.A1, "inbound", "reminder_confirm", at("2031-03-09", "11:00"));
  await message(ids.A2, "outbound", "appointment_reminder", eve, "delivered");
  await message(ids.A2, "inbound", "reminder_confirm", at("2031-03-09", "11:00"));
  await message(ids.A2, "outbound", "appointment_reminder", later, "delivered");
  await message(ids.A3, "outbound", "appointment_reminder", eve, "read");
  await message(ids.A3, "inbound", "reminder_cancel", at("2031-03-09", "12:00"));
  await message(ids.A4, "outbound", "appointment_reminder", eve, "failed");
  await message(ids.A5, "outbound", "appointment_reminder", eve, "delivered");
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteClinics([otherClinic]);
  await deleteUsers([doctor, outsider]);
});

const both = () => [fixture.ids.agendaDra, fixture.ids.agendaDra2];
const monday1 = () => ({ start: at(MON1, "00:00"), end: at(MON2, "00:00") });

describe("contas do Desempenho no banco (M2)", () => {
  it("agendamentos criados: cada marcação uma vez, remarcar não soma, cancelados à parte", async () => {
    const now = new Date();
    const scope = { start: new Date(now.getTime() - 3_600_000), end: new Date(now.getTime() + 3_600_000), agendaIds: both() };
    const summary = summarizePerformance({ activity: await listActivity(asDb(fixture.admin), fixture.clinicId, scope), attendance: [], reminders: [], returnRights: [] });
    expect(summary.created).toEqual({ total: 8, panel: 7, whatsapp: 1, canceledLater: 1 });
    expect(summary.rescheduled).toEqual({ total: 1, patient: 0, team: 1, waitlist: 0 });
    expect(summary.canceled).toMatchObject({ total: 1, patient: 0, clinic: 1, mass: 0 });
    expect(summary.returns).toMatchObject({ booked: 1, panel: 1, whatsapp: 0 });
  });

  it("filtro de serviço: só o Retorno", async () => {
    const now = new Date();
    const scope = { start: new Date(now.getTime() - 3_600_000), end: new Date(now.getTime() + 3_600_000), agendaIds: both(), serviceIds: [fixture.ids.retorno] };
    const activity = await listActivity(asDb(fixture.admin), fixture.clinicId, scope);
    expect(activity.reduce((t, r) => t + r.createdPanel + r.createdWhatsapp, 0)).toBe(1);
  });

  it("comparecimento: só compareceu e faltou; cancelado fora; sem registro à parte", async () => {
    const rows = await listAttendance(asDb(fixture.admin), fixture.clinicId, { ...monday1(), agendaIds: both() }, at(MON2, "12:00"));
    const s = summarizePerformance({ activity: [], attendance: rows, reminders: [], returnRights: [] });
    expect(s.attendance).toMatchObject({ completed: 3, noShow: 1, unregistered: 1, upcoming: 0 });
    expect(s.attendance.showRate).toMatchObject({ n: 3, base: 4, enough: false });
    expect(s.attendance.partial).toBe(true);
    expect(s.canceled.ofScheduled).toMatchObject({ n: 1, base: 6 });
  });

  it("lembretes: um desfecho por atendimento, o toque antes da última tentativa não vale, sem resposta só depois do horário", async () => {
    const rows = await listReminderOutcomes(asDb(fixture.admin), fixture.clinicId, { ...monday1(), agendaIds: both() }, at(MON1, "09:15"));
    const byId = Object.fromEntries(rows.map((r) => [`${r.outcome}:${r.status}`, r.total]));
    expect(byId).toEqual({
      "confirmed:completed": 1,
      "no_answer:no_show": 1,
      "cancel:canceled": 1,
      "not_delivered:scheduled": 1,
      "waiting:completed": 1,
      "none:completed": 1,
    });
    const s = summarizePerformance({ activity: [], attendance: [], reminders: rows, returnRights: [] });
    expect(s.reminders).toMatchObject({ confirmed: 1, cancel: 1, noAnswer: 1, notDelivered: 1, waiting: 1, sent: 5 });
    expect(s.reminders.confirmedRate).toMatchObject({ n: 1, base: 3 });
    expect(s.noShowByReminder.map((g) => [g.key, g.noShow.n, g.noShow.base])).toEqual([
      ["confirmed", 0, 1],
      ["no_answer", 1, 1],
      ["none", 0, 1],
    ]);
  });

  it("retornos: prazo que terminou no período, com e sem retorno; oportunidade agora", async () => {
    const april = { start: at("2031-04-01", "00:00"), end: at("2031-05-01", "00:00"), agendaIds: both() };
    const due = (await listReturnRights(asDb(fixture.admin), fixture.clinicId, april, at("2031-04-20", "12:00"))).filter((r) => r.status === "due");
    expect(due.map((r) => [r.appointmentId, r.lastDate, r.hasReturn]).sort()).toEqual(
      [
        [ids.A1, "2031-04-09", true],
        [ids.A5, "2031-04-09", false],
      ].sort(),
    );
    const open = await listReturnOpportunities(asDb(fixture.admin), fixture.clinicId, { agendaIds: both() }, at(MON2, "12:00"));
    expect(open.map((r) => r.appointmentId)).toEqual([ids.A5]);
  });

  it("Profissional: só a própria agenda, mesmo pedindo as outras", async () => {
    const rows = await listAttendance(asDb(doctor), fixture.clinicId, { ...monday1(), agendaIds: both() }, at(MON2, "12:00"));
    expect(rows.reduce((t, r) => t + r.completed + r.noShow, 0)).toBe(1);
  });

  it("outra clínica não vê nada", async () => {
    const data = await loadPerformance(asDb(outsider), fixture.clinicId, { ...monday1(), agendaIds: both() }, at(MON2, "12:00"));
    expect(data).toEqual({ activity: [], attendance: [], reminders: [], returnRights: [] });
  });
});

describe("Agendamento digital no banco (M2)", () => {
  it("tentativa resumida, com o atendimento pela coluna e a situação dele", async () => {
    const session = crypto.randomUUID();
    const base = { clinic_id: fixture.clinicId, session_id: session, flow: "booking", contact_phone: "+5584933360011", source: "bot", metadata: {}, appointment_id: null as string | null };
    const t0 = new Date();
    const { error } = await adminClient()
      .from("bot_funnel_events")
      .insert([
        { ...base, step: "started", occurred_at: t0.toISOString() },
        { ...base, step: "link_sent", metadata: { service_id: fixture.ids.consulta }, occurred_at: new Date(t0.getTime() + 60_000).toISOString() },
        { ...base, step: "confirm_failed", source: "web", metadata: { reason: "slot_taken" }, occurred_at: new Date(t0.getTime() + 120_000).toISOString() },
        { ...base, step: "confirm_failed", source: "web", metadata: { reason: "duplicate" }, occurred_at: new Date(t0.getTime() + 180_000).toISOString() },
        { ...base, step: "confirmed", source: "web", metadata: { appointment_id: ids.A5 }, appointment_id: ids.A5, occurred_at: new Date(t0.getTime() + 240_000).toISOString() },
      ]);
    expect(error).toBeNull();
    const sessions = await listFunnelSessions(asDb(fixture.admin), fixture.clinicId, new Date(t0.getTime() - 60_000), new Date(t0.getTime() + 3_600_000));
    const s = sessions.find((x) => x.sessionId === session)!;
    expect(s).toMatchObject({ flow: "booking", inPeriod: true, appointmentId: ids.A5, appointmentStatus: "completed" });
    // Primeiro de cada passo + a última falha no fim.
    expect(s.events.map((e) => e.step)).toEqual(["started", "link_sent", "confirm_failed", "confirmed", "confirm_failed"]);
    expect(s.events.at(-1)!.metadata).toEqual({ reason: "duplicate" });
    const report = buildFunnelReportFromSessions(sessions, new Date(t0.getTime() + 3_600_000));
    expect(report.flows.find((f) => f.id === "booking")!.outcomes.concluded).toBe(1);
    expect(await listFunnelSessions(asDb(outsider), fixture.clinicId, new Date(t0.getTime() - 60_000), new Date(t0.getTime() + 3_600_000))).toEqual([]);
  });

  it("falhas ao gravar o funil: só a contagem, e só para quem é da clínica", async () => {
    const now = new Date();
    await adminClient().from("system_errors").insert({ clinic_id: fixture.clinicId, scope: "funil: erro ao gravar evento", ids: {}, message: "teste" });
    const range = { p_clinic_id: fixture.clinicId, p_start: new Date(now.getTime() - 60_000).toISOString(), p_end: new Date(now.getTime() + 60_000).toISOString() };
    expect((await (asDb(fixture.admin) as DbClient).rpc("metrics_funnel_write_failures", range)).data).toBe(1);
    expect((await (asDb(outsider) as DbClient).rpc("metrics_funnel_write_failures", range)).data).toBe(0);
  });
});
