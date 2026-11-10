import type { AstroCookies } from "astro";
import type { DbClient } from "../clients";
import { unwrap } from "../errors";
import type { PortalCodeSender } from "../whatsapp/codeSender";
import { logError } from "../../log";
import {
  CODE_MAX_ATTEMPTS,
  CODE_RESEND_MS,
  CODE_TTL_MS,
  hashCode,
  hashToken,
  LIMITS,
  MAX_HOLDS_PER_DAY,
  newCode,
  newSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type LimitRule,
} from "../../portalIdentity";

// Identificação do paciente no portal (F2b; proposta 5.1 e 7): sessão em cookie, código de 6 números pelo WhatsApp da
// clínica, limites de uso com bloqueio progressivo e a reserva do horário. Tudo com a credencial limitada à clínica;
// as contas de limite e a reserva ficam em funções do banco (migração 20270104120000).

/** `linkId`: a sessão abriu pelo link do bot (F3a), com o celular da conversa comprovado. */
export type PortalSession = { id: string; phone: string | null; verified: boolean; expiresAt: Date; linkId: string | null };

/** Sessão do cookie, se é desta clínica e não venceu. */
export async function readSession(db: DbClient, clinicId: string, cookies: AstroCookies, now: Date = new Date()): Promise<PortalSession | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const row = unwrap(
    await db
      .from("portal_sessions")
      .select("id, phone, phone_verified_at, expires_at, link_id")
      .eq("clinic_id", clinicId)
      .eq("token_hash", hashToken(token))
      .gt("expires_at", now.toISOString())
      .maybeSingle(),
    "Sessão do portal",
  );
  return row ? { id: row.id, phone: row.phone, verified: !!row.phone_verified_at, expiresAt: new Date(row.expires_at), linkId: row.link_id } : null;
}

