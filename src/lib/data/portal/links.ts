import type { AstroCookies } from "astro";
import { hashToken, newSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "../../portalIdentity";
import type { DbClient } from "../clients";
import { DataError, unwrap } from "../errors";
import { logError } from "../../log";
import { joinWaitlist } from "../waitlist/entries";
import { logWebFunnelEvent } from "../whatsapp/funnel";
import { hasFeature } from "../features";
import { examSlug, type PortalClinic } from "./portal";
import { recipientOfAppointment } from "../whatsapp/recipient";

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
  /** Remarcação depois do cancelamento pela clínica (F3-3): o atendimento cancelado. */
  canceledAppointmentId: string | null;
  /** Retorno: a consulta de origem (remarcação da clínica). */
  originAppointmentId: string | null;
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
  canceledAppointmentId?: string | null;
  originAppointmentId?: string | null;
  joinWaitlist?: boolean;
  funnelSessionId?: string | null;
  ttlMs?: number;
};

const COLUMNS = "id, phone, contact_id, purpose, professional_id, service_id, appointment_id, canceled_appointment_id, origin_appointment_id, join_waitlist, funnel_session_id, expires_at, used_at, revoked_at";

type Row = {
  id: string;
  phone: string;
  contact_id: string | null;
  purpose: string;
  professional_id: string | null;
  service_id: string | null;
  appointment_id: string | null;
  canceled_appointment_id: string | null;
  origin_appointment_id: string | null;
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
  canceledAppointmentId: row.canceled_appointment_id,
  originAppointmentId: row.origin_appointment_id,
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
  unwrap(
    await db
      .from("portal_links")
      .update({ revoked_at: now.toISOString() })
      .eq("clinic_id", clinicId)
      .eq("phone", input.phone)
      .eq("purpose", input.purpose)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", now.toISOString())
      // Remarcar: só o link do mesmo atendimento (dois atendimentos do mesmo celular, ou o do bot e o da clínica,
      // não se anulam).
      .filter("appointment_id", input.appointmentId ? "eq" : "is", input.appointmentId ?? null),
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
    canceled_appointment_id: input.canceledAppointmentId ?? null,
    origin_appointment_id: input.originAppointmentId ?? null,
    return_deadline_waived: !!input.canceledAppointmentId,
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
export function portalLinkTarget(link: Pick<PortalLink, "purpose" | "professionalId" | "serviceId" | "appointmentId">, portal: PortalClinic, base: string): string {
  if (link.purpose === "return") return `${base}/retorno`;
  // Remarcar (F3c; I7): os dias e horários do mesmo profissional; Minhas consultas: a lista do celular.
  if (link.purpose === "reschedule" && link.appointmentId) return `${base}/minhas-consultas/remarcar?a=${link.appointmentId}`;
  if (link.purpose === "my_appointments") return `${base}/minhas-consultas`;
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

const CATEGORY = { book: "consultation", return: "return_visit", exam: "exam", reschedule: "consultation", my_appointments: "consultation" } as const;

/**
 * Passo do funil do bot (Fase 15; Métricas › Agendamento digital): o link ligado à tentativa do bot que o gerou.
 * Medição: uma falha nunca impede abrir nem marcar.
 */
export async function logPortalLinkStep(
  db: DbClient,
  clinicId: string,
  link: PortalLink,
  step: "page_opened" | "link_expired" | "confirmed",
  metadata: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<void> {
  try {
    await logWebFunnelEvent(
      db,
      clinicId,
      {
        funnelSessionId: link.funnelSessionId,
        contactPhone: link.phone,
        contactId: link.contactId,
        mode: link.purpose === "reschedule" ? "reschedule" : "create",
        serviceCategory: CATEGORY[link.purpose],
      },
      step,
      { ...metadata, portal: true },
      now,
    );
  } catch (error) {
    logError("portal: funil não registrado", error, { clinica: clinicId });
  }
}

/**
 * Depois da marcação pelo link (melhor esforço, a consulta já está marcada): o link fica usado, o funil do bot fecha
 * com o atendimento e, vindo do "Encaixe ou antecipar" sem nada marcado (F3-2), o atendimento entra na lista de espera.
 */
export async function afterLinkBooking(db: DbClient, clinicId: string, linkId: string, appointmentId: string, now: Date = new Date()): Promise<void> {
  try {
    await markPortalLinkUsed(db, clinicId, linkId, now);
    const link = await getPortalLink(db, clinicId, linkId);
    if (!link) return;
    await logPortalLinkStep(db, clinicId, link, "confirmed", { appointment_id: appointmentId }, now);
    if (link.joinWaitlist) await joinWaitlist(db, clinicId, appointmentId, { via: "booking_link", actorId: null }, now);
  } catch (error) {
    logError("portal: depois da marcação pelo link", error, { clinica: clinicId, link: linkId });
  }
}

/** Pedido não concluído: um link novo igual ao vencido (mesma finalidade, escopo, encaixe e funil), por 30 minutos. */
export async function renewPortalLink(db: DbClient, clinicId: string, linkId: string, now: Date = new Date()): Promise<PortalLink> {
  const old = await getPortalLink(db, clinicId, linkId);
  if (!old) throw new DataError("not_found", "Link do portal");
  return createPortalLink(
    db,
    clinicId,
    {
      phone: old.phone,
      contactId: old.contactId,
      purpose: old.purpose,
      professionalId: old.professionalId,
      serviceId: old.serviceId,
      appointmentId: old.appointmentId,
      canceledAppointmentId: old.canceledAppointmentId,
      originAppointmentId: old.originAppointmentId,
      // A remarcação da clínica volta com os 2 dias dela; o do bot, com os 30 minutos.
      ttlMs: old.canceledAppointmentId ? PORTAL_REBOOKING_TTL_MS : PORTAL_LINK_TTL_MS,
      joinWaitlist: old.joinWaitlist,
      funnelSessionId: old.funnelSessionId,
    },
    now,
  );
}

/** A sessão veio do "Encaixe ou antecipar" (F3-2): o aviso da lista de espera nos horários e na revisão. */
export async function sessionJoinsWaitlist(db: DbClient, clinicId: string, session: { linkId: string | null } | null): Promise<boolean> {
  if (!session?.linkId) return false;
  const link = await getPortalLink(db, clinicId, session.linkId);
  return !!link && link.joinWaitlist && !link.usedAt;
}

/** Folga depois da validade do link, para quem abriu no fim do prazo (F3c). */
export const LINK_GRACE_MS = 30 * 60_000;

/**
 * O que o link do bot desta sessão libera para um atendimento (F3c): remarcar sem a antecedência (F3-4, o link do
 * Remarcar do bot e do lembrete) e, no link da clínica depois do cancelamento (F3-3), marcar de novo o cancelado.
 */
export async function sessionLinkFor(
  db: DbClient,
  clinicId: string,
  session: { linkId: string | null } | null,
  appointmentId: string,
  now: Date = new Date(),
): Promise<{ noLead: boolean; rebook: boolean; link: PortalLink | null }> {
  const link = session?.linkId ? await getPortalLink(db, clinicId, session.linkId) : null;
  // Só o link ainda de pé: não usado, não trocado por outro e dentro da validade, com folga para quem abriu no fim
  // do prazo e está no meio da remarcação.
  const alive = !!link && !link.usedAt && !link.revokedAt && link.expiresAt.getTime() + LINK_GRACE_MS > now.getTime();
  const mine = alive && link!.purpose === "reschedule" && link!.appointmentId === appointmentId;
  return { noLead: mine, rebook: mine && link!.canceledAppointmentId === appointmentId, link: mine ? link : null };
}

/** Remarcação depois do cancelamento pela clínica: 2 dias, como o link de hoje (F5.4). */
export const PORTAL_REBOOKING_TTL_MS = 2 * 24 * 60 * 60_000;

/**
 * Link de remarcação do portal para um atendimento cancelado pela clínica (F3-3): o mesmo paciente, serviço e agenda,
 * no consultório ou em casa (F3e-1: o portal pergunta se o endereço continua o mesmo); retorno sem o limite do prazo.
 * null = o portal não cobre (sem endereço ou Portal desligado, turma, paciente sem celular): quem chamou faz o link
 * de hoje.
 */
export async function createPortalRebookingLink(
  db: DbClient,
  clinicId: string,
  appointment: { id: string; patientId: string; serviceId: string; locationId: string; originAppointmentId: string | null },
  now: Date = new Date(),
): Promise<PortalLink | null> {
  const [clinic, portalOn, location, service, recipient] = await Promise.all([
    db.from("clinics").select("portal_slug").eq("id", clinicId).maybeSingle().then((r) => unwrap(r, "Clínica")),
    hasFeature(db, clinicId, "portal"),
    db.from("locations").select("type").eq("clinic_id", clinicId).eq("id", appointment.locationId).maybeSingle().then((r) => unwrap(r, "Local")),
    db.from("services").select("scheduling_mode").eq("clinic_id", clinicId).eq("id", appointment.serviceId).maybeSingle().then((r) => unwrap(r, "Serviço")),
    // O link vai no aviso de cancelamento, para quem marcou (D14, VR3).
    recipientOfAppointment(db, clinicId, appointment.id),
  ]);
  const phone = recipient?.phone ?? null;
  if (!clinic?.portal_slug || !portalOn || (location?.type !== "clinic" && location?.type !== "home_visit") || service?.scheduling_mode === "group" || !phone) return null;
  return createPortalLink(
    db,
    clinicId,
    {
      phone,
      contactId: recipient!.id,
      purpose: "reschedule",
      appointmentId: appointment.id,
      canceledAppointmentId: appointment.id,
      originAppointmentId: appointment.originAppointmentId,
      ttlMs: PORTAL_REBOOKING_TTL_MS,
    },
    now,
  );
}

/** Links de remarcação do portal ainda válidos de cada atendimento cancelado pela clínica (tela "Avisar"). */
export async function listValidPortalRebookingLinks(db: DbClient, clinicId: string, canceledAppointmentIds: string[], now: Date = new Date()): Promise<Map<string, PortalLink>> {
  if (!canceledAppointmentIds.length) return new Map();
  const rows = unwrap(
    await db
      .from("portal_links")
      .select(COLUMNS)
      .eq("clinic_id", clinicId)
      .in("canceled_appointment_id", canceledAppointmentIds)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: false }),
    "Links de remarcação do portal",
  ) as Row[];
  const result = new Map<string, PortalLink>();
  for (const row of rows) if (row.canceled_appointment_id && !result.has(row.canceled_appointment_id)) result.set(row.canceled_appointment_id, toLink(row));
  return result;
}

/** Finalidades em que a marcação de uma consulta, retorno ou exame gasta o link (F3a). */
const BOOKING_PURPOSES: PortalLinkPurpose[] = ["book", "return", "exam"];

/**
 * O link do bot que a marcação desta sessão gasta (uma marcação por link): só o de marcar, ainda não usado. O de
 * remarcar ou de Minhas consultas não é gasto por uma consulta nova.
 */
export function linkSpentByBooking(link: Pick<PortalLink, "purpose" | "usedAt"> | null): boolean {
  return !!link && BOOKING_PURPOSES.includes(link.purpose) && !link.usedAt;
}
