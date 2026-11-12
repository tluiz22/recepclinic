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

export type FreeGap = { start: Date; end: Date; time: string; endTime: string };

/**
 * Horários livres de uma agenda num dia, um por linha, como no protótipo da Agenda (opção B; cliente, 02/nov/2026):
 * o que sobra das janelas, descontado o ocupado (com o intervalo da agenda), cortado em passos, a partir do começo de
 * cada intervalo livre. Só os que ainda não começaram.
 * O passo é o da duração do serviço de cada janela (cliente, 02/nov/2026: 13:00 às 13:45 de Retorno de 15 min dá linhas
 * de 15 min; 13:45 às 17:30 de Consulta de 45 min dá linhas de 45 min). Onde duas janelas se sobrepõem, vale o menor
 * passo. Janela sem `stepMinutes` usa o `stepMinutes` geral.
 */
export function computeFreeGaps({
  date,
  timeZone,
  windows,
  busy,
  bufferMinutes,
  stepMinutes,
  now,
}: {
  date: string;
  timeZone: string;
  windows: (Pick<SlotWindow, "startTime" | "endTime"> & { stepMinutes?: number })[];
  busy: BusyInterval[];
  bufferMinutes: number;
  stepMinutes: number;
  now: Date;
}): FreeGap[] {
  const merged = mergeBusy(busy, date, timeZone, bufferMinutes);
  // Trechos do dia com o passo de cada um: cada ponto de início ou fim de janela divide o dia; o passo do trecho é o
  // menor entre as janelas que o cobrem (o livre é do horário, não do local), e trechos vizinhos de mesmo passo se juntam.
  const spans = windows
    .map((w) => ({ start: toMinutes(w.startTime), end: toMinutes(w.endTime), step: w.stepMinutes ?? stepMinutes }))
    .filter((w) => w.step > 0 && w.end > w.start);
  const points = [...new Set(spans.flatMap((w) => [w.start, w.end]))].sort((x, y) => x - y);
  const pieces: (Interval & { step: number })[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const covering = spans.filter((w) => w.start <= points[i] && w.end >= points[i + 1]);
    if (covering.length === 0) continue;
    const step = Math.min(...covering.map((w) => w.step));
    const last = pieces[pieces.length - 1];
    if (last && last.end === points[i] && last.step === step) last.end = points[i + 1];
    else pieces.push({ start: points[i], end: points[i + 1], step });
  }
  const gaps: (Interval & { step: number })[] = [];
  for (const span of pieces) {
    let cursor = span.start;
    for (const interval of merged) {
      const gapEnd = Math.min(interval.start, span.end);
      if (gapEnd > cursor) gaps.push({ start: cursor, end: gapEnd, step: span.step });
      cursor = Math.max(cursor, Math.min(interval.end, span.end));
      if (cursor >= span.end) break;
    }
    if (cursor < span.end) gaps.push({ start: cursor, end: span.end, step: span.step });
  }
  const result: FreeGap[] = [];
  for (const gap of gaps) {
    for (let minute = gap.start; minute + gap.step <= gap.end; minute += gap.step) {
      const time = toClock(minute);
      const endTime = toClock(minute + gap.step);
      const start = toInstant(date, time, timeZone);
      // Hora que não existe no dia (horário de verão) cai noutra: não oferece.
      if (start > now && localTimeOf(start, timeZone) === time) result.push({ start, end: toInstant(date, endTime, timeZone), time, endTime });
    }
  }
  return result;
}

/**
 * Turmas de uma faixa (cliente, 11/nov/2026): uma a cada duração do exame, do início ao fim (08:00–12:00 com 60 min:
 * 08:00, 09:00, 10:00 e 11:00). A primeira vale sempre (faixa mais curta que o exame, como antes). O banco confere
 * igual (`app.group_starts_at`).
 */
export function groupStartTimes(startTime: string, endTime: string, durationMinutes: number): string[] {
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const times = [startTime.slice(0, 5)];
  if (durationMinutes <= 0) return times;
  for (let m = start + durationMinutes; m + durationMinutes <= end; m += durationMinutes) times.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  return times;
}
