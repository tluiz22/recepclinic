import { defineMiddleware } from "astro:middleware";
import { ACTIVE_CLINIC_COOKIE, activeClinicCookieOptions, areaOfPath, canAccessArea } from "./lib/clinicAccess";
import { createUserClient } from "./lib/data/clients";
import { loadClinicContext, logPlatformAccess } from "./lib/data/clinicContext";
import { platformEnv } from "./lib/env";

// Painel (/admin e /api/admin): login, clínica ativa, papéis e agendas da
// pessoa (F3.2, D6). O banco (RLS) confere de novo cada leitura e escrita.

const PUBLIC_ADMIN_PATHS = new Set(["/admin/login", "/api/admin/auth/login"]);

// Funcionam com login mas sem clínica ativa: sair e escolher a clínica.
const PATHS_WITHOUT_CLINIC = new Set(["/api/admin/auth/logout", "/api/admin/clinica-ativa"]);

const json = (status: number, body: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request, cookies, redirect } = context;

  // Páginas geradas no build (a 404, inclusive de /admin e /api/admin
  // inexistentes) não têm login, cookies nem variáveis do servidor.
  if (context.isPrerendered) return next();

  try {
    platformEnv();
  } catch (error) {
    console.error(error);
    return new Response("Sistema mal configurado. Avise o suporte.", { status: 500 });
  }

  const isAdminPath = url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/admin");
  if (!isAdminPath || PUBLIC_ADMIN_PATHS.has(url.pathname)) {
    return next();
  }
  const isApi = url.pathname.startsWith("/api/");

  const db = createUserClient(request, cookies);
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return isApi ? json(401, { error: "unauthenticated" }) : redirect("/admin/login");
  }

  // Login de quem está usando a tela — gravado como autor ao marcar,
  // remarcar e cancelar (Fase 17).
  context.locals.userId = user.id;

  if (PATHS_WITHOUT_CLINIC.has(url.pathname)) {
    return next();
  }

  let result;
  try {
    result = await loadClinicContext(db, user.id, cookies.get(ACTIVE_CLINIC_COOKIE)?.value);
  } catch (error) {
    console.error(error);
    return isApi ? json(500, { error: "context_unavailable" }) : new Response("Erro ao abrir o painel.", { status: 500 });
  }

  // Sem papel em nenhuma clínica (D6: sem papel = sem acesso).
  if (result.status === "no_access") {
    await db.auth.signOut();
    return isApi ? json(403, { error: "no_clinic_access" }) : redirect("/admin/login?error=sem_acesso");
  }

  // Suporte sem clínica escolhida. A tela de escolha vem na F4; até lá, a
  // clínica é escolhida por POST em /api/admin/clinica-ativa.
  if (result.status === "choose_clinic") {
    return isApi
      ? json(409, { error: "choose_clinic" })
      : new Response("Escolha a clínica em /api/admin/clinica-ativa.", { status: 409 });
  }

  const { context: clinic } = result;
  if (!result.remembered) {
    cookies.set(ACTIVE_CLINIC_COOKIE, clinic.clinicId, activeClinicCookieOptions(url));
  }

  if (!canAccessArea(clinic, areaOfPath(url.pathname))) {
    return isApi ? json(403, { error: "forbidden" }) : redirect("/admin/dashboard?aviso=acesso_negado");
  }

  // Toda leitura do Suporte fica registrada (D6); sem o registro, não responde.
  if (clinic.isPlatformStaff) {
    try {
      await logPlatformAccess(db, clinic.clinicId, request.method, `${url.pathname}${url.search}`.slice(0, 2048));
    } catch (error) {
      console.error(error);
      return isApi ? json(500, { error: "access_log_failed" }) : new Response("Erro ao registrar o acesso.", { status: 500 });
    }
  }

  context.locals.clinic = clinic;
  return next();
});
