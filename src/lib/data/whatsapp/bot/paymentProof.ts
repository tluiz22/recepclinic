// Comprovante de pagamento no WhatsApp: quem paga na recepção e manda o comprovante não recebe resposta do bot.
// Só regras simples (sem OCR nem IA): tipo da mensagem + legenda + nome do arquivo + consulta concluída recente.
// A mensagem continua gravada e aparece nas Conversas para a secretária; nada é respondido nem contado como "não entendi".
import type { DbClient } from "../../clients";
import { unwrap } from "../../errors";
import { contactPatientIds } from "../../patientContacts";
import type { WaMessage } from "../meta";

/** Janela (horas) para a consulta concluída e (minutos) para anexos seguidos de um comprovante reconhecido. */
export const PROOF_APPOINTMENT_HOURS = 24;
export const PROOF_FOLLOWUP_MINUTES = 10;
export const PROOF_CONTEXT_KEY = "paymentProofAt";

const KEYWORDS = /\b(comprovante|comprovantes|pix|pagamento|pagamentos|paguei|pago|pagou|transferencia|transferi|recibo|deposito)\b/;

const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9?]+/g, " ");

export type ProofInput = {
  type: string | null;
  /** Legenda da foto/PDF ou texto digitado. */
  text: string | null;
  fileName: string | null;
  /** Conversa parada: começo ou menu, sem marcação em andamento. */
  idle: boolean;
  /** Consulta concluída nas últimas 24 h. */
  recentCompletedAppointment: boolean;
  /** Comprovante reconhecido há menos de 10 minutos. */
  followsRecentProof: boolean;
};

/** A mensagem é um comprovante (ou anexo logo depois de um) e fica sem resposta. */
export function isPaymentProof(i: ProofInput): boolean {
  if (!i.idle) return false;
  const words = normalize(`${i.text ?? ""} ${i.fileName ?? ""}`);
  const hasKeyword = KEYWORDS.test(words);
  if (i.type === "image" || i.type === "document") {
    return hasKeyword || i.recentCompletedAppointment || i.followsRecentProof;
  }
  // Texto só com palavras de pagamento, sem pedido: curto e depois de uma consulta concluída.
  if (i.type === "text") return hasKeyword && i.recentCompletedAppointment && words.trim().split(/\s+/).length <= 6 && !/\b(quero|gostaria|marcar|agendar|remarcar|cancelar|\?)/.test(words);
  return false;
}

/** Há consulta concluída nas últimas 24 h do contato (ou dos pacientes ligados a ele). */
export async function hasRecentCompletedAppointment(db: DbClient, clinicId: string, contactId: string | null, now: Date): Promise<boolean> {
  if (!contactId) return false;
  const since = new Date(now.getTime() - PROOF_APPOINTMENT_HOURS * 3_600_000).toISOString();
  const patientIds = await contactPatientIds(db, clinicId, contactId);
  const filters = [`booked_by_contact_id.eq.${contactId}`, ...(patientIds.length ? [`patient_id.in.(${patientIds.join(",")})`] : [])];
  const rows = unwrap(
    await db
      .from("appointments")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("status", "completed")
      .gte("scheduled_at", since)
      .lte("scheduled_at", now.toISOString())
      .or(filters.join(","))
      .limit(1),
    "Consulta concluída recente",
  );
  return rows.length > 0;
}

export const proofTextOf = (msg: WaMessage): string | null => msg.text?.body ?? msg.image?.caption ?? msg.document?.caption ?? null;
export const proofFileNameOf = (msg: WaMessage): string | null => msg.document?.filename ?? null;

export function followsRecentProof(context: Record<string, unknown>, now: Date): boolean {
  const at = typeof context[PROOF_CONTEXT_KEY] === "string" ? Date.parse(context[PROOF_CONTEXT_KEY] as string) : NaN;
  return Number.isFinite(at) && now.getTime() - at >= 0 && now.getTime() - at <= PROOF_FOLLOWUP_MINUTES * 60_000;
}
