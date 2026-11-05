import type { DbClient } from "../clients";
import { DataError, unwrap } from "../errors";

// Falhas de envio que a clínica resolve (cliente, 05/nov/2026; docs/falhas-de-envio.md).
//
// Número sem WhatsApp: a Meta devolve 131026 quando o número não tem WhatsApp (ou o app está muito desatualizado, ou
// a pessoa não aceitou os termos novos) — quase sempre um número cadastrado errado. O Início mostra "Corrigir
// número" até a recepção corrigir o cadastro, até uma mensagem nova chegar a esse número ou até "O número está certo".
//
// Descartar: o Suporte tira da aba Envios o erro já conhecido e resolvido (ex.: o pagamento da Meta já acertado).
// Cada lugar descarta o seu (tabela send_failure_dismissals; a função do banco confere o papel).

/** Códigos da Meta que dizem que o número não recebe WhatsApp. */
export const NUMBER_FAILURE_CODES = [131026] as const;

/** Até quantos dias atrás uma falha de número ainda aparece no Início. */
export const NUMBER_FAILURE_WINDOW_DAYS = 30;

export type DismissScope = "envios" | "inicio";

export async function dismissSendFailure(
  db: DbClient,
  clinicId: string,
  scope: DismissScope,
  target: { messageId: string } | { eventId: number },
): Promise<void> {
  unwrap(
    await db.rpc("dismiss_send_failure", {
      p_clinic_id: clinicId,
      p_scope: scope,
      ...("messageId" in target ? { p_message_id: target.messageId } : { p_event_id: target.eventId }),
    }),
    "Falha de envio",
  );
}

export type NumberWithoutWhatsapp = {
  messageId: string;
  contactId: string;
  contactName: string;
  phone: string;
  failedAt: Date;
  messageType: string;
  /** O atendimento da mensagem, quando era dele (confirmação, lembrete, aviso). */
  appointment: { id: string; patientName: string; scheduledAt: Date } | null;
};

type FailureRow = { id: string; contact_id: string | null; contact_phone: string; message_type: string; appointment_id: string | null; created_at: string };

/**
 * Contatos com número sem WhatsApp, do mais recente ao mais antigo: a última falha de número de cada contato nos
 * últimos 30 dias, se o cadastro ainda tem esse número, nenhuma mensagem chegou a ele depois e ninguém disse que o
 * número está certo.
 */
