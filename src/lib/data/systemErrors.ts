import type { DbClient } from "./clients";
import { unwrap } from "./errors";

// Administração do sistema › Erros (F9.3): o Suporte lê os erros gravados pelo
// servidor (system_errors, já sem dados pessoais) e a última execução de cada
// rotina (cron_heartbeats). O RLS só deixa o Suporte ler.

export type SystemError = {
  id: number;
  occurredAt: Date;
  scope: string;
  clinicId: string | null;
  clinicName: string | null;
  ids: Record<string, string>;
  message: string;
};

export async function listSystemErrors(db: DbClient, { clinicId, limit = 200 }: { clinicId?: string | null; limit?: number } = {}): Promise<SystemError[]> {
  let query = db
    .from("system_errors")
    .select("id, occurred_at, scope, clinic_id, ids, message, clinics(name)")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (clinicId) query = query.eq("clinic_id", clinicId);
  const rows = unwrap(await query, "Erros do sistema");
  return rows.map((row) => ({
    id: row.id,
    occurredAt: new Date(row.occurred_at),
    scope: row.scope,
    clinicId: row.clinic_id,
    clinicName: row.clinics?.name ?? null,
    ids: (row.ids ?? {}) as Record<string, string>,
    message: row.message,
  }));
}

export async function listCronHeartbeats(db: DbClient): Promise<{ job: string; lastFinishedAt: Date; clinics: number; errors: number }[]> {
  const rows = unwrap(await db.from("cron_heartbeats").select("job, last_finished_at, clinics, errors"), "Execuções das rotinas");
  return rows.map((row) => ({ job: row.job, lastFinishedAt: new Date(row.last_finished_at), clinics: row.clinics, errors: row.errors }));
}
