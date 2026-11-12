import { isUuid } from "./clinicAccess";

// Qual agenda a Agenda mostra (F4.5; cliente, 05/out/2026): por padrão todas as que a pessoa vê e um seletor para ver
// só uma. F5a (R3, cliente, 08/nov/2026): a escolha não é mais lembrada; a Agenda abre sempre com todas.

export const ALL_AGENDAS = "todas";

/** Agenda escolhida no endereço (`?agenda=`); agenda que a pessoa não vê (ou desativada) vira "todas" (null). */
export function resolveAgendaChoice(url: URL, selectable: { id: string }[]): string | null {
  const wanted = url.searchParams.get("agenda");
  return wanted && isUuid(wanted) && selectable.some((a) => a.id === wanted) ? wanted : null;
}
