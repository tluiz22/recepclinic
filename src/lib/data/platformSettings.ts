import { normalizePhone } from "../phone";
import type { DbClient } from "./clients";
import { unwrap } from "./errors";

// Ajustes da plataforma (cliente, 01/nov/2026): hoje, o WhatsApp do suporte do
// RecepClinic. Qualquer credencial lê (a clínica mostra na Central de Ajuda e o
// webhook confere); só o Suporte grava (RLS).

/** Número do suporte em E.164, ou null quando ainda não foi informado. */
export async function getSupportWhatsapp(db: DbClient): Promise<string | null> {
  const row = unwrap(await db.from("platform_settings").select("support_whatsapp").maybeSingle(), "Ajustes da plataforma");
  return row?.support_whatsapp ?? null;
}

/** Grava o número (vazio apaga). false = número inválido; nada é salvo. */
export async function setSupportWhatsapp(db: DbClient, raw: string, userId: string): Promise<boolean> {
  const trimmed = raw.trim();
  const phone = trimmed ? normalizePhone(trimmed) : null;
  if (trimmed && !phone) return false;
  unwrap(
    await db.from("platform_settings").update({ support_whatsapp: phone, updated_at: new Date().toISOString(), updated_by: userId }).eq("id", true).select("id"),
    "Ajustes da plataforma",
  );
  return true;
}

/** O número é o do suporte? (comparação em E.164, como o webhook guarda) */
export function isSupportPhone(phone: string | null | undefined, support: string | null): boolean {
  return !!phone && !!support && phone === support;
}
