import { addDays, dayBounds, formatCalendarDate, isCalendarDate, todayIn } from "./clinicTime";

// Período das Métricas (F4.9; Fase 23 do piloto): atalhos e intervalo
// personalizado, lidos do endereço (`?periodo=…&de=…&ate=…`), no fuso da
// clínica. Abre em "Hoje" (decisão do cliente no piloto).

export type PeriodPreset = "hoje" | "7dias" | "mes" | "mes_anterior" | "personalizado";

export const PERIOD_PRESETS: { id: Exclude<PeriodPreset, "personalizado">; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "7dias", label: "7 dias" },
  { id: "mes", label: "Este mês" },
  { id: "mes_anterior", label: "Mês anterior" },
];

/** Intervalo personalizado longo deixa a tela lenta. */
export const MAX_CUSTOM_DAYS = 366;

export type MetricsPeriod = {
  preset: PeriodPreset;
  /** Dias inclusivos, "AAAA-MM-DD". */
  from: string;
  to: string;
  /** Instantes para as consultas: [start, end). */
  start: Date;
  end: Date;
  label: string;
  /** Intervalo personalizado inválido caiu em "Hoje". */
  invalid: boolean;
  /** Por que o personalizado é inválido (R7, QA-04): datas faltando, De depois de Até ou longo demais. */
  invalidReason: InvalidPeriodReason | null;
  /** As datas pedidas no endereço, para os campos De e Até voltarem como digitados (R7, FORM-01). */
  requested: { from: string; to: string } | null;
};

export type InvalidPeriodReason = "missing" | "order" | "too_long";

/** Texto do erro do período personalizado, para a equipe. */
export const INVALID_PERIOD_MESSAGES: Record<InvalidPeriodReason, string> = {
  missing: "Informe as duas datas.",
  order: "A data De é depois da data Até.",
  too_long: `O período passa de ${MAX_CUSTOM_DAYS} dias.`,
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function monthOf(date: string, delta: number): { from: string; to: string } {
  const [year, month] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + delta, 1));
  const last = new Date(Date.UTC(year, month + delta, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export function parsePeriod(params: URLSearchParams, timeZone: string, now: Date = new Date()): MetricsPeriod {
  const today = todayIn(timeZone, now);
  const build = (preset: PeriodPreset, from: string, to: string, label: string, invalidReason: InvalidPeriodReason | null = null, requested: MetricsPeriod["requested"] = null): MetricsPeriod => ({
    preset,
    from,
    to,
    start: dayBounds(from, timeZone).start,
    end: dayBounds(to, timeZone).end,
    label,
    invalid: invalidReason !== null,
    invalidReason,
    requested,
  });
  const todayLabel = `Hoje, ${formatCalendarDate(today, "dd/MM/yyyy")}`;
  switch (params.get("periodo")) {
    case "7dias": {
      const from = addDays(today, -6);
      return build("7dias", from, today, `Últimos 7 dias (${formatCalendarDate(from, "dd/MM")} a ${formatCalendarDate(today, "dd/MM")})`);
    }
    case "mes": {
      // Mês inteiro: inclui o que já está marcado para os próximos dias.
      const { from, to } = monthOf(today, 0);
      return build("mes", from, to, capitalize(formatCalendarDate(from, "MMMM 'de' yyyy")));
    }
    case "mes_anterior": {
      const { from, to } = monthOf(today, -1);
      return build("mes_anterior", from, to, capitalize(formatCalendarDate(from, "MMMM 'de' yyyy")));
    }
    case "personalizado": {
      const from = params.get("de") ?? "";
      const to = params.get("ate") ?? "";
      const reason: InvalidPeriodReason | null =
        !isCalendarDate(from) || !isCalendarDate(to) ? "missing" : from > to ? "order" : addDays(from, MAX_CUSTOM_DAYS - 1) < to ? "too_long" : null;
      if (reason) return build("hoje", today, today, todayLabel, reason, { from, to });
      const label = from === to ? formatCalendarDate(from, "dd/MM/yyyy") : `${formatCalendarDate(from, "dd/MM/yyyy")} a ${formatCalendarDate(to, "dd/MM/yyyy")}`;
      return build("personalizado", from, to, label, null, { from, to });
    }
    default:
      return build("hoje", today, today, todayLabel);
  }
}
