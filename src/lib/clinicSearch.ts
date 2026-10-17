// Busca de clínica pelo nome (R10, cliente, 17/out/2026): para o Suporte, em
// Escolher a clínica e em Sistema › Clínicas, só quando há mais de 6 clínicas.
// Sem acento e sem diferença de maiúsculas ("pediatria" acha "Pediatria Sól").

/** Acima deste número de clínicas, aparece o campo "Buscar clínica". */
export const CLINIC_SEARCH_FROM = 6;

export function showClinicSearch(total: number): boolean {
  return total > CLINIC_SEARCH_FROM;
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

/** Filtra pelo nome; busca vazia devolve a lista inteira. */
export function filterClinicsByName<T extends { name: string }>(clinics: T[], query: string | null | undefined): T[] {
  const wanted = fold(query ?? "");
  if (!wanted) return clinics;
  return clinics.filter((clinic) => fold(clinic.name).includes(wanted));
}

/** Iniciais do cartão (até 2 letras, sem "de", "da", "do"...). */
export function clinicInitials(name: string): string {
  const words = name.split(/\s+/).filter((word) => word && !/^(d[aeo]s?|e)$/i.test(word));
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toLocaleUpperCase("pt-BR"))
    .join("");
}
