import type { APIRoute } from "astro";
import { platformEnv } from "../../../lib/env";

// Saúde do webhook do WhatsApp para o monitor externo (F9.3): o próprio
// /api/whatsapp/webhook recusa (403) quem não é a Meta, e o Better Stack não
// aceita 403 como sucesso. Aqui: 200 com o webhook pronto para receber (App
// Secret e token de verificação configurados), 503 quando falta algum. Roda na
// mesma função do webhook. Sem segredo na resposta.
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const GET: APIRoute = () => {
  let configured = false;
  try {
    configured = platformEnv().whatsapp !== null;
  } catch {
    configured = false;
  }
  return json(configured ? 200 : 503, { ok: configured, webhook: configured ? "configurado" : "sem configuração do app da Meta" });
};
