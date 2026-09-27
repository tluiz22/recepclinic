import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { getReturnOriginCheck } from "../../../../lib/scheduling/returnVisitEligibility";

// Consulta de origem + avisos de um retorno (Fase 17), para as telas
// Marcar/Remarcar. `appointment_id` = retorno sendo remarcado.
export const GET: APIRoute = async ({ url, request, cookies }) => {
  const patientId = url.searchParams.get("patient_id");
  const appointmentId = url.searchParams.get("appointment_id");

  if (!patientId) {
    return new Response(JSON.stringify({ error: "patient_id é obrigatório" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(request, cookies);

  let originAppointmentId: string | null = null;
  if (appointmentId) {
    const { data: appointment } = await supabase
      .from("appointments")
      .select("origin_appointment_id")
      .eq("id", appointmentId)
      .maybeSingle();
    originAppointmentId = appointment?.origin_appointment_id ?? null;
  }

  const check = await getReturnOriginCheck(supabase, {
    patientId,
    originAppointmentId,
    ignoreAppointmentId: appointmentId,
  });

  return new Response(JSON.stringify(check), { headers: { "Content-Type": "application/json" } });
};
