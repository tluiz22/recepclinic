// Cores da situação na Agenda e no Resumo do dia (cliente, 10/out/2026): faixa
// à esquerda e fundo claro, como o cancelado já tinha (05/out). Verde só para o
// que está garantido; amarelo para o que falta confirmar. Redesign (R0/R2,
// 15/out): a paleta do canvas aprovado, faixa mais estreita, fundo mais suave e
// o selo sempre com ícone e texto.
import type { IconName } from "../Icon.astro";
import type { AgendaAppointment } from "../../../lib/data/agenda/view";

export type Situation = "pending" | "confirmed" | "attended" | "no_show" | "canceled" | "block";

/** Situação do atendimento; "confirmado" segue os selos (presença confirmada ou pelo lembrete). */
export function appointmentSituation(a: Pick<AgendaAppointment, "status" | "patientConfirmedAt" | "reminderResponse">): Situation {
  if (a.status === "canceled") return "canceled";
  if (a.status === "completed") return "attended";
  if (a.status === "no_show") return "no_show";
  return a.patientConfirmedAt || a.reminderResponse === "confirm" ? "confirmed" : "pending";
}

type SituationStyle = {
  label: string;
  icon: IconName;
  /** Fundo e faixa do cartão (o `Card` do Resumo do Dia mantém a própria borda). */
  card: string;
  /** Borda do cartão da Agenda, no tom da situação. */
  edge: string;
  /** Faixa e fundo das linhas curtas (Semana, busca). */
  swatch: string;
  /** Selo: fundo e texto. */
  pill: string;
};

export const SITUATIONS: Record<Situation, SituationStyle> = {
  pending: {
    label: "Não confirmado",
    icon: "clock",
    card: "border-l-[5px] border-l-pend-500 bg-pend-50",
    edge: "border-pend-200",
    swatch: "border-l-pend-500 bg-pend-50",
    pill: "bg-pend-100 text-pend-800",
  },
  confirmed: {
    label: "Confirmado",
    icon: "check",
    card: "border-l-[5px] border-l-conf-500 bg-conf-50",
    edge: "border-conf-200",
    swatch: "border-l-conf-500 bg-conf-50",
    pill: "bg-conf-100 text-conf-800",
  },
  attended: {
    label: "Compareceu",
    icon: "user-check",
    card: "border-l-[5px] border-l-att-500 bg-att-50",
    edge: "border-att-200",
    swatch: "border-l-att-500 bg-att-50",
    pill: "bg-att-100 text-att-800",
  },
  no_show: {
    label: "Faltou",
    icon: "user-x",
    card: "border-l-[5px] border-l-ns-500 bg-ns-50",
    edge: "border-ns-200",
    swatch: "border-l-ns-500 bg-ns-50",
    pill: "bg-ns-100 text-ns-800",
  },
  canceled: {
    label: "Cancelado",
    icon: "x-mark",
    card: "border-l-[5px] border-l-can-500 bg-can-50",
    edge: "border-can-200",
    swatch: "border-l-can-500 bg-can-50",
    pill: "bg-can-100 text-can-800",
  },
  block: {
    label: "Bloqueio",
    icon: "lock",
    card: "border-l-[5px] border-l-blk-500 bg-blk-50",
    edge: "border-blk-200",
    swatch: "border-l-blk-500 bg-blk-50",
    pill: "bg-blk-100 text-blk-800",
  },
};

/** Fundo e faixa do cartão do atendimento. */
export const situationCard = (a: Parameters<typeof appointmentSituation>[0]) => SITUATIONS[appointmentSituation(a)].card;

/** Quantos atendimentos (e bloqueios) há em cada situação, para a legenda do dia. */
export function countSituations(
  appointments: Parameters<typeof appointmentSituation>[0][],
  blocks: number,
): Record<Situation, number> {
  const counts: Record<Situation, number> = { pending: 0, confirmed: 0, attended: 0, no_show: 0, canceled: 0, block: blocks };
  for (const a of appointments) counts[appointmentSituation(a)] += 1;
  return counts;
}

// Cancelado: horário riscado (o nome do paciente, não).
export const CANCELED_TEXT = "line-through decoration-can-500 decoration-2 text-ink-soft";
