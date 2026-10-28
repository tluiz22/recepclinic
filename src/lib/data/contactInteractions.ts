import type { DbClient } from "./clients";
import { DataError, unwrap, unwrapAllIn } from "./errors";

// Registro do resultado do contato (CRM C2, cliente, 28/out/2026): o que a
// equipe fez ao procurar alguém de uma pendência. Só se acrescenta (Q9): para
// corrigir, um registro novo, e vale o último. A saída das listas (Q8) é daqui;
// a tabela e o banco só guardam e conferem (20261029120000_registros_de_contato.sql).

export type InteractionOutcome = "scheduled" | "link_sent" | "call_back" | "no_answer" | "not_interested" | "wrong_number" | "other";

export type InteractionSource =
  | "retomar_contato"
  | "retorno"
  | "faltosos"
  | "aguardando_remarcacao"
  | "lembretes"
  | "lista_espera"
  | "atendimento"
  | "ficha_paciente";

/** As 7 opções (Q7 e Q10), na ordem da tela. */
export const OUTCOMES: { key: InteractionOutcome; label: string }[] = [
  { key: "scheduled", label: "Marcou" },
  { key: "link_sent", label: "Enviou o link / vai marcar" },
  { key: "call_back", label: "Pediu para falar depois" },
  { key: "no_answer", label: "Não respondeu" },
  { key: "not_interested", label: "Não quer marcar agora" },
  { key: "wrong_number", label: "Número errado ou sem WhatsApp" },
  { key: "other", label: "Outro" },
];

export const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label])) as Record<InteractionOutcome, string>;

/** Tiram a pessoa da lista (Q8); os outros só marcam a tentativa. */
export const EXIT_OUTCOMES: ReadonlySet<InteractionOutcome> = new Set(["scheduled", "not_interested", "wrong_number"]);

/** Origens com "Registrar contato" (C2). */
export const LOGGED_SOURCES = ["retomar_contato", "retorno", "lembretes", "aguardando_remarcacao", "faltosos", "ficha_paciente"] as const;
export type LoggedSource = (typeof LOGGED_SOURCES)[number];

/**
 * Opções de cada origem. Lembretes (Q11) e Aguardando remarcação: o
 * atendimento já existe, então sem "Marcou" (a saída é pelas ações de sempre:
 * confirmar, remarcar, cancelar ou "Desistiu").
 */
export function outcomesFor(source: InteractionSource): InteractionOutcome[] {
  const all = OUTCOMES.map((o) => o.key);
  return source === "lembretes" || source === "aguardando_remarcacao" ? all.filter((key) => key !== "scheduled") : all;
}

/**
 * Quem sai da lista com o registro (Q8). Aguardando remarcação só sai ao
 * remarcar ou com "Desistiu"; a ficha do paciente não é lista.
 */
export function exitsList(source: InteractionSource, outcome: InteractionOutcome): boolean {
  if (source === "aguardando_remarcacao" || source === "ficha_paciente") return false;
  if (source === "lembretes") return outcome === "not_interested" || outcome === "wrong_number";
  return EXIT_OUTCOMES.has(outcome);
}

export const NOTE_MAX = 1000;

export type ContactInteraction = {
  id: string;
  phone: string;
  contactId: string | null;
  patientId: string | null;
  source: InteractionSource;
  appointmentId: string | null;
  sessionId: string | null;
  outcome: InteractionOutcome;
  note: string | null;
  createdAt: Date;
  createdBy: string | null;
};

const COLUMNS = "id, contact_phone, contact_id, patient_id, source, appointment_id, funnel_session_id, outcome, note, created_at, created_by";

type Row = {
  id: string;
  contact_phone: string;
  contact_id: string | null;
  patient_id: string | null;
  source: string;
  appointment_id: string | null;
  funnel_session_id: string | null;
  outcome: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
};

const toInteraction = (row: Row): ContactInteraction => ({
  id: row.id,
  phone: row.contact_phone,
  contactId: row.contact_id,
  patientId: row.patient_id,
  source: row.source as InteractionSource,
  appointmentId: row.appointment_id,
  sessionId: row.funnel_session_id,
  outcome: row.outcome as InteractionOutcome,
  note: row.note,
  createdAt: new Date(row.created_at),
  createdBy: row.created_by,
});

