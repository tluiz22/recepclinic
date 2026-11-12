import { unwrap } from "../errors";
import type { DbClient } from "../clients";

// Apoio do portal de agendamento: horário escolhido (valor do formulário), tipo do horário livre e convênios aceitos.
// A página antiga /agendar/[token] e a API api/agendar saíram em 12/nov/2026 (limpeza da F3f).

export type PublicSlot = {
  start: Date;
  agendaId: string;
  agendaName: string;
  locationId: string;
  locationName: string;
  /** Turma: vagas que sobram na sessão. */
  remaining: number | null;
};

/**
 * Agendas com profissional que atende o plano (MC: `professional_insurance_plans`) ou sem profissional (exames), se o
 * exame `serviceId` aceita o plano (CE, cliente, 10/nov/2026: `service_insurance_plans`).
 */
export async function agendasAcceptingPlan(db: DbClient, clinicId: string, agendaIds: string[], insurancePlanId: string, serviceId: string): Promise<string[]> {
  if (!agendaIds.length) return [];
  const [agendas, accepting, examAccepts] = await Promise.all([
    db.from("agendas").select("id, professional_id").eq("clinic_id", clinicId).in("id", agendaIds).then((r) => unwrap(r, "Agendas")),
    db
      .from("professional_insurance_plans")
      .select("professional_id")
      .eq("clinic_id", clinicId)
      .eq("insurance_plan_id", insurancePlanId)
      .then((r) => unwrap(r, "Convênios do profissional")),
    db
      .from("service_insurance_plans")
      .select("service_id")
      .eq("clinic_id", clinicId)
      .eq("service_id", serviceId)
      .eq("insurance_plan_id", insurancePlanId)
      .then((r) => unwrap(r, "Convênios do exame").length > 0),
  ]);
  const accepts = new Set(accepting.map((e) => e.professional_id));
  const ok = new Set(agendas.filter((a) => (a.professional_id ? accepts.has(a.professional_id) : examAccepts)).map((a) => a.id));
  return agendaIds.filter((id) => ok.has(id));
}

/** Valor do horário no formulário: "<início ISO>|<agenda>|<local>". */
export function slotChoiceValue(slot: Pick<PublicSlot, "start" | "agendaId" | "locationId">): string {
  return `${slot.start.toISOString()}|${slot.agendaId}|${slot.locationId}`;
}

export function parseSlotChoice(value: string | null | undefined): { start: Date; agendaId: string; locationId: string } | null {
  const [iso, agendaId, locationId] = (value ?? "").split("|");
  const start = new Date(iso ?? "");
  return Number.isNaN(start.getTime()) || !agendaId || !locationId ? null : { start, agendaId, locationId };
}
