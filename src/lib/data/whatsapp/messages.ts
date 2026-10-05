import type { DbClient } from "../clients";
import { DataError, unwrap } from "../errors";
import { deliveryRank, isDeliveryStatus, messageBody, reachedPhone, toE164, type WaMessage } from "./meta";

// Registro das mensagens do WhatsApp (F3.9a), com a credencial da clínica.
//
// Tudo o que entra e sai fica em `whatsapp_messages`, com o telefone, o
// contato (quando o número já é contato da clínica) e o atendimento quando a
// mensagem é dele (trilha). Eventos repetidos da Meta não entram duas vezes
// (L23): quem chama não trata de novo uma mensagem repetida. Enviar de verdade
// é de quem chama (bot na F6, agendador na F7); aqui só se registra.

/**
 * Margem sobre as 24h da Meta: a última mensagem do paciente pode ter chegado
 * quase no limite, e o envio acontece alguns segundos depois da checagem.
 */
export const CUSTOMER_SERVICE_WINDOW_MS = 23.5 * 60 * 60_000;

/** Contato ativo da clínica com este telefone (null = ainda não é contato). */
export async function contactIdByPhone(db: DbClient, clinicId: string, phone: string): Promise<string | null> {
  const row = unwrap(
    await db.from("contacts").select("id").eq("clinic_id", clinicId).eq("phone", phone).eq("is_active", true).maybeSingle(),
    "Contato",
  );
  return row?.id ?? null;
}

export type RecordResult = { recorded: true; id: string; contactId: string | null } | { recorded: false; reason: "duplicate" | "invalid_phone" };

async function insertOnce(db: DbClient, row: Record<string, unknown> & { clinic_id: string }): Promise<string | null> {
  const { data, error } = await db.from("whatsapp_messages").insert(row as never).select("id").single();
  if (error) {
    // Índice único (clinic_id, wa_message_id): a Meta repetiu o evento.
    if ((error as { code?: string }).code === "23505") return null;
    throw new DataError("unexpected", `Mensagem do WhatsApp: ${error.message}`, {}, { cause: error });
  }
  return data.id;
}

/** Mensagem recebida do paciente. `duplicate` = a Meta repetiu o evento: não tratar de novo. */
export async function recordInboundMessage(db: DbClient, clinicId: string, msg: WaMessage, now: Date = new Date()): Promise<RecordResult> {
  const phone = toE164(msg.from);
  if (!phone) return { recorded: false, reason: "invalid_phone" };
  const contactId = await contactIdByPhone(db, clinicId, phone);
  const id = await insertOnce(db, {
    clinic_id: clinicId,
    contact_id: contactId,
    contact_phone: phone,
    direction: "inbound",
    message_type: msg.type ?? "unknown",
    body: messageBody(msg),
    status: "received",
    wa_message_id: msg.id ?? null,
    created_at: now.toISOString(),
  });
  return id ? { recorded: true, id, contactId } : { recorded: false, reason: "duplicate" };
}

/**
 * Mensagem que a recepção mandou pelo app do WhatsApp Business (eco da
 * coexistência). Pausar o bot ou devolver a conversa é da conversa
 * (handleAgentEcho em conversations.ts).
 */
export async function recordAgentEcho(db: DbClient, clinicId: string, echo: WaMessage, now: Date = new Date()): Promise<RecordResult> {
  const phone = toE164(echo.to);
  if (!phone) return { recorded: false, reason: "invalid_phone" };
  const contactId = await contactIdByPhone(db, clinicId, phone);
  const id = await insertOnce(db, {
    clinic_id: clinicId,
    contact_id: contactId,
    contact_phone: phone,
    direction: "outbound",
    message_type: "agent_reply",
    body: messageBody(echo),
    status: "sent",
    wa_message_id: echo.id ?? null,
    created_at: now.toISOString(),
  });
  return id ? { recorded: true, id, contactId } : { recorded: false, reason: "duplicate" };
}

export type OutboundMessage = {
  phone: string;
  contactId?: string | null;
  appointmentId?: string | null;
  /** O que foi enviado (ex.: "reminder", "bot_menu", "waitlist_offer"). */
  messageType: string;
  templateName?: string | null;
  body?: string | null;
  /** "sent" com o id da Meta; "failed" ou "skipped_…" quando não saiu. */
  status: string;
  waMessageId?: string | null;
};

/** Mensagem enviada pelo sistema (bot, agendador ou botão da tela). */
export async function recordOutboundMessage(
  db: DbClient,
  clinicId: string,
  message: OutboundMessage,
  now: Date = new Date(),
): Promise<string> {
  const contactId = message.contactId !== undefined ? message.contactId : await contactIdByPhone(db, clinicId, message.phone);
  const id = await insertOnce(db, {
    clinic_id: clinicId,
    contact_id: contactId,
    contact_phone: message.phone,
    appointment_id: message.appointmentId ?? null,
    direction: "outbound",
    message_type: message.messageType,
    template_name: message.templateName ?? null,
    body: message.body ?? null,
    status: message.status,
    wa_message_id: message.waMessageId ?? null,
    created_at: now.toISOString(),
  });
  if (!id) throw new DataError("duplicate", "Mensagem do WhatsApp: já registrada");
  return id;
}

