import type { APIRoute } from "astro";
import { createClient } from "../../../../lib/supabase/server";

// Busca de responsável (nome ou telefone) do "Cadastrar paciente" > "Já
// cadastrado" (Fase 21). Só responsáveis ativos.
export const GET: APIRoute = async ({ url, request, cookies }) => {
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
  }

  const supabase = createClient(request, cookies);
  const digits = q.replace(/\D/g, "");

  // Telefone é gravado só com dígitos (E.164), então "(84) 98188" busca
  // pelos dígitos; o resto vai por nome.
  const query =
    digits.length >= 4
      ? supabase.from("guardians").select("id, full_name, phone").eq("is_active", true).ilike("phone", `%${digits}%`)
      : supabase.from("guardians").select("id, full_name, phone").eq("is_active", true).ilike("full_name", `%${q}%`);

  const { data } = await query.order("full_name").limit(10);

  return new Response(JSON.stringify(data ?? []), { headers: { "Content-Type": "application/json" } });
};
