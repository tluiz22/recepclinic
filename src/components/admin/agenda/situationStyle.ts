// Cores da situação na Agenda e no Resumo do dia (cliente, 10/out/2026): faixa
// à esquerda e fundo claro, como o cancelado já tinha (05/out). Verde só para o
// que está garantido; amarelo para o que falta confirmar.
import type { AgendaAppointment } from "../../../lib/data/agenda/view";

export type Situation = "pending" | "confirmed" | "attended" | "no_show" | "canceled" | "block";

/** Situação do atendimento; "confirmado" segue os selos (presença confirmada ou pelo lembrete). */
export function appointmentSituation(a: Pick<AgendaAppointment, "status" | "patientConfirmedAt" | "reminderResponse">): Situation {
  if (a.status === "canceled") return "canceled";
  if (a.status === "completed") return "attended";
  if (a.status === "no_show") return "no_show";
  return a.patientConfirmedAt || a.reminderResponse === "confirm" ? "confirmed" : "pending";
}

export const SITUATIONS: Record<Situation, { label: string; card: string; swatch: string }> = {
  pending: { label: "Não confirmado", card: "border-l-4 border-l-amber-400 bg-amber-50", swatch: "border-l-amber-400 bg-amber-50" },
  confirmed: { label: "Confirmado", card: "border-l-4 border-l-emerald-600 bg-emerald-100", swatch: "border-l-emerald-600 bg-emerald-100" },
  attended: { label: "Compareceu", card: "border-l-4 border-l-sky-500 bg-sky-50", swatch: "border-l-sky-500 bg-sky-50" },
  no_show: { label: "Faltou", card: "border-l-4 border-l-orange-500 bg-orange-50", swatch: "border-l-orange-500 bg-orange-50" },
  canceled: { label: "Cancelado", card: "border-l-4 border-l-red-500 bg-red-50", swatch: "border-l-red-500 bg-red-50" },
  block: { label: "Bloqueio", card: "border-l-4 border-l-slate-400 bg-slate-100", swatch: "border-l-slate-400 bg-slate-100" },
};

/** Fundo e faixa do cartão do atendimento. */
export const situationCard = (a: Parameters<typeof appointmentSituation>[0]) => SITUATIONS[appointmentSituation(a)].card;

// Cancelado: horário riscado (o nome do paciente, não).
export const CANCELED_TEXT = "line-through decoration-red-500 decoration-2 text-slate-500";
