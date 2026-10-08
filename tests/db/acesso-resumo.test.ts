import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, setPresenceConfirmed } from "../../src/lib/data/agenda/appointments";
import type { DbClient } from "../../src/lib/data/clients";
import { listProfessionals, updateProfessional, type Professional } from "../../src/lib/data/config/professionals";
import { getSendsAlert, listAppointmentsWithFailedSends, listJobRuns } from "../../src/lib/data/sends";
import { getSummarySchedule, runDailySummary, type DailySummarySender, type DailySummaryToSend } from "../../src/lib/data/whatsapp/dailySummary";
import { recordOutboundMessage } from "../../src/lib/data/whatsapp/messages";
import { adminClient, clinicServiceClient, createClinic, deleteClinics, type TestUser } from "./helpers";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";

// F3.9c — resumo do dia (contatos do resumo e cada profissional, D2 revista
// em 05/out/2026), execuções das rotinas e alerta de envios, na clínica de
// teste da agenda (atendimentos na segunda, 10/03/2031; "agora" é o domingo).

let fixture: AgendaFixture;
let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let ids: AgendaIds;
let bot: DbClient;
let dra: Professional;
let clinicNoSummary: string;
const db = asDb;
const SUN = "2031-03-09";
const RECEPTION_PHONE = "+5584977740001";
const DRA_PHONE = "+5584977740002";

let seq = 0;
const summaries: DailySummaryToSend[] = [];
const sender: DailySummarySender = async (summary) => {
  summaries.push(summary);
  return { sent: true, messageId: `wamid.res.${Date.now()}.${++seq}` };
};
const sentSince = (from: number) => summaries.slice(from).map((s) => ({ to: s.phone, kind: s.kind, variant: s.variant, date: s.date, list: s.listText }));

const book = async (patient: string, service: string, agenda: string, start: Date, now = NOW) =>
  (await bookAppointment(db(reception), clinicId, { patientId: patient, serviceId: service, agendaId: agenda, start, channel: "admin", actorId: reception.id }, now))
    .appointment.id;

const appt = {} as Record<string, string>;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do resumo", "849777500");
  ({ clinicId, admin, reception, ids } = fixture);
  bot = clinicServiceClient(clinicId) as unknown as DbClient;
  await adminClient().from("whatsapp_connections").insert({ clinic_id: clinicId, phone_number_id: `pn-resumo-${Date.now()}`, waba_id: "waba", status: "connected" });
  await adminClient().from("whatsapp_templates").insert(
    ["daily_summary_consultations", "daily_summary_exams", "daily_summary_consultations_today"].map((key) => ({
      clinic_id: clinicId,
      template_key: key,
      name: `rc_${key}`,
      status: "approved",
    })),
  );
  await adminClient()
    .from("notification_recipients")
    .insert({ clinic_id: clinicId, label: "Recepção", phone: RECEPTION_PHONE, receives_consultations: true, receives_exams: true });
  const { data: agenda } = await adminClient().from("agendas").select("professional_id").eq("id", ids.agendaDra).single();
  dra = (await listProfessionals(db(admin), clinicId)).find((p) => p.id === agenda!.professional_id)!;
  clinicNoSummary = await createClinic("Clínica sem resumo", ["reminders"]);

  appt.c1 = await book(ids.p1, ids.consulta, ids.agendaDra, at(MON1, "09:00"));
  appt.c2 = await book(ids.p2, ids.consulta, ids.agendaDra2, at(MON1, "08:00"));
  appt.e1 = await book(ids.p3, ids.exame, ids.agendaExams, at(MON1, "08:00"));
  await setPresenceConfirmed(db(reception), clinicId, appt.c1, true, reception.id, NOW);
});

afterAll(async () => {
  await deleteClinics([clinicNoSummary]);
  await fixture.cleanup();
});

