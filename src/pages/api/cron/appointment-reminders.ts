import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../../../lib/supabase/service";
import {
  isReminderTemplateConfigured,
  sendAppointmentReminder,
  sendExamPreparation,
} from "../../../lib/whatsapp/notifications";
import { finishJobRun, logAppointmentEvent, startJobRun } from "../../../lib/audit";
import { fortalezaHour } from "../../../lib/automaticSends";

// Dispara o lembrete de consulta para todo agendamento ativo nas próximas
// ~26h que ainda não recebeu lembrete (`reminder_sent_at is null`). Rodando
// 1x/dia, cada consulta recebe exatamente um lembrete, na primeira execução
// que cai dentro da janela — na prática, "no dia anterior".
//
// Horário configurável (Fase 22 · etapa 7): quem chama é o agendador do
// Supabase (pg_cron, migrações 0029/0030), de hora em hora, com
// `?trigger=scheduled` — a rota só envia quando a hora de Fortaleza bate com
// `appointment_settings.reminder_hour` (as outras 23 chamadas voltam sem
// fazer nada e sem gravar `job_runs`). Chamada sem o parâmetro (teste
// manual) envia na hora.
//
// Cada execução vira uma linha em `job_runs` (Fase 22), inclusive quando não
// há ninguém na janela. Responsável sem telefone ou template desligado: não
// envia, NÃO marca como lembrado (se o telefone/template aparecer, a próxima
// execução ainda na janela envia) e registra "não enviado" na trilha uma vez
// por data do atendimento.
//
// Autenticação: `Authorization: Bearer <CRON_SECRET>` (o agendador lê o
// segredo do Vault do Supabase).

const WINDOW_HOURS = 26;

type NotSentReason = "no_phone" | "template_disabled";

export const GET: APIRoute = async ({ request, url }) => {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) {
    return json({ error: "CRON_SECRET não configurada" }, 500);
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "não autorizado" }, 401);
  }

  const supabase = createServiceClient();

  if (url.searchParams.get("trigger") === "scheduled") {
    const { data: settings } = await supabase.from("appointment_settings").select("reminder_hour").eq("id", 1).single();
    const reminderHour = settings?.reminder_hour ?? 8;
    if (fortalezaHour(new Date()) !== reminderHour) {
      return json({ skipped: "fora_do_horario", reminder_hour: reminderHour });
    }
  }

  const runId = await startJobRun(supabase, "appointment_reminders");

  const totals = { candidates: 0, sent: 0, failed: 0, not_sent_no_phone: 0, not_sent_no_template: 0 };

  try {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + WINDOW_HOURS * 60 * 60 * 1000);

    const { data: candidates, error } = await supabase
      .from("appointments")
      .select(
        "id, scheduled_at, appointment_type, exam_type_id, home_visit_address, clinic_locations ( type, address ), exam_types ( name ), patients ( full_name, guardians ( id, full_name, phone ) )"
      )
      .in("status", ["scheduled", "confirmed"])
      .is("reminder_sent_at", null)
      .gt("scheduled_at", now.toISOString())
      .lte("scheduled_at", windowEnd.toISOString());

    if (error) {
      await finishJobRun(supabase, runId, { totals, error: error.message });
      return json({ error: error.message }, 500);
    }

    totals.candidates = candidates?.length ?? 0;
    const alreadyLogged = await fetchLoggedNotSent(supabase, (candidates ?? []).map((row) => row.id));
    const templateConfigured = isReminderTemplateConfigured();

    const registerNotSent = async (appointmentId: string, scheduledAt: string, reason: NotSentReason) => {
      if (reason === "no_phone") totals.not_sent_no_phone++;
      else totals.not_sent_no_template++;
      if (alreadyLogged.has(notSentKey(appointmentId, scheduledAt, reason))) return;
      await logAppointmentEvent(supabase, {
        appointmentId,
        type: "message_not_sent",
        channel: "cron",
        details: { kind: "reminder", reason, scheduled_at: scheduledAt },
      });
    };

    for (const appointment of candidates ?? []) {
      const patient = (appointment.patients ?? null) as unknown as {
        full_name: string;
        guardians: { id: string; full_name: string; phone: string } | null;
      } | null;
      const guardian = patient?.guardians ?? null;
      const location = (appointment.clinic_locations ?? null) as unknown as {
        type: string;
        address: string | null;
      } | null;
      const examType = (appointment.exam_types ?? null) as unknown as { name: string } | null;

      if (!patient || !guardian?.phone) {
        await registerNotSent(appointment.id, appointment.scheduled_at, "no_phone");
        continue;
      }

      if (!templateConfigured) {
        await registerNotSent(appointment.id, appointment.scheduled_at, "template_disabled");
        continue;
      }

      const status = await sendAppointmentReminder({
        supabase,
        appointmentId: appointment.id,
        guardianId: guardian.id,
        guardianPhone: guardian.phone,
        patientName: patient.full_name,
        appointmentType: appointment.appointment_type,
        examName: examType?.name,
        scheduledAt: new Date(appointment.scheduled_at),
        locationType: location?.type,
        locationAddress: appointment.home_visit_address ?? location?.address ?? null,
      });

      // Em falha, deixa `reminder_sent_at` nulo para o próximo cron tentar de
      // novo (ainda dentro da janela de 26h). O status fica em
      // `whatsapp_messages`, lido pela trilha.
      if (status !== "sent") {
        totals.failed++;
        continue;
      }
      totals.sent++;

      await supabase
        .from("appointments")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", appointment.id);

      // Preparo do exame junto do lembrete (Fase 18) — melhor esforço, fora
      // da contagem e sem nova tentativa: o lembrete é o que controla
      // `reminder_sent_at`.
      if (appointment.appointment_type === "exam" && appointment.exam_type_id) {
        await sendExamPreparation({
          supabase,
          appointmentId: appointment.id,
          guardianId: guardian.id,
          guardianPhone: guardian.phone,
          examTypeId: appointment.exam_type_id,
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(supabase, runId, { totals, error: message });
    return json({ error: message, ...totals }, 500);
  }

  await finishJobRun(supabase, runId, { totals });
  return json(totals);
};

function notSentKey(appointmentId: string, scheduledAt: string, reason: string): string {
  return `${appointmentId}|${new Date(scheduledAt).getTime()}|${reason}`;
}

// "Não enviado" já registrado para estes atendimentos — um por data do
// atendimento e motivo (remarcar para outra data volta a registrar).
async function fetchLoggedNotSent(supabase: SupabaseClient, appointmentIds: string[]): Promise<Set<string>> {
  if (appointmentIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("appointment_events")
    .select("appointment_id, details")
    .eq("event_type", "message_not_sent")
    .in("appointment_id", appointmentIds);
  if (error) {
    console.error("[cron reminders] erro ao ler 'não enviado' já registrados:", error.message);
  }
  const keys = new Set<string>();
  for (const row of data ?? []) {
    const details = (row.details ?? {}) as { kind?: string; reason?: string; scheduled_at?: string };
    if (details.kind === "reminder" && details.reason && details.scheduled_at) {
      keys.add(notSentKey(row.appointment_id, details.scheduled_at, details.reason));
    }
  }
  return keys;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
