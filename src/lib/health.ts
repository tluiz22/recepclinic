// Saúde do sistema para o monitor externo (F9.3, L45). Regras puras; quem lê o
// banco é src/lib/data/health.ts.

/**
 * Rotinas do agendador (pg_cron, migrações 20261007130000 e 20261007170000) e
 * o atraso tolerado desde a última execução terminada: a frequência com folga
 * para uma ou duas falhas seguidas e para a demora da própria execução.
 */
export const CRON_JOBS: Readonly<Record<string, { every: string; maxDelayMinutes: number }>> = {
  "conversas-paradas": { every: "a cada minuto", maxDelayMinutes: 10 },
  "resumo-do-dia": { every: "a cada 5 minutos", maxDelayMinutes: 20 },
  "lista-de-espera": { every: "a cada 5 minutos", maxDelayMinutes: 20 },
  lembretes: { every: "a cada hora", maxDelayMinutes: 90 },
  series: { every: "uma vez por dia", maxDelayMinutes: 26 * 60 },
};

/** Janela da /api/saude/erros: erro mais novo que isso deixa o monitor vermelho. */
export const RECENT_ERRORS_MINUTES = 15;

export type CronCheck = { job: string; ok: boolean; lastFinishedAt: Date | null; minutesLate: number | null };

/** Situação de cada rotina conhecida; a que nunca rodou conta como atrasada. */
export function checkCronJobs(heartbeats: { job: string; lastFinishedAt: Date }[], now: Date): CronCheck[] {
  const last = new Map(heartbeats.map((beat) => [beat.job, beat.lastFinishedAt]));
  return Object.entries(CRON_JOBS).map(([job, { maxDelayMinutes }]) => {
    const lastFinishedAt = last.get(job) ?? null;
    if (!lastFinishedAt) return { job, ok: false, lastFinishedAt, minutesLate: null };
    const minutes = Math.floor((now.getTime() - lastFinishedAt.getTime()) / 60_000);
    return { job, ok: minutes <= maxDelayMinutes, lastFinishedAt, minutesLate: minutes > maxDelayMinutes ? minutes - maxDelayMinutes : 0 };
  });
}
