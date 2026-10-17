// Textos das confirmações do Marcar, da série e do Remarcar (cliente,
// 17/out/2026; S-01 do teste da R0 a R4): dizem o dia, o horário, com quem e
// onde, e, na série, a frequência, o começo e até quando. Usados no servidor
// (texto de cada horário) e no navegador (a série muda com o formulário).
import { frequencyLabel } from "./seriesLabels";

const WEEKDAYS_PLURAL = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"];

/** "AAAA-MM-DD" → "dd/MM" (com o ano quando não é o de `reference`). */
function shortDate(date: string, reference?: string): string {
  const [year, month, day] = date.split("-");
  return reference && reference.slice(0, 4) !== year ? `${day}/${month}/${year}` : `${day}/${month}`;
}

/** Horário escolhido: "terça-feira, 20/10 às 09:00, com Rafael Lima (Consultório Centro)". */
export function slotConfirmText(when: string, agenda: string, location: string): string {
  return `${when.charAt(0).toLowerCase()}${when.slice(1)}, com ${agenda} (${location})`;
}

/** Começo da série: "às terças, 09:00, com Rafael Lima (Consultório Centro), a partir de 20/10". */
export function seriesStartText(date: string, time: string, agenda: string, location: string): string {
  const weekday = WEEKDAYS_PLURAL[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return `às ${weekday}, ${time}, com ${agenda} (${location}), a partir de ${shortDate(date)}`;
}

export interface SeriesEnd {
  /** Opção "Até quando" do formulário. */
  fim: "sem_fim" | "data" | "sessoes";
  endsOn?: string;
  maxSessions?: string;
}

/** Fim da série: "até 15/12", "com 10 sessões" ou "sem data para terminar (…)". */
export function seriesEndText(end: SeriesEnd, startDate: string, horizonMonths: number): string {
  if (end.fim === "data") return end.endsOn ? `até ${shortDate(end.endsOn, startDate)}` : "até o dia escolhido";
  if (end.fim === "sessoes") {
    const n = Number(end.maxSessions);
    if (!Number.isInteger(n) || n < 1) return "com o número de sessões escolhido";
    return n === 1 ? "com 1 sessão" : `com ${n} sessões`;
  }
  return `sem data para terminar (ficam marcadas as sessões dos próximos ${horizonMonths} meses)`;
}

/** Confirmação da série inteira. */
export function seriesConfirmMessage(input: {
  /** "Ana Souza: Consulta pediátrica". */
  intro: string;
  intervalWeeks: number;
  start: string;
  end: string;
}): string {
  const frequency = frequencyLabel(input.intervalWeeks);
  return (
    `${input.intro}, ${frequency.charAt(0).toLowerCase()}${frequency.slice(1)} ${input.start}, ${input.end}. ` +
    "Feriado, bloqueio ou horário ocupado: a data é pulada e aparece na tela da série. O paciente é avisado pelo WhatsApp."
  );
}
