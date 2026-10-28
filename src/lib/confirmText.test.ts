import { describe, expect, it } from "vitest";
import { paymentChangeNote, sendsPatientMessages, seriesEndText, seriesStartText, seriesWhenText, slotConfirmText, whatsappNoticeText } from "./confirmText";

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

  it("quando da série inteira", () => {
    expect(
      seriesWhenText({
        intervalWeeks: 2,
        start: "às terças, 09:00, com Rafael Lima (Consultório Centro), a partir de 20/10",
        end: "com 10 sessões",
      }),
    ).toBe("A cada 2 semanas (quinzenal) às terças, 09:00, com Rafael Lima (Consultório Centro), a partir de 20/10, com 10 sessões");
  });

  it("aviso do WhatsApp na confirmação", () => {
    expect(whatsappNoticeText("o paciente", "marcacao", "consultation")).toBe(
      "O paciente receberá uma mensagem no WhatsApp informando a marcação da consulta.",
    );
    expect(whatsappNoticeText("o responsável", "alteracao", "exam")).toBe(
      "O responsável receberá uma mensagem no WhatsApp informando a alteração do exame.",
    );
    expect(whatsappNoticeText("o paciente", "marcacao", "return_visit")).toContain("da consulta");
  });

  it("aviso só quando a clínica manda mensagens", () => {
    expect(sendsPatientMessages("active", "connected")).toBe(true);
    expect(sendsPatientMessages("onboarding", "connected")).toBe(false);
    expect(sendsPatientMessages("active", "disconnected")).toBe(false);
    expect(sendsPatientMessages("active", null)).toBe(false);
  });

  it("pagamento registrado quando o valor muda", () => {
    // A moeda vem com espaço fixo entre "R$" e o número.
    const note = (paid: number, before: number | null, after: number | null) => paymentChangeNote(paid, before, after).replace(/\u00a0/g, " ");
    expect(paymentChangeNote(0, 30000, 20000)).toBe("");
    expect(paymentChangeNote(30000, 30000, 30000)).toBe("");
    expect(note(30000, 30000, 20000)).toBe(
      "Já há R$ 300,00 em pagamentos registrados, que não mudam. Com o novo valor (R$ 200,00), fica R$ 100,00 pago a mais: confira no Financeiro.",
    );
    expect(note(10000, 30000, 45000)).toBe(
      "Já há R$ 100,00 em pagamentos registrados, que não mudam. Com o novo valor (R$ 450,00), faltam R$ 350,00.",
    );
    expect(paymentChangeNote(20000, 30000, 20000)).toContain("o atendimento fica pago");
  });
});
