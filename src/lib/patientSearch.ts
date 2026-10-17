// O que a busca de paciente procura (cliente, 17/out/2026): com letras, o
// nome (que pode ter números, "Paciente 2001"); só números (4 ou mais), o
// telefone; uma data dd/mm/aaaa, a data de nascimento. Antes, qualquer texto
// com 4 dígitos virava busca por telefone.
import { isCalendarDate } from "./clinicTime";

export type SearchTerm =
  | { kind: "name"; text: string }
  | { kind: "phone"; digits: string }
  | { kind: "birthdate"; date: string };

export function parseSearch(query: string): SearchTerm | null {
  const q = query.trim();
  if (!q) return null;
  const date = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(q);
  if (date) {
    const iso = `${date[3]}-${date[2].padStart(2, "0")}-${date[1].padStart(2, "0")}`;
    if (isCalendarDate(iso)) return { kind: "birthdate", date: iso };
  }
  if (/\p{L}/u.test(q)) return { kind: "name", text: q };
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4) return { kind: "phone", digits };
  return { kind: "name", text: q };
}
