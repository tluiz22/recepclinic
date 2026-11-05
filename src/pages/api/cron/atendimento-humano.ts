import { cronRoute } from "../../../lib/cron/route";
import { pushContextFrom, runAttentionRoutine } from "../../../lib/data/whatsapp/attentionPush";
import { returnDueConversations } from "../../../lib/data/whatsapp/handoffReturn";
import { platformEnv } from "../../../lib/env";

// Atendimento humano (F8.5c): a cada 5 minutos, a volta ao bot, em silêncio,
// das conversas "Em atendimento" há 12 h sem mensagem
// (CA, cliente, 04/nov/2026), o lembrete do "#bot" das conversas paradas há 1 hora em
// atendimento e o resumo ao abrir o horário da recepção, para quem ativou as
// notificações. Sem as chaves, as notificações não saem.
const route = cronRoute("atendimento-humano", async ({ clinicId, db, now }) => {
  const returned = await returnDueConversations(db, clinicId, now);
  const push = await runAttentionRoutine(db, clinicId, pushContextFrom(platformEnv().webPush, platformEnv().siteUrl), now);
  return { returned, ...push };
});

export const POST = route;
export const GET = route;
