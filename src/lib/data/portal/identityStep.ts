import type { AstroGlobal } from "astro";
import { platformEnv } from "../../env";
import { normalizePhone } from "../../phone";
import { cleanCode, clock, ipPrefix, LIMITS } from "../../portalIdentity";
import { verifyTurnstile } from "../../turnstile";
import type { DbClient } from "../clients";
import { createPortalCodeSender } from "../whatsapp/codeSender";
import { ensureSession, forgetPhone, hitLimits, pendingCode, readSession, sendCode, verifyCode, type PendingCode, type PortalSession, type SendCodeResult } from "./identity";

// Passo "Qual é o seu celular com WhatsApp?" (F2b, P7), usado depois do horário (consulta e exame) e antes da lista do
// retorno (F2d): CAPTCHA (Turnstile) → código de 6 números pelo WhatsApp (número do RecepClinic, seção 14 do plano) → celular comprovado na sessão.
// Formulários POST na própria página (o endereço do portal não abre o /api). Limites e bloqueio progressivo no servidor.

export type IdentityProblem = { field: "phone" | "code" | "page"; text: string };

export type IdentityState = {
  /** Redirecionar (código mandado, celular comprovado com o próximo passo pronto…). */
  response: Response | null;
  session: PortalSession | null;
  problem: IdentityProblem | null;
  typedPhone: string;
  blockedUntil: Date | null;
  pending: PendingCode | null;
  /** Só no computador local (npm run dev): o código na tela. */
  devCode: string | null;
  unavailable: boolean;
  turnstile: { siteKey: string } | null;
};

export function clientIpOf(Astro: AstroGlobal): string | null {
  try {
    return Astro.clientAddress;
  } catch {
    return Astro.request.headers.get("x-forwarded-for");
  }
}

/**
 * Trata os formulários do celular e do código. `onVerified` roda com o celular comprovado (logo depois do código, ou ao
 * abrir a página já comprovada) e devolve o próximo passo; null fica na página (com `problem` ou `blockedUntil`
 * preenchidos por ele, via o `state` que recebe).
 */
export async function runIdentityStep(
  Astro: AstroGlobal,
  input: {
    db: DbClient;
    clinicId: string;
    /** Esta página, com os parâmetros do caminho. */
    here: string;
    onVerified: (session: PortalSession, state: IdentityState) => Promise<Response | null>;
    /** A sessão já lida pela página (evita ler de novo); undefined = ler aqui. */
    session?: PortalSession | null;
  },
): Promise<IdentityState> {
  const { db, clinicId, here } = input;
  const devMode = import.meta.env.DEV;
  const turnstileEnv = platformEnv().turnstile;
  const clientIp = clientIpOf(Astro);
  const ip = ipPrefix(clientIp);
  const state: IdentityState = {
    response: null,
    session: input.session !== undefined ? input.session : await readSession(db, clinicId, Astro.cookies),
    problem: null,
    typedPhone: "",
    blockedUntil: null,
    pending: null,
    devCode: devMode ? Astro.url.searchParams.get("dev") : null,
    unavailable: false,
    turnstile: turnstileEnv ? { siteKey: turnstileEnv.siteKey } : null,
  };
  const withDev = (code: string) => `${here}${here.includes("?") ? "&" : "?"}dev=${code}`;
  const afterSend = (sent: SendCodeResult, field: "phone" | "code"): Response | null => {
    if (sent.status === "sent") return Astro.redirect(sent.devCode ? withDev(sent.devCode) : here);
    if (sent.status === "wait") state.problem = { field, text: `Já mandamos um código. Você pode pedir outro em ${clock(sent.seconds)}.` };
    if (sent.status === "blocked") state.blockedUntil = sent.until;
    if (sent.status === "unavailable") state.unavailable = true;
    return null;
  };
  const sender = () => createPortalCodeSender();
  const finish = (response: Response | null) => {
    state.response = response;
    return state;
  };

  if (Astro.request.method === "POST") {
    const form = await Astro.request.formData().catch(() => null);
    const action = String(form?.get("acao") ?? "");
    let session = state.session;
    if (action === "enviar") {
      state.typedPhone = String(form?.get("celular") ?? "").slice(0, 30);
      const phone = normalizePhone(state.typedPhone);
      if (!phone || !/^\+55\d{2}9\d{8}$/.test(phone)) {
        state.problem = { field: "phone", text: "Confira o DDD e o número do celular." };
      } else if (!turnstileEnv && !devMode) {
        state.unavailable = true;
      } else if (turnstileEnv && !(await verifyTurnstile(turnstileEnv.secretKey, String(form?.get("cf-turnstile-response") ?? ""), clientIp))) {
        state.problem = { field: "phone", text: "Não conseguimos confirmar que você não é um robô. Tente de novo." };
      } else {
        session = await ensureSession(db, clinicId, Astro.cookies, { ip, secure: Astro.url.protocol === "https:" });
        state.session = session;
        const next = afterSend(await sendCode(db, clinicId, session, phone, { ip, sender: sender(), devMode }), "phone");
        if (next) return finish(next);
      }
    } else if (session && action === "reenviar") {
      const current = await pendingCode(db, clinicId, session.id);
      if (current) {
        const next = afterSend(await sendCode(db, clinicId, session, current.phone, { ip, sender: sender(), devMode }), "code");
        if (next) return finish(next);
      }
    } else if (session && action === "codigo") {
      const code = cleanCode(String(form?.get("codigo") ?? ""));
      if (!code) {
        state.problem = { field: "code", text: "Digite os 6 números do código." };
      } else {
        const blocked = await hitLimits(db, clinicId, [
          [`ip:${ip}`, LIMITS.verifyPerIp],
          [`session:${session.id}`, LIMITS.verifyPerSession],
        ]);
        const result = blocked ? null : await verifyCode(db, clinicId, session, code);
        if (!result) {
          state.blockedUntil = blocked;
        } else if (result.status === "ok") {
          // O celular já está comprovado nesta sessão (se o próximo passo não sair agora, a página não pede o código de novo).
          session = { ...session, phone: result.phone, verified: true };
          state.session = session;
          const next = await input.onVerified(session, state);
          if (next) return finish(next);
        } else if (result.status === "wrong") {
          state.problem = { field: "code", text: `Código incorreto. ${result.attemptsLeft === 1 ? "Resta 1 tentativa." : `Restam ${result.attemptsLeft} tentativas.`}` };
        } else {
          state.problem = {
            field: "page",
            text: result.status === "expired" ? "O código venceu. Digite o celular de novo para receber outro." : "Muitas tentativas com este código. Digite o celular de novo para receber outro.",
          };
        }
      }
    } else if (session && action === "trocar") {
      await forgetPhone(db, clinicId, session.id);
      return finish(Astro.redirect(here));
    } else if (session?.verified) {
      // Outro formulário da página (o do próximo passo): a página trata.
      return state;
    }
  } else if (state.session?.verified) {
    const next = await input.onVerified(state.session, state);
    if (next) return finish(next);
  }
  if (state.session && !state.session.verified) state.pending = await pendingCode(db, clinicId, state.session.id);
  if (!state.pending) state.devCode = null;
  return state;
}

/** Limite de reservas por IP (o mesmo da P7). */
export const holdBlocked = (db: DbClient, clinicId: string, Astro: AstroGlobal) => hitLimits(db, clinicId, [[`ip:${ipPrefix(clientIpOf(Astro))}`, LIMITS.holdPerIp]]);
