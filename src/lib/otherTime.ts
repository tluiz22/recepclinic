import { isCalendarDate, isClockTime } from "./clinicTime";

// "Outro horário" do Marcar e do Remarcar (cliente, 28/out/2026): a equipe
// digita dia, hora, local e (no "Primeiro horário disponível") com quem. Os
// campos vêm no endereço, como o resto da tela; o horário é conferido no
// servidor (checkFreeTime).

export type OtherTimeQuery = { date: string; time: string; locationId: string; agendaId: string };

/** Os campos do endereço; null sem dia ou hora válidos. */
export function readOtherTime(params: URLSearchParams): OtherTimeQuery | null {
  const date = params.get("outro_data") ?? "";
  const time = params.get("outro_hora") ?? "";
  if (!isCalendarDate(date) || !isClockTime(time)) return null;
  return { date, time, locationId: params.get("outro_local") ?? "", agendaId: params.get("outro_agenda") ?? "" };
}

/** O escolhido, se está entre as opções; com uma só, ela; senão "". */
export function pickOne(chosen: string, options: string[]): string {
  if (options.includes(chosen)) return chosen;
  return options.length === 1 ? options[0] : "";
}
