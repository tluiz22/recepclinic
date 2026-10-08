import { cronRoute } from "../../../lib/cron/route";
import { runAppointmentReminders } from "../../../lib/data/whatsapp/reminders";
import { reminderSender } from "../../../lib/data/whatsapp/send";

// Lembrete da véspera e reenvio automático (F7), de hora em hora pelo
// agendador: cada clínica na própria hora do lembrete (Configurações ›
// WhatsApp); sem o WhatsApp conectado, a trilha registra "não enviado".
const route = cronRoute("lembretes", ({ clinicId, db, sender, now }) =>
  runAppointmentReminders(
    db,
    clinicId,
    { trigger: "scheduled", sender: sender ? reminderSender(sender) : async () => ({ sent: false, reason: "not_connected" }) },
    now,
  ),
);

export const POST = route;
export const GET = route;