export async function listNumbersWithoutWhatsapp(db: DbClient, clinicId: string, now: Date = new Date()): Promise<NumberWithoutWhatsapp[]> {
  const since = new Date(now.getTime() - NUMBER_FAILURE_WINDOW_DAYS * 24 * 60 * 60_000).toISOString();
  const failures = unwrap(
    await db
      .from("whatsapp_messages")
      .select("id, contact_id, contact_phone, message_type, appointment_id, created_at")
      .eq("clinic_id", clinicId)
      .eq("direction", "outbound")
      .in("failure_code", [...NUMBER_FAILURE_CODES])
      .not("contact_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200),
    "Mensagens do WhatsApp",
  ) as FailureRow[];
  if (failures.length === 0) return [];

  // A última falha de cada contato.
  const latest = new Map<string, FailureRow>();
  for (const row of failures) if (!latest.has(row.contact_id!)) latest.set(row.contact_id!, row);
  const rows = [...latest.values()];
  const contactIds = rows.map((r) => r.contact_id!);
  const phones = [...new Set(rows.map((r) => r.contact_phone))];
  const appointmentIds = rows.map((r) => r.appointment_id).filter((id): id is string => !!id);

  const [contacts, reached, dismissed, appointments] = await Promise.all([
    db.from("contacts").select("id, full_name, phone, is_active").eq("clinic_id", clinicId).in("id", contactIds),
    db
      .from("whatsapp_messages")
      .select("contact_phone, created_at")
      .eq("clinic_id", clinicId)
      .eq("direction", "outbound")
      .in("contact_phone", phones)
      .in("status", ["delivered", "read"])
      .gte("created_at", since),
    db.from("send_failure_dismissals").select("message_id").eq("clinic_id", clinicId).eq("scope", "inicio").in("message_id", rows.map((r) => r.id)),
    appointmentIds.length
      ? db.from("appointments").select("id, scheduled_at, patients ( full_name )").eq("clinic_id", clinicId).in("id", appointmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const contactById = new Map(unwrap(contacts, "Contatos").map((c) => [c.id, c]));
  const reachedRows = unwrap(reached, "Mensagens do WhatsApp");
  const dismissedIds = new Set(unwrap(dismissed, "Falhas descartadas").map((d) => d.message_id));
  const appointmentById = new Map(
    (unwrap(appointments, "Atendimentos") as unknown as { id: string; scheduled_at: string; patients: { full_name: string } | null }[]).map((a) => [a.id, a]),
  );

  return rows.flatMap((row): NumberWithoutWhatsapp[] => {
    const contact = contactById.get(row.contact_id!);
    // Cadastro corrigido (outro número), contato desativado, já dispensado ou o número recebeu mensagem depois.
    if (!contact || !contact.is_active || contact.phone !== row.contact_phone || dismissedIds.has(row.id)) return [];
    if (reachedRows.some((m) => m.contact_phone === row.contact_phone && m.created_at > row.created_at)) return [];
    const appointment = row.appointment_id ? appointmentById.get(row.appointment_id) : undefined;
    return [
      {
        messageId: row.id,
        contactId: contact.id,
        contactName: contact.full_name,
        phone: contact.phone,
        failedAt: new Date(row.created_at),
        messageType: row.message_type,
        appointment: appointment ? { id: appointment.id, patientName: appointment.patients?.full_name ?? contact.full_name, scheduledAt: new Date(appointment.scheduled_at) } : null,
      },
    ];
  });
}

export type FailedMessage = { id: string; contactId: string | null; phone: string | null; messageType: string; appointmentId: string | null; status: string | null };

/** Uma mensagem enviada da clínica (para corrigir o número ou descartar). */
export async function getOutboundMessage(db: DbClient, clinicId: string, id: string): Promise<FailedMessage> {
  const row = unwrap(
    await db
      .from("whatsapp_messages")
      .select("id, contact_id, contact_phone, message_type, appointment_id, status")
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .eq("direction", "outbound")
      .maybeSingle(),
    "Mensagem do WhatsApp",
  );
  if (!row) throw new DataError("not_found", "Mensagem do WhatsApp: não encontrada");
  return { id: row.id, contactId: row.contact_id, phone: row.contact_phone, messageType: row.message_type, appointmentId: row.appointment_id, status: row.status };
}

/** Situação do último aviso (marcação ou remarcação) de um atendimento, para o aviso da Agenda depois de marcar. */
export type NoticeTracking = {
  messageId: string;
  messageType: string;
  status: string | null;
  phone: string;
  contactId: string | null;
  contactName: string | null;
  failureCode: number | null;
  failureReason: string | null;
  createdAt: Date;
  /** Falha passageira com nova tentativa prevista. */
  retrying: boolean;
};

export async function getLatestNotice(db: DbClient, clinicId: string, appointmentId: string): Promise<NoticeTracking | null> {
  const row = unwrap(
    await db
      .from("whatsapp_messages")
      .select("id, message_type, status, contact_phone, contact_id, failure_code, failure_reason, created_at, retry_at, contacts ( full_name )")
      .eq("clinic_id", clinicId)
      .eq("appointment_id", appointmentId)
      .eq("direction", "outbound")
      .in("message_type", ["appointment_confirmation", "appointment_reschedule"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "Mensagem do WhatsApp",
  ) as
    | {
        id: string;
        message_type: string;
        status: string | null;
        contact_phone: string;
        contact_id: string | null;
        failure_code: number | null;
        failure_reason: string | null;
        created_at: string;
        retry_at: string | null;
        contacts: { full_name: string } | null;
      }
    | null;
  if (!row) return null;
  return {
    messageId: row.id,
    messageType: row.message_type,
    status: row.status,
    phone: row.contact_phone,
    contactId: row.contact_id,
    contactName: row.contacts?.full_name ?? null,
    failureCode: row.failure_code,
    failureReason: row.failure_reason,
    createdAt: new Date(row.created_at),
    retrying: row.retry_at !== null,
  };
}
