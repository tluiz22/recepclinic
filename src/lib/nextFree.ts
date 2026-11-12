// Próximos horários livres (F5a; R3b, cliente, 08/nov/2026): para responder o paciente na hora, os 2 primeiros dias com
// vaga de cada agenda, a partir de um dia. Horário em reserva do portal aparece apagado (não marca). Regra pura.

export type FreeGapLike = { agendaId: string; date: string; time: string; start: Date; end: Date; places: string[]; group?: unknown };
export type HoldLike = { agendaId: string; start: Date; end: Date };

export type NextFreeDay = { date: string; slots: { time: string; held: boolean }[] };
export type NextFreeAgenda = { agendaId: string; days: NextFreeDay[]; first: Date | null };

/**
 * Por agenda, os `perAgenda` primeiros dias com algum horário livre (sem reserva), com os horários do dia (os em reserva
 * marcados). Turmas ficam de fora (têm tela própria). `place`: só os horários desse tipo de local. Agendas sem vaga
 * vêm com `days` vazio; a ordem é a recebida.
 */
export function nextFreeDays(
  agendaIds: string[],
  gaps: FreeGapLike[],
  holds: HoldLike[],
  { place = null, perAgenda = 2 }: { place?: string | null; perAgenda?: number } = {},
): NextFreeAgenda[] {
  return agendaIds.map((agendaId) => {
    const mine = gaps
      .filter((g) => g.agendaId === agendaId && !g.group && (!place || g.places.includes(place)))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const held = (g: FreeGapLike) => holds.some((h) => h.agendaId === agendaId && h.start < g.end && h.end > g.start);
    // Todos os dias com os horários (em reserva marcados); ficam os primeiros com algum horário que dá para marcar.
    const byDate = new Map<string, NextFreeDay>();
    let first: Date | null = null;
    for (const gap of mine) {
      const isHeld = held(gap);
      const day = byDate.get(gap.date) ?? { date: gap.date, slots: [] };
      byDate.set(gap.date, day);
      day.slots.push({ time: gap.time, held: isHeld });
      if (!isHeld && (!first || gap.start < first)) first = gap.start;
    }
    const days = [...byDate.values()].filter((d) => d.slots.some((slot) => !slot.held)).slice(0, perAgenda);
    return { agendaId, days, first };
  });
}
