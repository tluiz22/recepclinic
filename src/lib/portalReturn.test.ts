import { describe, expect, it } from "vitest";
import { consultationOn, dayMonth, mainRefusal, refusalText, returnButton, returnUntil } from "./portalReturn";

describe("textos do retorno no portal", () => {
  it("datas como no canvas", () => {
    expect(dayMonth("2026-11-01")).toBe("1/11");
    expect(consultationOn("2026-10-19")).toBe("Consulta em segunda, 19/10");
    expect(consultationOn("2026-10-24")).toBe("Consulta em sábado, 24/10");
    expect(returnUntil("2026-11-20")).toBe("Retorno até sex, 20/11");
    expect(returnUntil(null)).toBe("Retorno sem prazo");
  });

  it("motivos sem direito", () => {
    const tz = "America/Fortaleza";
    expect(refusalText({ kind: "expired", originDate: "2026-10-02", lastDate: "2026-11-01", professionalName: "Dr. André" }, tz)).toBe(
      "O prazo acabou em 1/11 (consulta de 2/10). Para voltar, agende uma consulta nova.",
    );
    expect(refusalText({ kind: "used", originDate: "2026-10-05", professionalName: "Dra. Carla" }, tz)).toBe(
      "O retorno da consulta de 5/10 já foi marcado. Cada consulta dá direito a um retorno.",
    );
    expect(refusalText({ kind: "future", originDate: "2026-10-05", scheduledAt: new Date("2026-11-12T12:00:00Z"), professionalName: "Dra. Carla" }, tz)).toBe(
      "Já tem atendimento marcado com Dra. Carla em 12/11 às 09:00.",
    );
  });

  it("motivo principal na ordem do bot", () => {
    expect(mainRefusal([{ kind: "expired" }, { kind: "used" }, { kind: "home_visit" }])?.kind).toBe("home_visit");
    expect(mainRefusal([{ kind: "expired" }, { kind: "future" }])?.kind).toBe("future");
    expect(mainRefusal([])).toBeNull();
  });

  it("botão com o primeiro nome", () => {
    expect(returnButton("JOÃO souza lima")).toBe("Marcar retorno de João");
  });
});
