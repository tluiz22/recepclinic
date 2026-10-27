import type { APIRoute } from "astro";
import { createUserClient } from "../../../lib/data/clients";
import { DataError } from "../../../lib/data/errors";
import { deviceLabel, pushContextFrom, removeMySubscription, saveMySubscription, sendTestToMe } from "../../../lib/data/whatsapp/attentionPush";
import { platformEnv } from "../../../lib/env";
import { logError } from "../../../lib/log";

// Notificações do atendimento humano neste aparelho (F8.5c): a tela chama por
// código (fetch, JSON). Toda a equipe da clínica com o bot; cada pessoa só mexe
// nos próprios aparelhos (o banco confere).
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const clinic = locals.clinic!;
  if (!clinic.features.includes("whatsapp_bot")) return json(403, { error: "Notificações só com o bot de WhatsApp liberado." });
  const push = pushContextFrom(platformEnv().webPush, platformEnv().siteUrl);
  if (!push) return json(409, { error: "As notificações ainda não estão ligadas no sistema. Fale com o suporte do RecepClinic." });

  const body = (await request.json().catch(() => null)) as {
    acao?: string;
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    endpoint?: string;
  } | null;
  const db = createUserClient(request, cookies);
  try {
    switch (body?.acao) {
      case "ativar": {
        const sub = body.subscription;
        await saveMySubscription(
          db,
          clinic.clinicId,
          clinic.userId,
          { endpoint: sub?.endpoint ?? "", p256dh: sub?.keys?.p256dh ?? "", auth: sub?.keys?.auth ?? "" },
          deviceLabel(request.headers.get("user-agent")),
        );
        return json(200, { ok: true });
      }
      case "desativar":
        await removeMySubscription(db, clinic.clinicId, body.endpoint ?? "");
        return json(200, { ok: true });
      case "testar": {
        const sent = await sendTestToMe(db, clinic.clinicId, clinic.userId, push);
        return json(200, { ok: true, sent });
      }
      default:
        return json(400, { error: "Ação desconhecida." });
    }
  } catch (error) {
    if (error instanceof DataError) return json(400, { error: error.message });
    logError("notificações: aparelho", error, { clinica: clinic.clinicId });
    return json(500, { error: "Falha do sistema, já registrada para o suporte. Tente de novo em instantes." });
  }
};
