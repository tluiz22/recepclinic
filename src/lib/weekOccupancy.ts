// Agenda › Semana como quadro de ocupação (seção 16.3, opção C; cliente, 11/nov/2026): por profissional e por dia,
// "N de M" marcados, os livres e a barra. Regra pura.
//
// - Marcados (N): atendimentos não cancelados do dia (cancelado libera o horário).
// - Abertos (M): os marcados mais os horários livres do dia contados desde o começo da semana (assim o dia que já
//   passou mantém o total dele); bloqueio e feriado já tiram horários da conta.
// - Livres: a mesma conta da Marcar e dos "Próximos horários livres": abertos − marcados − bloqueados − em reserva no
//   portal − já passados. Turma fica de fora (tem horário próprio).

export type OccupancyGap = { agendaId: string; date: string; start: Date; end: Date; group?: unknown };
export type OccupancyHold = { agendaId: string; start: Date; end: Date };
export type OccupancyAppointment = { agendaId: string; date: string; status: string };

export type OccupancyCell =
  | { kind: "holiday" }
  | { kind: "closed" }
  | { kind: "open"; booked: number; total: number; free: number; past: boolean };

/** Ocupação de uma agenda num dia. `gaps` contados desde o começo da semana; `now` separa os que já passaram. */
export function occupancyCell(
  agendaId: string,
  date: string,
  {
    gaps,
    holds,
    appointments,
    holidays,
    today,
    now,
  }: { gaps: OccupancyGap[]; holds: OccupancyHold[]; appointments: OccupancyAppointment[]; holidays: Set<string>; today: string; now: Date },
): OccupancyCell {
  const booked = appointments.filter((a) => a.agendaId === agendaId && a.date === date && a.status !== "canceled").length;
  if (holidays.has(date) && booked === 0) return { kind: "holiday" };
  const open = gaps.filter((g) => g.agendaId === agendaId && g.date === date && !g.group);
  if (open.length === 0 && booked === 0) return { kind: "closed" };
  const held = (g: OccupancyGap) => holds.some((h) => h.agendaId === agendaId && h.start < g.end && h.end > g.start);
  const free = open.filter((g) => g.start > now && !held(g)).length;
  return { kind: "open", booked, total: booked + open.length, free, past: date < today };
}

/** Livres do dia somando as agendas (a faixa dos dias e o cabeçalho de cada coluna). `null`: ninguém atende. */
export function dayFree(cells: OccupancyCell[]): { free: number; holiday: boolean } | null {
  const open = cells.filter((c): c is Extract<OccupancyCell, { kind: "open" }> => c.kind === "open");
  if (open.length === 0) return cells.some((c) => c.kind === "holiday") ? { free: 0, holiday: true } : null;
  return { free: open.reduce((n, c) => n + c.free, 0), holiday: false };
}

/** Parte marcada da barra, em % (0 a 100). */
export function occupancyPercent(cell: OccupancyCell): number {
  if (cell.kind !== "open" || cell.total === 0) return 0;
  return Math.min(100, Math.round((cell.booked / cell.total) * 100));
}

/** Texto dos livres: "3 livres", "1 livre", "Cheio" (tudo marcado), "0 livres" (o resto passou ou está em reserva);
 * dia que já passou não mostra. */
export function freeText(cell: OccupancyCell): string {
  if (cell.kind !== "open" || cell.past) return "";
  if (cell.free === 0) return cell.booked >= cell.total ? "Cheio" : "0 livres";
  return `${cell.free} ${cell.free === 1 ? "livre" : "livres"}`;
}
