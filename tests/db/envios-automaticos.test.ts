import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { createSeries, extendOpenSeries } from "../../src/lib/data/agenda/series";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import type { DbClient } from "../../src/lib/data/clients";
import { runDailySummary } from "../../src/lib/data/whatsapp/dailySummary";
import { recordInboundMessage } from "../../src/lib/data/whatsapp/messages";
import { runAppointmentReminders } from "../../src/lib/data/whatsapp/reminders";
import { dailySummarySender, waitlistOfferSender, type ClinicSender } from "../../src/lib/data/whatsapp/send";
import { asDb, at, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// F7 — Envios automáticos: as opções da clínica (lembrete e resumo, cliente
// 07/out/2026), quem envia o resumo e a oferta de vaga, e a extensão das
// séries sem fim.

const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});

let f: AgendaFixture;
let db: DbClient;
type Call = { kind: string; to: string; args: unknown[] };
let calls: Call[] = [];
let seq = 0;
const sender: ClinicSender = {
  clinicId: "",
  clinicLabel: "da Clínica F7",
  baseUrl: "https://app.exemplo.test",
  template: async (to, ...args) => (calls.push({ kind: "template", to, args }), { sent: true, messageId: `wamid.f7.${++seq}`, body: "corpo" }),
  text: async (to, ...args) => (calls.push({ kind: "text", to, args }), { sent: true, messageId: `wamid.f7.${++seq}` }),
  list: async (to, ...args) => (calls.push({ kind: "list", to, args }), { sent: true, messageId: `wamid.f7.${++seq}` }),
  buttons: async (to, ...args) => (calls.push({ kind: "buttons", to, args }), { sent: true, messageId: `wamid.f7.${++seq}`, body: "oferta" }),
};
const set = (values: Record<string, unknown>) => adminClient().from("clinic_settings").update(values).eq("clinic_id", f.clinicId);

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica F7", "849777700");
  db = createClinicServiceClient(f.clinicId, env());
  await adminClient().from("whatsapp_connections").insert({ clinic_id: f.clinicId, phone_number_id: "f7-numero", waba_id: "f7-waba", status: "connected" });
  await adminClient().from("whatsapp_templates").insert([
    { clinic_id: f.clinicId, template_key: "reminder", name: "rc_lembrete_v1", status: "approved" },
    { clinic_id: f.clinicId, template_key: "daily_summary_consultations", name: "rc_resumo_consultas_amanha_v1", status: "approved" },
  ]);
});

afterAll(async () => f.cleanup());

describe("opções da clínica (F7)", () => {
  it("padrões: lembrete e resumos ligados, véspera às 18h, no dia 1h antes", async () => {
    const { data } = await adminClient()
      .from("clinic_settings")
      .select("reminder_enabled, reminder_hour, summary_preview_enabled, summary_preview_hour, summary_today_enabled, summary_today_lead_hours")
      .eq("clinic_id", f.clinicId)
      .single();
    expect(data).toEqual({
      reminder_enabled: true,
      reminder_hour: 18,
      summary_preview_enabled: true,
      summary_preview_hour: 18,
      summary_today_enabled: true,
      summary_today_lead_hours: 1,
    });
  });

  it("lembrete da véspera desligado: a rotina não envia nem reenvia", async () => {
    await set({ reminder_enabled: false });
    expect(await runAppointmentReminders(db, f.clinicId, { trigger: "manual", sender: async () => ({ sent: true, messageId: "x" }) }, NOW)).toEqual({
      skipped: "disabled",
    });
    await set({ reminder_enabled: true });
  });

  it("resumo da véspera: desligado não sai; ligado sai na hora escolhida", async () => {
    await bookAppointment(
      asDb(f.reception),
      f.clinicId,
      { patientId: f.ids.p1, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra, start: at(MON1, "08:00"), locationId: f.ids.office, channel: "admin", actorId: null },
      NOW,
    );
    await adminClient().from("notification_recipients").insert({ clinic_id: f.clinicId, label: "Recepção F7", phone: "+5584977770099", receives_consultations: true, receives_exams: false });
    const send = dailySummarySender(sender);
    const sunday = (time: string) => at("2031-03-09", time);

    await set({ summary_preview_enabled: false });
    expect(await runDailySummary(db, f.clinicId, { variant: "preview", trigger: "scheduled", sender: send }, sunday("19:00"))).toEqual({ skipped: "disabled" });

    await set({ summary_preview_enabled: true, summary_preview_hour: 19 });
    expect(await runDailySummary(db, f.clinicId, { variant: "preview", trigger: "scheduled", sender: send }, sunday("18:30"))).toEqual({ skipped: "not_due" });
    calls = [];
    const result = await runDailySummary(db, f.clinicId, { variant: "preview", trigger: "scheduled", sender: send }, sunday("19:05"));
    expect(result).toMatchObject({ totals: { sent: 1 } });
    expect(calls[0]).toMatchObject({ kind: "template", to: "+5584977770099" });
    expect(calls[0].args.slice(0, 1)).toEqual(["daily_summary_consultations"]);
    // {{1}} primeiro nome, {{2}} a clínica, {{3}} a data, {{4}} a lista.
    expect(calls[0].args[2]).toEqual(["Recepção", "da Clínica F7", "segunda, 10/03", "▪️ 08h00 - Paciente Um (sem confirmação)"]);
  });
});

