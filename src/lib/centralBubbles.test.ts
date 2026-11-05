import { describe, expect, it } from "vitest";
import { bubbleOf, deliveryLabel } from "./centralBubbles";
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
    expect(deliveryLabel("sent")).toBeNull();
  });
});
