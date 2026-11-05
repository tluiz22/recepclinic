// IP de quem fez o pedido: o 1º do x-forwarded-for (Vercel), senão o da
// conexão. Usado no aceite do contrato (F12.2b) e no cartão da assinatura
// (F12.2i: o Asaas exige o IP de quem informou o cartão).
export function requestIp(context: { request: Request; clientAddress?: string }): string | null {
  const forwarded = context.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  // O Astro lança erro quando o adaptador não informa o endereço.
  try {
    return context.clientAddress ?? null;
  } catch {
    return null;
  }
}

/**
 * Endereço de volta para o Asaas (Checkout): o Asaas recusa o nome
 * "localhost" (sandbox, 04/nov/2026) e aceita 127.0.0.1. Fora do local, igual.
 */
export function asaasCallbackUrl(path: string, base: string): string {
  const url = new URL(path, base);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.toString();
}
