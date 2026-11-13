import type { DbClient } from "./clients";
import { SIGNALS, type SignalCount, type SignalId } from "../usabilitySignals";

/** Sinais de usabilidade da clínica no período (só o Suporte: a função recusa os demais com lista vazia). */
export async function getUsabilitySignals(db: DbClient, clinicId: string, start: Date, end: Date): Promise<SignalCount[]> {
  const { data, error } = await db.rpc("metrics_usability", { p_clinic_id: clinicId, p_start: start.toISOString(), p_end: end.toISOString() });
  if (error) throw error;
  const known = new Set<string>(SIGNALS.map((s) => s.id));
  return (data ?? [])
    .filter((r: { signal: string }) => known.has(r.signal))
    .map((r: { signal: string; affected: number; base: number }) => ({ signal: r.signal as SignalId, affected: Number(r.affected), base: Number(r.base) }));
}
