import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";
import { logAppointmentEvent } from "../../../../../lib/audit";

export const POST: APIRoute = async ({ params, request, cookies, redirect, locals }) => {
  const { id } = params;
  const formData = await request.formData();
  const status = formData.get("status")?.toString();
  const tab = formData.get("tab")?.toString() === "confirmadas" ? "confirmadas" : "pendentes";
  const page = formData.get("page")?.toString();
  const pageParam = tab === "confirmadas" && page ? `&page=${page}` : "";

  if (!id || (status !== "completed" && status !== "no_show")) {
    return redirect(`/admin/consultas?tab=${tab}${pageParam}&error=1`);
  }

  const supabase = createClient(request, cookies);

  // Status anterior, pra trilha (Fase 22) separar "registrado" de "corrigido".
  const { data: before } = await supabase.from("appointments").select("status").eq("id", id).maybeSingle();

  const { error } = await supabase.from("appointments").update({ status }).eq("id", id);

  if (error) {
    return redirect(`/admin/consultas?tab=${tab}${pageParam}&error=1`);
  }

  if (before && before.status !== status) {
    const isCorrection = before.status === "completed" || before.status === "no_show";
    await logAppointmentEvent(supabase, {
      appointmentId: id,
      type: isCorrection ? "attendance_corrected" : "attendance_recorded",
      channel: "admin",
      actorId: locals.userId ?? null,
      details: isCorrection ? { from: before.status, to: status } : { status },
    });
  }

  return redirect(`/admin/consultas?tab=${tab}${pageParam}`);
};
