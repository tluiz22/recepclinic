import { cronRoute } from "../../../lib/cron/route";
import { runDailySummary } from "../../../lib/data/whatsapp/dailySummary";
import { dailySummarySender } from "../../../lib/data/whatsapp/send";

// Resumo do dia para a equipe (F7), a cada 5 minutos pelo agendador: o da
// véspera na hora da clínica e o do dia as horas escolhidas antes da primeira
// agenda (Configurações › WhatsApp); cada um sai uma vez.
const route = cronRoute("resumo-do-dia", async ({ clinicId, db, sender, now }) => {
  const send = sender ? dailySummarySender(sender) : async () => ({ sent: false as const, reason: "not_connected" });
  return {
    preview: await runDailySummary(db, clinicId, { variant: "preview", trigger: "scheduled", sender: send }, now),
    final: await runDailySummary(db, clinicId, { variant: "final", trigger: "scheduled", sender: send }, now),
  };
});

export const POST = route;
export const GET = route;
