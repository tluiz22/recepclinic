import { formatRate, formatRatio, type CountComparison, type RateComparison } from "../../../lib/metricsRules";

// Texto e cor da variação de um indicador (redesign das Métricas, M4). Subir
// é bom em "criados", ruim em "cancelamentos" e "faltas"; neutro onde não há
// lado certo (remarcações).

export type Goodness = "up" | "down" | "neutral";

export type Delta = { tone: "good" | "bad" | "flat"; text: string } | null;

function tone(direction: "up" | "down" | "flat", good: Goodness): "good" | "bad" | "flat" {
  if (direction === "flat" || good === "neutral") return "flat";
  return direction === good ? "good" : "bad";
}

/** "▲ 8%", "▲ 3 a mais", "● igual"; null quando a base é pequena (só o número anterior aparece). */
export function countDelta(c: CountComparison, good: Goodness): Delta {
  if (c.direction === "flat") return c.pct === null && c.previous === 0 ? null : { tone: "flat", text: "● igual" };
  const arrow = c.direction === "up" ? "▲" : "▼";
  if (c.pct !== null) return { tone: tone(c.direction, good), text: `${arrow} ${formatRate(Math.abs(c.pct))}` };
  return null;
}

/** "▲ 5 pontos"; null sem base suficiente nos dois períodos. */
export function rateDelta(c: RateComparison, good: Goodness): Delta {
  if (c.points === null) return null;
  if (c.direction === "flat") return { tone: "flat", text: "● igual" };
  const n = Math.round(Math.abs(c.points));
  return { tone: tone(c.direction, good), text: `${c.direction === "up" ? "▲" : "▼"} ${n} ${n === 1 ? "ponto" : "pontos"}` };
}

/** "289 de 1 a 22/set (mesmos 22 dias)". */
export function previousCount(c: CountComparison, when: string): string {
  return `${c.previous} de ${when}`;
}

export function previousRate(c: RateComparison, when: string): string {
  return c.previous.base === 0 ? `sem dados de ${when}` : `${formatRatio(c.previous)} de ${when}`;
}
