import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual de Pacientes (inventário de 23/out/2026).

export const pacientes = {
  dicas: {
    // Os envios usam o telefone do contato (patients → contacts.phone): notices.ts, reminders.ts, preparation.ts.
    contato:
      "O paciente e quem conversa com a clínica podem ser pessoas diferentes (ex.: a mãe de uma criança). Avisos, lembretes e o bot usam o WhatsApp de quem fala com a clínica, que pode ter vários pacientes.",
  },
  comoFunciona: {
    // src/pages/admin/pacientes/contato/[id].astro (canReview, canExempt, canBlock e os textos das confirmações) e F9.6.
    contatoBot: {
      serve: "Decidir o que fazer com um número que atingiu um limite do bot, ou que a clínica não quer mais atender pelo bot.",
      como: [
        "\"Revisado\" (Recepção e Administrador): tira o número de \"Contatos para revisar\" no Início. Se atingir um limite de novo, ele volta para a lista.",
        "\"Liberar dos limites do bot\" (só o Administrador): o bot deixa de aplicar os limites de atendimentos, cadastros e faltas a este número, até alguém desfazer.",
        "\"Bloquear no bot\" (só o Administrador): o bot para de atender o número e responde, uma vez por dia, que a conversa está com a recepção. Só os botões do lembrete seguem valendo. A equipe continua marcando pelo painel.",
        "Ao bloquear, dá para cancelar sem aviso os atendimentos futuros. Desbloquear não traz de volta o que foi cancelado.",
      ],
      exemplo: "Uma empresa marca para vários funcionários pelo mesmo número e passa do limite de atendimentos futuros: o Administrador libera o número dos limites.",
    },
  },
} satisfies ModuloDeAjuda;
