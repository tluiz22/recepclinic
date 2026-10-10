import type { DbClient } from "../clients";
import { roleLabel } from "../../clinicAccess";
import { unwrap, unwrapOne } from "../errors";

// Proteção contra abuso no agendamento pelo bot (F9.6a; cliente, 09 e
// 10/out/2026). Três limites por contato, somando todos os pacientes dele,
// só no bot (a equipe marca e cadastra sem limite pelo painel):
//   - atendimentos futuros (marcados pelo bot ou pela equipe), mais os links
//     de marcar ainda válidos: sem eles, quem pedisse vários links antes de
//     usar o primeiro passaria do limite;
//   - pacientes cadastrados pelo bot nos últimos 30 dias;
//   - faltas nos últimos 90 dias (0 desliga).
// Atingido o limite, o bot não marca (cancelar, remarcar e confirmar seguem):
// passa a conversa para a recepção e o caso fica registrado em
// `bot_limit_events`, para a tela do contato, o Painel e a tela Uso.
// Na tela do contato (cliente, 10/out, na validação): "Revisado" tira o
// contato do Painel até o próximo limite (Recepção e Administrador); "Liberar
// dos limites do bot" desliga os três para o número (só o Administrador, ex.:
// empresa com acordo). O contato desativado continua contando.

export type BotLimitReason = "future_appointments" | "new_patients" | "no_shows";

export type BotLimits = {
  /** 1 a 10. */
  maxFutureAppointments: number;
  /** Em 30 dias; 1 a 10. */
  maxNewPatients: number;
  /** Em 90 dias; 0 desliga, até 10. */
  maxNoShows: number;
};

export const DEFAULT_BOT_LIMITS: BotLimits = { maxFutureAppointments: 3, maxNewPatients: 3, maxNoShows: 2 };
export const BOT_LIMIT_RANGES: Record<keyof BotLimits, { min: number; max: number }> = {
  maxFutureAppointments: { min: 1, max: 10 },
  maxNewPatients: { min: 1, max: 10 },
  maxNoShows: { min: 0, max: 10 },
};
export const NEW_PATIENTS_WINDOW_DAYS = 30;
export const NO_SHOWS_WINDOW_DAYS = 90;
/** "Contatos para revisar" no Painel: quem bateu limite nestes últimos dias. */
export const REVIEW_WINDOW_DAYS = 7;

export const BOT_LIMIT_LABELS: Record<BotLimitReason, string> = {
  future_appointments: "Limite de atendimentos futuros",
  new_patients: "Limite de cadastros pelo bot",
  no_shows: "Limite de faltas",
};

/** "3 atendimentos futuros (limite 3)", para a equipe. */
export function describeBotLimitHit(hit: Pick<BotLimitHit, "reason" | "limit" | "current">): string {
  switch (hit.reason) {
    case "future_appointments":
      return `${hit.current} ${hit.current === 1 ? "atendimento futuro" : "atendimentos futuros"} (limite ${hit.limit})`;
    case "new_patients":
      return `${hit.current} ${hit.current === 1 ? "cadastro" : "cadastros"} pelo bot em ${NEW_PATIENTS_WINDOW_DAYS} dias (limite ${hit.limit})`;
    case "no_shows":
      return `${hit.current} ${hit.current === 1 ? "falta" : "faltas"} em ${NO_SHOWS_WINDOW_DAYS} dias (limite ${hit.limit})`;
  }
}

export type BotLimitHit = { reason: BotLimitReason; limit: number; current: number };

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

/**
 * Marcar: atendimentos futuros primeiro, depois faltas. Atinge com o valor
 * igual ao limite (com 3 marcados e limite 3, o quarto não sai pelo bot).
 */
export function evaluateBookingLimits(limits: BotLimits, counts: { futureAppointments: number; noShows: number }): BotLimitHit | null {
  if (counts.futureAppointments >= limits.maxFutureAppointments) {
    return { reason: "future_appointments", limit: limits.maxFutureAppointments, current: counts.futureAppointments };
  }
  if (limits.maxNoShows > 0 && counts.noShows >= limits.maxNoShows) {
    return { reason: "no_shows", limit: limits.maxNoShows, current: counts.noShows };
  }
  return null;
}

/** Cadastrar outra pessoa pelo bot. */
export function evaluateNewPatientLimit(limits: BotLimits, newPatients: number): BotLimitHit | null {
  return newPatients >= limits.maxNewPatients ? { reason: "new_patients", limit: limits.maxNewPatients, current: newPatients } : null;
}

// ---------------------------------------------------------------------------
// Contagens (credencial da clínica no bot; RLS da equipe nas telas)
// ---------------------------------------------------------------------------

