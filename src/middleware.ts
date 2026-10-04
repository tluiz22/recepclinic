import { defineMiddleware } from "astro:middleware";
import { platformEnv } from "./lib/env";
import { createClient } from "./lib/supabase/server";

// Fase 14: telas (e APIs) só da médica — as de métricas (Relatórios e
// Métricas do WhatsApp, Fase 15). Todo o resto do admin, incluindo
// Configurações, é compartilhado com a secretária (decisão do cliente ao
// validar a etapa 1).
const MEDICA_ONLY_PREFIXES = ["/admin/relatorios", "/admin/metricas"];

const isMedicaOnlyPath = (pathname: string) =>
  MEDICA_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request, cookies, redirect } = context;

  // Páginas geradas no build (404) não precisam das variáveis do servidor.
  if (!context.isPrerendered) {
    try {
      platformEnv();
    } catch (error) {
      console.error(error);
      return new Response("Sistema mal configurado. Avise o suporte.", { status: 500 });
    }
  }

  const isAdminPath = url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/admin");
  const isPublicAdminPath =
    url.pathname === "/admin/login" || url.pathname === "/api/admin/auth/login";

  if (!isAdminPath || isPublicAdminPath) {
    return next();
  }

  const supabase = createClient(request, cookies);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/admin/login");
  }

  // Login de quem está usando a tela — gravado como autor ao marcar,
  // remarcar e cancelar (Fase 17).
  context.locals.userId = user.id;

  // Login sem linha em `staff_profiles` é tratado como secretária (acesso
  // restrito por padrão — decisão do cliente, Fase 14).
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  const role = profile?.role === "medica" ? "medica" : "secretaria";
  context.locals.role = role;

  if (role !== "medica" && isMedicaOnlyPath(url.pathname)) {
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return redirect("/admin/dashboard?aviso=acesso_negado");
  }

  return next();
});
