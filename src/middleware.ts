import { defineMiddleware } from "astro:middleware";
import { createClient } from "./lib/supabase/server";

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request, cookies, redirect } = context;

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

  return next();
});
