import { defineMiddleware, sequence } from "astro:middleware";
import { ACTIVE_CLINIC_COOKIE, activeClinicCookieOptions, canAccessPath, expectsPage } from "./lib/clinicAccess";
import { createUserClient } from "./lib/data/clients";
import { isPlatformStaff } from "./lib/data/clinicChoice";
import { loadClinicContext, logPlatformAccess } from "./lib/data/clinicContext";
import { platformEnv } from "./lib/env";
import { withSecurityHeaders } from "./lib/securityHeaders";
import { logError } from "./lib/log";

// Painel (/admin e /api/admin): login, clínica ativa, papéis e agendas da
// pessoa (F3.2, D6). O banco (RLS) confere de novo cada leitura e escrita.

// Sem login: entrar, recuperar a senha e o link dos e-mails (F4.1).
const PUBLIC_ADMIN_PATHS = new Set([
  "/admin/login",
  "/admin/esqueci-senha",
  "/api/admin/auth/login",
  "/api/admin/auth/recuperar",
  "/api/admin/auth/confirmar",
]);

// Funcionam com login mas sem clínica ativa: sair, escolher a clínica e criar
// a senha depois do convite ou da recuperação.
const PATHS_WITHOUT_CLINIC = new Set([
  "/api/admin/auth/logout",
  "/api/admin/clinica-ativa",
  "/admin/escolher-clinica",
  "/admin/nova-senha",
  "/api/admin/auth/nova-senha",
]);

// Administração do sistema (F4.2, matriz de acesso): só o Suporte, sem
// clínica ativa (vale para todas).
const PLATFORM_PREFIXES = ["/admin/sistema", "/api/admin/sistema"];
const isPlatformPath = (pathname: string) => PLATFORM_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const json = (status: number, body: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const access = defineMiddleware(async (context, next) => {
  const { url, request, cookies, redirect } = context;

  // Páginas geradas no build (a 404, inclusive de /admin e /api/admin
  // inexistentes) não têm login, cookies nem variáveis do servidor.
  if (context.isPrerendered) return next();

  try {
    platformEnv();
  } catch (error) {
    logError("configuração", error);
    return new Response("Sistema mal configurado. Avise o suporte.", { status: 500 });
  }

  const isAdminPath = url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/admin");
  if (!isAdminPath || PUBLIC_ADMIN_PATHS.has(url.pathname)) {
    return next();
  }
  // Formulário enviado pelo navegador a uma rota /api: os erros de acesso
  // levam a uma página com aviso, como nas telas.
  const isApi = url.pathname.startsWith("/api/") && !expectsPage(request);

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

  if (isPlatformPath(url.pathname)) {
    let staff = false;
    try {
      staff = await isPlatformStaff(db, user.id);
    } catch (error) {
      logError("painel", error, { caminho: url.pathname });
      return isApi ? json(500, { error: "context_unavailable" }) : new Response("Erro ao abrir o painel.", { status: 500 });
    }
    if (!staff) return isApi ? json(403, { error: "forbidden" }) : redirect("/admin/dashboard?aviso=acesso_negado");
    return next();
  }

  let result;
  try {
    result = await loadClinicContext(db, user.id, cookies.get(ACTIVE_CLINIC_COOKIE)?.value);
  } catch (error) {
    logError("painel", error, { caminho: url.pathname });
    return isApi ? json(500, { error: "context_unavailable" }) : new Response("Erro ao abrir o painel.", { status: 500 });
  }

  // Sem papel em nenhuma clínica (D6: sem papel = sem acesso).
  if (result.status === "no_access") {
    await db.auth.signOut();
    return isApi ? json(403, { error: "no_clinic_access" }) : redirect("/admin/login?error=sem_acesso");
  }

  // Suporte sem clínica escolhida.
  if (result.status === "choose_clinic") {
    return isApi ? json(409, { error: "choose_clinic" }) : redirect("/admin/escolher-clinica");
  }

  const { context: clinic } = result;
  if (!result.remembered) {
    cookies.set(ACTIVE_CLINIC_COOKIE, clinic.clinicId, activeClinicCookieOptions(url));
  }

  if (!canAccessPath(clinic, url.pathname, url.searchParams)) {
    return isApi ? json(403, { error: "forbidden" }) : redirect("/admin/dashboard?aviso=acesso_negado");
  }

  // Toda leitura do Suporte fica registrada (D6); sem o registro, não responde.
  if (clinic.isPlatformStaff) {
    try {
      await logPlatformAccess(db, clinic.clinicId, request.method, `${url.pathname}${url.search}`.slice(0, 2048));
    } catch (error) {
      logError("painel", error, { caminho: url.pathname });
      return isApi ? json(500, { error: "access_log_failed" }) : new Response("Erro ao registrar o acesso.", { status: 500 });
    }
  }

  context.locals.clinic = clinic;
  return next();
});

// Cabeçalhos de segurança em toda resposta do servidor, inclusive nos
// redirecionamentos e erros do controle de acesso (F9.1).
const securityHeaders = defineMiddleware(async (_context, next) => withSecurityHeaders(await next()));

export const onRequest = sequence(securityHeaders, access);
