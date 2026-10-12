// CNPJ dos dados fiscais (F11.3, cliente, 12/out/2026): gravado só com os 14
// caracteres; o banco confere os dígitos verificadores de novo
// (app.is_valid_cnpj). Já aceita o CNPJ alfanumérico da Receita (letras nas 12
// primeiras posições; cada caractere vale o código ASCII − 48).

const WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Sem pontuação e em maiúsculas, ou null se não for um CNPJ válido. */
export function normalizeCnpj(input: string | null | undefined): string | null {
  const chars = (input ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return isValidCnpj(chars) ? chars : null;
}

/** 14 caracteres (12 letras ou números e 2 dígitos), com os dois dígitos verificadores certos. */
export function isValidCnpj(chars: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(chars) || /^(.)\1{13}$/.test(chars)) return false;
  for (const position of [12, 13]) {
    let sum = 0;
    for (let i = 0; i < position; i++) sum += (chars.charCodeAt(i) - 48) * WEIGHTS[i + 13 - position];
    const check = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (check !== Number(chars[position])) return false;
  }
  return true;
}

/** "11222333000181" → "11.222.333/0001-81". */
export function formatCnpj(chars: string): string {
  return chars.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, "$1.$2.$3/$4-$5");
}