export type NewInteraction = {
  source: InteractionSource;
  phone: string;
  contactId: string | null;
  patientId: string | null;
  appointmentId: string | null;
  sessionId: string | null;
  outcome: InteractionOutcome;
  note: string | null;
};

/** Grava o registro; o banco põe o autor e a hora e confere o paciente e o "Marcou". */
export async function recordContactInteraction(db: DbClient, clinicId: string, input: NewInteraction): Promise<string> {
  const note = input.note?.trim() || null;
  if (input.outcome === "other" && !note) throw new DataError("invalid", "Registro: falta a observação", { note: 'Em "Outro", escreva o que aconteceu.' });
  if (note && note.length > NOTE_MAX) throw new DataError("invalid", "Registro: observação longa", { note: `A observação vai até ${NOTE_MAX} caracteres.` });
  if (input.outcome === "scheduled" && !input.appointmentId) {
    throw new DataError("invalid", "Registro: sem atendimento", { outcome: "Ainda não há atendimento marcado para este contato." });
  }
  const { data, error } = await db
    .from("contact_interactions")
    .insert({
      clinic_id: clinicId,
      contact_phone: input.phone,
      contact_id: input.contactId,
      patient_id: input.patientId,
      source: input.source,
      appointment_id: input.appointmentId,
      funnel_session_id: input.sessionId,
      outcome: input.outcome,
      note,
    })
    .select("id")
    .single();
  if (error) {
    // Regras do gatilho (paciente de outro contato, "Marcou" sem atendimento ativo).
    if ((error as { code?: string }).code === "23514") {
      throw new DataError("invalid", "Registro: não confere", { outcome: "Não deu para registrar: o atendimento ou o paciente não confere. Abra a lista de novo." });
    }
    if ((error as { code?: string }).code === "42501") throw new DataError("forbidden", "Registro: sem permissão");
    throw new DataError("unexpected", `Registro: ${error.message}`, {}, { cause: error });
  }
  return data.id;
}

