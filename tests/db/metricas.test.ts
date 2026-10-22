import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, recordAttendance } from "../../src/lib/data/agenda/appointments";
import { listFinancialTotals, listFrequentNoShows, ownAgendaIds } from "../../src/lib/data/metrics";
import { asDb, at, MON1, MON2, MON3, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { addMember, adminClient, anonClient, createUser, deleteUsers, type TestUser } from "./helpers";

// F4.9 — Métricas: leitura do período por agenda e por paciente, faltosos e
// as agendas do próprio Profissional (Métricas pessoais, D11).

let fixture: AgendaFixture;
let doctor: TestUser;
let outsider: TestUser;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste das métricas", "849333400");
  const { clinicId, ids, admin } = fixture;
  doctor = await createUser("mt-medica");
  outsider = await createUser("mt-de-fora");
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
  await deleteUsers([doctor, outsider]);
});

describe("métricas", () => {
  const period = { start: at(MON1, "00:00"), end: at("2031-04-01", "00:00") };

  it("financeiro: o período nas agendas escolhidas, com o valor gravado na marcação", async () => {
    const { clinicId, ids, admin } = fixture;
    const totals = await listFinancialTotals(asDb(admin), clinicId, { ...period, agendaIds: [ids.agendaDra] });
    expect(totals).toEqual(
      expect.arrayContaining([
        { serviceName: "Consulta", locationName: "Consultório", bucket: "lost", count: 2, cents: 60000 },
        { serviceName: "Consulta", locationName: "Consultório", bucket: "done", count: 1, cents: 30000 },
      ]),
    );
    expect(totals).toHaveLength(2);
    expect(await listFinancialTotals(asDb(admin), clinicId, { ...period, agendaIds: [ids.agendaDra2] })).toEqual([]);
    expect(await listFinancialTotals(asDb(admin), clinicId, { ...period, agendaIds: [ids.agendaDra], patientIds: [ids.p2] })).toEqual([
      { serviceName: "Consulta", locationName: "Consultório", bucket: "done", count: 1, cents: 30000 },
    ]);
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

// Contas no banco com o acesso conferido na entrada (22/out/2026): as mesmas
// agendas que o RLS deixaria ver, e nada para quem não é da clínica.
describe("contas no banco: acesso conferido na entrada", () => {
  const range = () => ({ p_clinic_id: fixture.clinicId, p_start: at(MON1, "00:00").toISOString(), p_end: at("2031-04-01", "00:00").toISOString() });
  const attendance = async (user: TestUser, agendaIds: string[]) => {
    const { data, error } = await user.client.rpc("metrics_attendance", { ...range(), p_agenda_ids: agendaIds, p_now: at("2031-04-01", "00:00").toISOString() });
    expect(error).toBeNull();
    return (data as { completed: number; no_show: number }[]).reduce((t, r) => ({ completed: t.completed + Number(r.completed), noShow: t.noShow + Number(r.no_show) }), { completed: 0, noShow: 0 });
  };

  beforeAll(async () => {
    await adminClient()
      .from("bot_funnel_events")
      .insert({ clinic_id: fixture.clinicId, session_id: crypto.randomUUID(), flow: "booking", step: "started", contact_phone: "+5584999990001", occurred_at: at(MON1, "09:00").toISOString() });
  });

  it("quem vê a agenda recebe as contas dela", async () => {
    expect(await attendance(fixture.admin, [fixture.ids.agendaDra])).toEqual({ completed: 1, noShow: 2 });
  });

  it("o Profissional não recebe a agenda de outro, mesmo pedindo por ela", async () => {
    expect(await attendance(doctor, [fixture.ids.agendaDra, fixture.ids.agendaDra2])).toEqual({ completed: 0, noShow: 0 });
    const { data } = await doctor.client.rpc("metrics_activity", { ...range(), p_agenda_ids: [fixture.ids.agendaDra] });
    expect(data).toEqual([]);
    expect(await listFrequentNoShows(asDb(doctor), fixture.clinicId, [fixture.ids.agendaDra])).toEqual([]);
    expect(await listFinancialTotals(asDb(doctor), fixture.clinicId, { start: at(MON1, "00:00"), end: at("2031-04-01", "00:00"), agendaIds: [fixture.ids.agendaDra] })).toEqual([]);
  });

  it("quem não é da clínica recebe tudo zerado", async () => {
    const agendas = [fixture.ids.agendaDra, fixture.ids.agendaDra2];
    expect(await attendance(outsider, agendas)).toEqual({ completed: 0, noShow: 0 });
    for (const fn of ["metrics_activity", "metrics_return_rights"] as const) {
      const { data, error } = await outsider.client.rpc(fn, { ...range(), p_agenda_ids: agendas });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    const { data: reminders } = await outsider.client.rpc("metrics_reminders", { ...range(), p_agenda_ids: agendas });
    expect(reminders).toEqual([]);
    expect(await listFinancialTotals(asDb(outsider), fixture.clinicId, { start: at(MON1, "00:00"), end: at("2031-04-01", "00:00"), agendaIds: agendas })).toEqual([]);
    expect(await listFrequentNoShows(asDb(outsider), fixture.clinicId, agendas)).toEqual([]);
    const { data: sessions } = await outsider.client.rpc("metrics_bot_sessions", range());
    expect(sessions).toEqual([]);
    const { data: own } = await fixture.admin.client.rpc("metrics_bot_sessions", range());
    expect(own).toHaveLength(1);
  });

  it("sem login, nada roda", async () => {
    const { error } = await anonClient().rpc("metrics_attendance", { ...range(), p_agenda_ids: [fixture.ids.agendaDra] });
    expect(error?.code).toBe("42501");
  });
});
