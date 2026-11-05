import type { DbClient } from "../clients";
import { hasFeature } from "../features";
import { logError } from "../../log";
import { listHumanAttention, type AttentionItem } from "./attention";
import { returnToBot } from "./conversations";

// Encerramento automático do atendimento humano (CA, cliente, 04/nov/2026; era
// a C20, de 03/nov). Rede de segurança, não o caminho principal (o principal é
// o "Finalizar atendimento"): "Em atendimento" sem mensagem nenhuma há 12 h
// volta ao bot, sem mandar nada ao paciente (a C20 mandava uma mensagem de
// encerramento). "Aguardando a clínica" (o paciente espera uma resposta) nunca
// volta sozinha.
//
// A rotina relê a lista a cada execução e só encerra se a situação e a hora
// dela ainda forem as lidas: execução atrasada ou repetida não encerra
// conversa que mudou nesse meio-tempo.

export const HANDOFF_RETURN_HOURS = 12;

const HOUR = 60 * 60_000;

/** A conversa já pode voltar ao bot: "Em atendimento" e 12 h sem mensagem. */
export function isDueToReturn(item: Pick<AttentionItem, "status" | "lastActivityAt">, now: Date): boolean {
  return item.status === "in_progress" && now.getTime() - item.lastActivityAt.getTime() >= HANDOFF_RETURN_HOURS * HOUR;
}

/**
 * Rotina (a cada 5 minutos, com a do atendimento humano): devolve ao bot as conversas vencidas, em silêncio.
 * Devolve quantas voltaram. Sem o bot liberado, nada muda.
 */
export async function returnDueConversations(db: DbClient, clinicId: string, now: Date = new Date()): Promise<number> {
  if (!(await hasFeature(db, clinicId, "whatsapp_bot"))) return 0;
  const due = (await listHumanAttention(db, clinicId)).filter((item) => isDueToReturn(item, now));
  let returned = 0;
  for (const item of due) {
    try {
      if (await returnToBot(db, clinicId, item.phone, { origin: "system", now, expected: { status: "in_progress", statusAt: item.statusAt } })) returned++;
    } catch (error) {
      logError("atendimento: volta ao bot em 12 h", error, { clinica: clinicId });
    }
  }
  return returned;
}
