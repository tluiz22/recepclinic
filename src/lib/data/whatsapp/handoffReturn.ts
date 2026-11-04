import type { DbClient } from "../clients";
import { hasFeature } from "../features";
import { logError } from "../../log";
import { listHumanAttention, type AttentionItem } from "./attention";
import { HANDOFF_CLOSED } from "./bot/texts";
import { returnToBot } from "./conversations";
import { recordOutboundMessage } from "./messages";
import type { ClinicSender } from "./send";

// Volta ao bot depois do atendimento da clínica (C20; cliente, 03/nov/2026;
// desfaz a C10, em que a conversa não voltava sozinha). Conversa "Em
// atendimento" (a clínica respondeu e o paciente não escreveu depois) há 12 h
// desde a última resposta da clínica volta ao bot, do começo. Paciente
// esperando resposta ("Aguardando a clínica") continua com a clínica.
//
// Ao voltar, o paciente recebe a mensagem de encerramento, em texto livre: a
// Meta só aceita texto sem template até 24 h depois da última mensagem do
// paciente. Passou disso, a conversa volta calada (sem template).

export const HANDOFF_RETURN_HOURS = 12;
/** Janela de atendimento da Meta: texto livre só até 24 h depois da última mensagem do paciente. */
export const SERVICE_WINDOW_HOURS = 24;

const HOUR = 60 * 60_000;

/** A conversa já pode voltar ao bot: a clínica respondeu e 12 h passaram sem o paciente escrever. */
export function isDueToReturn(item: Pick<AttentionItem, "status" | "lastAgentAt">, now: Date): boolean {
  return item.status === "in_progress" && !!item.lastAgentAt && now.getTime() - item.lastAgentAt.getTime() >= HANDOFF_RETURN_HOURS * HOUR;
}

/** Dá para mandar a mensagem de encerramento sem template (dentro da janela da Meta). */
export function canSendFreeText(lastPatientAt: Date | null, now: Date): boolean {
  return !!lastPatientAt && now.getTime() - lastPatientAt.getTime() < SERVICE_WINDOW_HOURS * HOUR;
}

/**
 * Rotina (a cada 5 minutos, com a do atendimento humano): devolve ao bot as
 * conversas vencidas e manda a mensagem de encerramento quando cabe. Devolve
 * quantas voltaram. Sem o bot liberado, nada muda.
 */
export async function returnDueConversations(db: DbClient, clinicId: string, sender: ClinicSender | null, now: Date = new Date()): Promise<number> {
  if (!(await hasFeature(db, clinicId, "whatsapp_bot"))) return 0;
  const due = (await listHumanAttention(db, clinicId)).filter((item) => isDueToReturn(item, now));
  let returned = 0;
  for (const item of due) {
    try {
      await returnToBot(db, clinicId, item.phone);
      returned++;
      if (!sender || !canSendFreeText(item.lastPatientAt, now)) continue;
      const outcome = await sender.text(item.phone, HANDOFF_CLOSED);
      await recordOutboundMessage(
        db,
        clinicId,
        {
          phone: item.phone,
          contactId: item.contactId,
          messageType: "bot_handoff_closed",
          body: HANDOFF_CLOSED,
          status: outcome.sent ? "sent" : "failed",
          waMessageId: outcome.sent ? outcome.messageId : null,
        },
        now,
      );
    } catch (error) {
      logError("atendimento: volta ao bot em 12 h", error, { clinica: clinicId });
    }
  }
  return returned;
}
