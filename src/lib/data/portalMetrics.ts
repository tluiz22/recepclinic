import type { DbClient } from "./clients";
import { unwrap } from "./errors";

// Métricas › Portal (F6, parte 2): o caminho do paciente no portal, da clínica toda. Contas na função do banco
// `metrics_portal` (security definer, só quem é da clínica); aqui viram os passos do funil.

export type PortalMetrics = {
  visits: number;
  fromBotLink: number;
  verified: number;
  held: number;
  booked: number;
  blocks: number;
};

const n = (value: unknown) => Number(value) || 0;

export async function getPortalMetrics(db: DbClient, clinicId: string, start: Date, end: Date): Promise<PortalMetrics> {
  const rows = unwrap(await db.rpc("metrics_portal", { p_clinic_id: clinicId, p_start: start.toISOString(), p_end: end.toISOString() }), "Métricas: portal");
  const r = rows[0];
  return { visits: n(r?.visits), fromBotLink: n(r?.from_bot_link), verified: n(r?.verified), held: n(r?.held), booked: n(r?.booked), blocks: n(r?.blocks) };
}
