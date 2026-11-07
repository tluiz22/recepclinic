import { cronRoute } from "../../../lib/cron/route";
import { applyConversationRetention } from "../../../lib/data/whatsapp/media";

// Prazo de guarda das conversas (CN7; decisão 8, cliente, 05/nov/2026): uma vez por dia, o texto das mensagens com
// mais de 5 anos fica nulo e o anexo com mais de 12 meses fica "apagado" (o arquivo sai na rotina de cada minuto).
// Em todas as clínicas: a Central pode ter sido desligada depois de guardar.
const route = cronRoute("guarda-conversas", ({ clinicId, db, now }) => applyConversationRetention(db, clinicId, now));

export const POST = route;
export const GET = route;
