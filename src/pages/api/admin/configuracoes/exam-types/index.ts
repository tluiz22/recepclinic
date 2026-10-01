import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";
import { MAX_PREPARATION_LENGTH, normalizeMultilineText } from "../../../../../lib/whatsappFormat";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const name = formData.get("name")?.toString().trim();
  const durationMinutes = Number(formData.get("duration_minutes"));
  const price = formData.get("price")?.toString();
  const preparationInstructions =
    normalizeMultilineText(formData.get("preparation_instructions")?.toString() ?? "") || null;
  const schedulingModeRaw = formData.get("scheduling_mode")?.toString();
  const schedulingMode = schedulingModeRaw === "group" ? "group" : "individual";

  const priceCents = price ? Math.round(Number(price) * 100) : NaN;

  if (
    !name ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes < 1 ||
    !Number.isFinite(priceCents) ||
    (preparationInstructions?.length ?? 0) > MAX_PREPARATION_LENGTH
  ) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  const supabase = createClient(request, cookies);
  const { data: created, error } = await supabase
    .from("exam_types")
    .insert({
      name,
      duration_minutes: durationMinutes,
      price_cents: priceCents,
      preparation_instructions: preparationInstructions,
      scheduling_mode: schedulingMode,
    })
    .select("id")
    .single();

  if (error || !created) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  // Abre a tela do exame novo direto nos dias e horários — sem eles o exame
  // não aparece pra marcar.
  return redirect(`/admin/configuracoes/exames/${created.id}?novo=1#horarios`);
};
