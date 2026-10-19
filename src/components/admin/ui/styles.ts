// Classes dos componentes base do redesign (R0, cliente, 15/out/2026), para
// os casos em que o elemento não pode ser um <Button> (ex.: o <summary> de um
// <details>, o botão que abre o menu "Mais"). Um só botão cheio por tela ou
// cartão; 44px de toque no celular e 32px nos compactos do computador.
export type ButtonVariant = "primary" | "secondary" | "danger" | "danger-quiet" | "quiet";
export type ButtonSize = "md" | "sm";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60";

const SIZES: Record<ButtonSize, string> = {
  md: "h-11 rounded-lg px-4 text-[15px] sm:h-10",
  sm: "h-11 rounded-lg px-3.5 text-[15px] sm:h-8 sm:rounded-[7px] sm:px-2.5 sm:text-sm",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-brand text-white hover:bg-brand-strong",
  secondary: "border-line-strong bg-white text-ink hover:bg-canvas",
  danger: "border-danger-line bg-white text-danger hover:bg-can-50",
  "danger-quiet": "border-transparent bg-transparent px-2 text-danger hover:bg-can-50 sm:px-1.5",
  quiet: "border-transparent bg-transparent px-2 text-brand hover:bg-brand-soft sm:px-2",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]}`;
}

/**
 * Campo de formulário do redesign (seletor, data, busca). Campo com erro
 * (`aria-invalid`): borda vermelha até ser corrigido, em todo o painel
 * (regressão de 18/out, REG-04 e S-01; cliente, 19/out/2026).
 */
export const CONTROL =
  "h-11 rounded-lg border border-line-strong bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand aria-invalid:border-danger-solid aria-invalid:ring-1 aria-invalid:ring-danger-solid sm:h-10 sm:text-[15px]";

/** Item do menu "Mais" (link ou botão de formulário). `danger`: o que desfaz algo. */
export function menuItemClass(danger = false): string {
  return `flex h-11 w-full items-center gap-2 rounded-[7px] border-0 bg-transparent px-2.5 text-left text-[15px] font-medium no-underline hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-2 focus-visible:outline-brand sm:h-9 sm:text-[14.5px] ${danger ? "text-danger" : "text-ink"}`;
}

/** Tabela do redesign (R7): caixa com rolagem própria no celular, cabeçalho claro, números à direita. */
export const TABLE = {
  box: "overflow-x-auto rounded-xl border border-line bg-white focus-visible:outline-2 focus-visible:outline-brand",
  table: "w-full border-collapse text-[15px]",
  th: "border-b border-line bg-[#f8faf9] px-3 py-2.5 text-left text-[13px] leading-snug font-semibold whitespace-nowrap text-ink-soft sm:px-4",
  td: "border-b border-[#e6ecea] px-3 py-2.5 align-middle text-ink sm:px-4 sm:py-[11px]",
  num: "text-right tabular-nums whitespace-nowrap",
  total: "bg-[#f8faf9] font-bold",
  sub: "block text-sm font-normal text-ink-soft",
} as const;