describe("cadastro do profissional", () => {
  it("recebe o resumo só com telefone", async () => {
    const base = { ...dra };
    expect(await codeOf(() => updateProfessional(db(admin), clinicId, dra.id, { ...base, phone: null, receivesDailySummary: true }))).toBe("invalid");
    expect(await codeOf(() => updateProfessional(db(admin), clinicId, dra.id, { ...base, phone: "123" }))).toBe("invalid");
    dra = await updateProfessional(db(admin), clinicId, dra.id, { ...base, phone: "(84) 97774-0002", receivesDailySummary: true });
    expect(dra).toMatchObject({ phone: DRA_PHONE, receivesDailySummary: true });
    // Sem os campos, ficam como estão.
    const { phone: _phone, receivesDailySummary: _receives, ...withoutContact } = dra;
    expect(await updateProfessional(db(admin), clinicId, dra.id, withoutContact)).toMatchObject({ phone: DRA_PHONE, receivesDailySummary: true });
  });

  it("sem o item do resumo liberado, ninguém marca a opção", async () => {
    const { data } = await adminClient()
      .from("professionals")
      .insert({ clinic_id: clinicNoSummary, display_name: "Dr. Sem", profession: "Médico", phone: DRA_PHONE })
      .select("id")
      .single();
    const { error } = await adminClient().from("professionals").update({ receives_daily_summary: true }).eq("id", data!.id);
    expect(error?.hint).toBe("feature_disabled:daily_summary");
  });

  it("horário do resumo pela agenda de cada público", async () => {
    expect(await getSummarySchedule(db(reception), clinicId)).toEqual({ consultas: "seg 7h", exames: "seg 7h" });
    expect(await getSummarySchedule(db(reception), clinicId, dra.id)).toEqual({ consultas: "seg 7h", exames: "nenhuma janela cadastrada" });
  });
});

describe("resumo da véspera (18h)", () => {
  it("antes das 18h não sai; às 18h, a lista geral e a da Dra., cada uma uma vez", async () => {
    expect(await runDailySummary(bot, clinicId, { variant: "preview", trigger: "scheduled", sender }, at(SUN, "17:59"))).toEqual({ skipped: "not_due" });

    const from = summaries.length;
    const result = await runDailySummary(bot, clinicId, { variant: "preview", trigger: "scheduled", sender }, at(SUN, "18:00"));
    expect(result).toMatchObject({ date: MON1, totals: { lists: 3, professional_lists: 1, sent: 3, failed: 0, not_sent_no_template: 0, lists_without_recipient: 0 } });
    expect(sentSince(from)).toEqual([
      {
        to: RECEPTION_PHONE,
        kind: "consultas",
        variant: "preview",
        date: MON1,
        list: "▪️ 08h00 - Paciente Dois (Dr. Segundo) (sem confirmação) ▪️ 09h00 - Paciente Um (Dra. Agenda) (✅ confirmado)",
      },
      { to: RECEPTION_PHONE, kind: "exames", variant: "preview", date: MON1, list: "▪️ 08h00 - Paciente Três (sem confirmação)" },
      { to: DRA_PHONE, kind: "consultas", variant: "preview", date: MON1, list: "▪️ 09h00 - Paciente Um (✅ confirmado)" },
    ]);
    expect(summaries.at(-1)!.template).toEqual({ name: "rc_daily_summary_consultations", language: "pt_BR", body: null });

    expect(await runDailySummary(bot, clinicId, { variant: "preview", trigger: "scheduled", sender }, at(SUN, "18:05"))).toEqual({ skipped: "not_due" });
    const { data: messages } = await adminClient()
      .from("whatsapp_messages")
      .select("contact_phone, message_type, status, template_name")
      .eq("clinic_id", clinicId)
      .like("message_type", "daily_summary_%");
    expect(messages).toHaveLength(3);
    expect(messages).toContainEqual({ contact_phone: DRA_PHONE, message_type: "daily_summary_consultas", status: "sent", template_name: "rc_daily_summary_consultations" });
  });
});

