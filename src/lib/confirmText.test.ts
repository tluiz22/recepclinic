import { describe, expect, it } from "vitest";
import { seriesConfirmMessage, seriesEndText, seriesStartText, slotConfirmText } from "./confirmText";

describe("textos das confirmações", () => {
  it("horário escolhido, com a agenda e o local", () => {
    expect(slotConfirmText("Terça-feira, 20/10 às 09:00", "Rafael Lima", "Consultório Centro")).toBe(
      "terça-feira, 20/10 às 09:00, com Rafael Lima (Consultório Centro)",
    );
  });

  it("começo da série, com o dia da semana no plural", () => {
    expect(seriesStartText("2026-10-20", "09:00", "Rafael Lima", "Consultório Centro")).toBe(
      "às terças, 09:00, com Rafael Lima (Consultório Centro), a partir de 20/10",
    );
    expect(seriesStartText("2026-10-25", "08:00", "A", "B")).toContain("às domingos");
    expect(seriesStartText("2026-10-24", "08:00", "A", "B")).toContain("às sábados");
  });

  it("fim da série", () => {
    expect(seriesEndText({ fim: "data", endsOn: "2026-12-15" }, "2026-10-20", 3)).toBe("até 15/12");
    expect(seriesEndText({ fim: "data", endsOn: "2027-02-02" }, "2026-10-20", 3)).toBe("até 02/02/2027");
    expect(seriesEndText({ fim: "data", endsOn: "" }, "2026-10-20", 3)).toBe("até o dia escolhido");
    expect(seriesEndText({ fim: "sessoes", maxSessions: "10" }, "2026-10-20", 3)).toBe("com 10 sessões");
    expect(seriesEndText({ fim: "sessoes", maxSessions: "1" }, "2026-10-20", 3)).toBe("com 1 sessão");
    expect(seriesEndText({ fim: "sessoes", maxSessions: "" }, "2026-10-20", 3)).toBe("com o número de sessões escolhido");
    expect(seriesEndText({ fim: "sem_fim" }, "2026-10-20", 3)).toBe(
      "sem data para terminar (ficam marcadas as sessões dos próximos 3 meses)",
    );
  });

  it("confirmação da série inteira", () => {
    expect(
      seriesConfirmMessage({
        intro: "Ana Souza: Consulta pediátrica",
        intervalWeeks: 2,
        start: "às terças, 09:00, com Rafael Lima (Consultório Centro), a partir de 20/10",
        end: "com 10 sessões",
      }),
    ).toBe(
      "Ana Souza: Consulta pediátrica, a cada 2 semanas (quinzenal) às terças, 09:00, com Rafael Lima (Consultório Centro), a partir de 20/10, com 10 sessões. " +
        "Feriado, bloqueio ou horário ocupado: a data é pulada e aparece na tela da série. O paciente é avisado pelo WhatsApp.",
    );
  });
});
