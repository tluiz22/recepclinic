import type { Enums } from "../supabase/database.types";
import type { DbClient } from "./clients";
import { unwrap } from "./errors";
import { isFrequentNoShow } from "./agenda/view";

// Métricas (F4.9), no banco novo: uma leitura dos atendimentos do período e
// contas puras para cada aba (Visão geral, Atendimentos, Faltosos,
// Financeiro), como no piloto. Escopo: as agendas escolhidas (o Profissional,
// só as próprias, D11) e, se houver, os pacientes do filtro. Funil do bot e
// Retomar contato entram na F6, com o bot (cliente, 05/out/2026).

type Category = Enums<"service_category">;
type Status = Enums<"appointment_status">;

export type MetricsRow = {
  id: string;
  scheduledAt: Date;
  status: Status;
  category: Category;
  serviceName: string;
  locationName: string;
  isHomeVisit: boolean;
  agendaId: string;
  patientId: string;
  bookingChannel: string;
  canceledVia: string | null;
  priceCents: number | null;
};

export type MetricsScope = { start: Date; end: Date; agendaIds: string[]; patientIds?: string[] | null };

const PAGE = 1000;

/** Atendimentos com início no período (cancelados inclusive), lidos em páginas de 1000. */
export async function listMetricsRows(db: DbClient, clinicId: string, scope: MetricsScope): Promise<MetricsRow[]> {
  if (!scope.agendaIds.length || (scope.patientIds && !scope.patientIds.length)) return [];
  const rows: MetricsRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db
      .from("appointments")
      .select("id, scheduled_at, status, agenda_id, patient_id, booking_channel, canceled_via, price_cents, services ( name, category ), locations ( name, type )")
      .eq("clinic_id", clinicId)
      .in("agenda_id", scope.agendaIds)
      .gte("scheduled_at", scope.start.toISOString())
      .lt("scheduled_at", scope.end.toISOString());
    if (scope.patientIds) query = query.in("patient_id", scope.patientIds);
    const page = unwrap(await query.order("scheduled_at").order("id").range(from, from + PAGE - 1), "Métricas") as unknown as {
      id: string;
      scheduled_at: string;
      status: Status;
      agenda_id: string;
      patient_id: string;
      booking_channel: string;
      canceled_via: string | null;
      price_cents: number | null;
      services: { name: string; category: Category };
      locations: { name: string; type: string };
    }[];
    rows.push(
      ...page.map((row) => ({
        id: row.id,
        scheduledAt: new Date(row.scheduled_at),
        status: row.status,
        category: row.services.category,
        serviceName: row.services.name,
        locationName: row.locations.name,
        isHomeVisit: row.locations.type === "home_visit",
        agendaId: row.agenda_id,
        patientId: row.patient_id,
        bookingChannel: row.booking_channel,
        canceledVia: row.canceled_via,
        priceCents: row.price_cents,
      })),
    );
    if (page.length < PAGE) return rows;
  }
}

// ---------------------------------------------------------------------------
// Contas (regras puras)
// ---------------------------------------------------------------------------

const ACTIVE: Status[] = ["scheduled", "confirmed"];

export type Overview = {
  /** Sem os cancelados (o que ocupou a agenda). */
  total: number;
  completed: number;
  noShow: number;
  canceled: number;
  /** Já passaram e ainda sem registro. */
  pending: number;
  upcoming: number;
  /** Faltas entre os registrados (compareceu + faltou); null = nenhum registrado. */
  noShowRate: number | null;
  byChannel: { whatsapp: number; panel: number; link: number };
};

export function noShowRate(completed: number, noShow: number): number | null {
  return completed + noShow > 0 ? noShow / (completed + noShow) : null;
}

export function overview(rows: MetricsRow[], now: Date): Overview {
  const live = rows.filter((r) => r.status !== "canceled");
  const completed = rows.filter((r) => r.status === "completed").length;
  const noShow = rows.filter((r) => r.status === "no_show").length;
  return {
    total: live.length,
    completed,
    noShow,
    canceled: rows.length - live.length,
    pending: live.filter((r) => ACTIVE.includes(r.status) && r.scheduledAt <= now).length,
    upcoming: live.filter((r) => ACTIVE.includes(r.status) && r.scheduledAt > now).length,
    noShowRate: noShowRate(completed, noShow),
    byChannel: {
      whatsapp: live.filter((r) => r.bookingChannel === "whatsapp_bot").length,
      panel: live.filter((r) => r.bookingChannel === "admin").length,
      link: live.filter((r) => r.bookingChannel === "booking_link").length,
    },
  };
}

export type VolumeRow = { label: string; count: number };

/** Volume por serviço e local (sem cancelados), do maior para o menor. */
export function volumeByService(rows: MetricsRow[]): VolumeRow[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.status === "canceled") continue;
    const label = `${r.serviceName} · ${r.locationName}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export type NoShowRow = { label: string; completed: number; noShow: number; rate: number | null };

const CATEGORY_LABELS: Record<Category, string> = { consultation: "Consulta", return_visit: "Retorno", exam: "Exame" };

/** Não comparecimento por tipo de serviço, só entre os já registrados; com o total. */
export function noShowByCategory(rows: MetricsRow[]): NoShowRow[] {
  const line = (label: string, list: MetricsRow[]): NoShowRow => {
    const completed = list.filter((r) => r.status === "completed").length;
    const noShow = list.filter((r) => r.status === "no_show").length;
    return { label, completed, noShow, rate: noShowRate(completed, noShow) };
  };
  const categories = (["consultation", "return_visit", "exam"] as Category[]).filter((c) => rows.some((r) => r.category === c));
  return [...categories.map((c) => line(CATEGORY_LABELS[c], rows.filter((r) => r.category === c))), line("Total", rows)];
}

export type OriginRow = { label: string; booked: number; canceled: number };

const CHANNEL_LABELS: Record<string, string> = { admin: "Painel (equipe)", whatsapp_bot: "WhatsApp (bot)", booking_link: "Link de agendamento" };

/** Por onde foram marcados e cancelados os atendimentos do período. */
export function byOrigin(rows: MetricsRow[]): OriginRow[] {
  const result = new Map<string, OriginRow>();
  const get = (channel: string) => {
    const label = CHANNEL_LABELS[channel] ?? channel;
    const row = result.get(label) ?? { label, booked: 0, canceled: 0 };
    result.set(label, row);
    return row;
  };
  for (const r of rows) {
    get(r.bookingChannel).booked += 1;
    if (r.status === "canceled" && r.canceledVia) get(r.canceledVia).canceled += 1;
  }
  return [...result.values()].sort((a, b) => b.booked - a.booked);
}

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
