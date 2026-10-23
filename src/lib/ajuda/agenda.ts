import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual da Agenda e do Resumo do Dia (inventário de 23/out/2026).

export const agenda = {
  dicas: {
    // src/lib/data/agenda/view.ts (isFrequentNoShow, listNoShowStats).
    seloFaltas:
      "Aparece quando o paciente tem 2 ou mais faltas e faltou em pelo menos metade dos atendimentos registrados (compareceu ou faltou), em todo o histórico. Só informa: não impede marcar.",
  },
  comoFunciona: {
    // src/components/admin/agenda/situationStyle.ts (appointmentSituation); botão "Confirmar presença" do
    // lembrete (src/lib/data/whatsapp/templates.ts) e do bot (bot/manage.ts, confirmPresence); cardActions.ts.
    situacoes: {
      serve: "A cor e o selo de cada atendimento dizem em que pé ele está.",
      como: [
        "Não confirmado: o paciente ainda não confirmou a presença.",
        "Confirmado: o paciente tocou em \"Confirmar presença\" no lembrete do WhatsApp (ou confirmou pelo bot), ou a recepção usou \"Confirmar presença\" no cartão.",
        "Compareceu e Faltou: a recepção registra no cartão do atendimento.",
        "Cancelado: pela clínica, ou pelo paciente no WhatsApp.",
        "Bloqueio: período em que a agenda não recebe marcações.",
      ],
    },
    // src/lib/data/agenda/series.ts (SERIES_HORIZON_MONTHS, generateSessions, extendOpenSeries) e a rotina
    // diária src/pages/api/cron/series.ts; D9 em docs/arquitetura.md.
    serie: {
      serve: "Marcar o mesmo atendimento no mesmo dia da semana e horário, de uma vez.",
      como: [
        "Escolha a frequência (toda semana, a cada 2 semanas…) e até quando: um dia, um número de sessões ou sem data para terminar.",
        "Ficam marcadas as sessões dos próximos 3 meses. Uma vez por dia, o sistema marca as que entram nesse prazo, até o fim da série.",
        "Feriado, bloqueio ou horário ocupado: a data é pulada e aparece na tela da série, para marcar à mão se quiser. No fim por número de sessões, a data pulada não conta.",
        "Cada sessão é um atendimento comum: dá para remarcar ou cancelar só ela, ou encerrar a série dali em diante.",
      ],
      exemplo: "Toda semana, às terças às 14h, 10 sessões, com um feriado numa das terças: a data do feriado é pulada e a série vai até a 11ª terça, para completar as 10.",
    },
  },
} satisfies ModuloDeAjuda;

/** Consequência de cada saída do Bloquear (docs/plano.md F6.5; AguardandoTab.astro), visível antes de confirmar. */
export const bloquear = {
  cancelar:
    "Bloquear e cancelar: os atendimentos do período são cancelados; cada paciente recebe o aviso pelo WhatsApp da clínica, com o link para remarcar, e passa para \"Aguardando remarcação\" no Resumo do Dia.",
  manter: "Bloquear e manter: os atendimentos continuam marcados; só os horários livres do período deixam de ser oferecidos.",
};
