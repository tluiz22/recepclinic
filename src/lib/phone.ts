import { isAnonymizedPhone } from "./anonymization";

const E164_REGEX = /^\+\d{10,15}$/;
// Brasil (cliente, 17/out/2026): DDD sem zero e celular com 9 + 8 dígitos ou
// fixo com 8 dígitos começando de 2 a 5. Antes, qualquer número de 8 a 13
// dígitos passava (um celular sem os dois últimos dígitos era gravado).
const BR_NUMBER = /^[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/;

export function normalizePhone(rawPhone: string): string | null {
  const cleaned = rawPhone.replace(/[^\d+]/g, "");
  // Fora do Brasil, só com o "+" e o código do país.
  if (cleaned.startsWith("+") && !cleaned.startsWith("+55")) return E164_REGEX.test(cleaned) ? cleaned : null;
  let digits = cleaned.replace(/\D/g, "");
  if (cleaned.startsWith("+55") || (digits.length >= 12 && digits.startsWith("55"))) digits = digits.slice(2);
  return BR_NUMBER.test(digits) ? `+55${digits}` : null;
}

// "+5561998645490" → "(61) 99864-5490" e "+556133334444" → "(61) 3333-4444":
// exibição do telefone brasileiro, sem o +55 (cliente, 17/out/2026). Número
// brasileiro fora do formato (gravado antes da regra nova) aparece com o DDD
// e o resto; de outro país, como veio.
export function formatPhoneBR(e164: string): string {
  // Contato anonimizado (F9.4): o número não existe.
  if (isAnonymizedPhone(e164)) return "telefone anonimizado";
  const match = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  if (match) return `(${match[1]}) ${match[2]}-${match[3]}`;
  const br = e164.match(/^\+55(\d{2})(\d+)$/);
  return br ? `(${br[1]}) ${br[2]}` : e164;
}

// Conversa no WhatsApp instalado no aparelho de quem está usando o painel
// (wa.me, sem texto pronto) — Fase 23, ao lado de cada telefone do admin.
export function whatsappHref(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}

/** Telefone inválido, igual em todas as telas (U-08 da auditoria, cliente, 17/out/2026). */
export const INVALID_PHONE_MESSAGE = "Telefone inválido: informe DDD + número, ex.: (84) 98188-0777.";
