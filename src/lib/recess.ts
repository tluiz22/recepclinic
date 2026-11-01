import { addDays, formatCalendarDate, localDateOf } from "./clinicTime";

// Recesso da clínica (cliente, 01/nov/2026): bloqueio de agenda marcado como
// recesso guarda a mensagem que o bot envia quando o paciente pede a recepção.
// {data} vira o dia seguinte ao fim do bloqueio, no calendário da clínica.

/** Bloqueio maior que isso (em dias) pergunta se envia a mensagem de recesso. */
export const RECESS_ASK_AFTER_DAYS = 5;

export const RECESS_DATE_TOKEN = "{data}";

export const RECESS_DEFAULT_MESSAGE = `Olá, nossa clínica se encontra em recesso, iremos retornar no dia ${RECESS_DATE_TOKEN}

Retornaremos o contato a partir desta data.

Agradecemos a compreensão.`;

/** Dia do retorno (yyyy-MM-dd): o dia seguinte ao último dia bloqueado. */
export function recessReturnDate(endsAt: Date, timeZone: string): string {
  return addDays(localDateOf(new Date(endsAt.getTime() - 1), timeZone), 1);
}

/** Troca {data} por dd/MM/yyyy. */
export function renderRecessMessage(template: string, returnDate: string): string {
  return template.replaceAll(RECESS_DATE_TOKEN, formatCalendarDate(returnDate, "dd/MM/yyyy"));
}

/** Dias de calendário que o período cobre (início e fim inclusive). */
export function blockDays(startsAt: Date, endsAt: Date, timeZone: string): number {
  const first = localDateOf(startsAt, timeZone);
  const last = localDateOf(new Date(endsAt.getTime() - 1), timeZone);
  let days = 1;
  for (let d = first; d < last; d = addDays(d, 1)) days++;
  return days;
}
