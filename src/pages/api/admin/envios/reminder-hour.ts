import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";
import { REMINDER_HOUR_MAX, REMINDER_HOUR_MIN } from "../../../../lib/automaticSends";

// Horário do lembrete (Fase 22 · etapa 7), editado em Configurações › Envios
// automáticos (Fase 23 · etapa 2) — hora cheia de Fortaleza, das 7h às 20h.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const hour = Number(formData.get("reminder_hour")?.toString());

  if (!Number.isInteger(hour) || hour < REMINDER_HOUR_MIN || hour > REMINDER_HOUR_MAX) {
    return redirect("/admin/configuracoes/envios?horario=erro");
  }

  const supabase = createClient(request, cookies);
  const { error } = await supabase
    .from("appointment_settings")
    .update({ reminder_hour: hour, updated_at: new Date().toISOString() })
    .eq("id", 1);

  return redirect(`/admin/configuracoes/envios?horario=${error ? "erro" : "ok"}`);
};