describe("oferta de vaga (F7)", () => {
  let contactId = "";
  const offer = (phone: string) => ({
    offerId: "11111111-1111-4111-8111-111111111111",
    clinicId: f.clinicId,
    timeZone: "America/Fortaleza",
    contact: { id: contactId, fullName: "Maria Souza", phone },
    patientName: "João",
    appointmentId: null as unknown as string,
    serviceName: "Consulta",
    serviceCategory: "consultation" as const,
    currentStart: at("2031-03-24", "09:00"),
    slotStart: at(MON1, "14:00"),
    slotLocationName: "Consultório",
    slotIsHomeVisit: false,
    expiresAt: at(MON1, "13:00"),
  });

  it("quem escreveu nas últimas 24h recebe texto com os botões; os demais, o template (sem ele, ninguém)", async () => {
    // Contato real do Paciente Um (a mensagem fica registrada nele).
    contactId = (await adminClient().from("contacts").select("id").eq("clinic_id", f.clinicId).eq("phone", "+5584977770001").single()).data!.id;
    const send = waitlistOfferSender(sender, db);
    calls = [];
    // Sem janela e sem template: pulada.
    expect(await send(offer("+5584977770001"))).toEqual({ sent: false, reason: "no_template" });

    await recordInboundMessage(db, f.clinicId, { id: "wamid.f7.in", from: "5584977770001", type: "text", text: { body: "oi" } });
    expect(await send(offer("+5584977770001"))).toMatchObject({ sent: true });
    expect(calls[0].kind).toBe("buttons");
    expect(calls[0].args[0]).toBe(
      "Olá, Maria! Aqui é da Clínica F7.\nAbriu uma vaga de consulta para João: segunda, 10/03 às 14:00 (Consultório). É antes do horário marcado (segunda, 24/03 às 09:00).\n\nQuer antecipar? Responda em até 60 minutos.",
    );
    expect(calls[0].args[1]).toEqual([
      { id: "waitlist:yes:11111111-1111-4111-8111-111111111111", title: "Sim, quero antecipar" },
      { id: "waitlist:no:11111111-1111-4111-8111-111111111111", title: "Não, manter horário" },
    ]);

    await adminClient().from("whatsapp_templates").insert({ clinic_id: f.clinicId, template_key: "waitlist_offer", name: "rc_oferta_vaga_v1", status: "approved" });
    calls = [];
    expect(await send({ ...offer("+5584977770002"), contact: { id: (await adminClient().from("contacts").select("id").eq("clinic_id", f.clinicId).eq("phone", "+5584977770002").single()).data!.id, fullName: "Maria Souza", phone: "+5584977770002" } })).toMatchObject({ sent: true });
    expect(calls[0].kind).toBe("template");
    expect(calls[0].args[0]).toBe("waitlist_offer");
    expect(calls[0].args[1]).toMatchObject({ name: "rc_oferta_vaga_v1" });
    expect(calls[0].args[3]).toEqual(["waitlist:yes:11111111-1111-4111-8111-111111111111", "waitlist:no:11111111-1111-4111-8111-111111111111"]);
  });
});

describe("séries sem fim (F7)", () => {
  it("a rotina diária marca as sessões que entraram nos 3 meses à frente", async () => {
    const { series, created } = await createSeries(
      asDb(f.reception),
      f.clinicId,
      { patientId: f.ids.p2, serviceId: f.ids.consulta, agendaId: f.ids.agendaDra2, locationId: f.ids.office, intervalWeeks: 1, startsOn: MON1, startTime: "08:30", actorId: null },
      NOW,
    );
    const before = created.length;
    // Um mês depois, o horizonte andou: entram sessões novas.
    const totals = await extendOpenSeries(db, f.clinicId, new Date(NOW.getTime() + 31 * 24 * 60 * 60_000));
    expect(totals.errors).toBe(0);
    const { count } = await adminClient().from("appointments").select("id", { count: "exact", head: true }).eq("series_id", series.id);
    expect(count!).toBeGreaterThan(before);
    expect(totals.created).toBe(count! - before);
  });
});
