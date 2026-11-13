// Aba Usabilidade (frente Usabilidade, U2; cliente 13/nov/2026): sinais de dificuldade no portal e na recepção, tirados
// só de dados já gravados. Só o Suporte vê. Cada sinal diz o que pode significar e o que melhorar; um número alto é
// pista para olhar, não prova de erro.

export type SignalId = "portal_cancel_1h" | "admin_cancel_5min" | "resched_1h" | "code_wrong" | "hold_expired";
export type SignalCount = { signal: SignalId; affected: number; base: number };
export type Signal = {
  id: SignalId;
  where: "Portal" | "Recepção" | "Portal e recepção";
  label: string;
  meaning: string;
  improve: string;
  /** Texto da base: "de 40 marcadas pelo portal". */
  baseLabel: string;
  /** A mesma base no singular. */
  baseOne: string;
};

export const SIGNALS: readonly Signal[] = [
  {
    id: "portal_cancel_1h",
    where: "Portal",
    label: "Marcou e cancelou em menos de 1 hora",
    meaning: "O paciente marcou pelo portal e desistiu logo em seguida: pode ter escolhido o dia, o profissional ou o tipo de atendimento errado.",
    improve: "Mostrar o resumo (dia, hora, profissional, local) mais claro na revisão e avisar do convênio antes de confirmar.",
    baseLabel: "marcadas pelo portal",
    baseOne: "marcada pelo portal",
  },
  {
    id: "admin_cancel_5min",
    where: "Recepção",
    label: "Marcou e cancelou em menos de 5 minutos",
    meaning: "A recepção marcou e desfez quase na hora: sinal de clique errado, horário ou paciente trocado.",
    improve: "Conferir se a confirmação da marcação mostra paciente, dia e hora antes de gravar.",
    baseLabel: "marcadas pela recepção",
    baseOne: "marcada pela recepção",
  },
  {
    id: "resched_1h",
    where: "Portal e recepção",
    label: "Remarcou em menos de 1 hora depois de marcar",
    meaning: "Quem marcou mudou o horário logo depois: o primeiro horário provavelmente não era o que queria.",
    improve: "Deixar o dia e a hora em destaque antes de confirmar; na recepção, perguntar o dia e o turno de preferência antes de abrir a agenda.",
    baseLabel: "marcadas",
    baseOne: "marcada",
  },
  {
    id: "code_wrong",
    where: "Portal",
    label: "Errou o código do celular",
    meaning: "O paciente digitou o código do WhatsApp errado ao menos uma vez: código difícil de ler ou de copiar, ou celular trocado.",
    improve: "Reforçar a tela do código (6 dígitos, vale por 10 minutos) e o botão de pedir outro.",
    baseLabel: "códigos enviados",
    baseOne: "código enviado",
  },
  {
    id: "hold_expired",
    where: "Portal",
    label: "Reserva do horário venceu sem marcar",
    meaning: "O paciente confirmou o celular e reservou o horário, mas não terminou em 5 minutos: demorou na revisão ou desistiu (raramente, a gravação da marcação falhou: veja os erros).",
    improve: "Ver o passo “Chegaram à revisão” no funil; se muitos param ali, simplificar a tela de revisão.",
    baseLabel: "reservas",
    baseOne: "reserva",
  },
];

/** Número de casos em cada 100 possíveis, em texto; null quando não há base. */
export function signalShare(c: SignalCount | undefined): number | null {
  return c && c.base > 0 ? c.affected / c.base : null;
}

/** Os sinais com ao menos um caso, do maior para o menor (por casos); os sem caso vão por último. */
export function rankSignals(counts: readonly SignalCount[]): { signal: Signal; count: SignalCount | undefined }[] {
  const byId = new Map(counts.map((c) => [c.signal, c]));
  return SIGNALS.map((signal) => ({ signal, count: byId.get(signal.id) })).sort((a, b) => (b.count?.affected ?? 0) - (a.count?.affected ?? 0));
}
