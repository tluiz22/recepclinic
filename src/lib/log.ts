// Logs do servidor sem dados pessoais (F9.2, L43): só o escopo, ids (da
// clínica, do atendimento, da mensagem na Meta…) e o tipo e a mensagem do
// erro. Nunca o objeto do erro inteiro: o do Postgres traz em `details` os
// valores da linha, e o do e-mail, o endereço. Mesmo a mensagem passa por uma
// máscara de telefone e e-mail, porque pode vir da Meta, do banco ou do SMTP.
// Todo log do servidor passa por aqui (um teste confere que não há
// `console.*` fora deste arquivo).

/** Ids e contagens; nunca nome, telefone, e-mail ou texto de mensagem. */
export type LogIds = Record<string, string | number | boolean | null | undefined>;

const MAX_MESSAGE = 500;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// 10 dígitos ou mais (DDD + número, com ou sem +55), com separadores comuns;
// fora de palavras e ids (uuid, hash), que não são telefone.
const PHONE = /(?<![\w-])\+?\d(?:[\s().-]{0,2}\d){9,}(?![\w-])/g;

/** Troca telefones e e-mails do texto por marcadores. */
export function maskPersonalData(text: string): string {
  return text.replace(EMAIL, "[e-mail]").replace(PHONE, "[telefone]");
}

function oneError(error: unknown): { label: string; cause?: unknown } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return { label: `${error.name}${typeof code === "string" && code ? ` (${code})` : ""}: ${error.message}`, cause: error.cause };
  }
  if (error && typeof error === "object") {
    // Erro do supabase-js (PostgrestError e afins): só o código e a mensagem.
    const { code, message } = error as { code?: unknown; message?: unknown };
    const head = typeof code === "string" && code ? `(${code})` : "";
    return { label: [head, typeof message === "string" ? message : "erro sem mensagem"].filter(Boolean).join(" ") };
  }
  return { label: String(error) };
}

/** Tipo e mensagem do erro, com a causa (até 2 níveis), mascarados e cortados. */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current !== undefined && current !== null; depth++) {
    const { label, cause } = oneError(current);
    parts.push(label);
    current = cause;
  }
  const text = maskPersonalData(parts.join(" | causa: "));
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text;
}

function formatIds(ids: LogIds): string {
  return Object.entries(ids)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${maskPersonalData(String(value))}`)
    .join(" ");
}

/** Linha do log: `[escopo] ids — erro`. */
export function formatLogLine(scope: string, ids: LogIds = {}, error?: unknown): string {
  const idText = formatIds(ids);
  const errorText = error === undefined ? "" : describeError(error);
  return [`[${scope}]`, idText, errorText && `— ${errorText}`].filter(Boolean).join(" ");
}

export function logError(scope: string, error?: unknown, ids: LogIds = {}): void {
  console.error(formatLogLine(scope, ids, error));
}

export function logWarn(scope: string, ids: LogIds = {}): void {
  console.warn(formatLogLine(scope, ids));
}
