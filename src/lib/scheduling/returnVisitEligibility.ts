import type { SupabaseClient } from "@supabase/supabase-js";
import { computeReturnVisitLastDate, todayFortaleza } from "./returnVisitDeadline";

// Por que a criança tem (ou não) direito a marcar retorno agora — regras da
// Fase 17, avaliadas nesta ordem:
// - "no_recent_consultation": nenhuma Consulta de origem, ou a última
//   passou do prazo;
// - "home_visit": a última Consulta foi domiciliar (não dá direito a retorno);
// - "return_used": a última Consulta já tem um retorno não cancelado vinculado;
// - "future_appointment": já existe consulta/retorno futuro marcado (mesma
//   trava de duplicidade do resto do sistema);
// - "eligible": tem direito.
export type ReturnVisitStatus =
  | "eligible"
  | "no_recent_consultation"
  | "home_visit"
  | "return_used"
  | "future_appointment";

export interface ReturnVisitPatient {
  patientId: string;
  fullName: string;
  birthdate: string;
  status: ReturnVisitStatus;
  // Última Consulta que conta como origem (se houver).
  originAppointmentId?: string;
  // Consulta/retorno futuro que bloqueia (status "future_appointment").
  futureScheduledAt?: string;
}

interface OriginRow {
  id: string;
  patient_id: string;
  scheduled_at: string;
  clinic_locations: { type: string } | null;
}

/**
 * Consulta de origem de um retorno: a última Consulta (first_visit) da
 * criança já realizada (`completed`) ou ainda pendente de confirmação
 * (`scheduled`/`confirmed` com data no passado) — `no_show`/`canceled`
 * nunca contam.
 */
export async function getReturnVisitEligibility(
  supabase: SupabaseClient,
  guardianId: string
): Promise<{ deadlineDays: number; patients: ReturnVisitPatient[] }> {
  const nowIso = new Date().toISOString();

  const [{ data: settings }, { data: patients }] = await Promise.all([
    supabase.from("appointment_settings").select("return_visit_deadline_days").eq("id", 1).single(),
    supabase
      .from("patients")
      .select("id, full_name, birthdate")
      .eq("guardian_id", guardianId)
      .eq("is_active", true)
      .order("full_name"),
  ]);

  const deadlineDays: number = settings?.return_visit_deadline_days ?? 30;
  if (!patients?.length) return { deadlineDays, patients: [] };

  const patientIds = patients.map((p) => p.id as string);

  const [{ data: originRows }, { data: futureRows }] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, patient_id, scheduled_at, clinic_locations ( type )")
      .in("patient_id", patientIds)
      .eq("appointment_type", "first_visit")
      .in("status", ["completed", "scheduled", "confirmed"])
      .lt("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: false }),
    supabase
      .from("appointments")
      .select("patient_id, scheduled_at")
      .in("patient_id", patientIds)
      .in("appointment_type", ["first_visit", "return_visit"])
      .in("status", ["scheduled", "confirmed"])
      .gt("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true }),
  ]);

  // Já vem ordenado da mais recente para a mais antiga — fica a primeira.
  const lastOriginByPatient = new Map<string, OriginRow>();
  for (const row of (originRows ?? []) as unknown as OriginRow[]) {
    if (!lastOriginByPatient.has(row.patient_id)) lastOriginByPatient.set(row.patient_id, row);
  }

  const nextFutureByPatient = new Map<string, string>();
  for (const row of futureRows ?? []) {
    if (!nextFutureByPatient.has(row.patient_id)) nextFutureByPatient.set(row.patient_id, row.scheduled_at);
  }

  const originIds = [...lastOriginByPatient.values()].map((row) => row.id);
  const { data: usedRows } = originIds.length
    ? await supabase
        .from("appointments")
        .select("origin_appointment_id")
        .in("origin_appointment_id", originIds)
        .neq("status", "canceled")
    : { data: [] };
  const usedOriginIds = new Set((usedRows ?? []).map((row) => row.origin_appointment_id as string));

  const today = todayFortaleza();

  return {
    deadlineDays,
    patients: patients.map((patient) => {
      const base = {
        patientId: patient.id as string,
        fullName: patient.full_name as string,
        birthdate: patient.birthdate as string,
      };
      const origin = lastOriginByPatient.get(base.patientId);

      if (!origin || today > computeReturnVisitLastDate(origin.scheduled_at, deadlineDays)) {
        return { ...base, status: "no_recent_consultation" };
      }
      const withOrigin = { ...base, originAppointmentId: origin.id };
      if (origin.clinic_locations?.type === "home_visit") return { ...withOrigin, status: "home_visit" };
      if (usedOriginIds.has(origin.id)) return { ...withOrigin, status: "return_used" };
      const futureScheduledAt = nextFutureByPatient.get(base.patientId);
      if (futureScheduledAt) return { ...withOrigin, status: "future_appointment", futureScheduledAt };
      return { ...withOrigin, status: "eligible" };
    }),
  };
}

