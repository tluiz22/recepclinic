import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../../../lib/supabase/service";
import { sendDailySummaryMessage } from "../../../lib/whatsapp/dailySummary";
import { TIMEZONE } from "../../../lib/whatsapp/formatDateTime";
import { finishJobRun, startJobRun } from "../../../lib/audit";
import {
  computeSummarySendAt,
  fetchFirstWindowStarts,
  weekdayOf,
  type SummaryKind,
} from "../../../lib/dailySummarySchedule";

// Disparado pelo agendador do Supabase (pg_cron, migrações 0030/0031; antes
// era o cron da Vercel), mesmo endpoint, diferenciado pelo parâmetro `send`:
//   - `send=preview` (Envio A, 18h Fortaleza da véspera): mira o dia
//     seguinte ("amanhã", relativo ao momento do disparo).
//   - `send=final` (Envio B, no próprio dia): mira o dia de hoje. Com
//     `trigger=scheduled` (agendador, a cada 5 minutos) cada resumo sai 1h
//     antes do início dos atendimentos do dia, pela tela Disponibilidade
//     (`dailySummarySchedule.ts`), uma vez por dia e por tipo
//     (`daily_summary_sends`). Depois do envio, só reenvia se aparecer
//     atendimento antes do primeiro horário já informado (ou se o dia estava
//     vazio) — a médica não pode chegar depois de um paciente que não sabia
//     que existia. Fora disso a chamada não grava nada. Sem `trigger`
//     (teste manual), envia na hora.
// Cada resumo (consultas/exames) é avaliado de forma independente: lista
// vazia = não envia aquele resumo, silenciosamente (nunca manda "nada
// marcado") — mas a execução fica em `job_runs` (Fase 22) mesmo assim,
// com os totais, pra distinguir "não rodou" de "não tinha ninguém".
// Cada envio tem os seus templates: o texto fixo diz "de amanhã" no A e
// "de hoje" no B (`resumo_*_hoje`, set/2026). Sem o template do B
// configurado, o B fica como "template desligado" — nunca cai no template
// do A, que sairia com o dia errado.

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
  patient_confirmed_at: string | null;
  patients: { full_name: string } | { full_name: string }[] | null;
}

function patientName(row: AppointmentRow): string {
  const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
  return patient?.full_name ?? "Paciente";
}

// "▪️ 09h00 - João Silva (✅ confirmado) ▪️ 10h30 - Maria Souza (sem
// confirmação) - Endereço: Rua X, 123 - Bairro Y" — parâmetros de corpo de
// template da Meta não aceitam quebra de linha, então a lista inteira fica
// numa linha só; o marcador "▪️" separa cada paciente (decisão do cliente,
// set/2026 — no celular o texto quebra sozinho). Itens já ordenados por
// horário (a query abaixo ordena). Presença confirmada (Fase 19) em texto
// nos dois casos. Atendimento domiciliar leva o endereço completo junto —
// só ele tem `home_visit_address` preenchido (ver Fase 16 no plano).
function buildListText(rows: AppointmentRow[]): string {
  return rows
    .map((row) => {
      const presence = row.patient_confirmed_at ? "(✅ confirmado)" : "(sem confirmação)";
      const base = `▪️ ${formatTimeFortaleza(new Date(row.scheduled_at))} - ${patientName(row)} ${presence}`;
      return row.home_visit_address ? `${base} - Endereço: ${row.home_visit_address}` : base;
    })
    .join(" ");
}

async function fetchDayAppointments(supabase: SupabaseClient, targetDate: string) {
  const dayStart = new Date(`${targetDate}T00:00:00-03:00`);
  const dayEnd = new Date(`${addDays(targetDate, 1)}T00:00:00-03:00`);
  return supabase
    .from("appointments")
    .select("id, scheduled_at, appointment_type, home_visit_address, patient_confirmed_at, patients ( full_name )")
    .in("status", ["scheduled", "confirmed"])
    .gte("scheduled_at", dayStart.toISOString())
    .lt("scheduled_at", dayEnd.toISOString())
    .order("scheduled_at");
}

function splitByKind(rows: AppointmentRow[]): Record<SummaryKind, AppointmentRow[]> {
  return {
    consultas: rows.filter((a) => a.appointment_type === "first_visit" || a.appointment_type === "return_visit"),
    exames: rows.filter((a) => a.appointment_type === "exam"),
  };
}

