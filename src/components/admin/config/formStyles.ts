// Campos, botões e cartões das telas de Configurações no padrão do redesign
// (R9; os mesmos da ficha, R6). Mesmos nomes do fieldStyles antigo, que segue
// nas telas ainda não redesenhadas (Sistema, R10; página do paciente, R11).
import { buttonClass } from "../ui/styles";

/**
 * Campo sem largura nem margem, para os de largura própria (`${INPUT_INLINE} w-24`).
 * Campo que falhou (`aria-invalid`, posto por keepFormValues): borda vermelha
 * (teste da R9, QA-01).
 */
export const INPUT_INLINE =
  "rounded-lg border border-line-strong bg-white px-3 py-2.5 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand aria-invalid:border-danger-solid aria-invalid:ring-1 aria-invalid:ring-danger-solid disabled:bg-canvas disabled:text-ink-soft sm:text-[15px]";
export const INPUT = `mt-1.5 w-full ${INPUT_INLINE}`;
export const LABEL = "block text-[14.5px] font-semibold text-ink";
export const HINT = "mt-1.5 text-sm text-ink-soft";
export const PRIMARY_BUTTON = buttonClass("primary");
export const SECONDARY_BUTTON = buttonClass("secondary");
export const DANGER_BUTTON = buttonClass("danger");

/** Cartão branco do redesign. */
export const CARD = "rounded-xl border border-line bg-white";
/** Cartão com respiro, para blocos de formulário e textos. */
export const PANEL = "rounded-xl border border-line bg-white p-4 sm:px-5 sm:py-[18px]";
/** Título de bloco (h2). */
export const SECTION_TITLE = "font-display text-[17px] leading-tight font-bold text-ink sm:text-lg";
/** Rótulo de grupo de campos (legend). */
export const LEGEND = "text-[14.5px] font-semibold text-ink";
/** Opção de rádio ou caixa de marcar. */
export const CHOICE = "flex min-h-8 items-center gap-2.5 text-[15px] text-ink";
export const CHECK = "h-[18px] w-[18px] shrink-0 accent-brand";
/** Dados em leitura (EditCard): rótulo e valor. */
export const KV = "grid gap-x-4 gap-y-2.5 text-[15px] sm:grid-cols-[220px_minmax(0,1fr)]";
export const DT = "text-ink-soft";
export const DD = "font-semibold break-words text-ink";
/** Parte do texto em tom de apoio, dentro de um valor. */
export const SOFT = "font-normal text-ink-soft";

/** Listas em linhas (R9, como Pacientes na R6): a caixa, a linha e o cabeçalho (só no computador). */
export const LIST = "overflow-hidden rounded-xl border border-line bg-white";
export const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 border-t border-[#e6ecea] px-3.5 py-3.5 first:border-t-0 lg:items-center lg:gap-4 lg:px-5";
export const HEAD_ROW =
  "hidden border-b border-line bg-[#f8faf9] px-5 py-2.5 text-[12.5px] leading-tight font-semibold tracking-[.05em] text-ink-soft uppercase lg:grid lg:gap-4";
export const ROW_NAME = "text-[16.5px] leading-snug font-bold break-words text-ink no-underline hover:underline";
/** Seta para o formulário: no celular, à direita do nome. */
export const ROW_GO = "flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft hover:bg-canvas hover:text-ink lg:order-last";
/** Célula de dados: linha inteira no celular. */
export const ROW_CELL = "col-span-2 min-w-0 text-[15px] text-ink lg:col-span-1";
