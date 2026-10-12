// CPF no Módulo financeiro (F11.1, cliente, 12/out/2026): gravado só com os
// 11 dígitos; o banco confere os dígitos verificadores de novo
// (app.is_valid_cpf). Nas listas, aparece mascarado.

/** Só os dígitos do que foi digitado, ou null se não for um CPF válido. */
export function normalizeCpf(input: string | null | undefined): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  return isValidCpf(digits) ? digits : null;
}

/** 11 dígitos, não todos iguais, com os dois dígitos verificadores certos. */
export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  for (const position of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < position; i++) sum += Number(digits[i]) * (position + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(digits[position])) return false;
  }
  return true;
}

/** "12345678909" → "123.456.789-09". */
export function formatCpf(digits: string): string {
  return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

/** Para listas: só os dígitos do meio ("•••.456.789-••"). */
export function maskCpf(digits: string): string {
  return digits.replace(/^\d{3}(\d{3})(\d{3})\d{2}$/, "•••.$1.$2-••");
}
