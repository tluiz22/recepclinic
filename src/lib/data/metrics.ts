import type { DbClient } from "./clients";
import { unwrap, unwrapAll } from "./errors";
import { isFrequentNoShow } from "./agenda/view";

// Métricas (F4.9): Financeiro, Faltosos e as agendas do Profissional. As contas
// são do banco (`metrics_financial` e `metrics_no_shows`, com o acesso
// conferido na entrada, 22/out/2026), como as do Desempenho e do Agendamento
// digital. Escopo: as agendas escolhidas (o Profissional, só as próprias, D11)
// e, no Financeiro, os pacientes do filtro.

export type MetricsScope = {
  start: Date;
  end: Date;
  agendaIds: string[];
  patientIds?: string[] | null;
};

export type FinancialBucket = "done" | "expected" | "lost";

/** Uma linha da conta do banco: um serviço num local e uma situação. */
export type FinancialTotal = { serviceName: string; locationName: string; bucket: FinancialBucket; count: number; cents: number };

export type FinancialRow = {
  label: string;
  done: { count: number; cents: number };
  expected: { count: number; cents: number };
  lost: { count: number; cents: number };
};

/**
 * Financeiro (Fase 24 do piloto): por serviço e local, o realizado
 * (compareceu), o previsto (ainda marcado) e as faltas (valor que deixou de
 * entrar). Valor da tabela gravado na marcação, não o recebido. Retorno e
 * cancelados ficam fora (já no banco).
 */
export async function listFinancialTotals(db: DbClient, clinicId: string, scope: MetricsScope): Promise<FinancialTotal[]> {
  if (!scope.agendaIds.length || (scope.patientIds && !scope.patientIds.length)) return [];
  const rows = unwrap(
    await db.rpc("metrics_financial", {
      p_clinic_id: clinicId,
      p_start: scope.start.toISOString(),
      p_end: scope.end.toISOString(),
      p_agenda_ids: scope.agendaIds,
      p_patient_ids: scope.patientIds ?? undefined,
    }),
    "Métricas: financeiro",
  );
  return rows.map((r) => ({ serviceName: r.service_name, locationName: r.location_name, bucket: r.bucket as FinancialBucket, count: Number(r.total) || 0, cents: Number(r.cents) || 0 }));
}

/** A tabela da tela: uma linha por serviço e local, em ordem alfabética, e o total. */
export function financial(totals: FinancialTotal[]): { rows: FinancialRow[]; total: FinancialRow } {
  const zero = () => ({ count: 0, cents: 0 });
  const map = new Map<string, FinancialRow>();
  const total: FinancialRow = { label: "Total", done: zero(), expected: zero(), lost: zero() };
  for (const t of totals) {
    const label = `${t.serviceName} · ${t.locationName}`;
    const row = map.get(label) ?? { label, done: zero(), expected: zero(), lost: zero() };
    map.set(label, row);
    for (const target of [row, total]) {
      target[t.bucket].count += t.count;
      target[t.bucket].cents += t.cents;
    }
  }
  return { rows: [...map.values()].sort((a, b) => a.label.localeCompare(b.label)), total };
}

// ---------------------------------------------------------------------------
// Faltosos (todo o histórico)
// ---------------------------------------------------------------------------

export type FrequentNoShow = { patientId: string; patientName: string; contactName: string; contactPhone: string; isContactSelf: boolean; noShows: number; total: number; lastNoShow: Date };

/** Pacientes com faltas frequentes (regra do piloto), nas agendas do escopo; mais faltas primeiro. */
export async function listFrequentNoShows(db: DbClient, clinicId: string, agendaIds: string[]): Promise<FrequentNoShow[]> {
  if (!agendaIds.length) return [];
  const rows = await unwrapAll(
    (from, to) => db.rpc("metrics_no_shows", { p_clinic_id: clinicId, p_agenda_ids: agendaIds }).order("patient_id").range(from, to),
    "Faltosos",
  );
  return rows
    .map((r) => ({
      patientId: r.patient_id,
      patientName: r.patient_name,
      contactName: r.contact_name,
      contactPhone: r.contact_phone,
      isContactSelf: r.is_contact_self,
      noShows: Number(r.no_shows) || 0,
      total: Number(r.total) || 0,
      lastNoShow: new Date(r.last_no_show),
    }))
    .filter(isFrequentNoShow)
    .sort((a, b) => b.noShows - a.noShows || b.lastNoShow.getTime() - a.lastNoShow.getTime());
}

// ---------------------------------------------------------------------------
// Agendas do Profissional (Métricas pessoais, D11)
// ---------------------------------------------------------------------------

/** Agendas dos cadastros de profissional ligados a este login. */
export async function ownAgendaIds(db: DbClient, clinicId: string, userId: string): Promise<string[]> {
  const rows = unwrap(
    await db.from("agendas").select("id, professionals!inner ( user_id )").eq("clinic_id", clinicId).eq("professionals.user_id", userId),
    "Agendas do profissional",
  );
  return rows.map((row) => row.id);
}
