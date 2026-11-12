import { MAX_HOLDS_PER_DAY } from "../portalIdentity";
import type { DbClient } from "./clients";
import { DataError, unwrap } from "./errors";

// Celular bloqueado no portal, na ficha do paciente (validação da F3, cliente, 10/nov/2026; faixa no alto, opção A do
// canvas). O bloqueio é do celular (vale para todos os pacientes dele), de dois tipos: código pedido demais
// (`portal_blocks`, 15 min → 1 h → 24 h) e o limite do dia (5 consultas marcadas pelo portal em 24 h). "Liberar agora"
// solta os dois (`portal_release_phone`). Só Administrador e Recepção (o banco confere de novo).

export type PortalPhoneBlock = {
  /** Fim do bloqueio por código pedido demais; null = sem. */
  blockedUntil: Date | null;
  /** Quando o limite do dia acaba sozinho; null = não chegou ao limite. */
  limitUntil: Date | null;
};

/** A situação do celular no portal; null quando está liberado. */
export async function portalPhoneBlock(db: DbClient, clinicId: string, phone: string): Promise<PortalPhoneBlock | null> {
  const rows = unwrap(
    await db.rpc("portal_phone_status", { p_clinic_id: clinicId, p_phone: phone, p_max_per_day: MAX_HOLDS_PER_DAY }),
    "Portal do celular",
  );
  const row = rows[0];
  if (!row) return null;
  const blockedUntil = row.blocked_until ? new Date(row.blocked_until) : null;
  const limitUntil = row.limit_until ? new Date(row.limit_until) : null;
  return blockedUntil || limitUntil ? { blockedUntil, limitUntil } : null;
}

/** Libera o celular no portal: solta o bloqueio e recomeça a contagem do limite do dia. */
export async function releasePortalPhone(db: DbClient, clinicId: string, phone: string): Promise<void> {
  const { error } = await db.rpc("portal_release_phone", { p_clinic_id: clinicId, p_phone: phone });
  if (error?.code === "42501") throw new DataError("forbidden", "Liberar o portal: só o Administrador e a Recepção");
  if (error?.code === "22023") throw new DataError("invalid", "Liberar o portal: celular inválido");
  if (error) throw error;
}
