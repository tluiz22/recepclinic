import { cronRoute } from "../../../lib/cron/route";
import { runSendRetries } from "../../../lib/data/whatsapp/retries";

// Reenvio automático dos envios com falha técnica (cliente, 23/out/2026), de
// minuto em minuto pelo agendador: as tentativas previstas (10 e 30 minutos
// depois da primeira falha) saem pelo WhatsApp de cada clínica.
const route = cronRoute("reenvios", ({ clinicId, db, sender, now }) => runSendRetries(db, clinicId, sender, now));

export const POST = route;
export const GET = route;