export async function getBotLimits(db: DbClient, clinicId: string): Promise<BotLimits> {
  const row = unwrapOne(
    await db
      .from("clinic_settings")
      .select("bot_max_future_appointments, bot_max_new_patients, bot_max_no_shows")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    "Configuração da clínica",
  );
  return {
    maxFutureAppointments: row.bot_max_future_appointments,
    maxNewPatients: row.bot_max_new_patients,
    maxNoShows: row.bot_max_no_shows,
  };
}

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000).toISOString();

async function contactPatientIds(db: DbClient, clinicId: string, contactId: string): Promise<string[]> {
  const rows = unwrap(await db.from("patients").select("id").eq("clinic_id", clinicId).eq("contact_id", contactId), "Pacientes do contato");
  return rows.map((row) => row.id);
}

/** Atendimentos futuros dos pacientes do contato, mais um por paciente com link de marcar ainda válido. */
export async function countFutureAppointments(db: DbClient, clinicId: string, contactId: string, now: Date = new Date()): Promise<number> {
  const patientIds = await contactPatientIds(db, clinicId, contactId);
  if (!patientIds.length) return 0;
  const [appointments, links] = await Promise.all([
    db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .in("patient_id", patientIds)
      .in("status", ["scheduled", "confirmed"])
      .gt("scheduled_at", now.toISOString()),
    db
      .from("booking_links")
      .select("patient_id")
      .eq("clinic_id", clinicId)
      .eq("contact_id", contactId)
      .eq("mode", "create")
      .is("used_at", null)
      .gt("expires_at", now.toISOString()),
  ]);
  if (appointments.error) unwrap(appointments, "Atendimentos futuros do contato");
  const pendingPatients = new Set(unwrap(links, "Links do contato").map((row) => row.patient_id));
  return (appointments.count ?? 0) + pendingPatients.size;
}

export async function countNoShows(db: DbClient, clinicId: string, contactId: string, now: Date = new Date()): Promise<number> {
  const patientIds = await contactPatientIds(db, clinicId, contactId);
  if (!patientIds.length) return 0;
  const result = await db
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .in("patient_id", patientIds)
    .eq("status", "no_show")
    .gte("scheduled_at", daysAgo(now, NO_SHOWS_WINDOW_DAYS))
    .lte("scheduled_at", now.toISOString());
  if (result.error) unwrap(result, "Faltas do contato");
  return result.count ?? 0;
}

export async function countBotNewPatients(db: DbClient, clinicId: string, contactId: string, now: Date = new Date()): Promise<number> {
  const result = await db
    .from("patients")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .eq("created_via", "whatsapp")
    .gte("created_at", daysAgo(now, NEW_PATIENTS_WINDOW_DAYS));
  if (result.error) unwrap(result, "Cadastros do contato");
  return result.count ?? 0;
}

export async function checkBookingLimits(db: DbClient, clinicId: string, contactId: string, now: Date = new Date()): Promise<BotLimitHit | null> {
  const limits = await getBotLimits(db, clinicId);
  const futureAppointments = await countFutureAppointments(db, clinicId, contactId, now);
  if (futureAppointments >= limits.maxFutureAppointments) return evaluateBookingLimits(limits, { futureAppointments, noShows: 0 });
  const noShows = limits.maxNoShows > 0 ? await countNoShows(db, clinicId, contactId, now) : 0;
  return evaluateBookingLimits(limits, { futureAppointments, noShows });
}

export async function checkNewPatientLimit(db: DbClient, clinicId: string, contactId: string, now: Date = new Date()): Promise<BotLimitHit | null> {
  const limits = await getBotLimits(db, clinicId);
  return evaluateNewPatientLimit(limits, await countBotNewPatients(db, clinicId, contactId, now));
}

/**
 * Contato do número para os limites, mesmo desativado (o bot trata o número
 * desativado como novo, e a primeira marcação passaria sem verificar).
 */
export async function contactForLimits(db: DbClient, clinicId: string, phone: string): Promise<{ id: string; exempt: boolean } | null> {
  const row = unwrap(
    await db.from("contacts").select("id, bot_limits_exempt_at").eq("clinic_id", clinicId).eq("phone", phone).maybeSingle(),
    "Contato",
  );
  return row ? { id: row.id, exempt: row.bot_limits_exempt_at !== null } : null;
}

// ---------------------------------------------------------------------------
// Revisado e liberação (tela do contato)
// ---------------------------------------------------------------------------

export type ContactBotLimitsStatus = {
  reviewedAt: Date | null;
  exemptAt: Date | null;
  exemptBy: string | null;
};

export async function getContactBotLimitsStatus(db: DbClient, clinicId: string, contactId: string): Promise<ContactBotLimitsStatus> {
  const row = unwrapOne(
    await db
      .from("contacts")
      .select("bot_limits_reviewed_at, bot_limits_exempt_at, bot_limits_exempt_by")
      .eq("clinic_id", clinicId)
      .eq("id", contactId)
      .maybeSingle(),
    "Contato",
  );
  return {
    reviewedAt: row.bot_limits_reviewed_at ? new Date(row.bot_limits_reviewed_at) : null,
    exemptAt: row.bot_limits_exempt_at ? new Date(row.bot_limits_exempt_at) : null,
    exemptBy: row.bot_limits_exempt_by,
  };
}

