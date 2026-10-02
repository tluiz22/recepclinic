import type { SupabaseClient } from "@supabase/supabase-js";

// Pacientes que marcam e não comparecem (Fase 23 · etapa 7). Regra decidida
// com o cliente: 2 ou mais "Não compareceu" e faltas em pelo menos 50% dos
// atendimentos com desfecho registrado (Realizada + Não compareceu), em todo o
// histórico. Por paciente, não por responsável (o responsável pode ser um
// convênio com centenas de crianças). Só informa — não bloqueia nada.

export const MIN_NO_SHOWS = 2;
export const MIN_NO_SHOW_RATE = 0.5;

export interface NoShowStats {
  noShow: number;
  completed: number;
  lastNoShowAt: string | null;
}

export function isFrequentNoShow(stats: NoShowStats | undefined): boolean {
  if (!stats || stats.noShow < MIN_NO_SHOWS) return false;
  return stats.noShow / (stats.noShow + stats.completed) >= MIN_NO_SHOW_RATE;
}

// "Faltou 3 de 4".
export function noShowLabel(stats: NoShowStats): string {
  return `Faltou ${stats.noShow} de ${stats.noShow + stats.completed}`;
}

const PAGE = 1000;
const ID_BATCH = 150;

async function fetchOutcomes(
  supabase: SupabaseClient,
  status: "no_show" | "completed",
  patientIds: string[] | null
): Promise<{ patient_id: string; scheduled_at: string }[]> {
  const rows: { patient_id: string; scheduled_at: string }[] = [];
  const batches = patientIds === null ? [null] : chunk(patientIds, ID_BATCH);
  for (const batch of batches) {
    for (let from = 0; ; from += PAGE) {
      let query = supabase.from("appointments").select("patient_id, scheduled_at").eq("status", status);
      if (batch) query = query.in("patient_id", batch);
      const { data, error } = await query.order("scheduled_at").range(from, from + PAGE - 1);
      if (error) {
        console.error("[noShow] erro ao ler appointments:", error.message);
        break;
      }
      rows.push(...((data ?? []) as { patient_id: string; scheduled_at: string }[]));
      if (!data || data.length < PAGE) break;
    }
  }
  return rows;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function tally(
  noShows: { patient_id: string; scheduled_at: string }[],
  completed: { patient_id: string }[]
): Map<string, NoShowStats> {
  const stats = new Map<string, NoShowStats>();
  const get = (id: string) => {
    let entry = stats.get(id);
    if (!entry) {
      entry = { noShow: 0, completed: 0, lastNoShowAt: null };
      stats.set(id, entry);
    }
    return entry;
  };
  for (const row of noShows) {
    const entry = get(row.patient_id);
    entry.noShow += 1;
    if (!entry.lastNoShowAt || row.scheduled_at > entry.lastNoShowAt) entry.lastNoShowAt = row.scheduled_at;
  }
  for (const row of completed) get(row.patient_id).completed += 1;
  return stats;
}

/** Faltas e presenças destes pacientes (selo na Agenda e nas fichas). */
export async function fetchNoShowStats(
  supabase: SupabaseClient,
  patientIds: string[]
): Promise<Map<string, NoShowStats>> {
  const ids = [...new Set(patientIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const noShows = await fetchOutcomes(supabase, "no_show", ids);
  // Só quem tem faltas suficientes pode virar selo — evita contar presenças à toa.
  const candidates = [...tally(noShows, []).entries()]
    .filter(([, entry]) => entry.noShow >= MIN_NO_SHOWS)
    .map(([id]) => id);
  const completed = candidates.length ? await fetchOutcomes(supabase, "completed", candidates) : [];
  return tally(noShows, completed);
}

/** Todos os pacientes faltosos (aba Faltosos de Métricas), mais faltas primeiro. */
export async function fetchFrequentNoShows(
  supabase: SupabaseClient
): Promise<{ patientId: string; stats: NoShowStats }[]> {
  const noShows = await fetchOutcomes(supabase, "no_show", null);
  const candidates = [...tally(noShows, []).entries()]
    .filter(([, entry]) => entry.noShow >= MIN_NO_SHOWS)
    .map(([id]) => id);
  if (candidates.length === 0) return [];
  const completed = await fetchOutcomes(supabase, "completed", candidates);
  const stats = tally(
    noShows.filter((row) => candidates.includes(row.patient_id)),
    completed
  );
  return [...stats.entries()]
    .filter(([, entry]) => isFrequentNoShow(entry))
    .map(([patientId, entry]) => ({ patientId, stats: entry }))
    .sort((a, b) => b.stats.noShow - a.stats.noShow || (b.stats.lastNoShowAt ?? "").localeCompare(a.stats.lastNoShowAt ?? ""));
}
