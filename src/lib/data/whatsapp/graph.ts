// Chamadas à API da Meta (Graph) para a conexão da clínica (F6.1): conferir
// o número com o token e inscrever a conta (WABA) no app RecepClinic, para os
// eventos chegarem ao webhook. F6.2: envio de mensagens pelo número da
// clínica e criação e situação dos templates na conta.

/** Versão da API da Meta (cada versão vale cerca de 2 anos; a v21.0 do piloto vence em 2026). */
export const GRAPH_API_VERSION = "v24.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export type Fetcher = typeof fetch;

/** `subcode`: detalhe da Meta (ex.: 2388024 = já existe conteúdo nesse idioma). */
export type GraphError = { code: number | null; message: string; subcode?: number | null };

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
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: number; message?: string; error_subcode?: number; error_user_title?: string; error_user_msg?: string };
  } & T;
  if (!response.ok || body.error) {
    // A mensagem para pessoas (em português, quando a Meta manda) vem antes da técnica ("Invalid parameter").
    const human = [body.error?.error_user_title, body.error?.error_user_msg].filter(Boolean).join(": ");
    throw new GraphRequestError(what, {
      code: body.error?.code ?? null,
      subcode: body.error?.error_subcode ?? null,
      message: human || body.error?.message || `HTTP ${response.status}`,
    });
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

/** Envia uma mensagem pelo número (corpo da Cloud API sem `messaging_product`); devolve o id da Meta. */
export async function sendMessage(
  phoneNumberId: string,
  token: string,
  message: Record<string, unknown>,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const body = await call<{ messages?: { id?: string }[] }>(
    fetcher,
    "Envio pelo WhatsApp",
    `${GRAPH}/${encodeURIComponent(phoneNumberId)}/messages`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...message }),
    },
  );
  const id = body.messages?.[0]?.id;
  if (!id) throw new GraphRequestError("Envio pelo WhatsApp", { code: null, message: "a Meta não devolveu o id da mensagem" });
  return id;
}

export type MetaTemplate = { id: string; name: string; language: string; status: string; rejectedReason: string | null };

/** Templates da conta com este nome (um por idioma). */
export async function fetchTemplatesByName(wabaId: string, name: string, token: string, fetcher: Fetcher = fetch): Promise<MetaTemplate[]> {
  const params = new URLSearchParams({ name, fields: "id,name,language,status,rejected_reason", limit: "50" });
  const body = await call<{ data?: Record<string, string | undefined>[] }>(
    fetcher,
    "Templates da conta",
    `${GRAPH}/${encodeURIComponent(wabaId)}/message_templates?${params}`,
    token,
  );
  return (body.data ?? [])
    .filter((t) => t.name === name)
    .map((t) => ({
      id: t.id ?? "",
      name: t.name ?? name,
      language: t.language ?? "",
      status: t.status ?? "",
      rejectedReason: t.rejected_reason ?? null,
    }));
}

/** Cria o template na conta, para a análise da Meta; devolve o id e a situação inicial. */
export async function createTemplate(
  wabaId: string,
  payload: Record<string, unknown>,
  token: string,
  fetcher: Fetcher = fetch,
): Promise<{ id: string; status: string }> {
  const body = await call<{ id?: string; status?: string }>(
    fetcher,
    "Criação do template",
    `${GRAPH}/${encodeURIComponent(wabaId)}/message_templates`,
    token,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
  );
  return { id: body.id ?? "", status: body.status ?? "PENDING" };
}
