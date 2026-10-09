// Cabeçalhos de segurança de toda resposta do servidor (F9.1, L44). O CSP sai
// do próprio Astro (astro.config.mjs); estes completam: sem página em
// moldura de outro site, sem adivinhar o tipo do arquivo, só HTTPS, referência
// só com a origem (os links públicos levam código no caminho) e nada de
// indexação (o domínio é só painel e links de pacientes; o site institucional
// é outro).
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "X-Robots-Tag": "noindex, nofollow",
};

/** A resposta com os cabeçalhos; copia a resposta quando os dela não podem mudar. */
export function withSecurityHeaders(response: Response): Response {
  let target = response;
  try {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) target.headers.set(name, value);
  } catch {
    target = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) target.headers.set(name, value);
  }
  return target;
}
