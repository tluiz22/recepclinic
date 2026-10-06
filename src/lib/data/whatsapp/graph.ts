// Chamadas à API da Meta (Graph) para a conexão da clínica (F6.1): conferir
// o número com o token e inscrever a conta (WABA) no app RecepClinic, para os
// eventos chegarem ao webhook. O envio de mensagens entra na F6.2.

/** Versão da API da Meta (cada versão vale cerca de 2 anos; a v21.0 do piloto vence em 2026). */
export const GRAPH_API_VERSION = "v24.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export type Fetcher = typeof fetch;

export type GraphError = { code: number | null; message: string };

export class GraphRequestError extends Error {
  constructor(
    readonly what: string,
    readonly graph: GraphError,
  ) {
    super(`${what}: ${graph.message}${graph.code !== null ? ` (código ${graph.code})` : ""}`);
    this.name = "GraphRequestError";
  }
}

async function call<T>(fetcher: Fetcher, what: string, url: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetcher(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: number; message?: string } } & T;
  if (!response.ok || body.error) {
    throw new GraphRequestError(what, { code: body.error?.code ?? null, message: body.error?.message ?? `HTTP ${response.status}` });
  }
  return body;
}

export type PhoneNumberInfo = {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  /** Situação do nome de exibição na Meta (ex.: APPROVED, PENDING_REVIEW). */
  nameStatus: string | null;
  qualityRating: string | null;
  /** CLOUD_API quando o número está na API (não no app do celular). */
  platformType: string | null;
  /** Situação do número (ex.: CONNECTED). */
  status: string | null;
};

/** Confere o número com o token: se responder, o token vale para ele. */
export async function fetchPhoneNumberInfo(phoneNumberId: string, token: string, fetcher: Fetcher = fetch): Promise<PhoneNumberInfo> {
  const fields = "display_phone_number,verified_name,name_status,quality_rating,platform_type,status";
  const body = await call<Record<string, string | undefined>>(
    fetcher,
    "Número na Meta",
    `${GRAPH}/${encodeURIComponent(phoneNumberId)}?fields=${fields}`,
    token,
  );
  return {
    displayPhoneNumber: body.display_phone_number ?? null,
    verifiedName: body.verified_name ?? null,
    nameStatus: body.name_status ?? null,
    qualityRating: body.quality_rating ?? null,
    platformType: body.platform_type ?? null,
    status: body.status ?? null,
  };
}

/** Inscreve o app RecepClinic na conta (WABA): sem isso, os eventos não chegam ao webhook. */
export async function subscribeAppToWaba(wabaId: string, token: string, fetcher: Fetcher = fetch): Promise<void> {
  await call(fetcher, "Inscrição do app na conta do WhatsApp", `${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`, token, {
    method: "POST",
  });
}

/**
 * Registra o número na Cloud API com o PIN de 6 dígitos (verificação em duas
 * etapas do WhatsApp). Número posto direto na API (sem o app do celular)
 * precisa disso uma vez para receber e enviar.
 */
export async function registerPhoneNumber(phoneNumberId: string, pin: string, token: string, fetcher: Fetcher = fetch): Promise<void> {
  await call(fetcher, "Registro do número na Cloud API", `${GRAPH}/${encodeURIComponent(phoneNumberId)}/register`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
}
