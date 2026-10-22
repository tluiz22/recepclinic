import type { Enums } from "../supabase/database.types";
import type { DbClient } from "./clients";
import { unwrap } from "./errors";
import { isFrequentNoShow } from "./agenda/view";

// Métricas (F4.9): a leitura dos atendimentos do período para o Financeiro, os
// faltosos e as agendas do Profissional. Escopo: as agendas escolhidas (o
// Profissional, só as próprias, D11) e, se houver, os pacientes do filtro. O
// Desempenho e o Agendamento digital têm as contas no banco (redesign, 22/out/2026).

type Category = Enums<"service_category">;
type Status = Enums<"appointment_status">;

export type MetricsRow = {
  id: string;
  scheduledAt: Date;
  status: Status;
  category: Category;
  serviceName: string;
  locationName: string;
  priceCents: number | null;
};

export type MetricsScope = {
  start: Date;
  end: Date;
  agendaIds: string[];
  patientIds?: string[] | null;
};

const PAGE = 1000;

/** Atendimentos com início no período, cancelados inclusive, lidos em páginas de 1000. */
export async function listMetricsRows(db: DbClient, clinicId: string, scope: MetricsScope): Promise<MetricsRow[]> {
  if (!scope.agendaIds.length || (scope.patientIds && !scope.patientIds.length)) return [];
  const rows: MetricsRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db
      .from("appointments")
      .select("id, scheduled_at, status, price_cents, services ( name, category ), locations ( name )")
      .eq("clinic_id", clinicId)
      .in("agenda_id", scope.agendaIds)
      .gte("scheduled_at", scope.start.toISOString())
      .lt("scheduled_at", scope.end.toISOString());
    if (scope.patientIds) query = query.in("patient_id", scope.patientIds);
    const page = unwrap(await query.order("scheduled_at").order("id").range(from, from + PAGE - 1), "Métricas") as unknown as {
      id: string;
      scheduled_at: string;
      status: Status;
      price_cents: number | null;
      services: { name: string; category: Category };
      locations: { name: string };
    }[];
    rows.push(
      ...page.map((row) => ({
        id: row.id,
        scheduledAt: new Date(row.scheduled_at),
        status: row.status,
        category: row.services.category,
        serviceName: row.services.name,
        locationName: row.locations.name,
        priceCents: row.price_cents,
      })),
    );
    if (page.length < PAGE) return rows;
  }
}

// ---------------------------------------------------------------------------
// Contas (regras puras)
// ---------------------------------------------------------------------------

export type FinancialRow = {
  label: string;
  done: { count: number; cents: number };
  expected: { count: number; cents: number };
  lost: { count: number; cents: number };
};

/**
 * Financeiro (Fase 24 do piloto): por serviço e local, o realizado
 * (compareceu), o previsto (ainda marcado) e as faltas (valor que deixou de
 * entrar). Valor da tabela gravado na marcação, não o recebido. Retorno fica
 * fora (não gera valor).
 */
export function financial(rows: MetricsRow[]): { rows: FinancialRow[]; total: FinancialRow } {
  const zero = () => ({ count: 0, cents: 0 });
  const map = new Map<string, FinancialRow>();
  const total: FinancialRow = { label: "Total", done: zero(), expected: zero(), lost: zero() };
  for (const r of rows) {
    if (r.category === "return_visit" || r.status === "canceled") continue;
    const label = `${r.serviceName} · ${r.locationName}`;
    const row = map.get(label) ?? { label, done: zero(), expected: zero(), lost: zero() };
    map.set(label, row);
    const bucket = r.status === "completed" ? "done" : r.status === "no_show" ? "lost" : "expected";
    for (const target of [row, total]) {
      target[bucket].count += 1;
      target[bucket].cents += r.priceCents ?? 0;
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
  const rows = unwrap(
    await db
      .from("appointments")
      .select("patient_id, status, scheduled_at, patients ( full_name, is_contact_self, contacts ( full_name, phone ) )")
      .eq("clinic_id", clinicId)
      .in("agenda_id", agendaIds)
      .in("status", ["completed", "no_show"])
      .limit(20000),
    "Faltosos",
  ) as unknown as {
    patient_id: string;
    status: Status;
    scheduled_at: string;
    patients: { full_name: string; is_contact_self: boolean; contacts: { full_name: string; phone: string } };
  }[];
  const byPatient = new Map<string, FrequentNoShow>();
  for (const row of rows) {
    const item = byPatient.get(row.patient_id) ?? {
      patientId: row.patient_id,
      patientName: row.patients.full_name,
      contactName: row.patients.contacts.full_name,
      contactPhone: row.patients.contacts.phone,
      isContactSelf: row.patients.is_contact_self,
      noShows: 0,
      total: 0,
      lastNoShow: new Date(0),
    };
    item.total += 1;
    if (row.status === "no_show") {
      item.noShows += 1;
      const at = new Date(row.scheduled_at);
      if (at > item.lastNoShow) item.lastNoShow = at;
    }
    byPatient.set(row.patient_id, item);
  }
  return [...byPatient.values()].filter(isFrequentNoShow).sort((a, b) => b.noShows - a.noShows || b.lastNoShow.getTime() - a.lastNoShow.getTime());
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
