import type { DbClient } from "../clients";
import { cleanText, DataError, unwrap, unwrapOne, Validation } from "../errors";
import { PLAN_NOTE_MAX } from "./insurance";

// Convênios de cada exame (CE, cliente, 10/nov/2026; docs/implementacao-recepcao-digital.md, 15.5.7): como os do
// profissional (MC), "Aceita particular" e a associação positiva com observação; sem nenhum convênio = só
// particular. Só exame (o banco recusa os outros); quem mantém os convênios muda.

export type ServicePlan = { planId: string; note: string | null };

const CONTEXT = "Convênios aceitos";

/** Convênios que o exame aceita, com a observação. */
export async function listServicePlans(db: DbClient, clinicId: string, serviceId: string): Promise<ServicePlan[]> {
  const rows = unwrap(
    await db.from("service_insurance_plans").select("insurance_plan_id, note").eq("clinic_id", clinicId).eq("service_id", serviceId),
    CONTEXT,
  );
  return rows.map((row) => ({ planId: row.insurance_plan_id, note: row.note })).sort((a, b) => a.planId.localeCompare(b.planId));
}

/** Todas as ligações exame × convênio da clínica (portal, bot, agenda). */
export async function listServiceInsuranceLinks(db: DbClient, clinicId: string): Promise<{ serviceId: string; planId: string; note: string | null }[]> {
  const rows = unwrap(await db.from("service_insurance_plans").select("service_id, insurance_plan_id, note").eq("clinic_id", clinicId), CONTEXT);
  return rows.map((row) => ({ serviceId: row.service_id, planId: row.insurance_plan_id, note: row.note }));
}

/**
 * Como o exame é aceito: particular sim/não, os convênios marcados e a observação de cada um. Precisa de algum
 * jeito: particular ou ao menos um convênio ativo (`plans`). `keepPlanIds`: ligações a planos desativados, que
 * ficam como estão e não contam. "Aceita particular" primeiro (é a que pode faltar permissão).
 */
export async function setServiceCoverage(
  db: DbClient,
  clinicId: string,
  serviceId: string,
  input: { acceptsPrivate: boolean; plans: ServicePlan[]; keepPlanIds?: string[] },
): Promise<void> {
  const v = new Validation();
  const plans = [...new Map(input.plans.map((p) => [p.planId, { planId: p.planId, note: cleanText(p.note ?? "") }])).values()];
  v.check(input.acceptsPrivate || plans.length > 0, "coverage", "Marque Particular ou ao menos um convênio");
  v.check(plans.every((p) => (p.note?.length ?? 0) <= PLAN_NOTE_MAX), "note", `Observação com até ${PLAN_NOTE_MAX} caracteres`);
  v.throwIfInvalid(CONTEXT);
  unwrap(await db.rpc("set_service_accepts_private", { p_clinic_id: clinicId, p_service_id: serviceId, p_accepts: input.acceptsPrivate }), "Aceita particular");

  const current = await listServicePlans(db, clinicId, serviceId);
  const currentIds = current.map((p) => p.planId);
  const want = new Set([...plans.map((p) => p.planId), ...(input.keepPlanIds ?? [])]);
  const toAdd = plans.filter((p) => !currentIds.includes(p.planId));
  const toRemove = currentIds.filter((id) => !want.has(id));
  if (toAdd.length) {
    unwrap(
      await db.from("service_insurance_plans").insert(toAdd.map((p) => ({ clinic_id: clinicId, service_id: serviceId, insurance_plan_id: p.planId, note: p.note }))),
      CONTEXT,
    );
  }
  if (toRemove.length) {
    const removed = unwrap(
      await db.from("service_insurance_plans").delete().eq("clinic_id", clinicId).eq("service_id", serviceId).in("insurance_plan_id", toRemove).select("insurance_plan_id"),
      CONTEXT,
    );
    // Sem permissão, o RLS só esconde as linhas: a retirada não acontece.
    if (removed.length < toRemove.length) throw new DataError("forbidden", `${CONTEXT}: sem permissão`);
  }
  for (const plan of plans) {
    const before = current.find((p) => p.planId === plan.planId);
    if (!before || before.note === plan.note) continue;
    unwrapOne(
      await db
        .from("service_insurance_plans")
        .update({ note: plan.note })
        .eq("clinic_id", clinicId)
        .eq("service_id", serviceId)
        .eq("insurance_plan_id", plan.planId)
        .select("insurance_plan_id")
        .maybeSingle(),
      "Observação do convênio",
    );
  }
}
