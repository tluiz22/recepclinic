import { formatCalendarDate, formatInstant } from "./clinicTime";
import { capitalize } from "./vocabulary";

// Textos do retorno no portal (F2d; D4, seção 8 do plano; canvas, rodada 4). Os motivos seguem os textos do bot
// (domiciliar, retorno já marcado, atendimento futuro) e a ordem dele: do mais específico ao mais geral.

/** "19/10" ou "1/11" (como no canvas). */
export const dayMonth = (date: string) => formatCalendarDate(date, "d/MM");

/** "Consulta em segunda, 19/10". */
export const consultationOn = (date: string) => `Consulta em ${formatCalendarDate(date, "EEEE").replace("-feira", "")}, ${dayMonth(date)}`;

/** "Retorno até sex, 20/11" (sem prazo: "Retorno sem prazo"). */
export const returnUntil = (lastDate: string | null) =>
  lastDate ? `Retorno até ${formatCalendarDate(lastDate, "EEE").slice(0, 3)}, ${dayMonth(lastDate)}` : "Retorno sem prazo";

export type RefusalKind = "home_visit" | "used" | "future" | "expired";

export type RefusalFacts = { kind: RefusalKind; originDate: string; lastDate?: string; scheduledAt?: Date; professionalName: string };

/** O motivo de uma consulta sem direito, na lista "consultas sem direito a retorno". */
export function refusalText(r: RefusalFacts, timeZone: string): string {
  switch (r.kind) {
    case "expired":
      return `O prazo acabou em ${dayMonth(r.lastDate!)} (consulta de ${dayMonth(r.originDate)}). Para voltar, agende uma consulta nova.`;
    case "used":
      return `O retorno da consulta de ${dayMonth(r.originDate)} já foi marcado. Cada consulta dá direito a um retorno.`;
    case "home_visit":
      return `A consulta de ${dayMonth(r.originDate)} foi domiciliar, e consulta domiciliar não dá direito a retorno.`;
    case "future":
      return `Já tem atendimento marcado com ${r.professionalName} em ${formatInstant(r.scheduledAt!, timeZone, "dd/MM 'às' HH:mm")}.`;
  }
}

const ORDER: RefusalKind[] = ["home_visit", "used", "future", "expired"];

/** Ninguém com direito: o motivo mostrado, do mais específico ao mais geral (como o bot). */
export function mainRefusal<T extends { kind: RefusalKind }>(refusals: readonly T[]): T | null {
  for (const kind of ORDER) {
    const found = refusals.find((r) => r.kind === kind);
    if (found) return found;
  }
  return null;
}

/** "Marcar retorno do João" / "da Maria" (o primeiro nome; o artigo pelo cadastro não existe: "de"). */
export function returnButton(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return `Marcar retorno de ${capitalize(first.toLowerCase())}`;
}
