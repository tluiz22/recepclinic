import type { CentralMessage } from "./data/central";
import { MESSAGE_LABELS } from "./data/agenda/trail";

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
      bubble = { ...base, side: "right", tone: "panel", label: who ? `${who} · pela Central` : "Pela Central" };
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
