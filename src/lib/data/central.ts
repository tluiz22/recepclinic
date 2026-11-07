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

export type ConversationMedia = { id: string; status: string; mimeType: string | null; sizeBytes: number | null; fileName: string | null };

/** Anexos das mensagens mostradas (CN5): situação, tipo, tamanho e nome. O arquivo sai pela rota do anexo. */
export async function listConversationMedia(db: DbClient, clinicId: string, phone: string, ids: string[]): Promise<Map<string, ConversationMedia>> {
  if (!ids.length) return new Map();
  const rows = unwrap(await db.rpc("central_conversation_media", { p_clinic_id: clinicId, p_contact_phone: phone, p_media_ids: ids }), "Anexos");
  return new Map(rows.map((row) => [row.id, { id: row.id, status: row.status, mimeType: row.mime_type, sizeBytes: row.size_bytes, fileName: row.file_name }]));
}

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

/** A Central vale para a clínica (item liberado e ligada pelo Administrador): menu, tela Conversas e o Atendimento antigo. */
export async function isCentralActive(db: DbClient, clinicId: string): Promise<boolean> {
  return unwrap(await db.rpc("central_enabled", { p_clinic_id: clinicId }), "Central de atendimento") === true;
}

/** Conversas que aguardam a clínica e a pessoa vê (o número do item Conversas no menu). */
export async function countWaitingConversations(db: DbClient, clinicId: string): Promise<number> {
  return (unwrap(await db.rpc("central_waiting_count", { p_clinic_id: clinicId }), "Conversas") as number) ?? 0;
}

export type ConversationSummary = {
  phone: string;
  contactId: string | null;
  name: string | null;
  open: boolean;
  /** "waiting_clinic" = Aguardando a clínica; "in_progress" = Em atendimento; null = com o bot. */
  status: "waiting_clinic" | "in_progress" | null;
  statusAt: Date | null;
  startedAt: Date | null;
  reason: string | null;
  subject: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  lastMessageAt: Date | null;
  lastMessageAuthor: MessageAuthor | null;
  /** Prévia (até 120 caracteres); null = sem texto guardado (Central desligada, anexo ou apagada). */
  preview: string | null;
  lastPatientAt: Date | null;
  unread: number;
  /** Nome no perfil do WhatsApp (T4; só com a Central ligada). */
  profileName: string | null;
  /** O atendimento atual (eventos e assunto). */
  handoffId: string | null;
  /** NA: atendimento ou número marcado (Pessoal, Administrativo/outros), com quando e o primeiro nome de quem marcou. */
  classification: "patient" | "personal" | "administrative";
  classifiedAt: Date | null;
  classifiedByName: string | null;
};

/** Selo do número marcado (NA, telas NA0). */
export const CLASSIFICATION_LABELS = { personal: "Pessoal", administrative: "Administrativo" } as const;

/** Filtro das Abertas: Todas ou Minhas (NA0, cliente, 06/nov/2026; antes, o "Mostrar" da decisão 3, com quatro opções). */
export type ConversationFilter = "todas" | "minhas";

const date = (value: string | null) => (value ? new Date(value) : null);

/**
 * Abertas (com a clínica), Finalizadas (com o bot) ou Pessoal e admin. (números marcados, NA), na ordem da tela; o banco
 * aplica quem vê o quê (a aba nova só o Administrador, a Recepção e o Suporte).
 */
export async function listConversations(
  db: DbClient,
  clinicId: string,
  options: { finished?: boolean; classified?: boolean; search?: string | null } = {},
): Promise<ConversationSummary[]> {
  const rows = unwrap(
    await db.rpc("central_conversations", {
      p_clinic_id: clinicId,
      p_finished: options.finished ?? false,
      ...(options.classified ? { p_classified: true } : {}),
      ...(options.search?.trim() ? { p_search: options.search.trim().slice(0, 80) } : {}),
    }),
    "Conversas",
  );
  return rows.map((row) => ({
    phone: row.contact_phone,
    contactId: row.contact_id,
    name: row.name,
    open: row.human_handoff,
    status: row.human_handoff ? ((row.handoff_status as ConversationSummary["status"]) ?? "waiting_clinic") : null,
    statusAt: date(row.handoff_status_at),
    startedAt: date(row.handoff_started_at),
    reason: row.handoff_reason,
    subject: row.handoff_subject,
    assignedTo: row.assigned_to,
    assignedName: row.assigned_name,
    lastMessageAt: date(row.last_message_at),
    lastMessageAuthor: row.last_message_author as MessageAuthor | null,
    preview: row.last_message_preview,
    lastPatientAt: date(row.last_patient_at),
    unread: row.unread ?? 0,
    profileName: row.profile_name,
    handoffId: row.handoff_id,
    classification: ((row.classification as ConversationSummary["classification"] | null) ?? "patient"),
    classifiedAt: date(row.classified_at),
    classifiedByName: row.classified_by_name ?? null,
  }));
}

/** Aplica o filtro das Abertas: "Minhas" = as que estão com a pessoa. */
export function filterConversations(items: ConversationSummary[], filter: ConversationFilter, userId: string): ConversationSummary[] {
  return filter === "minhas" ? items.filter((item) => item.assignedTo === userId) : items;
}

/** Quem está com a conversa, na lista e no topo da conversa. */
export function ownerLabel(item: Pick<ConversationSummary, "open" | "assignedTo" | "assignedName"> & { classification?: ConversationSummary["classification"] }, userId: string): string {
  if (item.classification && item.classification !== "patient") return "Sem o assistente";
  if (!item.open) return "Com o assistente";
  if (!item.assignedTo) return "Sem responsável";
  if (item.assignedTo === userId) return "Com você";
  return `Com ${item.assignedName ?? "outra pessoa da equipe"}`;
}
