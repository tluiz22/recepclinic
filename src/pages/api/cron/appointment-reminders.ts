import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../../../lib/supabase/service";
import {
  isReminderTemplateConfigured,
  sendAppointmentReminder,
  sendExamPreparation,
} from "../../../lib/whatsapp/notifications";
import { finishJobRun, logAppointmentEvent, startJobRun } from "../../../lib/audit";
import { fetchReminderHour, fortalezaHour, reminderWindow } from "../../../lib/automaticSends";

// Dispara o lembrete de consulta para todo agendamento ativo do dia seguinte
// (00:00 às 23:59 de Fortaleza, `reminderWindow`) que ainda não recebeu
// lembrete (`reminder_sent_at is null`) — ajuste de 02/out/2026; antes era a
// janela das próximas 26h. Marcado depois do envio ou para o próprio dia fica
// sem lembrete automático (decisão do cliente; "Reenviar lembrete" resolve).
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
// envia, NÃO marca como lembrado (o "Reenviar lembrete" continua disponível;
// como a janela é só o dia seguinte, o agendador não tenta de novo) e
// registra "não enviado" na trilha uma vez por data do atendimento.
//
// Autenticação: `Authorization: Bearer <CRON_SECRET>` (o agendador lê o
// segredo do Vault do Supabase).

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

  const scheduled = url.searchParams.get("trigger") === "scheduled";
  if (scheduled) {
    const reminderHour = await fetchReminderHour(supabase);
    if (fortalezaHour(new Date()) !== reminderHour) {
      return json({ skipped: "fora_do_horario", reminder_hour: reminderHour });
    }
  }

  const runId = await startJobRun(supabase, "appointment_reminders", null, scheduled ? "scheduled" : "manual");

  const totals = { candidates: 0, sent: 0, failed: 0, not_sent_no_phone: 0, not_sent_no_template: 0 };

  try {
    const range = reminderWindow(new Date());

    const { data: candidates, error } = await supabase
      .from("appointments")
      .select(
        "id, scheduled_at, appointment_type, exam_type_id, home_visit_address, clinic_locations ( type, address ), exam_types ( name ), patients ( full_name, guardians ( id, full_name, phone ) )"
      )
      .in("status", ["scheduled", "confirmed"])
      .is("reminder_sent_at", null)
      .gte("scheduled_at", range.start.toISOString())
      .lt("scheduled_at", range.end.toISOString());

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

      // Em falha, deixa `reminder_sent_at` nulo: o botão "Reenviar lembrete"
      // continua disponível (o agendador só envia na hora configurada). O
      // status fica em `whatsapp_messages`, lido pela trilha.
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
