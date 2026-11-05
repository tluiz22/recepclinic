// Regras puras sobre os eventos da Meta (F3.9a), sem acesso ao banco: o
// webhook (F6) e a camada de mensagens e conversas usam estas funções.

/** Mensagem recebida (ou eco da recepção) no webhook, só com o que usamos. */
export interface WaMessage {
  id?: string;
  from?: string;
  to?: string;
  type?: string;
  text?: { body?: string };
  /** Toque num botão de template; `payload` é o definido no envio. */
  button?: { text?: string; payload?: string };
  interactive?: {
    list_reply?: { id?: string; title?: string };
    button_reply?: { id?: string; title?: string };
  };
  /** Mensagem respondida: num toque de lista ou botão, a mensagem que tinha as opções. */
  context?: { id?: string };
  /** Hora do evento na Meta, em segundos (IS4: a hora do eco do app). */
  timestamp?: string | number;
  /** Anexos: só a legenda importa aqui (o arquivo é do CN5). */
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  /** Eco de mensagem editada no app (smb_message_echoes, `type: "edit"`): o conteúdo novo da original. */
  edit?: { original_message_id?: string; message?: WaMessage };
  /** Eco de mensagem apagada no app (`type: "revoke"`). */
  revoke?: { original_message_id?: string };
}

/**
 * Texto guardado no histórico da Central (CN2): o que a pessoa escreveu ou tocou, ou a legenda do anexo; sem os
 * marcadores "[image]". O banco só guarda com a Central ligada (D12 revista).
 */
export function storedText(msg: WaMessage): string | null {
  const reply = msg.interactive?.list_reply ?? msg.interactive?.button_reply;
  const text = msg.text?.body ?? reply?.title ?? msg.button?.text ?? msg.image?.caption ?? msg.video?.caption ?? msg.document?.caption ?? null;
  return text?.trim() ? text : null;
}

/** Hora do evento na Meta (segundos, em texto ou número) → instante; null se não vier ou não for válida. */
export function waTimestamp(msg: WaMessage): Date | null {
  const seconds = Number(msg.timestamp);
  if (msg.timestamp == null || msg.timestamp === "" || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

/** Eco que muda uma mensagem já enviada pelo app (edição ou exclusão), em vez de ser uma resposta nova. */
export function echoChange(echo: WaMessage): { kind: "edit"; originalId: string; text: string | null } | { kind: "revoke"; originalId: string } | null {
  if (echo.type === "edit" && echo.edit?.original_message_id) {
    return { kind: "edit", originalId: echo.edit.original_message_id, text: echo.edit.message ? storedText(echo.edit.message) : null };
  }
  if (echo.type === "revoke" && echo.revoke?.original_message_id) return { kind: "revoke", originalId: echo.revoke.original_message_id };
  return null;
}

/**
 * "5584981880777" (formato da Meta) → "+5584981880777". A Meta às vezes manda
 * celular brasileiro sem o 9 (12 dígitos); sem acrescentar, o mesmo número
 * vira duas conversas (bug real do piloto). Só celular escreve no WhatsApp.
 */
export function toE164(waNumber: string | undefined | null): string | null {
  if (!waNumber || !/^\d{10,15}$/.test(waNumber)) return null;
  const digits = waNumber.startsWith("55") && waNumber.length === 12 ? `55${waNumber.slice(2, 4)}9${waNumber.slice(4)}` : waNumber;
  return `+${digits}`;
}

/** Número no formato do envio à Meta (sem o +). */
export function toWaNumber(e164: string): string {
  return e164.replace(/^\+/, "");
}

/** Texto legível de uma mensagem recebida ou de um eco, para o registro. */
export function messageBody(msg: WaMessage): string | null {
  if (msg.text?.body) return msg.text.body;
  const reply = msg.interactive?.list_reply ?? msg.interactive?.button_reply;
  if (reply) return reply.title ?? reply.id ?? null;
  if (msg.button?.text) return msg.button.text;
  return msg.type ? `[${msg.type}]` : null;
}

/** "#bot" em qualquer parte da mensagem da recepção devolve a conversa ao bot. */
export function isReturnToBotKeyword(body: string | null): boolean {
  return !!body && /#bot/i.test(body);
}

// ---------------------------------------------------------------------------
// Situação da entrega
// ---------------------------------------------------------------------------

/** Ordem das situações vindas da Meta: o webhook pode trazê-las fora de ordem. */
const DELIVERY_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 3 };

export function deliveryRank(status: string | null): number {
  return DELIVERY_RANK[status ?? ""] ?? 0;
}

export function isDeliveryStatus(status: string): boolean {
  return status in DELIVERY_RANK;
}

/** A mensagem chegou ao celular agora (entregue ou lida pela primeira vez)? */
export function reachedPhone(previous: string | null, next: string): boolean {
  return next !== "failed" && deliveryRank(next) >= DELIVERY_RANK.delivered && deliveryRank(previous) < DELIVERY_RANK.delivered;
}
