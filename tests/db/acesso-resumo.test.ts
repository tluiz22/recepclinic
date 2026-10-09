import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, setPresenceConfirmed } from "../../src/lib/data/agenda/appointments";
import type { DbClient } from "../../src/lib/data/clients";
import { listProfessionals, setSummaryProfessionals, updateProfessional, type Professional } from "../../src/lib/data/config/professionals";
import { getSendsAlert, listAppointmentsWithFailedSends, listJobRuns } from "../../src/lib/data/sends";
import { runDailySummary, type DailySummarySender, type DailySummaryToSend } from "../../src/lib/data/whatsapp/dailySummary";
import { recordOutboundMessage } from "../../src/lib/data/whatsapp/messages";
import { adminClient, clinicServiceClient, createClinic, deleteClinics, type TestUser } from "./helpers";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";

// F3.9c — resumo do dia, reestruturado em 09/out/2026 como lembrete ao
// profissional e à equipe (um envio por público, na véspera ou no dia, no
// horário escolhido), execuções das rotinas e alerta de envios, na clínica de
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
  // O alerta de lembrete que não rodou conta com o lembrete às 14h (o padrão era esse até a F7).
  await adminClient().from("clinic_settings").update({ reminder_hour: 14 }).eq("clinic_id", fixture.clinicId);
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

describe("cadastro do profissional e quem recebe", () => {
  it("WhatsApp obrigatório no cadastro; quem recebe é marcado em Lembretes, só com WhatsApp", async () => {
    const base = { ...dra };
    expect(await codeOf(() => updateProfessional(db(admin), clinicId, dra.id, { ...base, phone: null }))).toBe("invalid");
    expect(await codeOf(() => updateProfessional(db(admin), clinicId, dra.id, { ...base, phone: "123" }))).toBe("invalid");
    dra = await updateProfessional(db(admin), clinicId, dra.id, { ...base, phone: "(84) 97774-0002" });
    expect(dra.phone).toBe(DRA_PHONE);

    const segundo = (await listProfessionals(db(admin), clinicId)).find((p) => p.displayName === "Dr. Segundo")!;
    expect(await codeOf(() => setSummaryProfessionals(db(admin), clinicId, [dra.id, segundo.id]))).toBe("invalid");
    await setSummaryProfessionals(db(admin), clinicId, [dra.id]);
    expect((await listProfessionals(db(admin), clinicId)).filter((p) => p.receivesDailySummary).map((p) => p.id)).toEqual([dra.id]);
  });

  it("cada público com o próprio item: profissional (\"Lembrete ao profissional\") e contatos (\"Lembrete à equipe\")", async () => {
    const { data } = await adminClient()
      .from("professionals")
      .insert({ clinic_id: clinicNoSummary, display_name: "Dr. Sem", profession: "Médico", phone: DRA_PHONE })
      .select("id")
      .single();
    const { error } = await adminClient().from("professionals").update({ receives_daily_summary: true }).eq("id", data!.id);
    expect(error?.hint).toBe("feature_disabled:daily_summary");
    const contact = await adminClient().from("notification_recipients").insert({ clinic_id: clinicNoSummary, label: "Recepção", phone: RECEPTION_PHONE });
    expect(contact.error?.hint).toBe("feature_disabled:team_summary");
  });
});

