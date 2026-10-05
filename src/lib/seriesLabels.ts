import type { SkipReason } from "./data/agenda/series";

// Textos das séries recorrentes (D9) nas telas (F4.6).

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  holiday: "Feriado",
  block: "Agenda bloqueada",
  conflict: "Horário ocupado",
};

/** 1 → "Toda semana"; 2 → "A cada 2 semanas (quinzenal)"; N → "A cada N semanas". */
export function frequencyLabel(intervalWeeks: number): string {
  if (intervalWeeks === 1) return "Toda semana";
  if (intervalWeeks === 2) return "A cada 2 semanas (quinzenal)";
  return `A cada ${intervalWeeks} semanas`;
}

/** Fim da série em palavras. */
export function seriesEndLabel(series: { endsOn: string | null; maxSessions: number | null }): string {
  if (series.endsOn) return `até ${series.endsOn.split("-").reverse().join("/")}`;
  if (series.maxSessions) return `${series.maxSessions} sessões`;
  return "sem data para terminar";
}
