import { createHash, randomBytes, randomInt } from "node:crypto";

// Identificação e segurança do portal (recepção digital, F2b; proposta 5.1, 7.1 a 7.3; RD2, RD4, RD9). Sem banco:
// prazos, limites, o código, a sessão e o IP truncado.

/** Sessão do portal: cookie opaco, só o hash no banco; vale 2 horas. */
export const SESSION_COOKIE = "rc_portal";
export const SESSION_TTL_MS = 2 * 60 * 60_000;

/** Código: 6 números, vale 10 min, 5 tentativas, reenvio depois de 60 s (proposta 5.1). */
export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_MS = 60_000;

/** Limites de uso (proposta 7.2): por chave, numa janela; quem passa fica bloqueado 15 min → 1 h → 24 h. */
export const LIMITS = {
  codePerPhone: { action: "code", limit: 3, windowSeconds: 3600 },
  codePerIp: { action: "code", limit: 10, windowSeconds: 3600 },
  slotsPerIp: { action: "slots", limit: 300, windowSeconds: 600 },
  slotsPerSession: { action: "slots", limit: 60, windowSeconds: 600 },
  holdPerIp: { action: "hold", limit: 30, windowSeconds: 3600 },
  // Tentativas de código (além das 5 por código): por IP e por sessão.
  verifyPerIp: { action: "verify", limit: 30, windowSeconds: 3600 },
  verifyPerSession: { action: "verify", limit: 15, windowSeconds: 3600 },
} as const;
/** Reservas por celular em 24 h. */
export const MAX_HOLDS_PER_DAY = 5;

export type LimitRule = { action: string; limit: number; windowSeconds: number };

/** Token novo da sessão (vai no cookie) e o hash que o banco guarda. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Código de 6 números (com zeros à esquerda). */
export function newCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/** Hash do código, preso à sessão (o mesmo código em outra sessão não vale). */
export function hashCode(code: string, sessionId: string): string {
  return createHash("sha256").update(`${sessionId}:${code}`).digest("hex");
}

/** Só os números que o paciente digitou ou colou ("482 137" → "482137"); null fora do formato. */
export function cleanCode(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === CODE_LENGTH ? digits : null;
}

/** IPv4 /24 ("200.10.20.33" → "200.10.20") e IPv6 /48: limites e auditoria sem guardar o IP inteiro. */
export function ipPrefix(ip: string | null | undefined): string {
  const value = (ip ?? "").split(",")[0].trim().replace(/^::ffff:/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value.split(".").slice(0, 3).join(".");
  if (value.includes(":")) {
    // "::" vale quantos grupos de zero faltarem para 8 (2001:db8::1 → 2001:db8:0:…).
    const [head, tail = ""] = value.split("::");
    const left = head ? head.split(":") : [];
    const right = value.includes("::") && tail ? tail.split(":") : [];
    const groups = value.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
    return groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "") || "0").join(":");
  }
  return "desconhecido";
}

/** Celular mascarado: "+5584998764321" → "final 4321". */
export const phoneEnding = (e164: string) => `final ${e164.slice(-4)}`;

/** Segundos até poder reenviar o código (0 = já pode). */
export function resendWaitSeconds(sentAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((sentAt.getTime() + CODE_RESEND_MS - now.getTime()) / 1000));
}

/** "Tente de novo em 15 minutos", "em 1 hora", "amanhã" (bloqueio de 24 h). */
export function blockedText(until: Date, now: Date = new Date()): string {
  const minutes = Math.ceil((until.getTime() - now.getTime()) / 60_000);
  if (minutes <= 1) return "em 1 minuto";
  if (minutes < 60) return `em ${minutes} minutos`;
  const hours = Math.round(minutes / 60);
  return hours <= 1 ? "em 1 hora" : hours >= 20 ? "amanhã" : `em ${hours} horas`;
}

/** "0:59", "4:05" (contador da reserva e do reenvio). */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