describe("na véspera (padrão: 18h)", () => {
  it("antes do horário não sai; no horário, uma vez para cada público", async () => {
    expect(await runDailySummary(bot, clinicId, { audience: "professional", trigger: "scheduled", sender }, at(SUN, "17:59"))).toEqual({ skipped: "not_due" });

    let from = summaries.length;
    const professional = await runDailySummary(bot, clinicId, { audience: "professional", trigger: "scheduled", sender }, at(SUN, "18:00"));
    expect(professional).toMatchObject({ date: MON1, totals: { lists: 1, professional_lists: 1, sent: 1, failed: 0 } });
    expect(sentSince(from)).toEqual([{ to: DRA_PHONE, kind: "consultas", variant: "preview", date: MON1, list: "▪️ 09h00 - Paciente Um (✅ confirmado)" }]);

    from = summaries.length;
    const team = await runDailySummary(bot, clinicId, { audience: "team", trigger: "scheduled", sender }, at(SUN, "18:00"));
    expect(team).toMatchObject({ date: MON1, totals: { lists: 2, professional_lists: 0, sent: 2, not_sent_no_template: 0, lists_without_recipient: 0 } });
    expect(sentSince(from)).toEqual([
      {
        to: RECEPTION_PHONE,
        kind: "consultas",
        variant: "preview",
        date: MON1,
        list: "▪️ 08h00 - Paciente Dois (Dr. Segundo) (sem confirmação) ▪️ 09h00 - Paciente Um (Dra. Agenda) (✅ confirmado)",
      },
      { to: RECEPTION_PHONE, kind: "exames", variant: "preview", date: MON1, list: "▪️ 08h00 - Paciente Três (sem confirmação)" },
    ]);
    expect(summaries.at(-1)!.template).toEqual({ name: "rc_daily_summary_exams", language: "pt_BR", body: null });

    for (const audience of ["professional", "team"] as const) {
      expect(await runDailySummary(bot, clinicId, { audience, trigger: "scheduled", sender }, at(SUN, "18:05"))).toEqual({ skipped: "not_due" });
    }
    const { data: messages } = await adminClient()
      .from("whatsapp_messages")
      .select("contact_phone, message_type, status, template_name")
      .eq("clinic_id", clinicId)
      .like("message_type", "daily_summary_%");
    expect(messages).toHaveLength(3);
    expect(messages).toContainEqual({ contact_phone: DRA_PHONE, message_type: "daily_summary_consultas", status: "sent", template_name: "rc_daily_summary_consultations" });
  });

  it("desligado, não sai", async () => {
    await adminClient().from("clinic_settings").update({ professional_summary_enabled: false }).eq("clinic_id", clinicId);
    expect(await runDailySummary(bot, clinicId, { audience: "professional", trigger: "scheduled", sender }, at(SUN, "19:00"))).toEqual({ skipped: "disabled" });
    await adminClient().from("clinic_settings").update({ professional_summary_enabled: true }).eq("clinic_id", clinicId);
  });
});

describe("no dia (equipe às 7h)", () => {
  it("sai às 7h, uma vez só (nem com atendimento novo); sem template aprovado fica como não enviado", async () => {
    await adminClient().from("clinic_settings").update({ team_summary_timing: "same_day", team_summary_hour: 7 }).eq("clinic_id", clinicId);
    expect(await runDailySummary(bot, clinicId, { audience: "team", trigger: "scheduled", sender }, at(MON1, "06:59"))).toEqual({ skipped: "not_due" });
    const from = summaries.length;
    const result = await runDailySummary(bot, clinicId, { audience: "team", trigger: "scheduled", sender }, at(MON1, "07:00"));
    // O template de exames de hoje não está aprovado.
    expect(result).toMatchObject({ date: MON1, totals: { lists: 2, sent: 1, not_sent_no_template: 1 } });
    expect(sentSince(from).map((s) => [s.to, s.kind, s.variant])).toEqual([[RECEPTION_PHONE, "consultas", "final"]]);

    appt.c3 = await book(ids.p3, ids.consulta, ids.agendaDra, at(MON1, "08:00"), at(MON1, "07:10"));
    expect(await runDailySummary(bot, clinicId, { audience: "team", trigger: "scheduled", sender }, at(MON1, "07:15"))).toEqual({ skipped: "not_due" });
  });

  it("manual envia na hora, tudo", async () => {
    const result = await runDailySummary(bot, clinicId, { audience: "team", trigger: "manual", sender }, at(MON1, "05:00"));
    expect(result).toMatchObject({ totals: { lists: 2 } });
  });
});

describe("execuções e alerta de envios", () => {
  it("as execuções ficam registradas por clínica, com os totais", async () => {
    const runs = await listJobRuns(db(reception), clinicId, { job: "daily_summary" });
    expect(runs.map((r) => [r.variant, r.trigger, r.status])).toEqual([
      // Mais novas primeiro (a manual foi às 5h de segunda).
      ["final", "scheduled", "ok"],
      ["final", "manual", "ok"],
      ["preview", "scheduled", "ok"],
      ["preview", "scheduled", "ok"],
    ]);
    expect(runs[0].totals).toMatchObject({ sent: 1, not_sent_no_template: 1 });
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
    for (const audience of ["professional", "team"] as const) {
      expect(await runDailySummary(off, clinicNoSummary, { audience, trigger: "manual", sender })).toEqual({ skipped: "not_enabled" });
    }
    await adminClient().from("whatsapp_connections").update({ status: "disconnected" }).eq("clinic_id", clinicId);
    expect(await runDailySummary(bot, clinicId, { audience: "team", trigger: "manual", sender })).toEqual({ skipped: "not_connected" });
    await adminClient().from("whatsapp_connections").update({ status: "connected" }).eq("clinic_id", clinicId);
  });
});
