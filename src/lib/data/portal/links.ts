import type { AstroCookies } from "astro";
import { hashToken, newSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "../../portalIdentity";
import type { DbClient } from "../clients";
import { DataError, unwrap } from "../errors";
import { examSlug, type PortalClinic } from "./portal";

// Link do portal mandado pelo bot (F3a; proposta 3.4; plano, seção 15). O token é o id (em 22 caracteres no endereço
// /s/{token}); no banco ficam o celular da conversa, a finalidade e o escopo. Regras:
//   - vale 30 minutos (como o link de agendar de hoje) e só marca uma vez;
//   - um novo para o mesmo celular e finalidade revoga o anterior;
//   - abrir cria uma sessão do portal com o celular já comprovado (quem abriu recebeu a mensagem naquele chat): a P7
//     é pulada, e a P8 mostra o celular com "Usar outro número" (que volta a pedir o código).

export const PORTAL_LINK_TTL_MS = 30 * 60_000;

export type PortalLinkPurpose = "book" | "return" | "exam" | "reschedule" | "my_appointments";

export type PortalLink = {
  id: string;
  phone: string;
  contactId: string | null;
  purpose: PortalLinkPurpose;
  professionalId: string | null;
  serviceId: string | null;
  appointmentId: string | null;
  joinWaitlist: boolean;
  funnelSessionId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

export type PortalLinkInput = {
  phone: string;
  contactId?: string | null;
  purpose: PortalLinkPurpose;
  professionalId?: string | null;
  serviceId?: string | null;
  appointmentId?: string | null;
  joinWaitlist?: boolean;
  funnelSessionId?: string | null;
  ttlMs?: number;
};

const COLUMNS = "id, phone, contact_id, purpose, professional_id, service_id, appointment_id, join_waitlist, funnel_session_id, expires_at, used_at, revoked_at";

type Row = {
  id: string;
  phone: string;
  contact_id: string | null;
  purpose: string;
  professional_id: string | null;
  service_id: string | null;
  appointment_id: string | null;
  join_waitlist: boolean;
  funnel_session_id: string | null;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
};

const toLink = (row: Row): PortalLink => ({
  id: row.id,
  phone: row.phone,
  contactId: row.contact_id,
  purpose: row.purpose as PortalLinkPurpose,
  professionalId: row.professional_id,
  serviceId: row.service_id,
  appointmentId: row.appointment_id,
  joinWaitlist: row.join_waitlist,
  funnelSessionId: row.funnel_session_id,
  expiresAt: new Date(row.expires_at),
  usedAt: row.used_at ? new Date(row.used_at) : null,
  revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
});

/** Link novo; o anterior ainda válido do mesmo celular e finalidade deixa de valer. */
export async function createPortalLink(db: DbClient, clinicId: string, input: PortalLinkInput, now: Date = new Date()): Promise<PortalLink> {
  const ttl = input.ttlMs ?? PORTAL_LINK_TTL_MS;
  if (!(ttl > 0)) throw new DataError("invalid", "Link do portal: validade inválida");
  if (input.purpose === "reschedule" && !input.appointmentId) throw new DataError("invalid", "Link do portal: remarcar precisa do atendimento");
  if (input.purpose === "exam" && !input.serviceId) throw new DataError("invalid", "Link do portal: exame precisa do serviço");
  unwrap(
    await db
      .from("portal_links")
      .update({ revoked_at: now.toISOString() })
      .eq("clinic_id", clinicId)
      .eq("phone", input.phone)
      .eq("purpose", input.purpose)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", now.toISOString()),
    "Link do portal",
  );
  // Todas as colunas, sempre (cuidado da F2.5 com valores padrão no supabase-js).
  const row = {
    clinic_id: clinicId,
    phone: input.phone,
    contact_id: input.contactId ?? null,
    purpose: input.purpose,
    professional_id: input.professionalId ?? null,
    service_id: input.serviceId ?? null,
    appointment_id: input.appointmentId ?? null,
    join_waitlist: input.joinWaitlist ?? false,
    funnel_session_id: input.funnelSessionId ?? null,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl).toISOString(),
  };
  return toLink(unwrap(await db.from("portal_links").insert(row).select(COLUMNS).single(), "Link do portal") as Row);
}

export async function getPortalLink(db: DbClient, clinicId: string, id: string): Promise<PortalLink | null> {
  const row = unwrap(await db.from("portal_links").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Link do portal") as Row | null;
  return row ? toLink(row) : null;
}

/** "used": já marcou (P13 "já foi usado"); "expired": venceu ou outro link tomou o lugar (P13 "não vale mais"). */
export type PortalLinkState = "valid" | "used" | "expired";

export function portalLinkState(link: Pick<PortalLink, "usedAt" | "revokedAt" | "expiresAt">, now: Date = new Date()): PortalLinkState {
  if (link.usedAt) return "used";
  return link.revokedAt || link.expiresAt <= now ? "expired" : "valid";
}

/**
 * Abre o link: uma sessão nova do portal com o celular do link já comprovado (o cookie da sessão anterior é trocado,
 * para o link nunca herdar o celular de outra pessoa no mesmo aparelho).
 */
export async function openLinkSession(
  db: DbClient,
  clinicId: string,
  link: PortalLink,
  cookies: AstroCookies,
  { ip, secure, now = new Date() }: { ip: string; secure: boolean; now?: Date },
): Promise<void> {
  const token = newSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  unwrap(
    await db.from("portal_sessions").insert({
      clinic_id: clinicId,
      token_hash: hashToken(token),
      ip_prefix: ip,
      phone: link.phone,
      phone_verified_at: now.toISOString(),
      link_id: link.id,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    }),
    "Sessão do portal",
  );
  cookies.set(SESSION_COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", secure, expires: expiresAt });
}

/**
 * Para onde o link leva, no portal da clínica (especificação P1: "com token, abre direto conforme o escopo"): o
 * profissional escolhido na conversa já na escolha do atendimento (P5, pulada com uma opção só; o Voltar leva ao
 * início dele), o exame escolhido, a lista dos exames, o retorno ou o início da clínica.
 */
export function portalLinkTarget(link: Pick<PortalLink, "purpose" | "professionalId" | "serviceId">, portal: PortalClinic, base: string): string {
  if (link.purpose === "return") return `${base}/retorno`;
  if (link.purpose === "exam") {
    const exam = portal.exams.find((e) => e.serviceId === link.serviceId);
    return exam ? `${base}/${examSlug(exam.serviceId)}/atendimento?de=exames` : `${base}/exames`;
  }
  if (link.purpose === "book") {
    const professional = link.professionalId ? portal.professionals.find((p) => p.id === link.professionalId) : portal.professionals.length === 1 ? portal.professionals[0] : null;
    if (professional) return `${base}/${professional.slug}/atendimento`;
  }
  return base;
}

/** A marcação pelo link gasta o link (uma marcação por link). Melhor esforço: a consulta já está marcada. */
export async function markPortalLinkUsed(db: DbClient, clinicId: string, linkId: string, now: Date = new Date()): Promise<void> {
  unwrap(
    await db.from("portal_links").update({ used_at: now.toISOString() }).eq("clinic_id", clinicId).eq("id", linkId).is("used_at", null),
    "Link do portal",
  );
}
