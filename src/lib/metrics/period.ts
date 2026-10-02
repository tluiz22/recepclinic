// Período das Métricas (Fase 23 · etapa 4): atalhos e intervalo
// personalizado, lidos da URL (`?periodo=…&de=…&ate=…`). Datas no fuso de
// Fortaleza (UTC-3, sem horário de verão). Abre em "Hoje" (decisão do
// cliente).

export type PeriodPreset = "hoje" | "7dias" | "mes" | "mes_anterior" | "personalizado";

export const PERIOD_PRESETS: { id: Exclude<PeriodPreset, "personalizado">; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "7dias", label: "7 dias" },
  { id: "mes", label: "Este mês" },
  { id: "mes_anterior", label: "Mês anterior" },
];

// Intervalo personalizado longo deixa a tela lenta (eventos do funil).
const MAX_CUSTOM_DAYS = 366;

export interface MetricsPeriod {
  preset: PeriodPreset;
  // Dias inclusivos, "AAAA-MM-DD".
  from: string;
  to: string;
  // Instantes para as consultas: [start, end).
  start: Date;
  end: Date;
  label: string;
  // Intervalo personalizado inválido caiu em "Hoje".
  invalid: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayFortaleza(now = new Date()): string {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function startOfDay(day: string): Date {
  return new Date(`${day}T00:00:00-03:00`);
}

function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

function formatDayShort(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}/${month}`;
}

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function monthBounds(year: number, monthIndex: number): { from: string; to: string } {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

function build(preset: PeriodPreset, from: string, to: string, label: string, invalid = false): MetricsPeriod {
  return { preset, from, to, start: startOfDay(from), end: startOfDay(addDays(to, 1)), label, invalid };
}

export function parsePeriod(params: URLSearchParams, now = new Date()): MetricsPeriod {
  const today = todayFortaleza(now);
  const [year, month] = today.split("-").map(Number);
  const preset = params.get("periodo");

  const todayPeriod = (invalid = false) => build("hoje", today, today, `Hoje, ${formatDay(today)}`, invalid);

  switch (preset) {
    case "7dias": {
      const from = addDays(today, -6);
      return build("7dias", from, today, `Últimos 7 dias (${formatDayShort(from)} a ${formatDayShort(today)})`);
    }
    case "mes": {
      // Mês inteiro, como a antiga tela Relatórios: inclui o que já está
      // marcado para os próximos dias.
      const { from, to } = monthBounds(year, month - 1);
      return build("mes", from, to, `${capitalize(MONTH_NAMES[month - 1])} de ${year}`);
    }
    case "mes_anterior": {
      const { from, to } = monthBounds(year, month - 2);
      const [prevYear, prevMonth] = from.split("-").map(Number);
      return build("mes_anterior", from, to, `${capitalize(MONTH_NAMES[prevMonth - 1])} de ${prevYear}`);
    }
    case "personalizado": {
      const from = params.get("de") ?? "";
      const to = params.get("ate") ?? "";
      if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return todayPeriod(true);
      const days = (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000 + 1;
      if (days > MAX_CUSTOM_DAYS) return todayPeriod(true);
      const label = from === to ? formatDay(from) : `${formatDay(from)} a ${formatDay(to)}`;
      return build("personalizado", from, to, label);
    }
    default:
      return todayPeriod();
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Parâmetros da URL que mantêm o período ao trocar de aba. */
export function periodParams(period: MetricsPeriod): Record<string, string> {
  if (period.preset === "hoje") return {};
  if (period.preset === "personalizado") return { periodo: "personalizado", de: period.from, ate: period.to };
  return { periodo: period.preset };
}

export function metricsUrl(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/admin/metricas?${query}` : "/admin/metricas";
}
