import { describe, expect, it } from "vitest";
import * as t from "./texts";

// Revisão do "fale com a clínica" (cliente, 11/out/2026).
const consultorio = { noun: "consultório", article: "o" as const };

describe("textos do bot: não achou neste número", () => {
  it("data de nascimento sem atendimento: pergunta da recepção só com coexistência (cliente, 24/out/2026)", () => {
    expect(t.identityNotFound(true)).toBe("Não encontramos agendamentos para essa data de nascimento. Deseja falar com a recepção?");
    expect(t.identityNotFound(false)).toBe("Não encontramos agendamentos para essa data de nascimento.");
    expect(t.identityNotFoundButtons(true).map((b) => b.title)).toEqual(["Falar com a recepção", "Tentar outra data", "Voltar ao menu"]);
    expect(t.identityNotFoundButtons(false).map((b) => b.title)).toEqual(["Tentar outra data", "Voltar ao menu"]);
  });

  it("com recepção no número, aponta o \"Falar com a recepção\"; sem, escrever pelo outro número", () => {
    expect(t.noRegistration(true)).toBe(
      "Não encontramos agendamento marcado para esse número de telefone. Se o agendamento foi feito por outro número, escolha a opção *Falar com a recepção* no menu inicial.",
    );
    expect(t.noRegistration(false)).toBe(
      "Não encontramos agendamento marcado para esse número de telefone. Se o agendamento foi feito por outro número, escreva por aquele número.",
    );
    expect(t.noAppointments("cancelar", "exam", true)).toBe(
      "Não encontramos nenhum exame futuro para cancelar neste número. Se o agendamento foi feito por outro número, escolha a opção *Falar com a recepção* no menu inicial.",
    );
  });

  it("prazo do retorno vencido, link com erro e já tem marcado: com a forma de chamar a clínica e o caminho do Remarcar", () => {
    expect(t.returnDeadlinePassed("João", "05/10/2026", true, consultorio)).toBe(
      "O prazo para o retorno de *João* terminou em 05/10/2026, então não é possível remarcar por aqui. Para falar com o consultório, escolha a opção *Falar com a recepção* no menu inicial.",
    );
    expect(t.returnDeadlinePassed("João", "05/10/2026", false, consultorio)).toBe(
      "O prazo para o retorno de *João* terminou em 05/10/2026, então não é possível remarcar por aqui. Por favor, fale com o consultório.",
    );
    expect(t.linkError(consultorio)).toBe("Tivemos um problema para gerar o link de agendamento. Por favor, tente de novo em alguns minutos ou fale com o consultório.");
    expect(t.alreadyScheduled("João", "Consulta", "seg, 12/10 às 08:00", "consultation")).toBe(
      "*João* já tem Consulta marcado(a) para seg, 12/10 às 08:00. Para mudar o dia ou horário, escolha *Consultas › Remarcar*.",
    );
    expect(t.willReply(consultorio)).toBe("O consultório responderá sua mensagem em breve.");
  });
});
