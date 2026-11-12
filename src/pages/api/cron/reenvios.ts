import { cronRoute } from "../../../lib/cron/route";
import { runNoticeQueue } from "../../../lib/data/whatsapp/noticeQueue";
import { runSendRetries } from "../../../lib/data/whatsapp/retries";

// Reenvio automático dos envios com falha técnica (cliente, 23/out/2026), de
// minuto em minuto pelo agendador: as tentativas previstas (10 e 30 minutos
// depois da primeira falha) saem pelo WhatsApp de cada clínica. F2c: também a
// fila dos avisos (confirmação do portal que não saiu na hora).
const route = cronRoute("reenvios", async ({ clinicId, db, sender, now }) => ({
  retries: await runSendRetries(db, clinicId, sender, now),
  queue: await runNoticeQueue(db, clinicId, sender, now),
}));

export const POST = route;
export const GET = route;
