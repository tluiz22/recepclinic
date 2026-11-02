import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual do Meu dia (02/nov/2026, redesign da Recepção). Fonte: src/pages/admin/dashboard.astro e
// lib/data/relationship.ts (listPendingReminders).

export const meuDia = {
  comoFunciona: {
    esperando: {
      serve: "Ver quem recebeu o lembrete de hoje ou de amanhã e ainda não respondeu.",
      como: [
        "Só entram atendimentos por vir, com o lembrete enviado e sem toque nos botões.",
        "A linha mostra o WhatsApp do paciente, para insistir pela conversa.",
        "Confirmar presença e Remarcar ficam na própria linha e pedem confirmação.",
        "Quando o paciente responde, a linha sai sozinha.",
      ],
      erro: "Lembrete não saiu? Veja Relatório do dia › Lembretes (Não entregue) e Configurações › WhatsApp.",
    },
  },
} satisfies ModuloDeAjuda;
