import { TZDate, tzOffset } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// Datas e horas no fuso de cada clínica (L40, D4b).
//
// Convenção do código novo:
//   - instante (Date): um momento absoluto, como o banco guarda em timestamptz;
//   - data do calendário ("YYYY-MM-DD") e hora ("HH:mm"): como a clínica lê no
//     relógio dela, sempre acompanhadas do fuso (`clinic_settings.timezone`).
// Nada de "-03:00" fixo: o fuso vem da clínica.

export const DEFAULT_TIMEZONE = "America/Fortaleza";

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Fuso IANA reconhecido pelo ambiente (ex.: "America/Fortaleza"). */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** "YYYY-MM-DD" de um dia que existe no calendário (recusa 31/02 e mês 13). */
export function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** "HH:mm" entre 00:00 e 23:59. */
export function isClockTime(value: string): boolean {
  return CLOCK_TIME.test(value);
}

function assertTimeZone(timeZone: string): void {
  if (!isValidTimeZone(timeZone)) throw new RangeError(`Fuso horário inválido: ${timeZone}`);
}

function parseCalendarDate(value: string): [number, number, number] {
  if (!isCalendarDate(value)) throw new RangeError(`Data inválida: ${value}`);
  const [year, month, day] = value.split("-").map(Number);
  return [year, month, day];
}

function inZone(instant: Date, timeZone: string): TZDate {
  assertTimeZone(timeZone);
  return new TZDate(instant.getTime(), timeZone);
}

/** Data do calendário da clínica naquele instante. */
export function localDateOf(instant: Date, timeZone: string): string {
  return format(inZone(instant, timeZone), "yyyy-MM-dd");
}

/** Hora do relógio da clínica naquele instante ("HH:mm"). */
export function localTimeOf(instant: Date, timeZone: string): string {
  return format(inZone(instant, timeZone), "HH:mm");
}

/** Hora cheia do relógio da clínica (0–23). */
export function localHourOf(instant: Date, timeZone: string): number {
  return inZone(instant, timeZone).getHours();
}

/** Hoje, no calendário da clínica. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localDateOf(now, timeZone);
}

/**
 * Instante em que o relógio da clínica marca `date` às `time`.
 * Num fuso com horário de verão, uma hora que não existe (o relógio pula)
 * vai para a hora seguinte, e uma hora repetida fica com a primeira vez.
 */
export function toInstant(date: string, time: string, timeZone: string): Date {
  assertTimeZone(timeZone);
  const [year, month, day] = parseCalendarDate(date);
  if (!isClockTime(time)) throw new RangeError(`Hora inválida: ${time}`);
  const [hours, minutes] = time.split(":").map(Number);
  // Conta própria em vez do construtor do TZDate: na hora repetida ele escolhe
  // a 1ª ou a 2ª vez conforme o fuso do servidor.
  const wallClock = Date.UTC(year, month - 1, day, hours, minutes);
  const offsetBefore = tzOffset(timeZone, new Date(wallClock - DAY_MS)) * MINUTE_MS;
  const offsetAfter = tzOffset(timeZone, new Date(wallClock + DAY_MS)) * MINUTE_MS;
  const matches = [wallClock - offsetBefore, wallClock - offsetAfter].filter(
    (candidate) => candidate + tzOffset(timeZone, new Date(candidate)) * MINUTE_MS === wallClock,
  );
  // Nenhuma: a hora não existe (o relógio pulou); com o fuso de antes do pulo
  // ela cai adiantada pelo tamanho do pulo.
  return new Date(matches.length ? Math.min(...matches) : wallClock - offsetBefore);
}

/**
 * Começo e fim (exclusivo) do dia `date` no fuso da clínica, para consultas
 * do tipo `scheduled_at >= start and scheduled_at < end`.
 */
export function dayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  return { start: toInstant(date, "00:00", timeZone), end: toInstant(addDays(date, 1), "00:00", timeZone) };
}

/** Soma dias a uma data do calendário (não depende de fuso). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = parseCalendarDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Dia da semana de uma data do calendário: 0 = domingo … 6 = sábado. */
export function weekdayOf(date: string): number {
  const [year, month, day] = parseCalendarDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Formata um instante no relógio da clínica, em português (padrões do date-fns). */
export function formatInstant(instant: Date, timeZone: string, pattern: string): string {
  return format(inZone(instant, timeZone), pattern, { locale: ptBR });
}

/** Formata uma data do calendário em português (ex.: "EEEE, dd/MM/yyyy"). */
export function formatCalendarDate(date: string, pattern: string): string {
  const [year, month, day] = parseCalendarDate(date);
  return format(new TZDate(year, month - 1, day, 12, 0, "UTC"), pattern, { locale: ptBR });
}
