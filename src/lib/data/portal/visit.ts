import { randomUUID } from "node:crypto";
import type { AstroGlobal } from "astro";
import { waitUntil } from "@vercel/functions";
import type { DbClient } from "../clients";
import { logError } from "../../log";
import {
  formatVisitCookie,
  isBot,
  parseVisitCookie,
  planVisit,
  stepNumber,
  VISIT_COOKIE,
  VISIT_TTL_MS,
  type StepCount,
  type VisitEntry,
  type VisitStepId,
} from "../../portalVisit";

/**
 * Anota o passo da visita anônima (U1). Não atrasa a página: a gravação roda depois da resposta (waitUntil) e, se
 * falhar, só aquele passo deixa de contar. Grava só quando o passo avança; o cookie é renovado a cada tela.
 * Chamar depois das conferências da tela: o passo conta o que de fato aconteceu (reserva ativa, consulta marcada).
 */
export function trackPortalStep(
  Astro: AstroGlobal,
  db: DbClient,
  clinicId: string,
  step: VisitStepId,
  entry: VisitEntry = "clinic",
  { fresh = false }: { fresh?: boolean } = {},
): void {
  try {
    if (isBot(Astro.request.headers.get("user-agent"))) return;
    // `fresh`: o link do WhatsApp sempre começa outra visita.
    const current = fresh ? null : parseVisitCookie(Astro.cookies.get(VISIT_COOKIE)?.value);
    const plan = planVisit(current, clinicId, stepNumber(step), entry, randomUUID);
    if (!plan) return;
    Astro.cookies.set(VISIT_COOKIE, formatVisitCookie(plan.cookie), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: Astro.url.protocol === "https:",
      expires: new Date(Date.now() + VISIT_TTL_MS),
    });
    if (!plan.write) return;
    const work = Promise.resolve(
      db.rpc("portal_visit_step", { p_visit_id: plan.cookie.id, p_entry: plan.cookie.entry, p_step: plan.cookie.furthest }),
    ).then(({ error }) => {
      if (error) logError("portal: passo da visita não gravou", error, { clinica: clinicId });
    });
    waitUntil(work.catch((error) => logError("portal: passo da visita não gravou", error, { clinica: clinicId })));
  } catch (error) {
    logError("portal: passo da visita não gravou", error, { clinica: clinicId });
  }
}

/** Visitas do período por entrada e passo mais longe (Métricas › Portal). */
export async function getVisitSteps(db: DbClient, clinicId: string, start: Date, end: Date): Promise<StepCount[]> {
  const { data, error } = await db.rpc("metrics_portal_steps", { p_clinic_id: clinicId, p_start: start.toISOString(), p_end: end.toISOString() });
  if (error) throw error;
  return (data ?? []).map((r: { entry: string; furthest: number; visits: number }) => ({
    entry: r.entry as VisitEntry,
    furthest: Number(r.furthest),
    visits: Number(r.visits),
  }));
}