describe("resumo do dia (1h antes do início)", () => {
  it("sai às 7h (janelas às 8h); sem template aprovado fica como não enviado", async () => {
    expect(await runDailySummary(bot, clinicId, { variant: "final", trigger: "scheduled", sender }, at(MON1, "06:59"))).toEqual({ skipped: "not_due" });
    const from = summaries.length;
    const result = await runDailySummary(bot, clinicId, { variant: "final", trigger: "scheduled", sender }, at(MON1, "07:00"));
    // O template de exames de hoje não está aprovado.
    expect(result).toMatchObject({ totals: { lists: 3, professional_lists: 1, sent: 2, not_sent_no_template: 1, resent_earlier_start: 0 } });
    expect(sentSince(from).map((s) => [s.to, s.kind])).toEqual([
      [RECEPTION_PHONE, "consultas"],
      [DRA_PHONE, "consultas"],
    ]);
    expect(await runDailySummary(bot, clinicId, { variant: "final", trigger: "scheduled", sender }, at(MON1, "07:05"))).toEqual({ skipped: "not_due" });
  });

  it("atendimento novo antes do horário já avisado: sai de novo só para quem foi afetado", async () => {
    appt.c3 = await book(ids.p3, ids.consulta, ids.agendaDra, at(MON1, "08:00"), at(MON1, "07:10"));
    const from = summaries.length;
    const result = await runDailySummary(bot, clinicId, { variant: "final", trigger: "scheduled", sender }, at(MON1, "07:15"));
    // A lista geral já começava às 8h; a da Dra. começava às 9h.
    expect(result).toMatchObject({ totals: { lists: 1, professional_lists: 1, resent_earlier_start: 1, sent: 1 } });
    expect(sentSince(from)).toEqual([
      { to: DRA_PHONE, kind: "consultas", variant: "final", date: MON1, list: "▪️ 08h00 - Paciente Três (sem confirmação) ▪️ 09h00 - Paciente Um (✅ confirmado)" },
    ]);
  });

  it("manual envia na hora, tudo", async () => {
    const result = await runDailySummary(bot, clinicId, { variant: "final", trigger: "manual", sender }, at(MON1, "05:00"));
    expect(result).toMatchObject({ totals: { lists: 3 } });
  });
});

describe("execuções e alerta de envios", () => {
  it("as execuções ficam registradas por clínica, com os totais", async () => {
    const runs = await listJobRuns(db(reception), clinicId, { job: "daily_summary" });
    expect(runs.map((r) => [r.variant, r.trigger, r.status])).toEqual([
      // Mais novas primeiro (a manual foi às 5h de segunda).
      ["final", "scheduled", "ok"],
      ["final", "scheduled", "ok"],
      ["final", "manual", "ok"],
      ["preview", "scheduled", "ok"],
    ]);
    expect(runs[3].totals).toMatchObject({ sent: 3 });
    expect(await listJobRuns(clinicServiceClient(clinicNoSummary) as unknown as DbClient, clinicId)).toEqual([]);
  });

  it("alerta: lembrete que não rodou e atendimento com envio com falha", async () => {
    await recordOutboundMessage(bot, clinicId, { phone: "+5584977750001", appointmentId: appt.c1, messageType: "appointment_reminder", status: "failed" }, at(SUN, "14:00"));
    expect((await listAppointmentsWithFailedSends(db(reception), clinicId, {}, at(SUN, "15:00"))).map((a) => [a.id, a.failedSends])).toEqual([[appt.c1, 1]]);
    // Hora do lembrete 14h: às 14h59 ainda não cobra; às 15h, sim.
    expect(await getSendsAlert(db(reception), clinicId, at(SUN, "14:59"))).toEqual({ reminderNotRun: false, reminderRunFailed: false, failedAppointments: 1 });
    expect(await getSendsAlert(db(reception), clinicId, at(SUN, "15:00"))).toMatchObject({ reminderNotRun: true });
    await adminClient().from("job_runs").insert({ clinic_id: clinicId, job: "appointment_reminders", trigger: "scheduled", status: "error", started_at: at(SUN, "14:00").toISOString() });
    expect(await getSendsAlert(db(reception), clinicId, at(SUN, "15:00"))).toEqual({ reminderNotRun: false, reminderRunFailed: true, failedAppointments: 1 });
  });
});

describe("sem o item ou sem conexão", () => {
  it("não roda", async () => {
    const off = clinicServiceClient(clinicNoSummary) as unknown as DbClient;
    expect(await runDailySummary(off, clinicNoSummary, { variant: "final", trigger: "manual", sender })).toEqual({ skipped: "not_enabled" });
    await adminClient().from("whatsapp_connections").update({ status: "disconnected" }).eq("clinic_id", clinicId);
    expect(await runDailySummary(bot, clinicId, { variant: "final", trigger: "manual", sender })).toEqual({ skipped: "not_connected" });
    await adminClient().from("whatsapp_connections").update({ status: "connected" }).eq("clinic_id", clinicId);
  });
});
