import { addDays, formatCalendarDate, weekdayOf } from "./clinicTime";

// Regras puras dos indicadores das Métricas (redesign de 22/out/2026, M2):
// taxa só com base suficiente, comparação com o mesmo período do mês
// anterior, agrupamento por semana. Testadas em metricsRules.test.ts.

/** Decisão 9: taxa em % e variação só com base de 20 ou mais; abaixo, "X de Y". */
export const MIN_BASE = 20;

/** Com mais de 10% sem registro, o comparecimento ganha o selo "Parcial". */
export const PARTIAL_SHARE = 0.1;

export type Ratio = {
  n: number;
  base: number;
  /** null quando a base é zero: nunca "0%" sem nada medido. */
  rate: number | null;
  /** Base suficiente para mostrar a porcentagem. */
  enough: boolean;
};

export function ratio(n: number, base: number): Ratio {
  return { n, base, rate: base > 0 ? n / base : null, enough: base >= MIN_BASE };
}

/** "88%", "7,6%"; abaixo de 10% com uma casa. */
export function formatRate(rate: number): string {
  const pct = rate * 100;
  const text = pct > 0 && pct < 10 && Math.round(pct) !== pct ? pct.toFixed(1) : String(Math.round(pct));
  return `${text.replace(".", ",")}%`;
}

/** "88%" com base suficiente; "11 de 12" abaixo dela. */
export function formatRatio(r: Ratio): string {
  if (r.base === 0) return "—";
  return r.enough ? formatRate(r.rate!) : `${r.n} de ${r.base}`;
}

// ---------------------------------------------------------------------------
// Comparação (decisão 8): o mesmo período, em quantidade de dias, do mês anterior
// ---------------------------------------------------------------------------

export type DateRange = { from: string; to: string };

export function daysIn(range: DateRange): number {
  let n = 1;
  for (let d = range.from; d < range.to; d = addDays(d, 1)) n++;
  return n;
}

/** 1 a 22/out → 1 a 22/set; o dia que não existe no mês anterior vira o último dele. */
export function comparisonRange(range: DateRange): DateRange {
  const [year, month, day] = range.from.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const prevMonth = new Date(Date.UTC(year, month - 2, Math.min(day, lastDay)));
  const from = prevMonth.toISOString().slice(0, 10);
  return { from, to: addDays(from, daysIn(range) - 1) };
}

/** "1 a 22/set (mesmos 22 dias)", "22/set (mesmo dia)". */
export function describeComparison(range: DateRange): string {
  const days = daysIn(range);
  const span =
    days === 1
      ? formatCalendarDate(range.from, "d/MMM")
      : range.from.slice(0, 7) === range.to.slice(0, 7)
        ? `${Number(range.from.slice(8))} a ${formatCalendarDate(range.to, "d/MMM")}`
        : `${formatCalendarDate(range.from, "d/MMM")} a ${formatCalendarDate(range.to, "d/MMM")}`;
  return `${span} (${days === 1 ? "mesmo dia" : `mesmos ${days} dias`})`;
}

export type Direction = "up" | "down" | "flat";

export type CountComparison = { previous: number; diff: number; pct: number | null; direction: Direction };

/** Quantidades: variação em % só com as duas bases ≥ 20; abaixo, só o número anterior. */
export function compareCounts(current: number, previous: number): CountComparison {
  const diff = current - previous;
  const pct = current >= MIN_BASE && previous >= MIN_BASE ? diff / previous : null;
  const flat = pct !== null ? Math.abs(pct) < 0.01 : diff === 0;
  return { previous, diff, pct, direction: flat ? "flat" : diff > 0 ? "up" : "down" };
}

export type RateComparison = { previous: Ratio; points: number | null; direction: Direction };

/** Taxas: diferença em pontos só com as duas bases ≥ 20. */
export function compareRates(current: Ratio, previous: Ratio): RateComparison {
  if (!current.enough || !previous.enough || current.rate === null || previous.rate === null) return { previous, points: null, direction: "flat" };
  const points = (current.rate - previous.rate) * 100;
  return { previous, points, direction: Math.abs(points) < 1 ? "flat" : points > 0 ? "up" : "down" };
}

// ---------------------------------------------------------------------------
// Agrupamento por dia ou semana (semanas de segunda a domingo, cortadas no período)
// ---------------------------------------------------------------------------

export type Bucket = { from: string; to: string; label: string; partial: boolean };

/** Até 14 dias, por dia; acima, por semana. */
export function defaultGrouping(range: DateRange): "day" | "week" {
  return daysIn(range) <= 14 ? "day" : "week";
}

export function buckets(range: DateRange, grouping: "day" | "week", today: string): Bucket[] {
  const out: Bucket[] = [];
  let from = range.from;
  while (from <= range.to) {
    let to = from;
    if (grouping === "week") {
      const toSunday = (7 - weekdayOf(from)) % 7;
      to = addDays(from, toSunday);
      if (to > range.to) to = range.to;
    }
    const label =
      from === to
        ? formatCalendarDate(from, "dd/MM")
        : from.slice(0, 7) === to.slice(0, 7)
          ? `${Number(from.slice(8))} a ${formatCalendarDate(to, "dd/MM")}`
          : `${formatCalendarDate(from, "dd/MM")} a ${formatCalendarDate(to, "dd/MM")}`;
    // Em curso: a faixa ainda não terminou (os números podem crescer).
    out.push({ from, to, label, partial: from <= today && today <= to });
    from = addDays(to, 1);
  }
  return out;
}

/** Soma os campos numéricos das linhas diárias em cada faixa. */
export function sumByBucket<T extends { day: string }, K extends keyof T>(rows: T[], list: Bucket[], keys: K[]): Record<K, number>[] {
  return list.map((b) => {
    const total = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
    for (const row of rows) {
      if (row.day < b.from || row.day > b.to) continue;
      for (const k of keys) total[k] += Number(row[k]) || 0;
    }
    return total;
  });
}
