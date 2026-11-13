// Base comum da API do Asaas (N1, planejamento-nfse-asaas.md seção 15): o
// faturamento (conta principal) e a nota fiscal (subcontas) usam o mesmo
// cliente HTTP. Timeout de 60 s (recomendação do Asaas); pedido que falhou não
// é repetido às cegas (quem chama procura antes pela referência externa).
// A chave vai só no cabeçalho `access_token`; nunca em log nem em mensagem.

export type Fetcher = typeof fetch;

export class AsaasApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Códigos de erro do Asaas (`errors[].code`), quando vierem. */
    readonly codes: string[] = [],
  ) {
    super(message);
    this.name = "AsaasApiError";
  }
}

/** Onde e com qual chave falar: a conta principal ou uma subconta. */
export type AsaasTarget = { baseUrl: string; apiKey: string };

type AsaasErrorBody = { errors?: { code?: string; description?: string }[] };

export type AsaasMethod = "GET" | "POST" | "PUT" | "DELETE";

export const ASAAS_TIMEOUT_MS = 60_000;

export async function asaasCall<T>(
  target: AsaasTarget,
  fetcher: Fetcher,
  method: AsaasMethod,
  path: string,
  body?: Record<string, unknown> | FormData,
): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = { access_token: target.apiKey, "User-Agent": "RecepClinic" };
  // No multipart, o fetch monta o Content-Type com o boundary.
  if (body && !isForm) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetcher(`${target.baseUrl}${path}`, {
      method,
      headers,
      body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
      signal: AbortSignal.timeout(ASAAS_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AsaasApiError(0, `Asaas fora do ar ou sem resposta (${error instanceof Error ? error.message : String(error)})`);
  }
  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      if (response.ok) throw new AsaasApiError(response.status, "Asaas respondeu algo que não é JSON");
    }
  }
  if (!response.ok) {
    const errors = (json as AsaasErrorBody | null)?.errors ?? [];
    const description = errors.map((e) => e.description ?? e.code).filter(Boolean).join("; ");
    const codes = errors.map((e) => e.code).filter((c): c is string => typeof c === "string");
    throw new AsaasApiError(response.status, `Asaas recusou (${response.status}): ${description || "sem detalhe"}`, codes);
  }
  return json as T;
}

/** Atalhos ligados a um destino. */
export function asaasClient(target: AsaasTarget, fetcher: Fetcher = fetch) {
  return {
    get: <T>(path: string) => asaasCall<T>(target, fetcher, "GET", path),
    post: <T>(path: string, body: Record<string, unknown> | FormData) => asaasCall<T>(target, fetcher, "POST", path, body),
    put: <T>(path: string, body: Record<string, unknown>) => asaasCall<T>(target, fetcher, "PUT", path, body),
    del: <T>(path: string) => asaasCall<T>(target, fetcher, "DELETE", path),
  };
}

export type AsaasList<T> = { data: T[]; hasMore?: boolean };

export const toReais = (cents: number) => Math.round(cents) / 100;
export const toCents = (value: number) => Math.round(value * 100);
export const query = (params: Record<string, string>) => new URLSearchParams(params).toString();
export const seg = (id: string) => encodeURIComponent(id);
