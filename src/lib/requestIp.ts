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
