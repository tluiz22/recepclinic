import { logError } from "./log";

// Cloudflare Turnstile (F2b; RD9): o portal pede o CAPTCHA antes de mandar o código pela entrada direta e confere a
// resposta no servidor (siteverify). Sem resposta ou com erro de rede, não passa.

export const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  secretKey: string,
  token: string | null | undefined,
  remoteIp: string | null,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const response = await fetcher(SITEVERIFY, { method: "POST", body, signal: AbortSignal.timeout(8000) });
    const result = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    if (!result.success) logError("portal: CAPTCHA recusado", new Error((result["error-codes"] ?? []).join(", ") || "sem motivo"));
    return result.success === true;
  } catch (error) {
    logError("portal: CAPTCHA sem resposta", error);
    return false;
  }
}
