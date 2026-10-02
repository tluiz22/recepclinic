const E164_REGEX = /^\+\d{10,15}$/;

export function normalizePhone(rawPhone: string): string | null {
  const cleaned = rawPhone.replace(/[^\d+]/g, "");
  const withCountryCode = cleaned.startsWith("+") ? cleaned : `+55${cleaned}`;

  return E164_REGEX.test(withCountryCode) ? withCountryCode : null;
}

// "+5561998645490" → "(61) 99864-5490" — formatação de exibição pro
// telefone brasileiro armazenado em E.164 (só celular, único tipo aceito no
// cadastro). Números fora desse formato voltam como vieram, sem quebrar a
// tela.
export function formatPhoneBR(e164: string): string {
  const match = e164.match(/^\+55(\d{2})(\d{5})(\d{4})$/);
  if (!match) return e164;
  const [, ddd, prefix, suffix] = match;
  return `(${ddd}) ${prefix}-${suffix}`;
}

// Conversa no WhatsApp instalado no aparelho de quem está usando o painel
// (wa.me, sem texto pronto) — Fase 23, ao lado de cada telefone do admin.
export function whatsappHref(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}
