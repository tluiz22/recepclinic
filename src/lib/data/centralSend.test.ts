import { describe, expect, it } from "vitest";
import { resumeParams, resumeText, sendMessageText } from "./centralSend";
import { defaultTemplate, templateCreationPayload } from "./whatsapp/templates";

// "Retomar conversa" (CN4b; texto aprovado pelo cliente em 05/nov/2026, opção A).
describe("Retomar conversa", () => {
  it("a clínica e o dia da última mensagem do paciente, no fuso da clínica", () => {
    const params = resumeParams({ clinicLabel: "da Clínica Sorriso" }, { lastPatientAt: new Date("2026-11-04T02:30:00Z"), timeZone: "America/Fortaleza" });
    expect(params).toEqual(["da Clínica Sorriso", "03/11"]);
    expect(resumeText(null, params)).toBe("Olá! Aqui é da Clínica Sorriso.\nVi que a nossa conversa de 03/11 ficou pendente.\nQuer continuar de onde paramos?");
  });

  it("vai à Meta com um exemplo por variável", () => {
    const body = (templateCreationPayload(defaultTemplate("conversation_resume")!).components as Record<string, unknown>[])[0];
    expect(body).toMatchObject({ type: "BODY", example: { body_text: [["da Clínica Sorriso", "04/11"]] } });
  });

  it("avisos da tela", () => {
    expect(sendMessageText({ kind: "pending" }).tone).toBe("success");
    expect(sendMessageText({ kind: "no_template" }).tone).toBe("error");
  });
});
