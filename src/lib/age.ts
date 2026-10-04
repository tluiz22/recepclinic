// Maioridade (Fase 21): 18+ pode ser o próprio responsável e marcar exame
// para si.
export const ADULT_AGE_YEARS = 18;

// Idade em anos completos, com as mesmas datas puras de formatAge. Quem faz
// aniversário na data de referência já conta o ano novo.
export function ageInYears(birthdateIso: string, referenceDateIso: string): number {
  const [by, bm, bd] = birthdateIso.split("-").map(Number);
  const [ry, rm, rd] = referenceDateIso.split("-").map(Number);

  let years = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) years -= 1;
  return years;
}

export function isAdult(birthdateIso: string, referenceDateIso: string): boolean {
  return ageInYears(birthdateIso, referenceDateIso) >= ADULT_AGE_YEARS;
}

// Idade limite para Consulta (Configurações > Duração): pode marcar até
// completar o limite — com limite 14, 13 anos e 11 meses pode; no dia em que
// faz 14, não pode mais. Não vale para Retorno nem Exame.
export function isOverConsultationAgeLimit(
  birthdateIso: string,
  referenceDateIso: string,
  limitYears: number,
): boolean {
  return ageInYears(birthdateIso, referenceDateIso) >= limitYears;
}

// Idade legível a partir de uma data de nascimento (YYYY-MM-DD), relativa a
// uma data de referência (também YYYY-MM-DD — evita qualquer ambiguidade de
// fuso horário, os dois são datas puras, sem hora). Detalhada pra bebês e
// crianças pequenas (contexto pediátrico, onde meses importam), simples a
// partir de 3 anos.
export function formatAge(birthdateIso: string, referenceDateIso: string): string {
  // Nascimento depois da data de referência só vem de dado errado (o banco
  // recusa): aparece como tal (achado 3 da F1, decisão do cliente na F3.5).
  if (birthdateIso > referenceDateIso) return "nascimento inválido";

  const [by, bm, bd] = birthdateIso.split("-").map(Number);
  const [ry, rm, rd] = referenceDateIso.split("-").map(Number);

  let years = ry - by;
  let months = rm - bm;
  if (rd < bd) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years < 1) {
    if (months < 1) {
      const totalDays = Math.max(0, Math.round((Date.UTC(ry, rm - 1, rd) - Date.UTC(by, bm - 1, bd)) / 86_400_000));
      return totalDays === 1 ? "1 dia" : `${totalDays} dias`;
    }
    return months === 1 ? "1 mês" : `${months} meses`;
  }

  if (years < 3) {
    const yearLabel = years === 1 ? "1 ano" : `${years} anos`;
    if (months === 0) return yearLabel;
    const monthLabel = months === 1 ? "1 mês" : `${months} meses`;
    return `${yearLabel} e ${monthLabel}`;
  }

  return years === 1 ? "1 ano" : `${years} anos`;
}
