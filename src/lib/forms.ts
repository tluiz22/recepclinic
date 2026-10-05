// Leitura dos formulários do painel (F4.3): campos de texto, números, valores
// em reais e caixas de marcar. Valor inválido vira NaN (ou null, se vazio) e a
// camada de acesso recusa com a mensagem do campo.

type Form = FormData | null | undefined;

export function formText(form: Form, name: string): string {
  return form?.get(name)?.toString() ?? "";
}

/** Texto opcional: vazio vira null. */
export function formOptionalText(form: Form, name: string): string | null {
  const value = formText(form, name).trim();
  return value ? value : null;
}

/** Número inteiro; vazio ou inválido = NaN. */
export function formInt(form: Form, name: string): number {
  const value = formText(form, name).trim();
  return /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
}

/** Número inteiro opcional: vazio = null; inválido = NaN. */
export function formOptionalInt(form: Form, name: string): number | null {
  return formText(form, name).trim() === "" ? null : formInt(form, name);
}

/**
 * Valor em reais → centavos: "150", "150,5", "150.50" e "1.234,56". Vazio ou
 * inválido = NaN.
 */
export function parseMoneyCents(raw: string): number {
  let value = raw.trim().replace(/^R\$\s*/, "");
  if (!value) return Number.NaN;
  if (value.includes(",")) value = value.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return Number.NaN;
  return Math.round(Number(value) * 100);
}

export function formMoneyCents(form: Form, name: string): number {
  return parseMoneyCents(formText(form, name));
}

/** Valor opcional: vazio = null. */
export function formOptionalMoneyCents(form: Form, name: string): number | null {
  return formText(form, name).trim() === "" ? null : formMoneyCents(form, name);
}

/** Caixa de marcar. */
export function formChecked(form: Form, name: string): boolean {
  return form?.has(name) ?? false;
}

export function formAll(form: Form, name: string): string[] {
  return (form?.getAll(name) ?? []).map(String);
}

/** Centavos → "150,00" (campo de valor no formulário). */
export function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}
