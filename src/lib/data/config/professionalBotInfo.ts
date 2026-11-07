import type { DbClient } from "../clients";
import { cleanText, unwrap, Validation } from "../errors";

// Informações que o bot responde, por profissional (MI, cliente, 07/nov/2026,
// M5): formas de pagamento, texto de convênios e observações. Vazio = o bot
// não responde aquilo. A lista de convênios atendidos sai da ligação
// (professional_insurance_plans); o texto aqui é para o que a lista não diz.

export type ProfessionalBotInfo = {
  paymentInfo: string | null;
  insuranceInfo: string | null;
  notes: string | null;
};

export const EMPTY_BOT_INFO: ProfessionalBotInfo = { paymentInfo: null, insuranceInfo: null, notes: null };

const MAX = 1000;

type Row = { professional_id: string; payment_info: string | null; insurance_info: string | null; notes: string | null };

const toInfo = (row: Row | null | undefined): ProfessionalBotInfo =>
  row ? { paymentInfo: row.payment_info, insuranceInfo: row.insurance_info, notes: row.notes } : { ...EMPTY_BOT_INFO };

export function validateBotInfo(input: ProfessionalBotInfo) {
  const v = new Validation();
  const row = { payment_info: cleanText(input.paymentInfo), insurance_info: cleanText(input.insuranceInfo), notes: cleanText(input.notes) };
  v.check((row.payment_info ?? "").length <= MAX, "paymentInfo", `Até ${MAX} caracteres`);
  v.check((row.insurance_info ?? "").length <= MAX, "insuranceInfo", `Até ${MAX} caracteres`);
  v.check((row.notes ?? "").length <= MAX, "notes", `Até ${MAX} caracteres`);
  v.throwIfInvalid("Informações do bot");
  return row;
}

export async function getProfessionalBotInfo(db: DbClient, clinicId: string, professionalId: string): Promise<ProfessionalBotInfo> {
  const row = unwrap(
    await db
      .from("professional_bot_info")
      .select("professional_id, payment_info, insurance_info, notes")
      .eq("clinic_id", clinicId)
      .eq("professional_id", professionalId)
      .maybeSingle(),
    "Informações do bot",
  );
  return toInfo(row);
}

/** Todas da clínica, por profissional (lista de Profissionais). */
export async function listProfessionalBotInfo(db: DbClient, clinicId: string): Promise<Map<string, ProfessionalBotInfo>> {
  const rows = unwrap(
    await db.from("professional_bot_info").select("professional_id, payment_info, insurance_info, notes").eq("clinic_id", clinicId),
    "Informações do bot",
  );
  return new Map(rows.map((row) => [row.professional_id, toInfo(row)]));
}

/** Grava as três de uma vez; tudo vazio apaga a linha. */
export async function setProfessionalBotInfo(
  db: DbClient,
  clinicId: string,
  professionalId: string,
  input: ProfessionalBotInfo,
): Promise<ProfessionalBotInfo> {
  const row = validateBotInfo(input);
  if (!row.payment_info && !row.insurance_info && !row.notes) {
    unwrap(await db.from("professional_bot_info").delete().eq("clinic_id", clinicId).eq("professional_id", professionalId), "Informações do bot");
    return { ...EMPTY_BOT_INFO };
  }
  return toInfo(
    unwrap(
      await db
        .from("professional_bot_info")
        .upsert({ clinic_id: clinicId, professional_id: professionalId, ...row }, { onConflict: "professional_id" })
        .select("professional_id, payment_info, insurance_info, notes")
        .single(),
      "Informações do bot",
    ),
  );
}
