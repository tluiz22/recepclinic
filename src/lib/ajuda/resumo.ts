import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual do Resumo do Dia (inventário de 23/out/2026).

export const resumo = {
  dicas: {
    // reminderGroup em src/lib/data/daily.ts (o botão tocado; sem toque, a última tentativa: failed ou skipped_no_template).
    lembretesGrupos: [
      { termo: "Confirmaram, Pediram para remarcar e Pediram para cancelar", texto: "o botão que o paciente tocou no lembrete." },
      { termo: "Não responderam", texto: "o lembrete saiu, mas ninguém tocou nos botões." },
      { termo: "Não entregue", texto: "o WhatsApp recusou o envio, ou a mensagem do lembrete ainda não foi aprovada pela Meta." },
    ],
    // listAppointmentsWithFailedSends e retryingSends em src/lib/data/sends.ts; retryRules.ts (MAX_ATTEMPTS, 10 e 30 minutos).
    enviosFalha:
      "Atendimentos por vir com algum envio pelo WhatsApp que não saiu. Falha técnica é tentada de novo sozinha, 10 e 30 minutos depois (\"Tentando de novo\"). O horário e o nome levam à Agenda do dia, onde fica o reenvio.",
    // jobRuns.ts (JobName) e jobRunState em sends.ts (STUCK_AFTER_MS = 15 minutos).
    enviosRotinas:
      "Cada vez que o sistema roda os lembretes, o resumo do dia ou as ofertas da lista de espera, fica uma linha aqui. Rodou: terminou. Rodando: ainda em andamento. Travou: rodando há mais de 15 minutos. Erro: parou com uma falha.",
  },
  comoFunciona: {
    // src/lib/data/waitlist/offers.ts (cabeçalho, OFFER_MINUTES, MIN_LEAD_MS); D2 em docs/arquitetura.md.
    listaEspera: {
      serve: "Pacientes que já têm horário marcado e querem antecipar. Entram pelo WhatsApp (\"Encaixe ou antecipar\") ou pela recepção.",
      como: [
        "Quando um atendimento é cancelado ou remarcado, a vaga é oferecida pelo WhatsApp a um paciente por vez, na ordem de entrada na lista.",
        "Só recebe quem está na fila da mesma agenda e do mesmo serviço, com atendimento depois da vaga e no mesmo tipo de local.",
        "A vaga só é oferecida se começar daqui a mais de 2 horas.",
        "O paciente tem 60 minutos para responder. \"Sim\" remarca na hora e o horário antigo vira outra vaga; \"Não\" ou sem resposta passa ao próximo.",
      ],
      exemplo:
        "Ana tem Consulta na sexta às 15h e está na lista. Na quarta, a Consulta de quinta às 9h é cancelada: Ana recebe a oferta e, se responder \"Sim\" em até 60 minutos, passa para quinta às 9h.",
      erro: "A vaga não foi oferecida? Se houver horário livre antes dela, ela espera (oferecer não ajudaria ninguém). Confira também se alguém da fila é da mesma agenda e do mesmo serviço.",
    },
  },
  vazios: {
    // docs/plano.md F3.7a e F6.4.
    listaEspera: {
      titulo: "Ninguém na lista de espera",
      texto: "Entra aqui quem já tem horário e pede para antecipar, pelo WhatsApp (\"Encaixe ou antecipar\") ou pela recepção.",
    },
  },
} satisfies ModuloDeAjuda;