// --- tela da secretária (Marcar/Remarcar retorno) --------------------------

export interface ReturnOriginCheck {
  deadlineDays: number;
  // Consulta que o retorno vai vincular (null = sem consulta para vincular).
  origin: { id: string; date: string; lastDate: string } | null;
  // Avisos para a secretária — nunca bloqueiam (exceções combinadas com a
  // médica, Fase 17).
  warnings: string[];
}

function formatDateBR(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Consulta de origem de um retorno marcado/remarcado pela tela: a já
 * vinculada ao retorno sendo remarcado (`originAppointmentId`), ou a última
 * Consulta da criança pelas mesmas regras do bot. `ignoreAppointmentId` é o
 * próprio retorno sendo remarcado (não conta como "retorno já vinculado").
 */
export async function getReturnOriginCheck(
  supabase: SupabaseClient,
  {
    patientId,
    originAppointmentId,
    ignoreAppointmentId,
  }: { patientId: string; originAppointmentId?: string | null; ignoreAppointmentId?: string | null }
): Promise<ReturnOriginCheck> {
  const { data: settings } = await supabase
    .from("appointment_settings")
    .select("return_visit_deadline_days")
    .eq("id", 1)
    .single();
  const deadlineDays: number = settings?.return_visit_deadline_days ?? 30;

  let originQuery = supabase.from("appointments").select("id, scheduled_at, clinic_locations ( type )");
  if (originAppointmentId) {
    originQuery = originQuery.eq("id", originAppointmentId);
  } else {
    originQuery = originQuery
      .eq("patient_id", patientId)
      .eq("appointment_type", "first_visit")
      .in("status", ["completed", "scheduled", "confirmed"])
      .lt("scheduled_at", new Date().toISOString());
    if (ignoreAppointmentId) originQuery = originQuery.neq("id", ignoreAppointmentId);
  }
  const { data: originRow } = await originQuery.order("scheduled_at", { ascending: false }).limit(1).maybeSingle();

  if (!originRow) {
    return {
      deadlineDays,
      origin: null,
      warnings: ["Paciente sem Consulta anterior para vincular — o retorno ficará sem consulta de origem."],
    };
  }

  const origin = {
    id: originRow.id as string,
    date: new Date(new Date(originRow.scheduled_at).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10),
    lastDate: computeReturnVisitLastDate(originRow.scheduled_at, deadlineDays),
  };
  const originLabel = formatDateBR(origin.date);
  const warnings: string[] = [];

  const location = originRow.clinic_locations as unknown as { type: string } | null;
  if (location?.type === "home_visit") {
    warnings.push(`A consulta de origem (${originLabel}) foi domiciliar — consulta domiciliar não dá direito a retorno.`);
  }

  let usedQuery = supabase
    .from("appointments")
    .select("id")
    .eq("origin_appointment_id", origin.id)
    .neq("status", "canceled");
  if (ignoreAppointmentId) usedQuery = usedQuery.neq("id", ignoreAppointmentId);
  const { data: usedRows } = await usedQuery.limit(1);
  if (usedRows?.length) {
    warnings.push(`A consulta de origem (${originLabel}) já tem um retorno vinculado.`);
  }

  if (todayFortaleza() > origin.lastDate) {
    warnings.push(
      `Fora do prazo: o retorno da consulta de ${originLabel} deveria ser até ${formatDateBR(origin.lastDate)} (prazo de ${deadlineDays} dias).`
    );
  }

  return { deadlineDays, origin, warnings };
}
