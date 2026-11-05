import type { DbClient } from "./clients";
import { unwrap } from "./errors";

// Central de Atendimento (CN1; plano em docs/planejamento-central-atendimento.md): ligar e desligar pelo
// Administrador e a leitura do histórico de uma conversa. As regras ficam no banco: a Central vale com o item da
// matriz liberado e ligada pelo Administrador; Administrador e Recepção veem todas as conversas, o Profissional só a
// que está com ele, o Suporte todas; cada abertura e cada anexo ficam registrados.

export type MessageAuthor = "patient" | "bot" | "system" | "agent_app" | "agent_panel";

export type CentralMessage = {
  id: string;
  direction: "inbound" | "outbound";
  author: MessageAuthor;
  messageType: string;
  templateName: string | null;
  /** Texto; null = mensagem anterior à Central, apagada no app ou guardada com a Central desligada. */
  body: string | null;
  status: string | null;
  failureCode: number | null;
  failureReason: string | null;
  sortAt: Date;
  sentBy: string | null;
  handoffId: string | null;
  source: "live" | "history";
  editedAt: Date | null;
  revokedAt: Date | null;
  mediaId: string | null;
};

export type MessageCursor = { sortAt: string; id: string };

/** Liga ou desliga a Central (só o Administrador; ligar exige o item da matriz). true = mudou. */
export async function setCentralEnabled(db: DbClient, clinicId: string, enabled: boolean): Promise<boolean> {
  return unwrap(await db.rpc("set_central_enabled", { p_clinic_id: clinicId, p_enabled: enabled }), "Central de atendimento") as boolean;
}

/** Histórico da conversa, da mais nova para a mais antiga. Sem cursor = abre a conversa (registra e marca como lida). */
export async function listConversationMessages(
  db: DbClient,
  clinicId: string,
  phone: string,
  options: { before?: MessageCursor; limit?: number } = {},
): Promise<{ messages: CentralMessage[]; next: MessageCursor | null }> {
  const limit = options.limit ?? 50;
  const rows = unwrap(
    await db.rpc("central_conversation_messages", {
      p_clinic_id: clinicId,
      p_contact_phone: phone,
      p_limit: limit,
      ...(options.before ? { p_before_sort_at: options.before.sortAt, p_before_id: options.before.id } : {}),
    }),
    "Conversa",
  );
  const messages = rows.map((row) => ({
    id: row.id,
    direction: row.direction as CentralMessage["direction"],
    author: row.author as MessageAuthor,
    messageType: row.message_type,
    templateName: row.template_name,
    body: row.body,
    status: row.status,
    failureCode: row.failure_code,
    failureReason: row.failure_reason,
    sortAt: new Date(row.sort_at),
    sentBy: row.sent_by,
    handoffId: row.handoff_id,
    source: row.source as CentralMessage["source"],
    editedAt: row.edited_at ? new Date(row.edited_at) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    mediaId: row.media_id,
  }));
  const last = rows[rows.length - 1];
  return { messages, next: rows.length === limit && last ? { sortAt: last.sort_at, id: last.id } : null };
}

export type CentralSwitch = { enabled: boolean; at: Date | null };

/** Última troca do Administrador (sem troca = desligada). Lê só o Administrador e o Suporte. */
export async function getCentralSwitch(db: DbClient, clinicId: string): Promise<CentralSwitch> {
  const rows = unwrap(
    await db
      .from("central_switches")
      .select("enabled, occurred_at")
      .eq("clinic_id", clinicId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1),
    "Central de atendimento",
  );
  const last = rows[0];
  return last ? { enabled: last.enabled, at: new Date(last.occurred_at) } : { enabled: false, at: null };
}
