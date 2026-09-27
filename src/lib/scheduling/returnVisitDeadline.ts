import type { SupabaseClient } from "@supabase/supabase-js";

function toFortalezaDate(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function todayFortaleza(): string {
  return toFortalezaDate(new Date().toISOString());
}

/**
 * Última data (YYYY-MM-DD, fuso de Fortaleza, inclusive) em que cabe o
 * retorno de uma Consulta feita em `originScheduledAt` (Fase 17).
 */
export function computeReturnVisitLastDate(originScheduledAt: string, deadlineDays: number): string {
  return addDays(toFortalezaDate(originScheduledAt), deadlineDays);
}

/**
 * Mesmo cálculo, buscando a Consulta de origem e o prazo configurado.
 * `null` quando o retorno não tem consulta de origem vinculada (links/
 * consultas anteriores à Fase 17) — sem limite nesse caso.
 */
export async function getReturnVisitLastDate(
  supabase: SupabaseClient,
  originAppointmentId: string | null | undefined
): Promise<string | null> {
  if (!originAppointmentId) return null;

  const [{ data: origin }, { data: settings }] = await Promise.all([
    supabase.from("appointments").select("scheduled_at").eq("id", originAppointmentId).maybeSingle(),
    supabase.from("appointment_settings").select("return_visit_deadline_days").eq("id", 1).single(),
  ]);

  if (!origin || !settings) return null;

  return computeReturnVisitLastDate(origin.scheduled_at, settings.return_visit_deadline_days);
}

/**
 * Limite de datas de um link de agendar/remarcar (`booking_links`): só
 * retorno vinculado a uma Consulta tem limite, e o link de reagendamento
 * gerado pela clínica (cancelamento em massa/bloqueio) dispensa o prazo.
 */
export async function getBookingLinkLastDate(
  supabase: SupabaseClient,
  link: { appointment_type: string; origin_appointment_id: string | null; return_deadline_waived: boolean }
): Promise<string | null> {
  if (link.appointment_type !== "return_visit" || link.return_deadline_waived) return null;
  return getReturnVisitLastDate(supabase, link.origin_appointment_id);
}

/**
 * Se a Consulta de origem já tem um retorno não cancelado vinculado (regra
 * "1 retorno por consulta", Fase 17). `ignoreAppointmentId` exclui o
 * próprio retorno sendo remarcado.
 */
export async function hasActiveReturnVisit(
  supabase: SupabaseClient,
  originAppointmentId: string,
  ignoreAppointmentId?: string | null
): Promise<boolean> {
  let query = supabase
    .from("appointments")
    .select("id")
    .eq("origin_appointment_id", originAppointmentId)
    .neq("status", "canceled");
  if (ignoreAppointmentId) query = query.neq("id", ignoreAppointmentId);

  const { data } = await query.limit(1);
  return !!data?.length;
}