// ---------------------------------------------------------------------------
// Situação da entrega
// ---------------------------------------------------------------------------

export type DeliveryUpdate =
  | { updated: false }
  | {
      updated: true;
      /** Chegou ao celular agora: dispara o que espera a entrega (ex.: preparo do exame, F3.9b). */
      reachedPhone: boolean;
      message: { id: string; appointmentId: string | null; messageType: string; contactId: string | null; phone: string | null };
    };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Situação de entrega vinda da Meta para uma mensagem enviada. Nunca regride
 * (a Meta pode mandar "lida" antes de "entregue"), e só uma chamada vê a
 * mensagem chegar ao celular quando duas situações chegam juntas. Se a
 * situação chega antes de a mensagem ser gravada, espera um pouco (piloto).
 */
export async function updateDeliveryStatus(
  db: DbClient,
  clinicId: string,
  waMessageId: string,
  status: string,
  { wait = sleep }: { wait?: (ms: number) => Promise<unknown> } = {},
): Promise<DeliveryUpdate> {
  if (!waMessageId || !isDeliveryStatus(status)) return { updated: false };

  for (let attempt = 0; attempt < 4; attempt++) {
    const row = unwrap(
      await db
        .from("whatsapp_messages")
        .select("id, status, appointment_id, message_type, contact_id, contact_phone")
        .eq("clinic_id", clinicId)
        .eq("wa_message_id", waMessageId)
        .eq("direction", "outbound")
        .maybeSingle(),
      "Mensagem do WhatsApp",
    );

    if (!row) {
      // De outra origem, ou ainda não gravada.
      if (!reachedPhone(null, status) || attempt >= 2) return { updated: false };
      await wait(1500);
      continue;
    }
    if (deliveryRank(status) < deliveryRank(row.status)) return { updated: false };
    if (status === row.status) return { updated: false };

    let update = db.from("whatsapp_messages").update({ status }).eq("id", row.id);
    update = row.status === null ? update.is("status", null) : update.eq("status", row.status);
    const changed = unwrap(await update.select("id"), "Mensagem do WhatsApp");
    if (changed.length === 0) continue; // outra chamada mudou antes; relê

    return {
      updated: true,
      reachedPhone: reachedPhone(row.status, status),
      message: {
        id: row.id,
        appointmentId: row.appointment_id,
        messageType: row.message_type,
        contactId: row.contact_id,
        phone: row.contact_phone,
      },
    };
  }
  return { updated: false };
}

// ---------------------------------------------------------------------------
// Janela de 24h e leitura
// ---------------------------------------------------------------------------

/**
 * Janela de atendimento aberta: o número escreveu nas últimas 24h (com a
 * margem). Só aí a Meta aceita texto livre e botões; fora dela, só template.
 */
export async function isCustomerServiceWindowOpen(
  db: DbClient,
  clinicId: string,
  phone: string,
  now: Date = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - CUSTOMER_SERVICE_WINDOW_MS).toISOString();
  const rows = unwrap(
    await db
      .from("whatsapp_messages")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("contact_phone", phone)
      .eq("direction", "inbound")
      .gte("created_at", since)
      .limit(1),
    "Janela do WhatsApp",
  );
  return rows.length > 0;
}

export type WhatsappMessage = {
  id: string;
  direction: "inbound" | "outbound";
  messageType: string;
  templateName: string | null;
  body: string | null;
  status: string | null;
  phone: string | null;
  contactId: string | null;
  appointmentId: string | null;
  createdAt: Date;
};

/** Mensagens de um atendimento (trilha) ou de um contato, das mais novas para as mais antigas. */
export async function listWhatsappMessages(
  db: DbClient,
  clinicId: string,
  filter: { appointmentId: string } | { contactId: string },
  limit = 100,
): Promise<WhatsappMessage[]> {
  let query = db
    .from("whatsapp_messages")
    .select("id, direction, message_type, template_name, body, status, contact_phone, contact_id, appointment_id, created_at")
    .eq("clinic_id", clinicId);
  query = "appointmentId" in filter ? query.eq("appointment_id", filter.appointmentId) : query.eq("contact_id", filter.contactId);
  const rows = unwrap(await query.order("created_at", { ascending: false }).limit(limit), "Mensagens do WhatsApp");
  return rows.map((row) => ({
    id: row.id,
    direction: row.direction as "inbound" | "outbound",
    messageType: row.message_type,
    templateName: row.template_name,
    body: row.body,
    status: row.status,
    phone: row.contact_phone,
    contactId: row.contact_id,
    appointmentId: row.appointment_id,
    createdAt: new Date(row.created_at),
  }));
}
