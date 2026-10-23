import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual de Configurações (inventário de 23/out/2026).

export const configuracoes = {
  dicas: {
    // D4 em docs/arquitetura.md; prazo do retorno e preparo em configuracoes/servicos/[id].astro.
    servicoTipo: [
      { termo: "Consulta", texto: "atendimento comum." },
      { termo: "Retorno", texto: "volta ligada a uma consulta anterior, com prazo e valor próprios." },
      { termo: "Exame", texto: "pode ter preparo e ser em turma, com vagas por horário." },
    ],
    // booking_horizon_days: só o bot (bot/engine.ts) e o link de agendar (agenda/publicBooking.ts) usam.
    clinicaPrazo:
      "Até quantos dias à frente o bot e o link de agendamento mostram horários livres. A recepção, pelo painel, não tem esse limite. Ex.: com 30 dias, o paciente vê horários até daqui a um mês.",
    // AREA_ROLES em src/lib/clinicAccess.ts (D6, D11, F11).
    equipePapeis:
      "Uma pessoa pode ter mais de um papel (ex.: Administrador e Profissional). Configurações é só do Administrador; Métricas, do Administrador e do Profissional (só a própria agenda); Financeiro, do Administrador e da Recepção.",
    // app.can_access_agenda e app.default_agenda_scope (supabase/migrations/20261004130000_configuracao.sql).
    equipeAgendas:
      "Restrito: a pessoa vê só a agenda do profissional ligado a ela e as marcadas aqui (ex.: só a psicóloga e a fisioterapeuta); as outras agendas e os atendimentos delas não aparecem. Sem nenhuma, não vê agenda. O Administrador sempre vê todas.",
    // Sem o item "Exames e procedimentos" (D11), o tipo Exame não aparece.
    servicoTipoSemExame: [
      { termo: "Consulta", texto: "atendimento comum." },
      { termo: "Retorno", texto: "volta ligada a uma consulta anterior, com prazo e valor próprios." },
    ],
  },
  comoFunciona: {
    // src/pages/admin/configuracoes/mensagens.astro (as duas listas, a revisão do Suporte e as 24 horas).
    mensagens: {
      serve: "Ajustar o que o WhatsApp da clínica diz ao paciente.",
      como: [
        "\"Mensagens do bot\": as respostas da conversa, quando o paciente escreve para a clínica. Valem assim que você salva.",
        "\"Mensagens aprovadas pela Meta\": os avisos que a clínica manda primeiro (lembrete, cancelamento e outros). Um texto novo passa pela revisão do Suporte e pela aprovação da Meta; até lá, segue o texto atual.",
        "Mensagem livre só vai para quem escreveu para a clínica nas últimas 24 horas; para os outros, vai a mensagem aprovada pela Meta.",
      ],
    },
    // src/lib/data/whatsapp/reminders.ts (cabeçalho); botões do template em templates.ts; reenvio de 23/out (retryRules.ts).
    lembretes: {
      serve: "Lembrar o paciente, o profissional e a equipe dos atendimentos, pelo WhatsApp da clínica.",
      como: [
        "Um lembrete por público: na véspera (atendimentos do dia seguinte) ou no dia (os que começam depois do horário), na hora escolhida, das 6h às 20h, no fuso da clínica.",
        "O paciente responde pelos botões \"Confirmar presença\", \"Remarcar\" ou \"Cancelar\".",
        "Atendimento marcado depois do envio fica sem lembrete automático: na Agenda, o botão \"Enviar lembrete\" resolve. Remarcar zera o lembrete.",
        "Falha técnica no envio é tentada de novo sozinha, em 10 e 30 minutos.",
        "Sem o WhatsApp conectado ou sem a mensagem aprovada pela Meta, o lembrete não sai e a trilha do atendimento registra o motivo.",
      ],
    },
    // src/lib/data/agenda/slots.ts e freeSlots.ts; sem ligação dos atendimentos com o horário (removeAvailabilityWindow).
    horarios: {
      serve: "Dizer quando cada agenda atende. É daqui que saem os horários livres para marcar, no painel, no bot e no link de agendamento.",
      como: [
        "Cada horário é de uma agenda, com os dias da semana, o início e o fim, o local e o serviço (um só ou todos os da agenda).",
        "O período é dividido do início em diante, no tamanho da duração do serviço. Atendimentos e bloqueios ocupam o tempo, com o intervalo da agenda antes e depois.",
        "Em turma: uma sessão por horário cadastrado, com o número de vagas.",
        "Feriados (nacionais e os da clínica) e bloqueios tiram os horários do dia.",
        "Mudar ou apagar um horário não mexe nos atendimentos já marcados.",
      ],
      exemplo: "Das 8h às 12h, Consulta de 30 minutos e agenda sem intervalo: 8h, 8h30, 9h… até 11h30. Com uma Consulta já marcada às 9h, o horário das 9h sai da lista.",
    },
    // src/lib/data/whatsapp/botLimits.ts (cabeçalho); "Contatos para revisar" no Início; tela do contato.
    limitesBot: {
      serve: "Proteger o agendamento pelo WhatsApp de abuso, como alguém marcando muitos horários de uma vez.",
      como: [
        "Os limites contam por número de WhatsApp, somando todos os pacientes dele.",
        "Atendimentos futuros contam os marcados pelo bot ou pela equipe e os links de marcar ainda válidos.",
        "Atingido um limite, o bot não marca e passa a conversa para a recepção. Cancelar, remarcar e confirmar seguem pelo bot; a equipe marca sem limite pelo painel.",
        "O contato aparece no Início, em \"Contatos para revisar\", por 7 dias. \"Revisado\" tira o aviso; na tela do contato, \"Liberar dos limites do bot\" (só o Administrador) desliga os três para aquele número.",
      ],
    },
  },
} satisfies ModuloDeAjuda;
