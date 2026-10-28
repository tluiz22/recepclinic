import type { Enums } from "./supabase/database.types";

// Escolha do serviço no Marcar (C6; cliente, 28/out/2026, opção B do canvas):
// primeiro o tipo (Consulta, Retorno, Exame), depois os serviços dele em
// cartões. Nenhum tipo vem escolhido; com o serviço já definido (Marcar
// retorno, Alterar, volta com erro), abre no tipo dele. A busca dentro do tipo
// só aparece com mais de SEARCH_FROM serviços.

export type ServiceCategory = Enums<"service_category">;

const ORDER: ServiceCategory[] = ["consultation", "return_visit", "exam"];

export const SEARCH_FROM = 8;

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
