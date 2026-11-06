import { describe, expect, it } from "vitest";
import { resumeText, sendMessageText } from "./centralSend";
import { defaultTemplate, templateCreationPayload } from "./whatsapp/templates";

// "Retomar conversa" (CN4b; texto do cliente em 05/nov/2026, sem variáveis).
describe("Retomar conversa", () => {
  it("o texto do cliente, sem variáveis; o aprovado na conta vale quando existe", () => {
    expect(resumeText(null)).toBe("Olá! Vi que a nossa conversa ficou pendente. Quer continuar de onde paramos?");
    expect(resumeText({ body: "Outro texto" })).toBe("Outro texto");
  });

  it("vai à Meta sem exemplo de variável", () => {
    const body = (templateCreationPayload(defaultTemplate("conversation_resume")!).components as Record<string, unknown>[])[0];
    expect(body).toEqual({ type: "BODY", text: "Olá! Vi que a nossa conversa ficou pendente. Quer continuar de onde paramos?" });
  });

  it("avisos da tela", () => {
    expect(sendMessageText({ kind: "pending" }).tone).toBe("success");
    expect(sendMessageText({ kind: "no_template" }).tone).toBe("error");
  });
});
