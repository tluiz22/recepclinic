import { describe, expect, it } from "vitest";
import * as t from "./texts";

// Revisão do "fale com a clínica" (cliente, 11/out/2026).
const consultorio = { noun: "consultório", article: "o" as const };

describe("textos do bot: não achou neste número", () => {
  it("data de nascimento sem atendimento: pergunta da recepção só com coexistência (cliente, 24/out/2026)", () => {
    // Sem "Falar com a recepção" (cliente, 31/out/2026).
    expect(t.IDENTITY_NOT_FOUND).toBe("Não encontramos agendamentos para essa data de nascimento.");
    expect(t.IDENTITY_NOT_FOUND_BUTTONS.map((b) => b.title)).toEqual(["Tentar outra data", "Voltar ao menu"]);
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

describe("pedido não concluído (PN2, 03/nov/2026)", () => {
  it("mensagem e botões (até 20 caracteres, limite da Meta)", () => {
    expect(t.notCompleted("booking", "Ana")).toBe("Não concluímos a marcação de *Ana*. Como prefere seguir?");
    expect(t.notCompleted("reschedule", "Ana")).toBe("Não concluímos a remarcação de *Ana*. Como prefere seguir?");
    expect(t.notCompleted("cancel", "Ana")).toBe("Não concluímos o cancelamento de *Ana*. Como prefere seguir?");
    expect(t.notCompletedButtons("booking", true).map((b) => b.title)).toEqual(["Novo link", "Falar com a recepção", "Desistir"]);
    expect(t.notCompletedButtons("cancel", false).map((b) => b.title)).toEqual(["Cancelar agora", "Desistir"]);
    for (const b of t.notCompletedButtons("cancel", true)) expect(b.title.length).toBeLessThanOrEqual(20);
  });

  it("desistir e assunto da transferência", () => {
    expect(t.notCompletedKept("o exame Raio X", "o", "Ana", "segunda, 10/03 às 08:00")).toBe("Tudo bem, o exame Raio X de Ana continua marcado para segunda, 10/03 às 08:00.");
    expect(t.notCompletedSubject("booking", "Ana")).toBe("Não concluiu a marcação de Ana pelo WhatsApp.");
  });
});

describe("apresentação do menu principal (cliente, 04/nov/2026)", () => {
  const all = { consultations: true, exams: true, waitlist: true, info: true, reception: true, ask: true };

  it("tudo ligado: o que dá para resolver, a recepção e o convite a perguntar", () => {
    expect(t.menuIntro(all)).toBe(
      "Estamos aqui para ajudar você! 😊\n\nPor aqui, você pode:\n\n📅 Agendar ou remarcar consultas e exames.\n\n🔄 Solicitar cancelamentos ou entrar na fila de espera.\n\nℹ️ Consultar informações sobre atendimentos.\n\n👩‍💼 Falar diretamente com a recepção, se precisar de ajuda.\n\nComo podemos ajudar?\nEscolha uma das opções abaixo ou escreva sua pergunta.",
    );
  });

  it("só cita o que a clínica oferece; sem a base, não convida a perguntar", () => {
    const text = t.menuIntro({ ...all, exams: false, waitlist: false, reception: false, ask: false });
    expect(text).toContain("📅 Agendar ou remarcar consultas.");
    expect(text).toContain("🔄 Solicitar cancelamentos.");
    expect(text).not.toMatch(/fila de espera|recepção|escreva sua pergunta/);
    expect(text.endsWith("Como podemos ajudar?\nEscolha uma das opções abaixo.")).toBe(true);
    expect(t.menuIntro({ ...all, consultations: false })).toContain("📅 Agendar ou remarcar exames.");
    const onlyInfo = t.menuIntro({ ...all, consultations: false, exams: false });
    expect(onlyInfo).not.toMatch(/📅|🔄/);
    expect(onlyInfo).toContain("ℹ️ Consultar informações sobre atendimentos.");
  });

  it("limites da Meta: corpo até 1024, descrição até 72, botão até 20", () => {
    expect(t.menuIntro(all).length).toBeLessThanOrEqual(1024);
    for (const d of Object.values(t.MAIN_MENU_DESCRIPTIONS)) expect(d.length).toBeLessThanOrEqual(72);
    expect(t.LIST_BUTTON).toBe("Ver opções");
    expect(t.LIST_BUTTON.length).toBeLessThanOrEqual(20);
  });

  it("descrições das quatro opções, pelos ids de sempre", () => {
    expect(t.MAIN_MENU_DESCRIPTIONS).toEqual({
      menu_consultations: "Agendamentos, retornos, remarcações e cancelamentos.",
      menu_exams: "Agendamentos, retornos, remarcações e cancelamentos.",
      menu_info: "Dúvidas sobre consultas e exames.",
      menu_reception: "Precisa de ajuda? Fale com nossa equipe.",
    });
    const rows = t.numberedList(
      Object.entries(t.MAIN_MENU_DESCRIPTIONS).map(([id, description], i) => ({ id, label: ["Consultas", "Exames", "Informações gerais", "Falar com a recepção"][i], description })),
      false,
    )[0].rows;
    expect(rows.map((r) => r.title)).toEqual(["1. Consultas", "2. Exames", "3. Informações gerais", "4. Falar com a recepção"]);
    expect(rows.map((r) => r.description)).toEqual(Object.values(t.MAIN_MENU_DESCRIPTIONS));
  });
});