/** Registros de uma origem pelos valores de uma coluna (telefones, atendimentos ou pacientes), dos mais novos para os mais antigos. */
export async function listInteractions(
  db: DbClient,
  clinicId: string,
  source: InteractionSource,
  column: "contact_phone" | "appointment_id" | "patient_id",
  values: string[],
): Promise<ContactInteraction[]> {
  const unique = [...new Set(values)];
  if (unique.length === 0) return [];
  const rows = (await unwrapAllIn(
    unique,
    (chunk, from, to) =>
      db
        .from("contact_interactions")
        .select(COLUMNS)
        .eq("clinic_id", clinicId)
        .eq("source", source)
        .in(column, chunk)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    "Registros de contato",
  )) as unknown as Row[];
  return rows.map(toInteraction).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Registros do paciente e os do contato sem paciente (ficha do paciente), os mais novos primeiro. */
export async function listPatientInteractions(db: DbClient, clinicId: string, patientId: string, contactId: string, limit = 20): Promise<ContactInteraction[]> {
  const rows = unwrap(
    await db
      .from("contact_interactions")
      .select(COLUMNS)
      .eq("clinic_id", clinicId)
      .or(`patient_id.eq.${patientId},and(contact_id.eq.${contactId},patient_id.is.null)`)
      .order("created_at", { ascending: false })
      .limit(limit),
    "Registros de contato",
  ) as unknown as Row[];
  return rows.map(toInteraction);
}

// ---------------------------------------------------------------------------
// Situação de cada pendência (regras puras)
// ---------------------------------------------------------------------------

export type PendencyLog = {
  /** O registro mais recente desta pendência. */
  last: ContactInteraction;
  /** Quantos registros esta pendência tem. */
  attempts: number;
};

/**
 * Registros que contam para a pendência (já filtrados por ela): sai da lista
 * se algum tirar (Q8); senão, a tentativa mais recente aparece na linha.
 */
export function pendencyState(source: InteractionSource, interactions: readonly ContactInteraction[]): { exits: boolean; log: PendencyLog | null } {
  if (interactions.length === 0) return { exits: false, log: null };
  const sorted = [...interactions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { exits: sorted.some((i) => exitsList(source, i.outcome)), log: { last: sorted[0], attempts: sorted.length } };
}

// ---------------------------------------------------------------------------
// "Marcou" (Q10, seção 13.2): só com um atendimento ativo conferido
// ---------------------------------------------------------------------------

/**
 * O atendimento que permite "Marcou": ativo (marcado, confirmado ou
 * realizado), do paciente (ou de um paciente do contato), criado desde o
 * começo da pendência; na ficha do paciente, um atendimento por vir. O mais
 * recente primeiro. null = a opção fica desativada.
 */
export async function findBookedAppointment(
  db: DbClient,
  clinicId: string,
  who: { patientId: string | null; contactId: string | null },
  when: { createdSince: Date } | { upcomingFrom: Date },
): Promise<{ id: string; scheduledAt: Date } | null> {
  let patientIds: string[];
  if (who.patientId) patientIds = [who.patientId];
  else if (who.contactId) {
    const patients = unwrap(await db.from("patients").select("id").eq("clinic_id", clinicId).eq("contact_id", who.contactId), "Registro de contato");
    patientIds = patients.map((p) => p.id);
  } else return null;
  if (patientIds.length === 0) return null;
  let query = db
    .from("appointments")
    .select("id, scheduled_at")
    .eq("clinic_id", clinicId)
    .in("patient_id", patientIds)
    .in("status", "upcomingFrom" in when ? ["scheduled", "confirmed"] : ["scheduled", "confirmed", "completed"]);
  query = "upcomingFrom" in when ? query.gt("scheduled_at", when.upcomingFrom.toISOString()) : query.gte("created_at", when.createdSince.toISOString());
  const rows = unwrap(await query.order("created_at", { ascending: false }).limit(1), "Registro de contato");
  return rows[0] ? { id: rows[0].id, scheduledAt: new Date(rows[0].scheduled_at) } : null;
}

// ---------------------------------------------------------------------------
// Tela "Registrar contato": quem e qual pendência, conferidos no servidor
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164 = /^\+\d{10,15}$/;

/** O pedido, como veio no endereço ou no formulário (origem, paciente, telefone, tentativa, atendimento, desde). */
export type RegisterRequest = {
  source: LoggedSource;
  patientId: string | null;
  phone: string | null;
  sessionId: string | null;
  appointmentId: string | null;
  since: Date | null;
};

const PARAMS = { source: "origem", patientId: "paciente", phone: "telefone", sessionId: "sessao", appointmentId: "atendimento", since: "desde" } as const;

/** Lê o pedido; null = origem desconhecida. */
export function parseRegisterRequest(get: (name: string) => string | null): RegisterRequest | null {
  const source = get(PARAMS.source);
  if (!source || !(LOGGED_SOURCES as readonly string[]).includes(source)) return null;
  const text = (name: string) => get(name)?.trim() || null;
  const uuid = (name: string) => {
    const value = text(name);
    return value && UUID.test(value) ? value : null;
  };
  const sinceRaw = text(PARAMS.since);
  const since = sinceRaw ? new Date(sinceRaw) : null;
  return {
    source: source as LoggedSource,
    patientId: uuid(PARAMS.patientId),
    phone: text(PARAMS.phone),
    sessionId: uuid(PARAMS.sessionId),
    appointmentId: uuid(PARAMS.appointmentId),
    since: since && !Number.isNaN(since.getTime()) ? since : null,
  };
}

/** Os campos do pedido para levar ao endereço ou ao formulário. */
export function registerParams(req: Partial<RegisterRequest> & { source: LoggedSource }): Record<string, string> {
  const out: Record<string, string> = { [PARAMS.source]: req.source };
  if (req.patientId) out[PARAMS.patientId] = req.patientId;
  if (req.phone) out[PARAMS.phone] = req.phone;
  if (req.sessionId) out[PARAMS.sessionId] = req.sessionId;
  if (req.appointmentId) out[PARAMS.appointmentId] = req.appointmentId;
  if (req.since) out[PARAMS.since] = req.since.toISOString();
  return out;
}

export type RegisterTarget = {
  source: LoggedSource;
  phone: string;
  contactId: string | null;
  contactName: string | null;
  patientId: string | null;
  patientName: string | null;
  /** A pendência (consulta do Retorno, atendimento do Lembrete ou do Aguardando). */
  pendencyAppointmentId: string | null;
  sessionId: string | null;
  /** O atendimento que libera o "Marcou"; null = desativado. */
  booked: { id: string; scheduledAt: Date } | null;
  options: InteractionOutcome[];
};

const notFound = () => new DataError("not_found", "Registro de contato: pendência não encontrada");

/** Confere o pedido: o paciente e o atendimento são da clínica e um do outro; o "Marcou" só com o atendimento achado. */
export async function resolveRegisterTarget(db: DbClient, clinicId: string, req: RegisterRequest, now: Date = new Date()): Promise<RegisterTarget> {
  const options = outcomesFor(req.source);
  const needsSince = req.source === "retomar_contato" || req.source === "retorno" || req.source === "faltosos";
  if (needsSince && !req.since) throw notFound();

  if (req.source === "retomar_contato") {
    if (!req.phone || !E164.test(req.phone) || !req.sessionId) throw notFound();
    const contact = unwrap(
      await db.from("contacts").select("id, full_name, anonymized_at").eq("clinic_id", clinicId).eq("phone", req.phone).maybeSingle(),
      "Registro de contato",
    );
    if (contact?.anonymized_at) throw notFound();
    const booked = contact ? await findBookedAppointment(db, clinicId, { patientId: null, contactId: contact.id }, { createdSince: req.since! }) : null;
    return {
      source: req.source,
      phone: req.phone,
      contactId: contact?.id ?? null,
      contactName: contact?.full_name ?? null,
      patientId: null,
      patientName: null,
      pendencyAppointmentId: null,
      sessionId: req.sessionId,
      booked,
      options,
    };
  }

  if (!req.patientId) throw notFound();
  const patient = unwrap(
    await db
      .from("patients")
      .select("id, full_name, anonymized_at, contacts!inner ( id, full_name, phone )")
      .eq("clinic_id", clinicId)
      .eq("id", req.patientId)
      .maybeSingle(),
    "Registro de contato",
  ) as unknown as { id: string; full_name: string; anonymized_at: string | null; contacts: { id: string; full_name: string; phone: string } } | null;
  if (!patient || patient.anonymized_at) throw notFound();

  const keyed = req.source === "retorno" || req.source === "lembretes" || req.source === "aguardando_remarcacao";
  if (keyed) {
    if (!req.appointmentId) throw notFound();
    const appointment = unwrap(
      await db.from("appointments").select("id").eq("clinic_id", clinicId).eq("id", req.appointmentId).eq("patient_id", patient.id).maybeSingle(),
      "Registro de contato",
    );
    if (!appointment) throw notFound();
  }
  const who = { patientId: patient.id, contactId: patient.contacts.id };
  const booked = !options.includes("scheduled")
    ? null
    : req.source === "ficha_paciente"
      ? await findBookedAppointment(db, clinicId, who, { upcomingFrom: now })
      : await findBookedAppointment(db, clinicId, who, { createdSince: req.since! });
  return {
    source: req.source,
    phone: patient.contacts.phone,
    contactId: patient.contacts.id,
    contactName: patient.contacts.full_name,
    patientId: patient.id,
    patientName: patient.full_name,
    pendencyAppointmentId: keyed ? req.appointmentId : null,
    sessionId: null,
    booked,
    options,
  };
}

/** Grava o registro escolhido para a pendência conferida. */
export async function registerContact(
  db: DbClient,
  clinicId: string,
  target: RegisterTarget,
  choice: { outcome: string; note: string | null },
): Promise<{ outcome: InteractionOutcome; exits: boolean }> {
  const outcome = choice.outcome as InteractionOutcome;
  if (!target.options.includes(outcome)) throw new DataError("invalid", "Registro: escolha o resultado", { outcome: "Escolha o que aconteceu." });
  if (outcome === "scheduled" && !target.booked) {
    throw new DataError("invalid", "Registro: sem atendimento", { outcome: "Ainda não há atendimento marcado para este contato." });
  }
  await recordContactInteraction(db, clinicId, {
    source: target.source,
    phone: target.phone,
    contactId: target.contactId,
    patientId: target.patientId,
    appointmentId: outcome === "scheduled" ? target.booked!.id : target.pendencyAppointmentId,
    sessionId: target.sessionId,
    outcome,
    note: choice.note,
  });
  return { outcome, exits: exitsList(target.source, outcome) };
}
