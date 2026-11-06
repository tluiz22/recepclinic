import type { CentralMessage } from "./data/central";
import { MESSAGE_LABELS } from "./data/agenda/trail";
import { capitalize } from "./vocabulary";

// Como cada mensagem aparece na conversa da Central (CN3a; telas T1 e da conversa no celular, cliente, 05/nov/2026):
// o paciente à esquerda; o assistente, os avisos automáticos e a equipe à direita, cada um com o seu rótulo; a
// mensagem sem texto guardado diz o porquê (anterior à Central, apagada, anexo).

export type Bubble = {
  side: "left" | "right";
  tone: "patient" | "bot" | "system" | "app" | "panel";
  /** Rótulo acima do texto (null = paciente, sem rótulo). */
  label: string | null;
  text: string | null;
  /** Mensagem sem texto: o que mostrar no lugar, em itálico. */
  placeholder: string | null;
  edited: boolean;
  failed: boolean;
};

/** "Visto"/"entregue" ao lado da hora, nas mensagens que saíram (como no WhatsApp). */
export function deliveryLabel(status: string | null): string | null {
  if (status === "read") return "lida";
  if (status === "delivered") return "entregue";
  if (status === "failed") return "não entregue";
  if (status === "sending") return "enviando";
  return null;
}

const MEDIA_WORDS: Record<string, string> = {
  image: "Foto",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contacts: "Contato",
};

export function bubbleOf(message: CentralMessage, names: Map<string, string> = new Map()): Bubble {
  const base = { text: message.body, placeholder: null as string | null, edited: !!message.editedAt && !message.revokedAt, failed: message.status === "failed" };
  let bubble: Bubble;
  switch (message.author) {
    case "patient":
      bubble = { ...base, side: "left", tone: "patient", label: null };
      break;
    case "bot":
      bubble = { ...base, side: "right", tone: "bot", label: "Assistente" };
      break;
    case "agent_app":
      bubble = { ...base, side: "right", tone: "app", label: "Respondida pelo app do WhatsApp" };
      break;
    case "agent_panel": {
      const who = message.sentBy ? names.get(message.sentBy) : null;
      const via = message.messageType === "conversation_resume" ? "Retomar conversa" : "pela Central";
      bubble = { ...base, side: "right", tone: "panel", label: who ? `${who} · ${via}` : capitalize(via) };
      break;
    }
    default: {
      const kind = MESSAGE_LABELS[message.messageType]?.label;
      const label =
        message.messageType === "app_auto_reply"
          ? "Mensagem automática do app"
          : message.messageType === "connection_test"
            ? "Mensagem de teste"
            : kind
              ? `Aviso automático · ${kind}`
              : "Aviso automático";
      bubble = { ...base, side: "right", tone: "system", label };
    }
  }
  if (bubble.text) return bubble;
  if (message.revokedAt) return { ...bubble, placeholder: "Mensagem apagada" };
  const media = MEDIA_WORDS[message.messageType];
  if (media) return { ...bubble, placeholder: media };
  if (message.author === "system" && message.templateName) return { ...bubble, placeholder: "Texto do aviso não guardado" };
  return { ...bubble, placeholder: "Mensagem anterior à Central de atendimento" };
}

// ---------------------------------------------------------------------------
// Anexos (CN5; decisões 8b e 8c, cliente, 05/nov/2026)
// ---------------------------------------------------------------------------

/** "1,2 MB", "350 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",").replace(/,0$/, "")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type AttachmentMedia = { id: string; status: string; mimeType: string | null; sizeBytes: number | null; fileName: string | null };

export type Attachment =
  | { kind: "image" | "audio"; href: string }
  | { kind: "document"; href: string; name: string; size: string | null }
  /** Aviso no lugar do arquivo; `openInApp` = mostrar "Abrir no WhatsApp" (só com coexistência, 8c). */
  | { kind: "notice"; text: string; openInApp: boolean }
  | { kind: "pending"; text: string };

const ARTICLE: Record<string, string> = { image: "uma foto", audio: "um áudio", document: "um documento", video: "um vídeo", sticker: "uma figurinha" };

/** Como o anexo aparece na mensagem (null = sem anexo guardado: vale o texto ou o marcador de antes). */
export function attachmentOf(type: string, media: AttachmentMedia | undefined, coexistence: boolean): Attachment | null {
  if (!media) return null;
  // Enviada pela Central (CN6): a mensagem é "panel_reply"; o tipo vem do arquivo.
  const messageType = type in ARTICLE ? type : media.mimeType?.startsWith("image/") ? "image" : "document";
  const href = `/api/admin/conversas/midia/${media.id}`;
  const what = ARTICLE[messageType] ?? "um arquivo";
  const size = media.sizeBytes !== null ? formatFileSize(media.sizeBytes) : null;
  const viaApp = coexistence ? "veja e responda esta mensagem pelo app do WhatsApp." : "peça ao paciente para enviar como foto ou PDF.";
  switch (media.status) {
    case "stored":
      if (messageType === "image") return { kind: "image", href };
      if (messageType === "audio") return { kind: "audio", href };
      return { kind: "document", href: `${href}?baixar=1`, name: media.fileName ?? "Documento", size };
    case "pending":
      return { kind: "pending", text: `Recebendo ${what}…` };
    case "unsupported":
      if (messageType === "sticker") return { kind: "notice", text: "O paciente enviou uma figurinha. A Central não mostra figurinhas.", openInApp: false };
      return { kind: "notice", text: `O paciente enviou ${what}${size ? ` (${size})` : ""}. A Central não mostra vídeos: ${viaApp}`, openInApp: coexistence };
    case "too_large":
      return { kind: "notice", text: `O paciente enviou ${what}${size ? ` (${size})` : ""}, acima do limite da Central: ${viaApp}`, openInApp: coexistence };
    case "deleted":
      return { kind: "notice", text: "Anexo apagado: passou o prazo de guarda (12 meses).", openInApp: false };
    default:
      return { kind: "notice", text: `Não foi possível receber ${what}. Peça ao paciente para enviar de novo.`, openInApp: false };
  }
}
