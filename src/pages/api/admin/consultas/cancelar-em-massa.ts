import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { cancelAppointmentsInBulk } from "../../../../lib/scheduling/cancelAppointmentsInBulk";

// Cancelamento em massa de um dia (Fase 12): recebe a lista de
// `appointment_id`s selecionados na aba "Resumo do dia" de /admin/consultas
// e roda, pra cada um, a mesma rotina do cancelamento individual (trava
// atômica contra dupla ação, marca canceled) — mas com
// o motivo fixo ("imprevisto da médica") e um link de agendamento novo,
// pra facilitar a remarcação sem precisar escrever pro bot. Melhor esforço:
// uma falha isolada (link, notificação) não trava os demais.
// Rotina em `cancelAppointmentsInBulk` — compartilhada com o bloqueio de
// agenda (Fase 13 etapa 2), que reaproveita o mesmo cancelamento.
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const body = await request.json().catch(() => ({}));
  const appointmentIds = Array.isArray(body?.appointmentIds)
    ? body.appointmentIds.filter((id: unknown): id is string => typeof id === "string")
    : [];

  if (appointmentIds.length === 0) {
    return new Response(JSON.stringify({ error: "appointmentIds é obrigatório" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(request, cookies);
  const { canceled, skipped } = await cancelAppointmentsInBulk(supabase, appointmentIds, locals.userId ?? null, "mass_cancel");

  return new Response(JSON.stringify({ ok: true, canceled, skipped }), {
    headers: { "Content-Type": "application/json" },
  });
};
