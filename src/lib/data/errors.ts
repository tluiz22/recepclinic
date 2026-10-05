// Erros da camada de acesso ao banco (F3), num formato que as telas e o bot
// conseguem tratar sem conhecer os códigos do Postgres.

export type DataErrorCode =
  /** Dado de entrada inválido (antes de ir ao banco ou recusado por uma regra dele). */
  | "invalid"
  /** Já existe (nome, telefone, data… repetidos na clínica). */
  | "duplicate"
  /** Registro não existe, ou o login não pode vê-lo (RLS). */
  | "not_found"
  /** Está em uso por outro registro e não pode sair. */
  | "in_use"
  /** O login não tem permissão para a operação (RLS, papel). */
  | "forbidden"
  /** Conflito de agenda (horários sobrepostos). */
  | "conflict"
  /** Item da matriz de acesso não liberado para a clínica (D11). */
  | "not_enabled"
  /** Limite da clínica atingido (ex.: profissionais ativos, D11). */
  | "limit_reached"
  /** Falha inesperada do banco ou da rede. */
  | "unexpected";

export class DataError extends Error {
  constructor(
    readonly code: DataErrorCode,
    message: string,
    /** Problemas por campo, para mostrar ao lado de cada um na tela. */
    readonly fields: Record<string, string> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DataError";
  }
}

type PostgrestLikeError = { code?: string; message?: string; details?: string | null; hint?: string | null };

/** Traduz o erro do supabase-js para DataError. */
export function fromDbError(error: unknown, context: string): DataError {
  const { code = "", message = "", hint } = (error ?? {}) as PostgrestLikeError;
  const say = (text: string) => `${context}: ${text}`;
  if (code === "P0001" && hint?.startsWith("feature_disabled:")) {
    return new DataError("not_enabled", say(message), {}, { cause: error });
  }
  if (code === "P0001" && hint === "professional_limit") {
    return new DataError("limit_reached", say(message), {}, { cause: error });
  }
  switch (code) {
    case "23505":
      return new DataError("duplicate", say("já existe um cadastro igual"), {}, { cause: error });
    case "23503":
      // Apagar algo referenciado ou apontar para algo que não existe.
      return message.includes("still referenced") || message.includes("update or delete")
        ? new DataError("in_use", say("está em uso e não pode ser removido"), {}, { cause: error })
        : new DataError("invalid", say("referência inexistente"), {}, { cause: error });
    case "23514":
    case "23502":
    case "22P02":
    case "22007":
    case "22008":
    case "22023":
    case "P0001":
      return new DataError("invalid", say(message || "dado inválido"), {}, { cause: error });
    case "23P01":
      return new DataError("conflict", say("horário em conflito"), {}, { cause: error });
    case "42501":
      return new DataError("forbidden", say("sem permissão"), {}, { cause: error });
    case "PGRST116":
      return new DataError("not_found", say("não encontrado"), {}, { cause: error });
    default:
      return new DataError("unexpected", say(message || "falha no banco"), {}, { cause: error });
  }
}

/**
 * Lança DataError se a resposta do banco trouxe erro; senão devolve os dados.
 * Sem erro, select e insert…select sempre trazem dados; insert sem select
 * traz null, e quem chama não usa o retorno.
 */
export function unwrap<R extends { data: unknown; error: unknown }>(result: R, context: string): NonNullable<R["data"]> {
  if (result.error) throw fromDbError(result.error, context);
  return result.data as NonNullable<R["data"]>;
}

/**
 * Para update/delete numa linha: o RLS esconde o que o login não pode mexer,
 * e o banco responde "0 linhas" em vez de erro. Aqui isso vira not_found.
 */
export function unwrapOne<R extends { data: unknown; error: unknown }>(result: R, context: string): NonNullable<R["data"]> {
  const data = unwrap(result, context);
  if (data === null || data === undefined) throw new DataError("not_found", `${context}: não encontrado`);
  return data;
}

/** Junta os problemas de validação e lança um único erro com todos eles. */
export class Validation {
  readonly fields: Record<string, string> = {};

  check(condition: boolean, field: string, message: string): void {
    if (!condition && !(field in this.fields)) this.fields[field] = message;
  }

  get ok(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfInvalid(context: string): void {
    if (!this.ok) {
      throw new DataError("invalid", `${context}: ${Object.values(this.fields).join("; ")}`, { ...this.fields });
    }
  }
}

/** Texto obrigatório: sem espaços nas pontas; vazio vira null. */
export function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
