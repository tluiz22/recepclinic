import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";
import { conflictQuery, findExamWindowConflict } from "../../../../../../lib/scheduling/examWindowConflicts";

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;

  if (!id) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  const supabase = createClient(request, cookies);

  // Exame inativo não conta na regra de sobreposição; ao voltar, os horários
  // dele podem coincidir com os de um exame em grupo (ou ele mesmo ser grupo).
  const [{ data: exam }, { data: ownWindows }] = await Promise.all([
    supabase.from("exam_types").select("scheduling_mode").eq("id", id).maybeSingle(),
    supabase
      .from("exam_type_availability_windows")
      .select("weekday, start_time, end_time")
      .eq("exam_type_id", id)
      .eq("is_active", true),
  ]);

  if (!exam) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  let conflict;
  try {
    conflict = await findExamWindowConflict(supabase, {
      examTypeId: id,
      schedulingMode: exam.scheduling_mode,
      ignoreSameExam: true,
      windows: (ownWindows ?? []).map((window) => ({
        weekday: window.weekday,
        startTime: window.start_time.slice(0, 5),
        endTime: window.end_time.slice(0, 5),
      })),
    });
  } catch {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  if (conflict) {
    return redirect(`/admin/configuracoes/exames?show_inactive=1&${conflictQuery(conflict, "reactivate")}`);
  }

  const { error } = await supabase.from("exam_types").update({ is_active: true }).eq("id", id);

  if (error) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  return redirect("/admin/configuracoes/exames?show_inactive=1");
};
