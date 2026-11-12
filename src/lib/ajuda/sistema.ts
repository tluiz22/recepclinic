// Ajuda contextual das telas do Suporte (inventário de 23/out/2026, prioridade Baixa).

/**
 * O que some da clínica com cada item da matriz desligado (Sistema › Matriz), pelo id de
 * src/lib/plans.ts. Conferido nas regras de rota de src/lib/features.ts e em quem chama
 * hasFeature: bot/router.ts, reminders.ts, dailySummary.ts, bot/catalog.ts e preparation.ts,
 * waitlist/offers.ts, bot/engine.ts, config/locations.ts, series.ts (extendOpenSeries) e
 * clinicAccess.ts (áreas Métricas e Financeiro).
 */
export const itensDaMatriz: Record<string, string> = {
  whatsapp_bot:
    "Desligado, o bot não responde quem escreve para a clínica. Sai junto a Lista de espera, que depende dele. Só liga com o Portal de agendamento. Métricas › Agendamento digital é um item à parte, liberado pelo Suporte.",
  portal:
    "Desligado, a clínica fica sem os links do portal de agendamento (da clínica e dos profissionais) e sai junto o bot, que depende dele. Sem o bot, a clínica recebe só os lembretes e marca pelo painel.",
  reminders:
    "Desligado, o lembrete automático não sai para o paciente e somem a aba Lembretes do Relatório do dia e o lembrete ao paciente em Configurações › Lembretes.",
  daily_summary: "Desligado, o profissional deixa de receber pelo WhatsApp a lista dos atendimentos das agendas dele.",
  team_summary:
    "Desligado, a equipe deixa de receber pelo WhatsApp a lista do dia, e a tela de contatos dela sai de Configurações.",
  exams:
    "Ligado, a agenda da equipe (\"Exames\") é criada sozinha (ou reativada, com os horários e serviços de antes). Desligado, o tipo Exame some do cadastro de serviços, da Agenda e do bot, a agenda da equipe é desativada e o preparo deixa de ir.",
  knowledge_base:
    "Desligado, o bot não responde as perguntas frequentes digitadas (horário, endereço, convênios…) e segue com o \"não entendi\".",
  central_attendance:
    "Desligado, a clínica não pode ligar a Central de atendimento (conversas no painel) e, se estava ligada, o histórico guardado deixa de aparecer. Depende do bot.",
  waitlist: "Desligado, some a lista Lista de espera de Pacientes › Para contatar e a opção no bot, e nenhuma vaga é oferecida.",
  metrics: "Desligado, some o menu Métricas, com as abas (menos o Agendamento digital) e as métricas pessoais do profissional.",
  metrics_funnel: "Desligado, some a aba Métricas › Agendamento digital. O Suporte libera clínica a clínica, depois de avaliar a jornada no WhatsApp; vale com ou sem o bot ligado.",
  custom_messages:
    "Desligado, a clínica não muda os textos do bot nem pede mensagens novas à Meta em Configurações › Mensagens: valem os textos padrão.",
  home_visit: "Desligado, o tipo Domiciliar some de Locais e da marcação. O que já estava ligado a ele fica guardado e volta se o item for liberado.",
  insurance: "Desligado, somem Configurações › Convênios e o convênio no cadastro do paciente.",
  series: "Desligado, some o \"Repetir\" do Marcar, e a rotina diária para de marcar as próximas sessões das séries sem fim.",
  finance: "Desligado, somem o menu Financeiro, a Nota fiscal em Configurações e os pagamentos na ficha do paciente e na Agenda.",
  relationship:
    "Desligado, some a aba Para contatar de Pacientes (pendências que pedem contato da equipe). As mesmas informações continuam nas Métricas e no Meu dia.",
};
