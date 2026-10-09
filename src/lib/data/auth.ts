import type { DbClient } from "./clients";
import { DataError } from "./errors";
import { logError } from "../log";

// Login do painel (F4.1): entrar, sair, recuperar a senha e aceitar o convite.
// Sem cadastro público: a equipe entra por convite (Administrador da clínica,
// F4.4). Os e-mails de convite e de recuperação trazem um link para
// /api/admin/auth/confirmar, que confere o link no servidor (token_hash) e abre
// a sessão; a pessoa então escolhe a senha.

export const MIN_PASSWORD_LENGTH = 8;
/** Limite do Supabase Auth (bcrypt). */
export const MAX_PASSWORD_LENGTH = 72;

export type EmailLinkType = "invite" | "recovery";

export function isEmailLinkType(value: string | null): value is EmailLinkType {
  return value === "invite" || value === "recovery";
}

export type PasswordProblem = "short" | "long" | "mismatch" | "same" | "weak" | "session" | "rejected";

export const PASSWORD_PROBLEMS: Record<PasswordProblem, string> = {
  short: `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  long: `A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`,
  mismatch: "As duas senhas não são iguais.",
  same: "Esta já é a sua senha atual: ela já está valendo. Entre no painel com ela.",
  weak: "Senha fraca demais. Use uma senha mais longa, misturando letras, números e símbolos.",
  session: "O link venceu ou já foi usado. Peça um novo link e tente de novo.",
  rejected: "Não foi possível usar esta senha. Escolha outra.",
};

/** Recusa do Supabase Auth ao gravar a senha → o que a tela diz (staging, 06/out/2026). */
export function passwordRejection(error: { code?: string; name?: string }): PasswordProblem {
  if (error.code === "same_password") return "same";
  if (error.code === "weak_password") return "weak";
  if (error.name === "AuthSessionMissingError" || error.code === "session_not_found" || error.code === "session_expired") return "session";
  return "rejected";
}

/** Problema com a senha nova antes de enviar (null = pode). */
export function passwordProblem(password: string, confirmation: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "short";
  if (password.length > MAX_PASSWORD_LENGTH) return "long";
  if (password !== confirmation) return "mismatch";
  return null;
}

export function isPasswordProblem(value: string | null): value is PasswordProblem {
  return value !== null && Object.hasOwn(PASSWORD_PROBLEMS, value);
}

export async function signIn(db: DbClient, email: string, password: string): Promise<boolean> {
  if (!email.trim() || !password) return false;
  const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
  return !error;
}

/**
 * Pede o e-mail de recuperação. Não diz se o e-mail existe (quem chama mostra
 * sempre a mesma mensagem); falha do serviço só vai para o log.
 */
export async function requestPasswordReset(db: DbClient, email: string): Promise<void> {
  const clean = email.trim();
  if (!clean) return;
  const { error } = await db.auth.resetPasswordForEmail(clean);
  if (error) logError("login: pedido de recuperação de senha falhou", error);
}

/** Confere o link do e-mail e abre a sessão (cookies). false = link vencido ou inválido. */
export async function verifyEmailLink(db: DbClient, tokenHash: string, type: EmailLinkType): Promise<boolean> {
  if (!tokenHash) return false;
  const { error } = await db.auth.verifyOtp({ token_hash: tokenHash, type });
  return !error;
}

/** Grava a senha nova de quem está com a sessão aberta (convite ou recuperação). */
export async function setNewPassword(db: DbClient, password: string, confirmation: string): Promise<void> {
  const problem = passwordProblem(password, confirmation);
  if (problem) throw new DataError("invalid", `Senha: ${PASSWORD_PROBLEMS[problem]}`, { password: problem });
  const { error } = await db.auth.updateUser({ password });
  if (error) {
    const problem = passwordRejection(error);
    if (problem === "rejected") logError("login: senha recusada pelo Auth", error);
    throw new DataError("invalid", `Senha: ${error.message}`, { password: problem }, { cause: error });
  }
}
