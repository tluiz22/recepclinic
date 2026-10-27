import { addDays, isClockTime, localDateOf, localTimeOf, toInstant, weekdayOf } from "./clinicTime";
import { isNationalHoliday } from "./holidays";

// Horário da recepção (F8.5b, cliente, 27/out/2026): um intervalo por dia da
// semana (0 = domingo … 6 = sábado) ou fechado; nos feriados (nacionais e da
// clínica) a recepção não atende. Enquanto a clínica não salva, vale o
// sugerido pelos horários das agendas. Regras puras, no fuso da clínica.

export type ReceptionDay = { open: string; close: string } | null;
/** Sempre 7 posições, de domingo a sábado. */
export type ReceptionHours = ReceptionDay[];

export const WEEKDAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

/** Sugestão pelos horários ativos das agendas: o primeiro e o último horário de cada dia. */
export function suggestReceptionHours(windows: { weekday: number; startTime: string; endTime: string }[]): ReceptionHours {
  const hours: ReceptionHours = Array.from({ length: 7 }, () => null);
  for (const window of windows) {
    const start = window.startTime.slice(0, 5);
    const end = window.endTime.slice(0, 5);
    const day = hours[window.weekday];
    hours[window.weekday] = day ? { open: start < day.open ? start : day.open, close: end > day.close ? end : day.close } : { open: start, close: end };
  }
  return hours;
}

/** Erros por dia (índice do dia → mensagem); vazio = válido. */
export function validateReceptionHours(hours: ReceptionHours): Record<number, string> {
  const errors: Record<number, string> = {};
  if (hours.length !== 7) return { 0: "Horário da recepção incompleto." };
  hours.forEach((day, index) => {
    if (!day) return;
    if (!isClockTime(day.open) || !isClockTime(day.close)) errors[index] = `${WEEKDAY_NAMES[index]}: informe a abertura e o fechamento.`;
    else if (day.open >= day.close) errors[index] = `${WEEKDAY_NAMES[index]}: o fechamento precisa ser depois da abertura.`;
  });
  return errors;
}

const isClosedDate = (date: string, hours: ReceptionHours, clinicHolidays: Set<string>) =>
  !hours[weekdayOf(date)] || isNationalHoliday(date) || clinicHolidays.has(date);

/** A recepção atende neste instante? */
export function isReceptionOpen(hours: ReceptionHours, instant: Date, timeZone: string, clinicHolidays: Set<string>): boolean {
  const date = localDateOf(instant, timeZone);
  if (isClosedDate(date, hours, clinicHolidays)) return false;
  const day = hours[weekdayOf(date)]!;
  const time = localTimeOf(instant, timeZone);
  return time >= day.open && time < day.close;
}

/** Próxima abertura a partir deste instante (ele mesmo, se já estiver aberta); null = nenhuma em 14 dias. */
export function nextReceptionOpening(hours: ReceptionHours, instant: Date, timeZone: string, clinicHolidays: Set<string>): Date | null {
  if (isReceptionOpen(hours, instant, timeZone, clinicHolidays)) return instant;
  const today = localDateOf(instant, timeZone);
  for (let offset = 0; offset <= 14; offset++) {
    const date = addDays(today, offset);
    if (isClosedDate(date, hours, clinicHolidays)) continue;
    const opening = toInstant(date, hours[weekdayOf(date)]!.open, timeZone);
    if (opening.getTime() > instant.getTime()) return opening;
  }
  return null;
}

/** Resumo para a tela, juntando dias seguidos com o mesmo horário: "Seg a Sex 08:00–18:00 · Sáb 08:00–12:00". */
export function describeReceptionHours(hours: ReceptionHours): string {
  // Segunda primeiro, domingo no fim (como a clínica lê a semana).
  const order = [1, 2, 3, 4, 5, 6, 0];
  const parts: string[] = [];
  let i = 0;
  while (i < order.length) {
    const day = hours[order[i]];
    if (!day) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < order.length && hours[order[j + 1]]?.open === day.open && hours[order[j + 1]]?.close === day.close) j++;
    const span = j > i ? `${WEEKDAY_SHORT[order[i]]} a ${WEEKDAY_SHORT[order[j]]}` : WEEKDAY_SHORT[order[i]];
    parts.push(`${span} ${day.open}–${day.close}`);
    i = j + 1;
  }
  return parts.length ? parts.join(" · ") : "Fechada todos os dias";
}
