import { cronRoute } from "../../../lib/cron/route";
import { processWaitlist } from "../../../lib/data/waitlist/offers";
import { waitlistOfferSender } from "../../../lib/data/whatsapp/send";

// Lista de espera (F7), a cada 5 minutos pelo agendador: vence as ofertas sem
// resposta e oferece as vagas abertas ao primeiro da fila. Sem o WhatsApp
// conectado, ninguém recebe (a pessoa é pulada nessa vaga).
const route = cronRoute("lista-de-espera", ({ clinicId, db, sender, now }) =>
  processWaitlist(db, clinicId, sender ? waitlistOfferSender(sender, db) : async () => ({ sent: false, reason: "not_connected" }), now),
);

export const POST = route;
export const GET = route;
