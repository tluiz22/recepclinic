// Resposta à oferta de vaga da lista de espera (Fase 25 · etapa 3): botões
// "Sim, quero antecipar" / "Não, manter horário" — do template
// (`msg.button.payload`) ou do texto livre com botões
// (`interactive.button_reply.id`), sempre `waitlist:<yes|no>:<offer_id>`.
//
// Como o toque no lembrete, vale em qualquer estado da conversa e é tratado
// pelo roteador antes da máquina de estados — inclusive com o bot pausado
// (é a resposta a uma pergunta que o sistema fez).

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTextMessage } from "../client";
import type { WaMessage } from "../types";
import { acceptOffer, declineOffer, type OfferAnswer, type OfferReplyResult } from "../../waitlistOffers";
import { sendAndLog } from "./shared";
import * as texts from "./messages";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OfferTap {
  answer: OfferAnswer;
  offerId: string;
}

export function parseOfferTap(waMsg: WaMessage): OfferTap | null {
  const raw = waMsg.button?.payload ?? waMsg.interactive?.button_reply?.id ?? "";
  const [prefix, answer, offerId] = raw.split(":");
  if (prefix !== "waitlist" || (answer !== "yes" && answer !== "no")) return null;
  if (!offerId || !UUID_RE.test(offerId)) return null;
  return { answer, offerId };
}

function replyText(result: OfferReplyResult): string {
  switch (result.kind) {
    case "accepted":
      return texts.waitlistOfferAcceptedText(result.patientName, result.whenLabel);
    case "declined":
      return texts.waitlistOfferDeclinedText(result.patientName, result.whenLabel, result.stillInList);
    case "late":
      return texts.waitlistOfferLateText(result.stillInList);
    case "taken":
      return texts.waitlistOfferTakenText(result.stillInList);
    case "already_accepted":
      return texts.waitlistOfferAlreadyAcceptedText();
    case "not_found":
      return texts.waitlistOfferNotFoundText();
  }
}

export async function handleOfferTap(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  tap: OfferTap
): Promise<void> {
  const result =
    tap.answer === "yes"
      ? await acceptOffer(supabase, tap.offerId, guardianId)
      : await declineOffer(supabase, tap.offerId, guardianId);
  const body = replyText(result);
  await sendAndLog(supabase, guardianId, `bot_waitlist_offer_${result.kind}`, body, () =>
    sendTextMessage({ to: guardianPhone, body })
  );
}
