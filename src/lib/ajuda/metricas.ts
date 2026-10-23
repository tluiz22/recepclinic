import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual das Métricas (inventário de 23/out/2026).

export const metricas = {
  dicas: {
    // public.metrics_activity (supabase/migrations/20261023130000_metricas_acesso_na_entrada.sql) e a soma em PerformanceTab.astro.
    graficoAtividade: [
      { termo: "Agendamentos criados", texto: "no dia da marcação, pela recepção ou pelo WhatsApp, mesmo se cancelados depois (fora a agenda carregada na implantação)." },
      { termo: "Remarcações", texto: "cada uma, no dia em que aconteceu, inclusive pela lista de espera." },
      { termo: "Cancelamentos", texto: "no dia do cancelamento, por quem for." },
    ],
    // metrics_activity (booking_channel; created_at no período; sem agenda_import_id).
    marcadosPor: [
      { termo: "WhatsApp (bot)", texto: "marcados pelo bot ou pelo link de agendamento que ele manda." },
      { termo: "Painel (equipe)", texto: "marcados pela equipe." },
      { termo: "Conta", texto: "pela data da marcação, mesmo se cancelados depois; a agenda carregada na implantação fica de fora." },
    ],
    // DigitalFlowRow em src/lib/data/botFunnel.ts (concluded / finished; worstStep = a maior queda entre etapas seguidas).
    porOperacao: [
      { termo: "Taxa", texto: "concluídas sobre as tentativas já terminadas (as em andamento ficam de fora)." },
      { termo: "Onde mais perde", texto: "a passagem entre duas etapas seguidas em que mais tentativas pararam, com quantas." },
    ],
    // public.metrics_financial (supabase/migrations/20261023130000_metricas_acesso_na_entrada.sql).
    valoresServico: [
      { termo: "Conta", texto: "atendimentos com data no período, pelo valor da tabela gravado na marcação (não o recebido); cancelados e Retorno ficam de fora." },
      { termo: "Realizado", texto: "compareceu." },
      { termo: "Previsto", texto: "ainda sem registro." },
      { termo: "Faltas", texto: "faltou." },
    ],
    // src/lib/data/botFunnel.ts (classify, IN_PROGRESS_MS = 30 minutos).
    comoTerminaram: [
      { termo: "Marcaram", texto: "concluíram (ou Remarcaram, Cancelaram)." },
      { termo: "Abandonaram", texto: "30 minutos sem passo novo." },
      { termo: "Barradas pela regra", texto: "o bot recusou por uma regra da clínica." },
      { termo: "Erro técnico", texto: "falha do sistema." },
      { termo: "Desistiram", texto: "disseram que não querem mais." },
      { termo: "Em andamento", texto: "última resposta há menos de 30 minutos." },
    ],
  },
} satisfies ModuloDeAjuda;
