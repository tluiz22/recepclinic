// Logs do servidor sem dados pessoais (F9.2, L43): só o escopo, ids (da
// clínica, do atendimento, da mensagem na Meta…) e o tipo e a mensagem do
// erro. Nunca o objeto do erro inteiro: o do Postgres traz em `details` os
// valores da linha, e o do e-mail, o endereço. Mesmo a mensagem passa por uma
// máscara de telefone e e-mail, porque pode vir da Meta, do banco ou do SMTP.
// Todo log do servidor passa por aqui (um teste confere que não há
// `console.*` fora deste arquivo). Cada erro também vai para o destino
// registrado (F9.3: a tabela system_errors, ligada no middleware).

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

/** O que o destino recebe: tudo já sem dados pessoais. */
export type ErrorRecord = { scope: string; clinicId: string | null; ids: Record<string, string>; message: string };

type ErrorSink = (record: ErrorRecord) => Promise<void>;
/** Mantém a função viva até o fim da gravação (na Vercel, waitUntil). */
type Defer = (work: Promise<unknown>) => void;

let sink: { record: ErrorSink; defer: Defer } | null = null;

/** Liga (ou desliga, com null) o destino dos erros. */
export function setErrorSink(record: ErrorSink | null, defer: Defer = () => {}): void {
  sink = record ? { record, defer } : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Registro do erro: a clínica (de `ids.clinica`, se for um id) à parte; os demais ids em texto. */
export function toErrorRecord(scope: string, ids: LogIds = {}, error?: unknown): ErrorRecord {
  const clinic = typeof ids.clinica === "string" && UUID.test(ids.clinica) ? ids.clinica : null;
  const rest = Object.entries(ids)
    .filter(([key, value]) => !(key === "clinica" && clinic) && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, maskPersonalData(String(value)).slice(0, 200)] as const);
  return {
    scope: maskPersonalData(scope).slice(0, 200),
    clinicId: clinic,
    ids: Object.fromEntries(rest),
    message: error === undefined ? "" : describeError(error),
  };
}

export function logError(scope: string, error?: unknown, ids: LogIds = {}): void {
  console.error(formatLogLine(scope, ids, error));
  if (!sink) return;
  const { record, defer } = sink;
  // Falha ao gravar o erro só vai para o log (sem gravar de novo, sem laço).
  defer(record(toErrorRecord(scope, ids, error)).catch((failure) => console.error(formatLogLine("erros: não gravou no banco", {}, failure))));
}

export function logWarn(scope: string, ids: LogIds = {}): void {
  console.warn(formatLogLine(scope, ids));
}