// Agendador: quais resumos de hoje estão na hora (ou precisam ser reenviados
// porque o início do dia ficou mais cedo).
async function dueKinds(
  supabase: SupabaseClient,
  targetDate: string,
  lists: Record<SummaryKind, AppointmentRow[]>,
  now: Date
): Promise<{ kinds: SummaryKind[]; resent: SummaryKind[] }> {
  const kinds: SummaryKind[] = [];
  const resent: SummaryKind[] = [];
  const pending = (Object.keys(lists) as SummaryKind[]).filter((kind) => lists[kind].length > 0);
  if (pending.length === 0) return { kinds, resent };

  const [starts, { data: sends }] = await Promise.all([
    fetchFirstWindowStarts(supabase),
    supabase
      .from("daily_summary_sends")
      .select("kind, first_scheduled_at")
      .eq("summary_date", targetDate)
      .order("sent_at", { ascending: false }),
  ]);
  const weekday = weekdayOf(targetDate);

  for (const kind of pending) {
    const firstAt = new Date(lists[kind][0].scheduled_at);
    const lastSend = (sends ?? []).find((row) => row.kind === kind);
    if (lastSend) {
      if (firstAt.getTime() < Date.parse(lastSend.first_scheduled_at as string)) {
        kinds.push(kind);
        resent.push(kind);
      }
    } else if (now >= computeSummarySendAt(targetDate, starts[kind][weekday], firstAt)) {
      kinds.push(kind);
    }
  }
  return { kinds, resent };
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
  const scheduled = send === "final" && url.searchParams.get("trigger") === "scheduled";

  const supabase = createServiceClient();
  const targetDate = send === "preview" ? addDays(todayFortaleza(), 1) : todayFortaleza();

  // Agendador: decide antes de abrir `job_runs` — as chamadas de 5 em 5
  // minutos fora da hora não deixam rastro.
  let kindsToSend: SummaryKind[] = ["consultas", "exames"];
  let resentKinds: SummaryKind[] = [];
  let preloaded: AppointmentRow[] | null = null;
  if (scheduled) {
    const { data, error } = await fetchDayAppointments(supabase, targetDate);
    if (error) return json({ error: error.message }, 500);
    preloaded = (data ?? []) as AppointmentRow[];
    const due = await dueKinds(supabase, targetDate, splitByKind(preloaded), new Date());
    if (due.kinds.length === 0) return json({ skipped: "fora_do_horario", targetDate });
    kindsToSend = due.kinds;
    resentKinds = due.resent;
  }

  const runId = await startJobRun(supabase, "daily_summary", send);

  const totals = {
    consultas: 0,
    exames: 0,
    sent: 0,
    failed: 0,
    not_sent_no_template: 0,
    lists_without_recipient: 0,
    resent_earlier_start: resentKinds.length,
  };

  try {
    let active = preloaded;
    if (!active) {
      const { data, error } = await fetchDayAppointments(supabase, targetDate);
      if (error) {
        await finishJobRun(supabase, runId, { totals, error: error.message });
        return json({ error: error.message }, 500);
      }
      active = (data ?? []) as AppointmentRow[];
    }

    const lists = splitByKind(active);
    if (kindsToSend.includes("consultas")) totals.consultas = lists.consultas.length;
    if (kindsToSend.includes("exames")) totals.exames = lists.exames.length;

    const results: Record<string, string> = {};

    const sendList = async (kind: SummaryKind, rows: AppointmentRow[], templateName: string | undefined) => {
      if (rows.length === 0) return;
      const { data: recipients } = await supabase
        .from("notification_recipients")
        .select("phone")
        .eq("is_active", true)
        .eq(kind === "consultas" ? "receives_consultas" : "receives_exames", true);

      if (!recipients?.length) {
        console.warn(`[cron daily-summary] sem destinatário ativo para resumo de ${kind} — não enviado.`);
        totals.lists_without_recipient++;
      } else {
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
      }

      // Resumo do dia: registra a tentativa (mesmo com falha, template
      // desligado ou sem destinatário) — o agendador não repete de 5 em 5
      // minutos; o problema aparece em Envios.
      if (send === "final") {
        const { error } = await supabase.from("daily_summary_sends").insert({
          summary_date: targetDate,
          kind,
          first_scheduled_at: rows[0].scheduled_at,
        });
        if (error) console.error("[cron daily-summary] erro ao registrar envio:", kind, error.message);
      }
    };

    const templates =
      send === "preview"
        ? {
            consultas: import.meta.env.WHATSAPP_TEMPLATE_DAILY_SUMMARY_CONSULTAS,
            exames: import.meta.env.WHATSAPP_TEMPLATE_DAILY_SUMMARY_EXAMES,
          }
        : {
            consultas: import.meta.env.WHATSAPP_TEMPLATE_DAILY_SUMMARY_CONSULTAS_TODAY,
            exames: import.meta.env.WHATSAPP_TEMPLATE_DAILY_SUMMARY_EXAMES_TODAY,
          };
    for (const kind of kindsToSend) {
      await sendList(kind, lists[kind], templates[kind]);
    }

    await finishJobRun(supabase, runId, { totals });
    return json({ send, targetDate, kinds: kindsToSend, ...totals, results });
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
