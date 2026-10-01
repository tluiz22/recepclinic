import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";
import { conflictQuery, findExamWindowConflict } from "../../../../../lib/scheduling/examWindowConflicts";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const examTypeId = formData.get("exam_type_id")?.toString();
  const weekday = formData.get("weekday")?.toString();
  const startTime = formData.get("start_time")?.toString();
  const endTime = formData.get("end_time")?.toString();
  const capacityRaw = formData.get("capacity")?.toString();

  if (!examTypeId) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  // Os dias e horários são cadastrados na própria tela do exame — volta pra
  // ela, já na seção de horários, com o erro (se houver).
  const examPage = (error?: string, query = error ? `error=${error}` : "") =>
    `/admin/configuracoes/exames/${examTypeId}${query ? `?${query}` : ""}#horarios`;

  if (!weekday || !startTime || !endTime) {
    return redirect(examPage("window"));
  }

  if (startTime >= endTime) {
    return redirect(examPage("invalid_range"));
  }

  const supabase = createClient(request, cookies);

  const { data: examType, error: examTypeError } = await supabase
    .from("exam_types")
    .select("scheduling_mode")
    .eq("id", examTypeId)
    .maybeSingle();

  if (examTypeError || !examType) {
    return redirect(examPage("window"));
  }

  // Vagas só existe (e é obrigatório) pra exame em modo grupo — o campo vem
  // desabilitado na tela pra exame individual, então nem chega no formData.
  const isGroup = examType.scheduling_mode === "group";
  const capacity = capacityRaw ? Number(capacityRaw) : NaN;

  if (isGroup && (!Number.isFinite(capacity) || capacity < 1)) {
    return redirect(examPage("window"));
  }

  // Exames individuais podem dividir horário; o mesmo exame consigo mesmo e
  // exame em grupo com qualquer outro, não (ver `findExamWindowConflict`).
  let conflict;
  try {
    conflict = await findExamWindowConflict(supabase, {
      examTypeId,
      schedulingMode: examType.scheduling_mode,
      windows: [{ weekday: Number(weekday), startTime, endTime }],
    });
  } catch {
    return redirect(examPage("window"));
  }

  if (conflict) {
    return redirect(examPage(undefined, conflictQuery(conflict, "add")));
  }

  const { error } = await supabase.from("exam_type_availability_windows").insert({
    exam_type_id: examTypeId,
    weekday: Number(weekday),
    start_time: startTime,
    end_time: endTime,
    capacity: isGroup ? capacity : null,
  });

  if (error) {
    return redirect(examPage("window"));
  }

  return redirect(examPage());
};
