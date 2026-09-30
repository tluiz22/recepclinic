import type { APIRoute } from "astro";
import { createClient } from "../../../../../../lib/supabase/server";

// Fase 13 etapa 3: remove um bloqueio. Desde a Fase 20 a linha não é
// apagada — só marcada como removida (histórico), e deixa de ocupar a agenda.
export const POST: APIRoute = async ({ params, request, cookies, locals, redirect }) => {
  const { id } = params;
  if (id) {
    const supabase = createClient(request, cookies);
    const { error } = await supabase
      .from("schedule_blocks")
      .update({ removed_at: new Date().toISOString(), removed_by: locals.userId ?? null })
      .eq("id", id)
      .is("removed_at", null);

    if (error) console.error("[bloqueio] erro ao remover:", error);
  }
  return redirect("/admin/agenda/bloqueios");
};