/** Quem liberou, pelo papel na clínica (D6); fora da equipe, o Suporte. */
export async function exemptByLabel(db: DbClient, clinicId: string, userId: string): Promise<string> {
  const { data } = await db.from("clinic_members").select("roles").eq("clinic_id", clinicId).eq("user_id", userId).maybeSingle();
  return data ? roleLabel({ roles: data.roles, isPlatformStaff: false }) : "Suporte RecepClinic";
}

/** Recepção e Administrador (o banco confere). */
export async function markContactReviewed(db: DbClient, clinicId: string, contactId: string): Promise<void> {
  unwrap(await db.rpc("mark_contact_bot_limits_reviewed", { p_clinic_id: clinicId, p_contact_id: contactId }), "Revisar contato");
}

/** Só o Administrador (o banco confere). */
export async function setContactBotLimitsExempt(db: DbClient, clinicId: string, contactId: string, exempt: boolean): Promise<void> {
  unwrap(await db.rpc("set_contact_bot_limits_exempt", { p_clinic_id: clinicId, p_contact_id: contactId, p_exempt: exempt }), "Liberar contato");
}

/** Limite atingido depois da última revisão: o contato está "para revisar". */
export const isPendingReview = (event: Pick<BotLimitEvent, "at">, reviewedAt: Date | null, now: Date = new Date()) =>
  now.getTime() - event.at.getTime() < REVIEW_WINDOW_DAYS * 24 * 60 * 60_000 && (!reviewedAt || event.at > reviewedAt);

// ---------------------------------------------------------------------------
// Registro e leitura
// ---------------------------------------------------------------------------

export async function recordBotLimitEvent(
  db: DbClient,
  clinicId: string,
  contactId: string,
  hit: BotLimitHit,
  paused: boolean,
  now: Date = new Date(),
): Promise<void> {
  unwrap(
    await db.from("bot_limit_events").insert({
      clinic_id: clinicId,
      contact_id: contactId,
      reason: hit.reason,
      limit_value: hit.limit,
      current_value: hit.current,
      paused,
      created_at: now.toISOString(),
    }),
    "Limite do bot",
  );
}

export type BotLimitEvent = BotLimitHit & { at: Date; paused: boolean };

const toEvent = (row: { reason: string; limit_value: number; current_value: number; paused: boolean; created_at: string }): BotLimitEvent => ({
  reason: row.reason as BotLimitReason,
  limit: row.limit_value,
  current: row.current_value,
  paused: row.paused,
  at: new Date(row.created_at),
});

/** Os últimos limites atingidos pelo contato (tela do contato). */
export async function listContactLimitEvents(db: DbClient, clinicId: string, contactId: string, limit = 5): Promise<BotLimitEvent[]> {
  const rows = unwrap(
    await db
      .from("bot_limit_events")
      .select("reason, limit_value, current_value, paused, created_at")
      .eq("clinic_id", clinicId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "Limites do contato",
  );
  return rows.map(toEvent);
}

export type ContactToReview = { contactId: string; name: string; last: BotLimitEvent; hits: number };

/** Painel: contatos que bateram limite nos últimos 7 dias e ainda não foram revisados, do mais recente ao mais antigo. */
export async function listContactsToReview(db: DbClient, clinicId: string, now: Date = new Date()): Promise<ContactToReview[]> {
  const rows = unwrap(
    await db
      .from("bot_limit_events")
      .select("contact_id, reason, limit_value, current_value, paused, created_at, contacts ( full_name, bot_limits_reviewed_at )")
      .eq("clinic_id", clinicId)
      .gte("created_at", daysAgo(now, REVIEW_WINDOW_DAYS))
      .order("created_at", { ascending: false }),
    "Contatos para revisar",
  ) as unknown as {
    contact_id: string;
    reason: string;
    limit_value: number;
    current_value: number;
    paused: boolean;
    created_at: string;
    contacts: { full_name: string; bot_limits_reviewed_at: string | null } | null;
  }[];
  const byContact = new Map<string, ContactToReview>();
  for (const row of rows) {
    const reviewedAt = row.contacts?.bot_limits_reviewed_at;
    if (reviewedAt && new Date(row.created_at) <= new Date(reviewedAt)) continue;
    const current = byContact.get(row.contact_id);
    if (current) current.hits++;
    else byContact.set(row.contact_id, { contactId: row.contact_id, name: row.contacts?.full_name ?? "Contato", last: toEvent(row), hits: 1 });
  }
  return [...byContact.values()];
}
