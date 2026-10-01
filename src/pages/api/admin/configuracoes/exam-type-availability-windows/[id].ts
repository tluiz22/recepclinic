import type { APIRoute } from "astro";
import { createClient } from "../../../../../lib/supabase/server";

export const POST: APIRoute = async ({ params, request, cookies, redirect }) => {
  const { id } = params;

  if (!id) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  const supabase = createClient(request, cookies);
  // Devolve o exame da janela removida pra voltar pra tela dele.
  const { data: removed, error } = await supabase
    .from("exam_type_availability_windows")
    .delete()
    .eq("id", id)
    .select("exam_type_id")
    .maybeSingle();

  if (error || !removed) {
    return redirect("/admin/configuracoes/exames?error=1");
  }

  return redirect(`/admin/configuracoes/exames/${removed.exam_type_id}#horarios`);
};
