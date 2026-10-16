// Faixa de dias do Marcar e do Remarcar (redesign R4, cliente, 15/out/2026):
// 7 dias livres por vez, com setas para os 7 antes e os 7 depois.
//
// U-09 (cliente, 15/out/2026): o dia pedido (vindo de um dia da Agenda, de
// "Outra data" ou de um dia da faixa) é o escolhido. Sem horário livre nele,
// a tela avisa e escolhe o primeiro dia livre depois dele.

export const STRIP_SIZE = 7;

export interface DayStrip {
  /** Dias livres à vista, em ordem. */
  days: string[];
  /** Dia escolhido ("" quando não há dia livre a mostrar). */
  selected: string;
  /** Dia pedido que não tem horário livre (para o aviso), ou null. */
  unavailable: string | null;
  /** Primeiro dia da página anterior e da seguinte (null = não há). */
  prevStart: string | null;
  nextStart: string | null;
}

/**
 * `dates`: todos os dias com horário livre na janela de busca, em ordem.
 * `wanted`: o dia pedido (já conferido: data válida, de hoje em diante).
 * `start`: o primeiro dia da faixa (as setas mudam; os dias da faixa mantêm).
 */
export function buildDayStrip(dates: string[], wanted: string | null, start: string | null, size = STRIP_SIZE): DayStrip {
  const firstFrom = (day: string) => dates.findIndex((d) => d >= day);
  let selected = dates[0] ?? "";
  let unavailable: string | null = null;
  if (wanted && !dates.includes(wanted)) {
    unavailable = wanted;
    const after = firstFrom(wanted);
    selected = after === -1 ? "" : dates[after];
  } else if (wanted) {
    selected = wanted;
  }
  if (!selected) return { days: [], selected, unavailable, prevStart: null, nextStart: null };

  const selectedIndex = dates.indexOf(selected);
  let index = start ? firstFrom(start) : selectedIndex;
  // O escolhido sempre fica à vista (endereço montado à mão, por exemplo).
  if (index === -1 || selectedIndex < index || selectedIndex >= index + size) index = selectedIndex;
  return {
    days: dates.slice(index, index + size),
    selected,
    unavailable,
    prevStart: index > 0 ? dates[Math.max(0, index - size)] : null,
    nextStart: index + size < dates.length ? dates[index + size] : null,
  };
}

/** Turno do horário ("HH:mm"): Manhã até 11:59, Tarde até 17:59, Noite depois. */
export function periodOf(time: string): "Manhã" | "Tarde" | "Noite" {
  const hour = Number(time.slice(0, 2));
  return hour < 12 ? "Manhã" : hour < 18 ? "Tarde" : "Noite";
}
