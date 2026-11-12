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

export type PortalStep = { id: "visits" | "verified" | "held"; label: string; count: number; share: number | null; lostAfter: number | null };

/** Passos do funil (cada um sobre as visitas) e o que se perdeu entre um e o seguinte. Sem visitas: sem percentual. */
export function portalSteps(m: PortalMetrics): PortalStep[] {
  const raw: { id: PortalStep["id"]; label: string; count: number }[] = [
    { id: "visits", label: "Entraram no portal", count: m.visits },
    { id: "verified", label: "Confirmaram o celular", count: m.verified },
    { id: "held", label: "Escolheram um horário", count: m.held },
  ];
  return raw.map((s, i) => ({ ...s, share: m.visits > 0 ? s.count / m.visits : null, lostAfter: i < raw.length - 1 ? Math.max(0, s.count - raw[i + 1].count) : null }));
}
