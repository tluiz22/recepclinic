// Textos das confirmações do Marcar, da série e do Remarcar (cliente,
// 17/out/2026; S-01 do teste da R0 a R4): dizem o dia, o horário, com quem e
// onde, e, na série, a frequência, o começo e até quando. Usados no servidor
// (texto de cada horário) e no navegador (a série muda com o formulário).
import { formatCentsBRL } from "./money";
import { frequencyLabel } from "./seriesLabels";

const WEEKDAYS_PLURAL = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"];

/** "AAAA-MM-DD" → "dd/MM" (com o ano quando não é o de `reference`). */
function shortDate(date: string, reference?: string): string {
  const [year, month, day] = date.split("-");
  return reference && reference.slice(0, 4) !== year ? `${day}/${month}/${year}` : `${day}/${month}`;
}

/** Horário escolhido: "terça-feira, 20/10 às 09:00, com Rafael Lima (Consultório Centro)". */
export function slotConfirmText(when: string, agenda: string, location: string): string {
  return `${when.charAt(0).toLowerCase()}${when.slice(1)}, com ${agenda} (${location})`;
}

/** Começo da série: "às terças, 09:00, com Rafael Lima (Consultório Centro), a partir de 20/10". */
export function seriesStartText(date: string, time: string, agenda: string, location: string): string {
  const weekday = WEEKDAYS_PLURAL[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return `às ${weekday}, ${time}, com ${agenda} (${location}), a partir de ${shortDate(date)}`;
}

export interface SeriesEnd {
  /** Opção "Até quando" do formulário. */
  fim: "sem_fim" | "data" | "sessoes";
  endsOn?: string;
  maxSessions?: string;
}

/** Fim da série: "até 15/12", "com 10 sessões" ou "sem data para terminar (…)". */
export function seriesEndText(end: SeriesEnd, startDate: string, horizonMonths: number): string {
  if (end.fim === "data") return end.endsOn ? `até ${shortDate(end.endsOn, startDate)}` : "até o dia escolhido";
  if (end.fim === "sessoes") {
    const n = Number(end.maxSessions);
    if (!Number.isInteger(n) || n < 1) return "com o número de sessões escolhido";
    return n === 1 ? "com 1 sessão" : `com ${n} sessões`;
  }
  return `sem data para terminar (ficam marcadas as sessões dos próximos ${horizonMonths} meses)`;
}

/**
 * Quando da série, na lista de dados da confirmação: "A cada 2 semanas
 * (quinzenal) às terças, 09:00, com …, a partir de 20/10, com 10 sessões".
 */
export function seriesWhenText(input: { intervalWeeks: number; start: string; end: string }): string {
  return `${frequencyLabel(input.intervalWeeks)} ${input.start}, ${input.end}`;
}

/** Aviso da série, abaixo da lista de dados. */
export const SERIES_SKIP_NOTE = "Feriado, bloqueio ou horário ocupado: a data é pulada e aparece na tela da série.";

/**
 * Aviso da confirmação (cliente, 28/out/2026): quem recebe a mensagem do
 * WhatsApp sobre a marcação ou a alteração. `who` é "o paciente" ou "o responsável".
 */
export function whatsappNoticeText(who: string, action: "marcacao" | "alteracao", category: "consultation" | "return_visit" | "exam"): string {
  const what = category === "exam" ? "do exame" : "da consulta";
  return `${who.charAt(0).toUpperCase()}${who.slice(1)} receberá uma mensagem no WhatsApp informando a ${action === "marcacao" ? "marcação" : "alteração"} ${what}.`;
}

/**
 * Se a clínica manda mensagem aos pacientes: em implantação nada sai (F8.2b) e,
 * sem o WhatsApp conectado, também não (src/lib/data/whatsapp/send.ts).
 */
export function sendsPatientMessages(clinicStatus: string, connectionStatus: string | null | undefined): boolean {
  return clinicStatus === "active" && connectionStatus === "connected";
}

/**
 * Alterar com pagamento registrado (C4.3; cliente, 28/out/2026): os pagamentos
 * não mudam; com valor novo, a confirmação diz quanto falta ou quanto foi pago a mais.
 */
export function paymentChangeNote(paidCents: number, beforeCents: number | null, afterCents: number | null): string {
  if (paidCents <= 0 || afterCents === null || afterCents === beforeCents) return "";
  const paid = `Já há ${formatCentsBRL(paidCents)} em pagamentos registrados, que não mudam.`;
  if (paidCents === afterCents) return `${paid} Com o novo valor (${formatCentsBRL(afterCents)}), o atendimento fica pago.`;
  return paidCents > afterCents
    ? `${paid} Com o novo valor (${formatCentsBRL(afterCents)}), fica ${formatCentsBRL(paidCents - afterCents)} pago a mais: confira no Financeiro.`
    : `${paid} Com o novo valor (${formatCentsBRL(afterCents)}), faltam ${formatCentsBRL(afterCents - paidCents)}.`;
}
