import type { SupabaseClient } from "@supabase/supabase-js";
import { isNationalHoliday } from "./holidays";

// Horário do resumo do dia da manhã (Fase 22, ajuste de 30/set/2026): 1h
// antes do início dos atendimentos do dia, pela tela Disponibilidade —
// consultas pelas janelas de todos os locais ativos (domiciliar incluso),
// exames pelas janelas dos tipos de exame ativos. Decisões do cliente:
//   - várias janelas no dia → 1h antes da primeira (um envio, dia inteiro);
//   - atendimento antes da primeira janela → 1h antes dele;
//   - dia sem janela daquele tipo (ou feriado) → reserva às 6h30.

export type SummaryKind = "consultas" | "exames";

export const SUMMARY_LEAD_MINUTES = 60;
export const SUMMARY_FALLBACK_TIME = "06:30";

const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Primeira janela ("HH:MM") de cada dia da semana (0 = domingo); null = sem janela. */
export type FirstWindowStarts = Record<SummaryKind, (string | null)[]>;

function earliestByWeekday(rows: { weekday: number; start_time: string }[]): (string | null)[] {
  const result: (string | null)[] = Array(7).fill(null);
  for (const row of rows) {
    const time = row.start_time.slice(0, 5);
    const current = result[row.weekday];
    if (current === null || time < current) result[row.weekday] = time;
  }
  return result;
}

export async function fetchFirstWindowStarts(supabase: SupabaseClient): Promise<FirstWindowStarts> {
  const [{ data: consultaWindows }, { data: examWindows }] = await Promise.all([
    supabase
      .from("availability_windows")
      .select("weekday, start_time, clinic_locations!inner ( is_active )")
      .eq("is_active", true)
      .eq("clinic_locations.is_active", true),
    supabase
      .from("exam_type_availability_windows")
      .select("weekday, start_time, exam_types!inner ( is_active )")
      .eq("is_active", true)
      .eq("exam_types.is_active", true),
  ]);
  return {
    consultas: earliestByWeekday(consultaWindows ?? []),
    exames: earliestByWeekday(examWindows ?? []),
  };
}

/** Dia da semana (0 = domingo) de uma data "yyyy-mm-dd". */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

/**
 * Quando sai o resumo da manhã de `isoDate` para um tipo: 1h antes do que
 * vier primeiro entre a primeira janela do dia e o primeiro atendimento; sem
 * janela (ou feriado nacional), 6h30 — ou 1h antes do primeiro atendimento,
 * se ele for antes das 7h30.
 */
export function computeSummarySendAt(
  isoDate: string,
  windowStart: string | null,
  firstAppointmentAt: Date
): Date {
  const leadMs = SUMMARY_LEAD_MINUTES * 60_000;
  const beforeFirst = firstAppointmentAt.getTime() - leadMs;
  const usableWindow = isNationalHoliday(isoDate) ? null : windowStart;
  const base = usableWindow
    ? new Date(`${isoDate}T${usableWindow}:00-03:00`).getTime() - leadMs
    : new Date(`${isoDate}T${SUMMARY_FALLBACK_TIME}:00-03:00`).getTime();
  // Nunca antes da 0h do próprio dia (achado 5 da F1, cliente, 05/out/2026).
  const dayStart = new Date(`${isoDate}T00:00:00-03:00`).getTime();
  return new Date(Math.max(dayStart, Math.min(base, beforeFirst)));
}

/** "13:00" → "12h"; "13:30" → "12h30" (1h antes da janela); antes de 1h → "0h". */
function formatLeadTime(windowStart: string): string {
  const [hours, minutes] = windowStart.split(":").map(Number);
  const total = Math.max(0, hours * 60 + minutes - SUMMARY_LEAD_MINUTES);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** "seg 7h · ter 12h · qui 7h" — dias sem janela ficam de fora. */
export function describeSummarySchedule(starts: (string | null)[]): string {
  const parts = starts
    .map((start, weekday) => (start ? `${WEEKDAY_LABELS[weekday]} ${formatLeadTime(start)}` : null))
    .filter((part): part is string => part !== null);
  return parts.length ? parts.join(" · ") : "nenhuma janela cadastrada";
}
