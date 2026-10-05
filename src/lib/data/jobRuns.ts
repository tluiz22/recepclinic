import type { Json } from "../supabase/database.types";
import type { DbClient } from "./clients";
import { unwrap } from "./errors";

// Execuções das rotinas automáticas por clínica (`job_runs`, L33): a falha de
// uma clínica fica registrada com ela. Só o agendador grava (credencial da
// clínica); a equipe lê (aba Envios, F3.9c).

export type JobName = "appointment_reminders" | "daily_summary" | "waitlist_offers";
export type JobTrigger = "scheduled" | "manual";

export async function startJobRun(
  db: DbClient,
  clinicId: string,
  job: JobName,
  { trigger, variant = null }: { trigger: JobTrigger; variant?: "preview" | "final" | null },
  now: Date = new Date(),
): Promise<number> {
  const row = unwrap(
    await db
      .from("job_runs")
      .insert({ clinic_id: clinicId, job, trigger, variant, started_at: now.toISOString() })
      .select("id")
      .single(),
    "Execução da rotina",
  );
  return row.id;
}

/** Fecha a execução com os totais; com `error`, fica como falha. Nunca lança. */
export async function finishJobRun(
  db: DbClient,
  runId: number,
  { totals, error }: { totals: Record<string, number>; error?: string },
  now: Date = new Date(),
): Promise<void> {
  const { error: dbError } = await db
    .from("job_runs")
    .update({
      finished_at: now.toISOString(),
      status: error ? "error" : "ok",
      error_message: error ?? null,
      totals: totals as NonNullable<Json>,
    })
    .eq("id", runId);
  if (dbError) console.error("[rotinas] não fechou a execução", runId, dbError.message);
}
