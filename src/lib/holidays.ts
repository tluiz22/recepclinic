// Feriados nacionais do Brasil — usado para nunca oferecer data de feriado
// na agenda (nem nas sugestões automáticas, nem numa data escolhida
// manualmente). Além dos feriados fixados em lei federal, inclui também
// Carnaval (segunda e terça), Quarta-feira de Cinzas (dia inteiro) e Corpus
// Christi por pedido do cliente — não são feriados nacionais obrigatórios
// por lei ("ponto facultativo"), mas na prática a clínica também não atende
// nesses dias.

const FIXED_HOLIDAYS: ReadonlyArray<readonly [month: number, day: number, name: string]> = [
  [1, 1, "Confraternização Universal"],
  [4, 21, "Tiradentes"],
  [5, 1, "Dia do Trabalho"],
  [9, 7, "Independência do Brasil"],
  [10, 12, "Nossa Senhora Aparecida"],
  [11, 2, "Finados"],
  [11, 15, "Proclamação da República"],
  [11, 20, "Dia Nacional de Zumbi e da Consciência Negra"], // federal desde 2023
  [12, 25, "Natal"],
];

// Domingo de Páscoa pelo algoritmo de Meeus/Jones/Butcher (calendário
// gregoriano) — usado para achar Carnaval, Quarta-feira de Cinzas,
// Sexta-feira Santa e Corpus Christi, todos calculados a partir dele.
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function shiftMonthDay(year: number, month: number, day: number, deltaDays: number): { month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// Deslocamentos em relação ao Domingo de Páscoa (dias negativos = antes).
const EASTER_OFFSET_HOLIDAYS: ReadonlyArray<readonly [offset: number, name: string]> = [
  [-48, "Segunda-feira de Carnaval"],
  [-47, "Terça-feira de Carnaval"],
  [-46, "Quarta-feira de Cinzas"],
  [-2, "Sexta-feira Santa"],
  [60, "Corpus Christi"],
];

const pad = (n: number) => String(n).padStart(2, "0");

export type NationalHoliday = { date: string; name: string };

/** Feriados nacionais do ano, em ordem de data (tela de Feriados, F4.4b). */
export function listNationalHolidays(year: number): NationalHoliday[] {
  const easter = easterSunday(year);
  const all = [
    ...FIXED_HOLIDAYS.map(([month, day, name]) => ({ month, day, name })),
    ...EASTER_OFFSET_HOLIDAYS.map(([offset, name]) => ({ ...shiftMonthDay(year, easter.month, easter.day, offset), name })),
  ];
  return all
    .map(({ month, day, name }) => ({ date: `${year}-${pad(month)}-${pad(day)}`, name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// `isoDate` no formato "yyyy-mm-dd" (mesmo usado no resto do módulo de
// agendamento — sem hora/fuso, é uma data corrida, não um instante).
export function isNationalHoliday(isoDate: string): boolean {
  return listNationalHolidays(Number(isoDate.slice(0, 4))).some((holiday) => holiday.date === isoDate);
}
