import { describe, expect, it } from "vitest";
import { resumeParams, resumeText, sendMessageText } from "./centralSend";

// "Retomar conversa" (CN4b; texto aprovado pelo cliente em 05/nov/2026, opção C).
describe("Retomar conversa", () => {
  const sender = { clinicLabel: "da Clínica Sorriso" };

  it("primeiro nome, a clínica e o dia da última mensagem do paciente, no fuso da clínica", () => {
    expect(resumeParams(sender, { name: "Maria Souza", lastPatientAt: new Date("2026-11-04T02:30:00Z"), timeZone: "America/Fortaleza" })).toEqual([
      "Maria",
      "da Clínica Sorriso",
      "03/11",
    ]);
  });

  it("sem nome, \"paciente\"", () => {
    expect(resumeParams(sender, { name: null, lastPatientAt: null, timeZone: "America/Fortaleza" })[0]).toBe("paciente");
  });

  it("o texto aprovado, preenchido", () => {
    expect(resumeText(null, ["Maria", "da Clínica Sorriso", "04/11"])).toBe(
      "Olá, Maria! Aqui é da Clínica Sorriso.\nSobre a sua mensagem de 04/11: temos um retorno para você.\n\nPode responder esta mensagem para continuarmos o atendimento?",
    );
  });

  it("avisos da tela", () => {
    expect(sendMessageText({ kind: "pending" }).tone).toBe("success");
    expect(sendMessageText({ kind: "no_template" }).tone).toBe("error");
  });
});
