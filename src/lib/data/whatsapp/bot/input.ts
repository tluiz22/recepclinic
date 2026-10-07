import type { WaMessage } from "../meta";

// Leitura da resposta do paciente (F6.3), como no piloto: toque numa lista ou
// botão (id) ou texto digitado (número da opção, "sim"/"não", data).

export type Selection = { id: string | null; text: string };

export const BACK_TO_MENU_ID = "back_to_menu";

export function extractSelection(msg: WaMessage): Selection {
  const reply = msg.interactive?.list_reply ?? msg.interactive?.button_reply;
  if (reply) return { id: reply.id ?? null, text: (reply.title ?? "").trim() };
  if (msg.button) return { id: msg.button.payload ?? null, text: (msg.button.text ?? "").trim() };
  return { id: null, text: (msg.text?.body ?? "").trim() };
}

/** "Voltar ao menu" (toque), "0" ou "menu" digitados. */
export function isBackToMenu(selection: Selection): boolean {
  if (selection.id === BACK_TO_MENU_ID) return true;
  const text = selection.text.toLowerCase();
  return text === "0" || text === "menu" || text === "menu principal";
}

/**
 * Item escolhido de uma lista numerada: pelo id do toque ou pelo número
 * digitado ("2", "2." ou "2 algo").
 */
export function pick<T>(selection: Selection, items: T[], idOf: (item: T) => string): T | null {
  if (selection.id) {
    const found = items.find((item) => idOf(item) === selection.id);
    if (found) return found;
  }
  const match = selection.text.match(/^(\d{1,2})(?:[.\s)]|$)/);
  if (!match) return null;
  const index = Number(match[1]);
  return index >= 1 && index <= items.length ? items[index - 1] : null;
}

/** Sim/Não digitado ou tocado; null = não entendeu. */
export function yesNo(selection: Selection, ids: { yes: string; no: string } = { yes: "yes", no: "no" }): boolean | null {
  if (selection.id === ids.yes) return true;
  if (selection.id === ids.no) return false;
  const text = selection.text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  if (text === "1" || /^s(im)?\b/.test(text) || text === "isso" || text === "correto") return true;
  if (text === "2" || /^n(ao)?\b/.test(text)) return false;
  return null;
}

/** "10/03/2020" ou "10-03-2020" → "2020-03-10"; data inexistente, depois de hoje ou antes de 1900 = null. */
export function parseBirthdate(text: string, today: string): string | null {
  const match = text.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return iso >= "1900-01-01" && iso <= today ? iso : null;
}

/** "2020-03-10" → "10/03/2020". */
export function formatBirthdate(iso: string): string {
  return iso.split("-").reverse().join("/");
}
