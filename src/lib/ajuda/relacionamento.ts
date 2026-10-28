import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual do Relacionamento (CRM A1, 27/out/2026).

export const relacionamento = {
  comoFunciona: {
    // src/lib/data/relationship.ts (cabeçalho e relationshipTabs); Q1 a Q4 do plano da central.
    central: {
      serve: "Reúne numa tela só as pessoas que pedem contato da equipe, cada uma com o motivo.",
      como: [
        "São as mesmas listas do Resumo do Dia, das Métricas e do Início, com as mesmas regras: nada muda lá.",
        "Cada aba mostra quantas pessoas pedem atenção. A pessoa sai sozinha quando o motivo deixa de existir.",
        "As ações são as mesmas de sempre (Remarcar, Marcar retorno, Desistiu, Tirar da lista, Revisado) e voltam para esta tela.",
      ],
      erro: "Uma aba mostra \"!\"? A lista dela não carregou agora; as outras continuam. Tente abrir a aba de novo.",
    },
    // listPendingReminders e pendingReminderKind em src/lib/data/relationship.ts; reminderAction em whatsapp/reminders.ts (UNANSWERED_BUTTON_MS).
    lembretes: {
      serve: "Atendimentos por vir cujo lembrete não chegou ao paciente ou ficou sem resposta.",
      como: [
        "Não entregue: o WhatsApp recusou o envio ou a mensagem do lembrete ainda não foi aprovada pela Meta.",
        "Sem resposta: o lembrete chegou há mais de 2 horas e ninguém tocou nos botões nem confirmou a presença.",
        "Sai sozinho ao confirmar a presença, remarcar ou cancelar o atendimento.",
      ],
      exemplo: "O lembrete de Ana saiu ontem às 18h e ela não respondeu: Ana aparece em \"Sem resposta\" até a equipe confirmar a presença na Agenda.",
    },
    // listRecall e groupRecall em src/lib/data/relationship.ts; buildFunnelReportFromSessions (incomplete) em botFunnel.ts.
    retomar: {
      serve: "Quem começou pelo WhatsApp (bot ou link) e não concluiu nos últimos 14 dias.",
      como: [
        "Entra a tentativa abandonada ou com erro. Sai sozinha quando a mesma pessoa conclui o mesmo fluxo depois.",
        "Várias tentativas do mesmo número no mesmo fluxo viram uma linha só, com a mais recente e quantas foram.",
        "É a mesma regra da aba Retomar contato das Métricas, só que sempre nos últimos 14 dias.",
      ],
      exemplo: "Maria tentou marcar consulta 3 vezes e parou na escolha do horário: aparece uma linha, \"3 tentativas\", até ela concluir.",
    },
    // listReturnOpportunities em src/lib/data/performance.ts (metrics_return_rights).
    retorno: {
      serve: "Consultas realizadas com o prazo de retorno ainda aberto e sem retorno marcado.",
      como: [
        "Vale a última consulta realizada do paciente na agenda, fora do domiciliar, com o prazo do serviço de Retorno.",
        "Sai sozinha quando o retorno é marcado, quando há consulta ou retorno futuro na agenda ou quando o prazo acaba.",
        "É a mesma lista da Oportunidade agora das Métricas.",
      ],
    },
    // listDueReminders em src/lib/data/patientReminders.ts (CRM P3).
    lembretesEquipe: {
      serve: "Os lembretes que a equipe escreveu na ficha dos pacientes, no dia marcado.",
      como: [
        "Entra no dia do lembrete e fica, como atrasado, até alguém marcar \"Feito\".",
        "O lembrete é criado na ficha do paciente, na aba Lembretes; lá ficam também os feitos, com quem fez.",
        "O mais antigo vem primeiro.",
      ],
      exemplo: "A recepção escreveu \"cobrar a guia do plano\" para 05/11 na ficha de Ana: no dia 05/11, Ana aparece aqui até alguém marcar \"Feito\".",
    },
    // listFrequentNoShows em src/lib/data/metrics.ts e isFrequentNoShow em agenda/view.ts.
    faltosos: {
      serve: "Pacientes que faltam com frequência, para a equipe conversar antes do próximo atendimento.",
      como: [
        "Entra quem tem 2 ou mais faltas e faltou em pelo menos metade dos atendimentos registrados, em todo o histórico.",
        "Mais faltas primeiro. É a mesma lista dos Faltosos das Métricas.",
      ],
    },
  },
  vazios: {
    // listHumanAttention em src/lib/data/whatsapp/attention.ts.
    atendimento: {
      titulo: "Nenhuma conversa com a clínica",
      texto: "Entra aqui a conversa em que o bot parou e passou para a equipe: o paciente pediu, o bot não entendeu ou a recepção assumiu pelo app.",
    },
    retomar: {
      titulo: "Ninguém para retomar",
      texto: "Nos últimos 14 dias, ninguém deixou de concluir uma marcação, remarcação ou cancelamento pelo WhatsApp.",
    },
    retorno: {
      titulo: "Nenhum retorno a marcar",
      texto: "Entra aqui a consulta realizada com o prazo de retorno aberto e sem retorno marcado.",
    },
    faltosos: {
      titulo: "Ninguém faltando com frequência",
      texto: "Entra aqui quem tem 2 ou mais faltas e faltou em pelo menos metade dos atendimentos registrados.",
    },
    // listContactsToReview em src/lib/data/whatsapp/botLimits.ts (REVIEW_WINDOW_DAYS).
    revisar: {
      titulo: "Nenhum contato para revisar",
      texto: "Entra aqui o número que bateu um limite do bot nos últimos 7 dias e ainda não foi marcado como revisado.",
    },
    // listAwaitingRebooking em src/lib/data/daily.ts.
    aguardando: {
      titulo: "Ninguém aguardando remarcação",
      texto: "Entra aqui quem teve o atendimento cancelado pela clínica (em massa ou pelo bloqueio) e ainda não remarcou.",
    },
    lembretesEquipe: {
      titulo: "Nenhum lembrete para hoje",
      texto: "Entra aqui, no dia marcado, o lembrete escrito na ficha do paciente, até alguém marcar \"Feito\".",
    },
    lembretes: {
      titulo: "Nenhum lembrete pedindo atenção",
      texto: "Entra aqui o atendimento por vir com lembrete não entregue ou sem resposta há mais de 2 horas.",
    },
  },
} satisfies ModuloDeAjuda;
