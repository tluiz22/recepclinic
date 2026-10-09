import type { APIRoute } from "astro";
import { loadCronHeartbeats } from "../../../lib/data/platform";
import { checkCronJobs } from "../../../lib/health";
import { logError } from "../../../lib/log";

// Saúde do sistema para o monitor externo (F9.3, Better Stack): 200 quando o
// banco responde e todas as rotinas do agendador estão em dia; 503 quando não.
// Público e sem dados de clínica: só o nome e a situação de cada rotina.
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const GET: APIRoute = async () => {
  let beats;
  try {
    beats = await loadCronHeartbeats();
  } catch (error) {
    logError("saúde: banco não respondeu", error);
    return json(503, { ok: false, banco: "falhou" });
  }
  const checks = checkCronJobs(beats, new Date());
  const ok = checks.every((check) => check.ok);
  const rotinas = Object.fromEntries(
    checks.map((check) => [check.job, check.ok ? "ok" : check.lastFinishedAt ? `atrasada ${check.minutesLate} min` : "sem execução registrada"]),
  );
  return json(ok ? 200 : 503, { ok, banco: "ok", rotinas });
};
