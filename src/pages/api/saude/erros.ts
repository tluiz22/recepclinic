import type { APIRoute } from "astro";
import { countSystemErrorsSince } from "../../../lib/data/platform";
import { RECENT_ERRORS_MINUTES } from "../../../lib/health";
import { logError } from "../../../lib/log";

// Aviso de erros para o monitor externo (F9.3): 503 enquanto houver erro
// gravado nos últimos 15 minutos (o monitor manda o e-mail; o Suporte vê qual
// em Administração do sistema › Erros); volta a 200 sozinho. Só a contagem.
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const GET: APIRoute = async () => {
  try {
    const recent = await countSystemErrorsSince(new Date(Date.now() - RECENT_ERRORS_MINUTES * 60_000));
    return json(recent ? 503 : 200, { ok: !recent, erros_ultimos_minutos: recent, minutos: RECENT_ERRORS_MINUTES });
  } catch (error) {
    logError("saúde: banco não respondeu", error);
    return json(503, { ok: false, banco: "falhou" });
  }
};
