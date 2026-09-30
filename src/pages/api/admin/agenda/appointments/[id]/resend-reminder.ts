import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";
import { resendReminder } from "../../../../../../lib/reminderResend";

// Botão "Reenviar lembrete" (Fase 22 · etapa 6), da Agenda (dia) e da tela
// Envios automáticos: volta pra tela de onde veio (`return_to`) com o
// resultado em `?reenvio=`.
export const POST: APIRoute = async ({ params, request, cookies, locals, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
  const returnToRaw = formData.get("return_to")?.toString() ?? "";
  // Só caminhos internos do admin — evita redirecionar pra fora.
  const returnTo = returnToRaw.startsWith("/admin/") && !returnToRaw.startsWith("//") ? returnToRaw : "/admin/agenda";
  const withOutcome = (outcome: string) => `${returnTo}${returnTo.includes("?") ? "&" : "?"}reenvio=${outcome}`;

  if (!id) return redirect(withOutcome("not_eligible"));

  const supabase = createClient(request, cookies);
  const outcome = await resendReminder(supabase, id, locals.userId ?? null);
  return redirect(withOutcome(outcome));
};
