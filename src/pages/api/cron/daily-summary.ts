import type { APIRoute } from "astro";
import { createServiceClient } from "../../../lib/supabase/service";
import { sendDailySummaryMessage } from "../../../lib/whatsapp/dailySummary";
import { TIMEZONE } from "../../../lib/whatsapp/formatDateTime";
import { finishJobRun, startJobRun } from "../../../lib/audit";

// Disparado pelo agendador do Supabase (pg_cron, migração 0030; antes era o
// cron da Vercel) — dois disparos por dia, mesmo endpoint,
// diferenciados só pelo parâmetro `send`:
//   - `send=preview` (Envio A, ~18h Fortaleza da véspera): mira o dia
//     seguinte ("amanhã", relativo ao momento do disparo).
//   - `send=final` (Envio B, ~06h30 Fortaleza): mira o dia de hoje (relativo
//     ao momento do disparo) — como B dispara na manhã do próprio dia dos
//     atendimentos, "hoje" ali é o mesmo dia-calendário que era "amanhã"
//     quando A disparou na véspera. Os dois nunca miram dias diferentes,
//     desde que os horários do agendamento não sejam alterados.
// Cada resumo (consultas/exames) é avaliado de forma independente: lista
// vazia = não envia aquele resumo, silenciosamente (nunca manda "nada
// marcado") — mas a execução fica em `job_runs` (Fase 22) mesmo assim,
// com os totais, pra distinguir "não rodou" de "não tinha ninguém".

function todayFortaleza(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function formatTimeFortaleza(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(":", "h");
}

interface AppointmentRow {
  id: string;
  scheduled_at: string;
  appointment_type: string;
  home_visit_address: string | null;
  patients: { full_name: string } | { full_name: string }[] | null;
}

function patientName(row: AppointmentRow): string {
  const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
  return patient?.full_name ?? "Paciente";
}

// "09h00 - João Silva · 10h30 - Maria Souza (Rua X, 123 - Bairro Y)" —
// parâmetros de corpo de template da Meta não aceitam quebra de linha, a
// lista inteira fica numa linha só, itens já ordenados por horário (a query
// abaixo ordena). Atendimento domiciliar leva o endereço completo junto —
// só ele tem `home_visit_address` preenchido (ver Fase 16 no plano).
function buildListText(rows: AppointmentRow[]): string {
  return rows
    .map((row) => {
      const base = `${formatTimeFortaleza(new Date(row.scheduled_at))} - ${patientName(row)}`;
      return row.home_visit_address ? `${base} (${row.home_visit_address})` : base;
    })
    .join(" · ");
}

export const GET: APIRoute = async ({ request, url }) => {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) {
    return json({ error: "CRON_SECRET não configurada" }, 500);
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "não autorizado" }, 401);
  }

  const send = url.searchParams.get("send");
  if (send !== "preview" && send !== "final") {
    return json({ error: "parâmetro send inválido — use preview ou final" }, 400);
  }

  const supabase = createServiceClient();
  const runId = await startJobRun(supabase, "daily_summary", send);

  const totals = { consultas: 0, exames: 0, sent: 0, failed: 0, not_sent_no_template: 0, lists_without_recipient: 0 };

  try {
    const targetDate = send === "preview" ? addDays(todayFortaleza(), 1) : todayFortaleza();
    const dayStart = new Date(`${targetDate}T00:00:00-03:00`);
    const dayEnd = new Date(`${addDays(targetDate, 1)}T00:00:00-03:00`);

    const { data: candidates, error } = await supabase
      .from("appointments")
      .select("id, scheduled_at, appointment_type, home_visit_address, patients ( full_name )")
      .in("status", ["scheduled", "confirmed"])
      .gte("scheduled_at", dayStart.toISOString())
      .lt("scheduled_at", dayEnd.toISOString())
      .order("scheduled_at");

    if (error) {
      await finishJobRun(supabase, runId, { totals, error: error.message });
      return json({ error: error.message }, 500);
    }

    const active = (candidates ?? []) as AppointmentRow[];

    const consultas = active.filter((a) => a.appointment_type === "first_visit" || a.appointment_type === "return_visit");
    const exames = active.filter((a) => a.appointment_type === "exam");
    totals.consultas = consultas.length;
    totals.exames = exames.length;

    const results: Record<string, string> = {};

    const sendList = async (
      kind: "consultas" | "exames",
      rows: AppointmentRow[],
      templateName: string | undefined
    ) => {
      if (rows.length === 0) return;
      const { data: recipients } = await supabase
        .from("notification_recipients")
        .select("phone")
        .eq("is_active", true)
        .eq(kind === "consultas" ? "receives_consultas" : "receives_exames", true);

      if (!recipients?.length) {
        console.warn(`[cron daily-summary] sem destinatário ativo para resumo de ${kind} — não enviado.`);
        totals.lists_without_recipient++;
        return;
      }

      const listText = buildListText(rows);
      for (const recipient of recipients) {
        const status = await sendDailySummaryMessage({
          supabase,
          to: recipient.phone,
          templateName,
          messageType: kind === "consultas" ? "daily_summary_consultas" : "daily_summary_exames",
          listText,
        });
        results[`${kind}:${recipient.phone}`] = status;
        if (status === "sent") totals.sent++;
        else if (status === "failed") totals.failed++;
        else totals.not_sent_no_template++;
      }
    };

    await sendList("consultas", consultas, import.meta.env.WHATSAPP_TEMPLATE_DAILY_SUMMARY_CONSULTAS);
    await sendList("exames", exames, import.meta.env.WHATSAPP_TEMPLATE_DAILY_SUMMARY_EXAMES);

    await finishJobRun(supabase, runId, { totals });
    return json({ send, targetDate, ...totals, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(supabase, runId, { totals, error: message });
    return json({ error: message, ...totals }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
