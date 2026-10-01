import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";
import { conflictQuery, findExamWindowConflict } from "../../../../../lib/scheduling/examWindowConflicts";
import { MAX_PREPARATION_LENGTH, normalizeMultilineText } from "../../../../../lib/whatsappFormat";

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
  const name = formData.get("name")?.toString().trim();
  const durationMinutes = Number(formData.get("duration_minutes"));
  const price = formData.get("price")?.toString();
  const preparationInstructions =
    normalizeMultilineText(formData.get("preparation_instructions")?.toString() ?? "") || null;
  const schedulingModeRaw = formData.get("scheduling_mode")?.toString();
  const schedulingMode = schedulingModeRaw === "group" ? "group" : "individual";

  const priceCents = price ? Math.round(Number(price) * 100) : NaN;

  if (!id) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  if (
    !name ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes < 1 ||
    !Number.isFinite(priceCents) ||
    (preparationInstructions?.length ?? 0) > MAX_PREPARATION_LENGTH
  ) {
    return redirect(`/admin/configuracoes/exames/${id}?error=1`);
  }

  const supabase = createClient(request, cookies);

  // Exame em grupo não pode dividir horário com outro exame: quem já divide
  // (permitido entre individuais) não pode virar grupo sem ajustar antes.
  if (schedulingMode === "group") {
    const { data: ownWindows, error: windowsError } = await supabase
      .from("exam_type_availability_windows")
      .select("weekday, start_time, end_time")
      .eq("exam_type_id", id)
      .eq("is_active", true);

    if (windowsError) {
      return redirect(`/admin/configuracoes/exames/${id}?error=1`);
    }

    let conflict;
    try {
      conflict = await findExamWindowConflict(supabase, {
        examTypeId: id,
        schedulingMode,
        ignoreSameExam: true,
        windows: (ownWindows ?? []).map((window) => ({
          weekday: window.weekday,
          startTime: window.start_time.slice(0, 5),
          endTime: window.end_time.slice(0, 5),
        })),
      });
    } catch {
      return redirect(`/admin/configuracoes/exames/${id}?error=1`);
    }

    if (conflict) {
      return redirect(`/admin/configuracoes/exames/${id}?${conflictQuery(conflict, "mode")}`);
    }
  }

  const { error } = await supabase
    .from("exam_types")
    .update({
      name,
      duration_minutes: durationMinutes,
      price_cents: priceCents,
      preparation_instructions: preparationInstructions,
      scheduling_mode: schedulingMode,
    })
    .eq("id", id);

  if (error) {
    return redirect(`/admin/configuracoes/exames/${id}?error=1`);
  }

  return redirect("/admin/configuracoes/exames");
};
