import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";
import { resendPreparation } from "../../../../../../lib/preparationResend";

// Botão "Reenviar preparo do exame" (ajuste de 02/out/2026), da Agenda (dia;
// a tela Envios perdeu os botões na Fase 23): volta pra tela de onde veio (`return_to`)
// com o resultado em `?preparo=`.
export const POST: APIRoute = async ({ params, request, cookies, locals, redirect }) => {
  const { id } = params;
  const formData = await request.formData();
  const returnToRaw = formData.get("return_to")?.toString() ?? "";
  // Só caminhos internos do admin — evita redirecionar pra fora.
  const returnTo = returnToRaw.startsWith("/admin/") && !returnToRaw.startsWith("//") ? returnToRaw : "/admin/agenda";
  const withOutcome = (outcome: string) => `${returnTo}${returnTo.includes("?") ? "&" : "?"}preparo=${outcome}`;

  if (!id) return redirect(withOutcome("not_eligible"));

  const supabase = createClient(request, cookies);
  const outcome = await resendPreparation(supabase, id, locals.userId ?? null);
  return redirect(withOutcome(outcome));
};
