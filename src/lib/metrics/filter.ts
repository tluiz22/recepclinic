import type { SupabaseClient } from "@supabase/supabase-js";

// Filtro por paciente ou responsável nas Métricas (Fase 23 · etapa 8):
// `?paciente=<id>` ou `?responsavel=<id>`, válido nas abas Visão geral,
// Funil, Atendimentos e Retomar contato (Faltosos e Envios ignoram). O bot
// conversa com o responsável, então os dados do WhatsApp de um paciente são
// os do responsável dele (decisão do cliente).

export interface MetricsFilter {
  kind: "patient" | "guardian";
  id: string;
  // "Ana (paciente) · resp. Maria" ou "Maria (responsável)".
  label: string;
  guardianId: string;
  guardianPhone: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveFilter(supabase: SupabaseClient, params: URLSearchParams): Promise<MetricsFilter | null> {
  const patientId = params.get("paciente");
  const guardianId = params.get("responsavel");

  if (patientId && UUID_RE.test(patientId)) {
    const { data } = await supabase
      .from("patients")
      .select("id, full_name, guardian_id, guardians ( full_name, phone )")
      .eq("id", patientId)
      .maybeSingle();
    if (!data) return null;
    const guardian = data.guardians as unknown as { full_name: string; phone: string | null } | null;
    return {
      kind: "patient",
      id: data.id as string,
      label: `${data.full_name}${guardian ? ` · resp. ${guardian.full_name}` : ""}`,
      guardianId: data.guardian_id as string,
      guardianPhone: guardian?.phone ?? null,
    };
  }

  if (guardianId && UUID_RE.test(guardianId)) {
    const { data } = await supabase.from("guardians").select("id, full_name, phone").eq("id", guardianId).maybeSingle();
    if (!data) return null;
    return {
      kind: "guardian",
      id: data.id as string,
      label: `${data.full_name} (responsável)`,
      guardianId: data.id as string,
      guardianPhone: (data.phone as string | null) ?? null,
    };
  }

  return null;
}

/** Parâmetros da URL que mantêm o filtro ao trocar de aba ou período. */
export function filterParams(filter: MetricsFilter | null): Record<string, string> {
  if (!filter) return {};
  return filter.kind === "patient" ? { paciente: filter.id } : { responsavel: filter.id };
}

// Consultas em `appointments`: paciente direto; responsável pela junção com
// `patients` (responsável de convênio pode ter centenas de crianças — não cabe
// numa lista de ids na URL).
export function appointmentEmbed(filter: MetricsFilter | null): string {
  return filter?.kind === "guardian" ? ", patients!inner ( guardian_id )" : "";
}

export function scopeAppointments<Q>(query: Q, filter: MetricsFilter | null): Q {
  if (!filter) return query;
  // O tipo do construtor de consultas do Supabase é profundo demais para
  // restringir aqui; só `eq` é usado.
  const builder = query as unknown as { eq: (column: string, value: string) => Q };
  return filter.kind === "patient" ? builder.eq("patient_id", filter.id) : builder.eq("patients.guardian_id", filter.id);
}

/** Colunas + junção do filtro, tipadas como texto comum (o Supabase não tenta interpretá-las). */
export function appointmentColumns(columns: string, filter: MetricsFilter | null): string {
  return `${columns}${appointmentEmbed(filter)}`;
}

// Eventos do funil: pelo responsável, e pelo telefone para os passos de
// antes do cadastro (guardian_id ainda nulo).
export function funnelFilterExpression(filter: MetricsFilter): string {
  const parts = [`guardian_id.eq.${filter.guardianId}`];
  if (filter.guardianPhone) parts.push(`guardian_phone.eq."${filter.guardianPhone}"`);
  return parts.join(",");
}

export interface PersonResult {
  kind: "patient" | "guardian";
  id: string;
  name: string;
  detail: string;
}

const SEARCH_LIMIT = 8;

function searchSafe(term: string): string {
  return term.replace(/[,()*%\\"]/g, " ").trim();
}

/** Busca por nome do paciente, nome do responsável ou telefone (4+ dígitos). */
export async function searchPeople(supabase: SupabaseClient, term: string): Promise<PersonResult[]> {
  const safe = searchSafe(term);
  if (safe.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  const guardianParts = [`full_name.ilike.%${safe}%`];
  if (digits.length >= 4) guardianParts.push(`phone.ilike.%${digits}%`);

  const [{ data: patients }, { data: guardians }] = await Promise.all([
    supabase
      .from("patients")
      .select("id, full_name, guardians ( full_name )")
      .ilike("full_name", `%${safe}%`)
      .order("full_name")
      .limit(SEARCH_LIMIT),
    supabase
      .from("guardians")
      .select("id, full_name, phone")
      .or(guardianParts.join(","))
      .order("full_name")
      .limit(SEARCH_LIMIT),
  ]);

  return [
    ...(patients ?? []).map((row) => ({
      kind: "patient" as const,
      id: row.id as string,
      name: row.full_name as string,
      detail: `Paciente · resp. ${(row.guardians as unknown as { full_name: string } | null)?.full_name ?? "—"}`,
    })),
    ...(guardians ?? []).map((row) => ({
      kind: "guardian" as const,
      id: row.id as string,
      name: row.full_name as string,
      detail: "Responsável",
    })),
  ];
}
