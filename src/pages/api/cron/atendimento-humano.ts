import { cronRoute } from "../../../lib/cron/route";
import { pushContextFrom, runAttentionRoutine } from "../../../lib/data/whatsapp/attentionPush";
import { returnDueConversations } from "../../../lib/data/whatsapp/handoffReturn";
import { releaseIdleConversations } from "../../../lib/data/centralSend";
import { logError } from "../../../lib/log";
import { platformEnv } from "../../../lib/env";

// Atendimento humano (F8.5c): a cada 5 minutos, a volta ao bot, em silêncio,
// das conversas "Em atendimento" há 12 h sem mensagem
// (CA, cliente, 04/nov/2026), o lembrete do "#bot" das conversas paradas há 1 hora em
// atendimento e o resumo ao abrir o horário da recepção, para quem ativou as
// notificações. Sem as chaves, as notificações não saem. Com a Central (CN4b; decisão 5 e R1, cliente, 05/nov/2026):
// a conversa com o paciente esperando 30 min sem resposta, no horário da clínica, volta para "Sem responsável".
const route = cronRoute("atendimento-humano", async ({ clinicId, db, now }) => {
  const returned = await returnDueConversations(db, clinicId, now);
  const released = await releaseIdleConversations(db, clinicId).catch((error) => {
    logError("central: liberação em 30 min", error, { clinica: clinicId });
    return 0;
  });
  const push = await runAttentionRoutine(db, clinicId, pushContextFrom(platformEnv().webPush, platformEnv().siteUrl), now);
  return { returned, released, ...push };
});

export const POST = route;
export const GET = route;
