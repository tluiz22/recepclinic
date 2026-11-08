import { addDays, localDateOf, toInstant, weekdayOf } from "../../clinicTime";
import type { DbClient } from "../clients";
import { unwrap } from "../errors";

// Dias bloqueados inteiros (recepção digital, I9, cliente, 08/nov/2026): o dia em que os bloqueios da agenda
// cobrem todo o horário de atendimento dela. Não contam no prazo do retorno (bot, Agenda e portal). Bloqueio de
// parte do dia não conta; dia sem horário de atendimento nunca é "bloqueado"; feriados ficam de fora.

export type WeekWindow = { weekday: number; startTime: string; endTime: string };
export type Interval = { start: Date; end: Date };

/** Junta intervalos que se tocam ou se sobrepõem, em ordem. */
function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && item.start.getTime() <= last.end.getTime()) {
      if (item.end.getTime() > last.end.getTime()) last.end = item.end;
    } else {
      out.push({ start: item.start, end: item.end });
    }
  }
  return out;
}

/** O intervalo está inteiro dentro da união (já juntada) dos bloqueios. */
function covered(window: Interval, blocks: Interval[]): boolean {
  return blocks.some((b) => b.start.getTime() <= window.start.getTime() && b.end.getTime() >= window.end.getTime());
}

/** Datas de `fromDate` a `toDate` (inclusive) em que os bloqueios cobrem todo o horário de atendimento. */
export function wholeBlockedDays({
  windows,
  blocks,
  fromDate,
  toDate,
  timeZone,
}: {
  windows: WeekWindow[];
  blocks: Interval[];
  fromDate: string;
  toDate: string;
  timeZone: string;
}): Set<string> {
  const result = new Set<string>();
  const merged = merge(blocks);
  if (!merged.length || !windows.length) return result;
  // Só os dias tocados por algum bloqueio (uma janela longa sem bloqueio não custa nada).
  const candidates = new Set<string>();
  for (const b of merged) {
    const first = localDateOf(b.start, timeZone);
    const last = localDateOf(new Date(b.end.getTime() - 1), timeZone);
    for (let date = first < fromDate ? fromDate : first; date <= last && date <= toDate; date = addDays(date, 1)) candidates.add(date);
  }
  for (const date of [...candidates].sort()) {
    const weekday = weekdayOf(date);
    const today = windows.filter((w) => w.weekday === weekday);
    if (!today.length) continue;
    const open = merge(today.map((w) => ({ start: toInstant(date, w.startTime, timeZone), end: toInstant(date, w.endTime, timeZone) })));
    if (open.every((w) => covered(w, merged))) result.add(date);
  }
  return result;
}

/** Os dias bloqueados inteiros de cada agenda no período (uma consulta para todas). */
export async function loadWholeBlockedDays(
  db: DbClient,
  clinicId: string,
  agendaIds: string[],
  fromDate: string,
  toDate: string,
  timeZone: string,
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>(agendaIds.map((id) => [id, new Set<string>()]));
  if (!agendaIds.length || fromDate > toDate) return result;
  const from = toInstant(fromDate, "00:00", timeZone);
  const to = toInstant(addDays(toDate, 1), "00:00", timeZone);
  const blocks = unwrap(
    await db
      .from("schedule_blocks")
      .select("agenda_id, starts_at, ends_at")
      .eq("clinic_id", clinicId)
      .in("agenda_id", agendaIds)
      .is("removed_at", null)
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString()),
    "Bloqueios da agenda",
  );
  if (!blocks.length) return result;
  const blockedAgendas = [...new Set(blocks.map((b) => b.agenda_id))];
  const windows = unwrap(
    await db
      .from("availability_windows")
      .select("agenda_id, weekday, start_time, end_time")
      .eq("clinic_id", clinicId)
      .in("agenda_id", blockedAgendas)
      .eq("is_active", true),
    "Horários da agenda",
  );
  for (const agendaId of blockedAgendas) {
    result.set(
      agendaId,
      wholeBlockedDays({
        windows: windows
          .filter((w) => w.agenda_id === agendaId)
          .map((w) => ({ weekday: w.weekday, startTime: w.start_time.slice(0, 5), endTime: w.end_time.slice(0, 5) })),
        blocks: blocks.filter((b) => b.agenda_id === agendaId).map((b) => ({ start: new Date(b.starts_at), end: new Date(b.ends_at) })),
        fromDate,
        toDate,
        timeZone,
      }),
    );
  }
  return result;
}

/** Até onde olhar os bloqueios: o prazo mais um ano de folga (férias longas empurram o fim). */
export const BLOCKED_DAYS_SLACK = 366;
