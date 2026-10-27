import { cronRoute } from "../../../lib/cron/route";
import { pushContextFrom, runAttentionRoutine } from "../../../lib/data/whatsapp/attentionPush";
import { platformEnv } from "../../../lib/env";

// Atendimento humano (F8.5c): a cada 5 minutos, o lembrete do "#bot" das
// conversas paradas há 1 hora em atendimento e o resumo ao abrir o horário da
// recepção, para quem ativou as notificações. Sem as chaves, não faz nada.
const route = cronRoute("atendimento-humano", ({ clinicId, db, now }) =>
  runAttentionRoutine(db, clinicId, pushContextFrom(platformEnv().webPush, platformEnv().siteUrl), now),
);

export const POST = route;
export const GET = route;
