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
    "Desligado, o bot não responde quem escreve para a clínica. Saem junto a Lista de espera e as Métricas › Agendamento digital, que dependem dele.",
  reminders:
    "Desligado, o lembrete automático não sai para o paciente e somem a aba Lembretes do Resumo do Dia e o lembrete ao paciente em Configurações › Lembretes.",
  daily_summary: "Desligado, o profissional deixa de receber pelo WhatsApp a lista dos atendimentos das agendas dele.",
  team_summary:
    "Desligado, a equipe deixa de receber pelo WhatsApp a lista do dia, e a tela de contatos dela sai de Configurações.",
  exams:
    "Desligado, o tipo Exame some do cadastro de serviços, da Agenda e do bot, com a agenda da equipe e o envio do preparo.",
  waitlist: "Desligado, somem a aba Lista de espera do Resumo do Dia e a opção no bot, e nenhuma vaga é oferecida.",
  metrics: "Desligado, some o menu Métricas, com todas as abas e as métricas pessoais do profissional.",
  custom_messages:
    "Desligado, a clínica não muda os textos do bot nem pede mensagens novas à Meta em Configurações › Mensagens: valem os textos padrão.",
  home_visit: "Desligado, o tipo Domiciliar some de Locais e da marcação. O que já estava ligado a ele fica guardado e volta se o item for liberado.",
  insurance: "Desligado, somem Configurações › Convênios e o convênio no cadastro do paciente.",
  series: "Desligado, some o \"Repetir\" do Marcar, e a rotina diária para de marcar as próximas sessões das séries sem fim.",
  finance: "Desligado, somem o menu Financeiro, a Nota fiscal em Configurações e os pagamentos na ficha do paciente e na Agenda.",
  relationship:
    "Desligado, some o menu Relacionamento (pendências que pedem contato da equipe). As mesmas listas continuam no Resumo do Dia, nas Métricas e no Início.",
};
