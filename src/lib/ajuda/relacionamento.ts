import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual do Relacionamento (CRM A1, 27/out/2026).

export const relacionamento = {
  comoFunciona: {
    // src/lib/data/relationship.ts (cabeçalho e relationshipTabs); Q1 a Q4 do plano da central.
    central: {
      serve: "Reúne numa tela só as pessoas que pedem contato da equipe, cada uma com o motivo.",
      como: [
        "São as mesmas listas do Resumo do Dia, com as mesmas regras: nada muda lá.",
        "Cada aba mostra quantas pessoas pedem atenção. A pessoa sai sozinha quando o motivo deixa de existir.",
        "As ações são as mesmas de sempre (Remarcar, Desistiu, Tirar da lista) e voltam para esta tela.",
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
  },
  vazios: {
    // listAwaitingRebooking em src/lib/data/daily.ts.
    aguardando: {
      titulo: "Ninguém aguardando remarcação",
      texto: "Entra aqui quem teve o atendimento cancelado pela clínica (em massa ou pelo bloqueio) e ainda não remarcou.",
    },
    lembretes: {
      titulo: "Nenhum lembrete pedindo atenção",
      texto: "Entra aqui o atendimento por vir com lembrete não entregue ou sem resposta há mais de 2 horas.",
    },
  },
} satisfies ModuloDeAjuda;
