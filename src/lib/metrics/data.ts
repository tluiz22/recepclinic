import type { SupabaseClient } from "@supabase/supabase-js";
import type { FunnelEventRow } from "./whatsappFunnel";
import { funnelFilterExpression, type MetricsFilter } from "./filter";
import {
  buildReminderResponseReport,
  type ReminderResponseReport,
  type ReminderSentRow,
  type ReminderTapRow,
} from "./reminderResponses";

// Leituras e formatação compartilhadas pelas abas de Métricas (Fase 23 ·
// etapa 4) e pela aba Lembretes de Consultas. Cada aba busca só o que exibe.

// O Supabase devolve no máximo 1000 linhas por consulta.
const PAGE = 1000;

export async function fetchAllRows<T>(
  label: string,
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) {
      console.error(`[metricas] erro ao ler ${label}:`, error.message);
      break;
    }
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Eventos do funil das tentativas iniciadas no período. Busca 1 dia a mais:
// tentativa iniciada no fim do período ainda pode ter passos na página logo
// depois (o link vale 30min).
// Com filtro (etapa 8), só os eventos do responsável escolhido (ou do
// responsável do paciente escolhido).
export function fetchFunnelEvents(
  supabase: SupabaseClient,
  start: Date,
  end: Date,
  filter: MetricsFilter | null = null
): Promise<FunnelEventRow[]> {
  const eventsEnd = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return fetchAllRows<FunnelEventRow>("bot_funnel_events", (from, to) => {
    let query = supabase
      .from("bot_funnel_events")
      .select("session_id, flow, step, source, guardian_phone, guardian_id, metadata, occurred_at")
      .gte("occurred_at", start.toISOString())
      .lt("occurred_at", eventsEnd.toISOString());
    if (filter) query = query.or(funnelFilterExpression(filter));
    return query.order("occurred_at", { ascending: true }).range(from, to);
  });
}

export function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

// "02/10 às 14h05", no fuso de Fortaleza.
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(":", "h");
  return `${day} às ${time}`;
}

// Lembretes com botões enviados em [start, end) e a resposta de cada um
// (aba Lembretes de Consultas e cartão "Presença não confirmada" do Início).
// Só lembretes do layout novo (com a frase dos botões) que a Meta aceitou —
// os antigos, sem botões, nunca teriam resposta. Toques e lembretes
// seguintes são lidos desde `start`: a resposta pode vir depois do fim.
export async function fetchReminderResponseReport(
  supabase: SupabaseClient,
  start: Date,
  end: Date
): Promise<ReminderResponseReport> {
  const [remindersSinceStart, taps] = await Promise.all([
    fetchAllRows<ReminderSentRow>("whatsapp_messages", (from, to) =>
      supabase
        .from("whatsapp_messages")
        .select("appointment_id, created_at")
        .eq("message_type", "appointment_reminder")
        .in("status", ["sent", "delivered", "read"])
        .like("body", "%confirme sua presença%")
        .gte("created_at", start.toISOString())
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<ReminderTapRow>("whatsapp_messages", (from, to) =>
      supabase
        .from("whatsapp_messages")
        .select("appointment_id, message_type, created_at")
        .in("message_type", ["reminder_confirm", "reminder_reschedule", "reminder_cancel"])
        .gte("created_at", start.toISOString())
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
  ]);

  return buildReminderResponseReport(
    remindersSinceStart.filter((row) => Date.parse(row.created_at) < end.getTime()),
    remindersSinceStart,
    taps
  );
}
