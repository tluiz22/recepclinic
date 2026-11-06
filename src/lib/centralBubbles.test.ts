import { describe, expect, it } from "vitest";
import { attachmentOf, bubbleOf, deliveryLabel, formatFileSize, type AttachmentMedia } from "./centralBubbles";
import type { CentralMessage } from "./data/central";

const message = (over: Partial<CentralMessage>): CentralMessage => ({
  id: "1",
  direction: "inbound",
  author: "patient",
  messageType: "text",
  templateName: null,
  body: "Oi",
  status: "received",
  failureCode: null,
  failureReason: null,
  sortAt: new Date("2026-11-05T12:00:00Z"),
  sentBy: null,
  handoffId: null,
  source: "live",
  editedAt: null,
  revokedAt: null,
  mediaId: null,
  ...over,
});

describe("bolhas da conversa (CN3a)", () => {
  it("lado e rótulo por autor", () => {
    expect(bubbleOf(message({}))).toMatchObject({ side: "left", tone: "patient", label: null, text: "Oi" });
    expect(bubbleOf(message({ author: "bot", direction: "outbound" }))).toMatchObject({ side: "right", label: "Assistente" });
    expect(bubbleOf(message({ author: "agent_app", direction: "outbound" })).label).toBe("Respondida pelo app do WhatsApp");
    const names = new Map([["u1", "Ana"]]);
    expect(bubbleOf(message({ author: "agent_panel", direction: "outbound", sentBy: "u1" }), names).label).toBe("Ana · pela Central");
    expect(bubbleOf(message({ author: "system", direction: "outbound", messageType: "appointment_reminder" })).label).toBe("Aviso automático · Lembrete");
    expect(bubbleOf(message({ author: "system", direction: "outbound", messageType: "app_auto_reply" })).label).toBe("Mensagem automática do app");
  });

  it("sem texto: apagada, anexo ou anterior à Central; editada", () => {
    expect(bubbleOf(message({ body: null, revokedAt: new Date() })).placeholder).toBe("Mensagem apagada");
    expect(bubbleOf(message({ body: null, messageType: "image" })).placeholder).toBe("Foto");
    expect(bubbleOf(message({ body: null })).placeholder).toBe("Mensagem anterior à Central de atendimento");
    expect(bubbleOf(message({ editedAt: new Date() })).edited).toBe(true);
  });

  it("situação da entrega", () => {
    expect(deliveryLabel("read")).toBe("lida");
    expect(deliveryLabel("delivered")).toBe("entregue");
    expect(deliveryLabel("sending")).toBe("enviando");
    expect(deliveryLabel("sent")).toBeNull();
  });
});

describe("anexos (CN5)", () => {
  const media = (status: string, extra: Partial<AttachmentMedia> = {}): AttachmentMedia => ({ id: "m1", status, mimeType: null, sizeBytes: null, fileName: null, ...extra });

  it("guardado: foto e áudio na conversa; documento para baixar com nome e tamanho", () => {
    expect(attachmentOf("image", media("stored"), true)).toEqual({ kind: "image", href: "/api/admin/conversas/midia/m1" });
    expect(attachmentOf("audio", media("stored"), true)).toEqual({ kind: "audio", href: "/api/admin/conversas/midia/m1" });
    expect(attachmentOf("document", media("stored", { fileName: "exame.pdf", sizeBytes: 1258291 }), true)).toEqual({
      kind: "document",
      href: "/api/admin/conversas/midia/m1?baixar=1",
      name: "exame.pdf",
      size: "1,2 MB",
    });
  });

  it("vídeo e arquivo grande: o aviso, com Abrir no WhatsApp só com coexistência", () => {
    expect(attachmentOf("video", media("unsupported", { sizeBytes: 35 * 1024 * 1024 }), true)).toEqual({
      kind: "notice",
      text: "O paciente enviou um vídeo (35 MB). A Central não mostra vídeos: veja e responda esta mensagem pelo app do WhatsApp.",
      openInApp: true,
    });
    expect(attachmentOf("document", media("too_large", { sizeBytes: 20 * 1024 * 1024 }), false)).toEqual({
      kind: "notice",
      text: "O paciente enviou um documento (20 MB), acima do limite da Central: peça ao paciente para enviar como foto ou PDF.",
      openInApp: false,
    });
  });

  it("pendente, figurinha, falha; sem anexo guardado, nada", () => {
    expect(attachmentOf("image", media("pending"), true)).toEqual({ kind: "pending", text: "Recebendo uma foto…" });
    expect(attachmentOf("sticker", media("unsupported"), true)).toMatchObject({ kind: "notice", openInApp: false });
    expect(attachmentOf("audio", media("failed"), true)).toMatchObject({ text: "Não foi possível receber um áudio. Peça ao paciente para enviar de novo." });
    expect(attachmentOf("image", undefined, true)).toBeNull();
    expect(formatFileSize(350 * 1024)).toBe("350 KB");
  });
});
