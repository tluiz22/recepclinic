import { cronRoute } from "../../../lib/cron/route";
import { runDailySummary } from "../../../lib/data/whatsapp/dailySummary";
import { dailySummarySender } from "../../../lib/data/whatsapp/send";

// Resumo do dia (F7; lembretes do cliente, 09/out/2026), a cada 5 minutos
// pelo agendador: para os profissionais e para a equipe, cada público na
// véspera ou no dia, no horário escolhido (Configurações › Lembretes); um
// envio só por dia.
const route = cronRoute("resumo-do-dia", async ({ clinicId, db, sender, now }) => {
  const send = sender ? dailySummarySender(sender) : async () => ({ sent: false as const, reason: "not_connected" });
  return {
    professional: await runDailySummary(db, clinicId, { audience: "professional", trigger: "scheduled", sender: send }, now),
    team: await runDailySummary(db, clinicId, { audience: "team", trigger: "scheduled", sender: send }, now),
  };
});

export const POST = route;
export const GET = route;
