import { localDateOf, localTimeOf, toInstant } from "../../clinicTime";

// Horários livres de uma agenda num dia (cálculo puro). Portado de
// computeAvailableSlots (src/lib/scheduling/slots.ts, testado na F1), agora
// com o fuso da clínica e a duração do serviço escolhido:
//   - cada intervalo livre dentro das janelas, descontado o que está ocupado
//     (atendimentos e bloqueios, com o intervalo da agenda antes e depois),
//     é preenchido a partir do próprio início, em passos da duração;
//   - só horários depois de `now`;
//   - Retorno ("tapar buracos", Fase 17): prioriza os intervalos menores que
//     uma consulta, completa com os primeiros do dia, no máximo 4.

export const MAX_RETURN_VISIT_SUGGESTIONS = 4;

export type SlotWindow = { locationId: string; startTime: string; endTime: string };
export type BusyInterval = { start: Date; end: Date };
export type FreeSlot = { start: Date; time: string; locationId: string };

export type SlotStrategy =
  | { kind: "fill" }
  /** Retorno: `consultationMinutes` null = a agenda não tem consulta; só limita a 4. */
  | { kind: "return_gaps"; consultationMinutes: number | null };

const toMinutes = (time: string) => {
  const [hours, minutes] = time.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
};

const toClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Minutos do relógio da clínica dentro de `date`; antes do dia = -∞, depois = +∞. */
function minutesIntoDay(instant: Date, date: string, timeZone: string): number {
  const day = localDateOf(instant, timeZone);
  if (day < date) return Number.NEGATIVE_INFINITY;
  if (day > date) return Number.POSITIVE_INFINITY;
  return toMinutes(localTimeOf(instant, timeZone));
}

type Interval = { start: number; end: number };

function mergeBusy(busy: BusyInterval[], date: string, timeZone: string, bufferMinutes: number): Interval[] {
  const intervals = busy
    .map((interval) => ({
      start: minutesIntoDay(interval.start, date, timeZone) - bufferMinutes,
      end: minutesIntoDay(interval.end, date, timeZone) + bufferMinutes,
    }))
    .filter((interval) => interval.end > 0 && interval.start < 24 * 60)
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

export function computeFreeSlots({
  date,
  timeZone,
  windows,
  busy,
  durationMinutes,
  bufferMinutes,
  strategy,
  now,
}: {
  date: string;
  timeZone: string;
  windows: SlotWindow[];
  busy: BusyInterval[];
  durationMinutes: number;
  bufferMinutes: number;
  strategy: SlotStrategy;
  now: Date;
}): FreeSlot[] {
  if (durationMinutes <= 0) return [];
  const merged = mergeBusy(busy, date, timeZone, bufferMinutes);

  const gaps: (Interval & { locationId: string })[] = [];
  for (const window of [...windows].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    const windowStart = toMinutes(window.startTime);
    const windowEnd = toMinutes(window.endTime);
    let cursor = windowStart;
    for (const interval of merged) {
      const gapEnd = Math.min(interval.start, windowEnd);
      if (gapEnd > cursor) gaps.push({ start: cursor, end: gapEnd, locationId: window.locationId });
      cursor = Math.max(cursor, Math.min(interval.end, windowEnd));
      if (cursor >= windowEnd) break;
    }
    if (cursor < windowEnd) gaps.push({ start: cursor, end: windowEnd, locationId: window.locationId });
  }

  const slotsFrom = (gap: Interval & { locationId: string }): FreeSlot[] => {
    const result: FreeSlot[] = [];
    for (let minute = gap.start; minute + durationMinutes <= gap.end; minute += durationMinutes) {
      const time = toClock(minute);
      const start = toInstant(date, time, timeZone);
      // Hora que não existe no dia (horário de verão) cai noutra: não oferece.
      if (start > now && localTimeOf(start, timeZone) === time) result.push({ start, time, locationId: gap.locationId });
    }
    return result;
  };

  if (strategy.kind === "fill") return gaps.flatMap(slotsFrom);

  const { consultationMinutes } = strategy;
  const priority: FreeSlot[] = [];
  const others: FreeSlot[] = [];
  for (const gap of gaps) {
    const small = consultationMinutes !== null && gap.end - gap.start < consultationMinutes;
    (small ? priority : others).push(...slotsFrom(gap));
  }
  return [...priority, ...others]
    .slice(0, MAX_RETURN_VISIT_SUGGESTIONS)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