/** A sessão do cookie, ou uma nova (cookie HttpOnly, SameSite=Lax; Secure fora do computador local). */
export async function ensureSession(
  db: DbClient,
  clinicId: string,
  cookies: AstroCookies,
  { ip, secure, now = new Date() }: { ip: string; secure: boolean; now?: Date },
): Promise<PortalSession> {
  const current = await readSession(db, clinicId, cookies, now);
  if (current) return current;
  const token = newSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const { data, error } = await db
    .from("portal_sessions")
    .insert({ clinic_id: clinicId, token_hash: hashToken(token), ip_prefix: ip, expires_at: expiresAt.toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  cookies.set(SESSION_COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", secure, expires: expiresAt });
  return { id: data.id, phone: null, verified: false, expiresAt, linkId: null };
}

/** Conta um uso; null = pode seguir; senão, bloqueado até a data. */
export async function hitLimit(db: DbClient, clinicId: string, key: string, rule: LimitRule): Promise<Date | null> {
  const { data, error } = await db.rpc("portal_rate_hit", {
    p_clinic_id: clinicId,
    p_key: key,
    p_action: rule.action,
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) throw error;
  return data ? new Date(data) : null;
}

/** Vários limites de uma vez: o primeiro bloqueio encontrado (todos são contados). */
export async function hitLimits(db: DbClient, clinicId: string, checks: [string, LimitRule][]): Promise<Date | null> {
  const results = await Promise.all(checks.map(([key, rule]) => hitLimit(db, clinicId, key, rule)));
  const blocked = results.filter((d): d is Date => d !== null).map((d) => d.getTime());
  return blocked.length ? new Date(Math.max(...blocked)) : null;
}

export type PendingCode = { phone: string; sentAt: Date; expiresAt: Date; attemptsLeft: number };

/** O último código da sessão ainda válido e não usado. */
export async function pendingCode(db: DbClient, clinicId: string, sessionId: string, now: Date = new Date()): Promise<PendingCode | null> {
  const row = unwrap(
    await db
      .from("portal_codes")
      .select("phone, created_at, expires_at, attempts")
      .eq("clinic_id", clinicId)
      .eq("session_id", sessionId)
      .is("used_at", null)
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "Código do portal",
  );
  if (!row || row.attempts >= CODE_MAX_ATTEMPTS) return null;
  return { phone: row.phone, sentAt: new Date(row.created_at), expiresAt: new Date(row.expires_at), attemptsLeft: CODE_MAX_ATTEMPTS - row.attempts };
}

export type SendCodeResult =
  | { status: "sent"; devCode?: string }
  | { status: "wait"; seconds: number }
  | { status: "blocked"; until: Date }
  | { status: "unavailable" };

/**
 * Manda um código novo para o celular (o CAPTCHA já foi conferido por quem chama). Limites: 3 por celular e 10 por IP
 * por hora; reenvio só depois de 60 s. O código sai do número do RecepClinic (seção 14 do plano); sem ele configurado ou
 * com o envio recusado pela Meta: indisponível (a página leva à recepção). `devMode`: no computador local, sem envio de verdade, o código volta para aparecer na tela.
 */
export async function sendCode(
  db: DbClient,
  clinicId: string,
  session: PortalSession,
  phone: string,
  { ip, sender, devMode = false, now = new Date() }: { ip: string; sender: PortalCodeSender | null; devMode?: boolean; now?: Date },
): Promise<SendCodeResult> {
  const last = await pendingCode(db, clinicId, session.id, now);
  if (last && last.phone === phone && now.getTime() - last.sentAt.getTime() < CODE_RESEND_MS) {
    return { status: "wait", seconds: Math.ceil((last.sentAt.getTime() + CODE_RESEND_MS - now.getTime()) / 1000) };
  }
  // Sem como mandar, nem conta o limite: o paciente não fica bloqueado à toa.
  if (!sender && !devMode) return { status: "unavailable" };
  const blocked = await hitLimits(db, clinicId, [
    [`phone:${phone}`, LIMITS.codePerPhone],
    [`ip:${ip}`, LIMITS.codePerIp],
  ]);
  if (blocked) return { status: "blocked", until: blocked };

  const code = newCode();
  let sent = false;
  if (sender) {
    const outcome = await sender.send(phone, code);
    sent = outcome.sent;
    if (!outcome.sent) logError("portal: código não enviado", new Error(outcome.reason), { clinica: clinicId });
  }
  if (!sent && !devMode) return { status: "unavailable" };

  // O código anterior deixa de valer.
  unwrap(
    await db.from("portal_codes").update({ used_at: now.toISOString() }).eq("clinic_id", clinicId).eq("session_id", session.id).is("used_at", null),
    "Código do portal",
  );
  unwrap(
    await db.from("portal_codes").insert({
      clinic_id: clinicId,
      session_id: session.id,
      phone,
      code_hash: hashCode(code, session.id),
      expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
      created_at: now.toISOString(),
    }),
    "Código do portal",
  );
  return sent ? { status: "sent" } : { status: "sent", devCode: code };
}

export type VerifyResult = { status: "ok"; phone: string } | { status: "wrong"; attemptsLeft: number } | { status: "expired" } | { status: "exhausted" };

/** Confere o código digitado (no banco, com a linha travada); certo, a sessão passa a ter o celular comprovado. */
export async function verifyCode(db: DbClient, clinicId: string, session: PortalSession, code: string): Promise<VerifyResult> {
  const { data, error } = await db.rpc("portal_code_attempt", {
    p_clinic_id: clinicId,
    p_session_id: session.id,
    p_code_hash: hashCode(code, session.id),
    p_max_attempts: CODE_MAX_ATTEMPTS,
  });
  if (error) throw error;
  const row = (data as { outcome: string; attempts_left: number; phone: string | null }[])[0];
  if (row?.outcome === "ok" && row.phone) return { status: "ok", phone: row.phone };
  if (row?.outcome === "wrong") return { status: "wrong", attemptsLeft: row.attempts_left };
  return { status: row?.outcome === "exhausted" ? "exhausted" : "expired" };
}

/** "Trocar número" / "Usar outro número": o celular comprovado, o link do bot e o código pendente deixam de valer nesta sessão. */
export async function forgetPhone(db: DbClient, clinicId: string, sessionId: string, now: Date = new Date()): Promise<void> {
  unwrap(await db.from("portal_codes").update({ used_at: now.toISOString() }).eq("session_id", sessionId).is("used_at", null), "Código do portal");
  unwrap(await db.from("portal_sessions").update({ phone: null, phone_verified_at: null, link_id: null }).eq("id", sessionId), "Sessão do portal");
  await releaseHold(db, clinicId, sessionId);
}

export type HoldResult = { status: "ok"; holdId: string; expiresAt: Date } | { status: "taken" | "limit" | "session" };

/** Reserva o horário para a sessão (a anterior dela é solta). */
export async function holdSlot(
  db: DbClient,
  clinicId: string,
  sessionId: string,
  slot: { agendaId: string; serviceId: string; locationId: string; start: Date; end: Date },
): Promise<HoldResult> {
  const { data, error } = await db.rpc("portal_hold_slot", {
    p_clinic_id: clinicId,
    p_session_id: sessionId,
    p_agenda_id: slot.agendaId,
    p_service_id: slot.serviceId,
    p_location_id: slot.locationId,
    p_starts_at: slot.start.toISOString(),
    p_ends_at: slot.end.toISOString(),
    p_max_per_day: MAX_HOLDS_PER_DAY,
  });
  if (error) throw error;
  const row = (data as { outcome: string; hold_id: string | null; hold_expires_at: string | null }[])[0];
  if (row?.outcome === "ok" && row.hold_id && row.hold_expires_at) return { status: "ok", holdId: row.hold_id, expiresAt: new Date(row.hold_expires_at) };
  return { status: (row?.outcome ?? "taken") as "taken" | "limit" | "session" };
}

/**
 * Reserva uma vaga da turma (F3e-2): vale enquanto os marcados mais as reservas de outras sessões não chegam à
 * capacidade (migração 20270108130000). A capacidade vem da leitura das turmas (getGroupSessions).
 */
export async function holdGroupSlot(
  db: DbClient,
  clinicId: string,
  sessionId: string,
  slot: { agendaId: string; serviceId: string; locationId: string; start: Date; end: Date; capacity: number },
): Promise<HoldResult> {
  const { data, error } = await db.rpc("portal_hold_group_slot", {
    p_clinic_id: clinicId,
    p_session_id: sessionId,
    p_agenda_id: slot.agendaId,
    p_service_id: slot.serviceId,
    p_location_id: slot.locationId,
    p_starts_at: slot.start.toISOString(),
    p_ends_at: slot.end.toISOString(),
    p_capacity: slot.capacity,
    p_max_per_day: MAX_HOLDS_PER_DAY,
  });
  if (error) throw error;
  const row = (data as { outcome: string; hold_id: string | null; hold_expires_at: string | null }[])[0];
  if (row?.outcome === "ok" && row.hold_id && row.hold_expires_at) return { status: "ok", holdId: row.hold_id, expiresAt: new Date(row.hold_expires_at) };
  return { status: (row?.outcome ?? "taken") as "taken" | "limit" | "session" };
}

export async function releaseHold(db: DbClient, clinicId: string, sessionId: string): Promise<void> {
  const { error } = await db.rpc("portal_release_hold", { p_clinic_id: clinicId, p_session_id: sessionId });
  if (error) throw error;
}

export type ActiveHold = { id: string; agendaId: string; serviceId: string; locationId: string; start: Date; end: Date; expiresAt: Date };

/** A reserva da sessão ainda válida (null = venceu, foi solta ou não existe). */
export async function activeHold(db: DbClient, clinicId: string, sessionId: string, holdId: string, now: Date = new Date()): Promise<ActiveHold | null> {
  const row = unwrap(
    await db
      .from("slot_holds")
      .select("id, agenda_id, service_id, location_id, starts_at, ends_at, expires_at")
      .eq("clinic_id", clinicId)
      .eq("session_id", sessionId)
      .eq("id", holdId)
      .is("released_at", null)
      .gt("expires_at", now.toISOString())
      .maybeSingle(),
    "Reserva do horário",
  );
  return row
    ? {
        id: row.id,
        agendaId: row.agenda_id,
        serviceId: row.service_id,
        locationId: row.location_id,
        start: new Date(row.starts_at),
        end: new Date(row.ends_at),
        expiresAt: new Date(row.expires_at),
      }
    : null;
}
