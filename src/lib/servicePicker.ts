import type { Enums } from "./supabase/database.types";

// Escolha do serviço no Marcar (C6; cliente, 28/out/2026, opção B do canvas):
// primeiro o tipo (Consulta, Retorno, Exame), depois os serviços dele em
// cartões. Nenhum tipo vem escolhido; com o serviço já definido (Marcar
// retorno, Alterar, volta com erro), abre no tipo dele. A busca dentro do tipo
// só aparece com mais de SEARCH_FROM serviços.

export type ServiceCategory = Enums<"service_category">;

const ORDER: ServiceCategory[] = ["consultation", "return_visit", "exam"];

export const SEARCH_FROM = 8;

export const SERVICE_TYPE_PLURAL: Record<ServiceCategory, string> = { consultation: "consultas", return_visit: "retornos", exam: "exames" };

// Estilos do botão do tipo e do cartão do serviço, no Marcar (links) e em
// Horários (C8: botões e opções, sem recarregar a tela).
const CHIP = "inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border px-3.5 text-[15px] font-semibold no-underline select-none sm:min-h-10";
const CHIP_ON = "border-brand bg-brand text-white";
const CHIP_OFF = "border-line-strong bg-white text-ink hover:border-brand";
const CARD = "flex min-h-11 cursor-pointer flex-col gap-0.5 rounded-[10px] border no-underline hover:border-brand";
const CARD_ON = "border-2 border-brand bg-[#e7f4ef] px-[13px] py-[9px]";
const CARD_OFF = "border-line-strong bg-white px-3.5 py-2.5";

export const typeChipClass = (active: boolean) => `${CHIP} ${active ? CHIP_ON : CHIP_OFF}`;
export const serviceCardClass = (active: boolean) => `${CARD} ${active ? CARD_ON : CARD_OFF}`;

/** Em Horários o estado muda no navegador: o ativo vem do atributo (aria-pressed) ou da opção marcada (classes por extenso, para o Tailwind achar). */
const FOCUS = "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand";
export const typeChipToggleClass = `${CHIP} ${CHIP_OFF} aria-pressed:border-brand aria-pressed:bg-brand aria-pressed:text-white`;
export const anyChipClass = `${CHIP} ${CHIP_OFF} has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-white ${FOCUS}`;
export const serviceCardToggleClass = `${CARD} ${CARD_OFF} has-[:checked]:border-2 has-[:checked]:border-brand has-[:checked]:bg-[#e7f4ef] has-[:checked]:px-[13px] has-[:checked]:py-[9px] ${FOCUS}`;

/** Os tipos que têm serviço, na ordem da tela, com quantos serviços cada um tem. */
export function serviceTypes(services: { category: ServiceCategory }[]): { category: ServiceCategory; count: number }[] {
  return ORDER.map((category) => ({ category, count: services.filter((s) => s.category === category).length })).filter((t) => t.count > 0);
}

/** O tipo aberto: o pedido no endereço (se existe na lista), senão o do serviço escolhido, senão nenhum. */
export function openType(
  requested: string | null,
  services: { category: ServiceCategory }[],
  chosen: { category: ServiceCategory } | null,
): ServiceCategory | null {
  const types = serviceTypes(services).map((t) => t.category);
  if (requested && types.includes(requested as ServiceCategory)) return requested as ServiceCategory;
  return chosen && types.includes(chosen.category) ? chosen.category : null;
}
