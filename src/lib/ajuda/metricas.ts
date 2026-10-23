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
