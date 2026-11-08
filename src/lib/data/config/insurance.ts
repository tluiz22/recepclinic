import type { DbClient } from "../clients";
import { cleanText, DataError, unwrap, unwrapOne, Validation } from "../errors";

// Convênios e planos de saúde atendidos (D10): nomes alternativos para a
// busca e os planos que cada profissional atende (MC, cliente, 07/nov/2026:
// associação positiva; sem nenhum, só particular). Mantidos pelo Administrador
// e por quem ele autoriza em Equipe. Saem por desativação.

export type InsurancePlan = {
  id: string;
  name: string;
  /** Outros nomes pelos quais o paciente chama o plano (busca do bot). */
  alternativeNames: string[];
  ansCode: string | null;
  isActive: boolean;
};

export type InsurancePlanInput = Omit<InsurancePlan, "id" | "isActive">;

export type InsuranceSearchResult = { id: string; name: string; score: number };

const COLUMNS = "id, name, alternative_names, ans_code, is_active";

type Row = { id: string; name: string; alternative_names: string[]; ans_code: string | null; is_active: boolean };

const toPlan = (row: Row): InsurancePlan => ({
  id: row.id,
  name: row.name,
  alternativeNames: row.alternative_names,
  ansCode: row.ans_code,
  isActive: row.is_active,
});

export function validateInsurancePlan(input: InsurancePlanInput) {
  const v = new Validation();
  const name = cleanText(input.name) ?? "";
  // Sem repetidos (sem diferenciar maiúsculas) e sem o próprio nome.
  const seen = new Set([name.toLowerCase()]);
  const alternative_names: string[] = [];
  for (const raw of input.alternativeNames ?? []) {
    const alt = cleanText(raw);
    if (alt && !seen.has(alt.toLowerCase())) {
      seen.add(alt.toLowerCase());
      alternative_names.push(alt);
    }
  }
  v.check(name.length > 0, "name", "Informe o nome do plano");
  v.throwIfInvalid("Plano de saúde");
  return { name, alternative_names, ans_code: cleanText(input.ansCode) };
}

export async function listInsurancePlans(
  db: DbClient,
  clinicId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<InsurancePlan[]> {
  let query = db.from("insurance_plans").select(COLUMNS).eq("clinic_id", clinicId).order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  return unwrap(await query, "Planos de saúde").map(toPlan);
}

export async function createInsurancePlan(db: DbClient, clinicId: string, input: InsurancePlanInput): Promise<InsurancePlan> {
  const row = validateInsurancePlan(input);
  return toPlan(unwrap(await db.from("insurance_plans").insert({ clinic_id: clinicId, ...row }).select(COLUMNS).single(), "Plano de saúde"));
}

export async function updateInsurancePlan(
  db: DbClient,
  clinicId: string,
  id: string,
  input: InsurancePlanInput,
): Promise<InsurancePlan> {
  const row = validateInsurancePlan(input);
  return toPlan(
    unwrapOne(
      await db.from("insurance_plans").update(row).eq("clinic_id", clinicId).eq("id", id).select(COLUMNS).maybeSingle(),
      "Plano de saúde",
    ),
  );
}

export async function setInsurancePlanActive(db: DbClient, clinicId: string, id: string, isActive: boolean): Promise<void> {
  unwrapOne(
    await db.from("insurance_plans").update({ is_active: isActive }).eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(),
    "Plano de saúde",
  );
}

/** Planos ativos com nome parecido com o digitado (até 5, do mais parecido). */
export async function searchInsurancePlans(db: DbClient, clinicId: string, query: string): Promise<InsuranceSearchResult[]> {
  if (!query.trim()) return [];
  return unwrap(await db.rpc("search_insurance_plans", { p_clinic_id: clinicId, p_query: query }), "Busca de planos");
}

/** Planos que o profissional atende (MC, 07/nov/2026); vazio = só particular. */
export async function listProfessionalPlans(db: DbClient, clinicId: string, professionalId: string): Promise<string[]> {
  const rows = unwrap(
    await db.from("professional_insurance_plans").select("insurance_plan_id").eq("clinic_id", clinicId).eq("professional_id", professionalId),
    "Convênios atendidos",
  );
  return rows.map((row) => row.insurance_plan_id).sort();
}

/** Profissionais que atendem o plano (a mesma ligação, vista pelo plano). */
export async function listPlanProfessionals(db: DbClient, clinicId: string, insurancePlanId: string): Promise<string[]> {
  const rows = unwrap(
    await db.from("professional_insurance_plans").select("professional_id").eq("clinic_id", clinicId).eq("insurance_plan_id", insurancePlanId),
    "Profissionais que atendem o plano",
  );
  return rows.map((row) => row.professional_id).sort();
}

/** Todas as ligações da clínica (bot, página de agendar, listas). */
export async function listInsuranceLinks(db: DbClient, clinicId: string): Promise<{ professionalId: string; planId: string }[]> {
  const rows = unwrap(
    await db.from("professional_insurance_plans").select("professional_id, insurance_plan_id").eq("clinic_id", clinicId),
    "Convênios atendidos",
  );
  return rows.map((row) => ({ professionalId: row.professional_id, planId: row.insurance_plan_id }));
}

type LinkSide = { by: "professional_id"; id: string; other: "insurance_plan_id" } | { by: "insurance_plan_id"; id: string; other: "professional_id" };

/** Grava a lista inteira de um lado (só o que mudou: a trilha registra cada ligação e cada retirada). */
async function setLinks(db: DbClient, clinicId: string, side: LinkSide, wanted: string[], current: string[]): Promise<void> {
  const want = [...new Set(wanted)];
  const toAdd = want.filter((id) => !current.includes(id));
  const toRemove = current.filter((id) => !want.includes(id));
  const context = "Convênios atendidos";
  if (toAdd.length) {
    unwrap(
      await db.from("professional_insurance_plans").insert(toAdd.map((other) => ({ clinic_id: clinicId, [side.by]: side.id, [side.other]: other }) as never)),
      context,
    );
  }
  if (toRemove.length) {
    const removed = unwrap(
      await db.from("professional_insurance_plans").delete().eq("clinic_id", clinicId).eq(side.by, side.id).in(side.other, toRemove).select(side.other),
      context,
    );
    // Sem permissão, o RLS só esconde as linhas: a retirada não acontece.
    if (removed.length < toRemove.length) throw new DataError("forbidden", `${context}: sem permissão`);
  }
}

export async function setProfessionalPlans(db: DbClient, clinicId: string, professionalId: string, insurancePlanIds: string[]): Promise<string[]> {
  const current = await listProfessionalPlans(db, clinicId, professionalId);
  await setLinks(db, clinicId, { by: "professional_id", id: professionalId, other: "insurance_plan_id" }, insurancePlanIds, current);
  return listProfessionalPlans(db, clinicId, professionalId);
}

export async function setPlanProfessionals(db: DbClient, clinicId: string, insurancePlanId: string, professionalIds: string[]): Promise<string[]> {
  const current = await listPlanProfessionals(db, clinicId, insurancePlanId);
  await setLinks(db, clinicId, { by: "insurance_plan_id", id: insurancePlanId, other: "professional_id" }, professionalIds, current);
  return listPlanProfessionals(db, clinicId, insurancePlanId);
}

/** O profissional atende o plano? (plano ativo e ligado a ele) */
export function professionalAcceptsPlan(plan: Pick<InsurancePlan, "id" | "isActive">, acceptedPlanIds: readonly string[]): boolean {
  return plan.isActive && acceptedPlanIds.includes(plan.id);
}

/** Observação de cada convênio do profissional (autorização, carteirinha…), pelo id do plano. */
export async function listProfessionalPlanNotes(db: DbClient, clinicId: string, professionalId: string): Promise<Map<string, string>> {
  const rows = unwrap(
    await db.from("professional_insurance_plans").select("insurance_plan_id, note").eq("clinic_id", clinicId).eq("professional_id", professionalId),
    "Convênios atendidos",
  );
  return new Map(rows.flatMap((row) => (row.note ? [[row.insurance_plan_id, row.note] as const] : [])));
}

export const PLAN_NOTE_MAX = 300;

/**
 * Como o profissional atende (recepção digital, F1, cliente, 08/nov/2026): particular sim/não, os convênios
 * marcados e a observação de cada um. Precisa atender de algum jeito: particular ou ao menos um convênio.
 */
export async function setProfessionalCoverage(
  db: DbClient,
  clinicId: string,
  professionalId: string,
  input: { acceptsPrivate: boolean; plans: { planId: string; note: string | null }[] },
): Promise<void> {
  const v = new Validation();
  const plans = [...new Map(input.plans.map((p) => [p.planId, { planId: p.planId, note: cleanText(p.note ?? "") }])).values()];
  v.check(input.acceptsPrivate || plans.length > 0, "coverage", "Marque Particular ou ao menos um convênio");
  v.check(plans.every((p) => (p.note?.length ?? 0) <= PLAN_NOTE_MAX), "note", `Observação com até ${PLAN_NOTE_MAX} caracteres`);
  v.throwIfInvalid("Convênios atendidos");
  await setProfessionalPlans(
    db,
    clinicId,
    professionalId,
    plans.map((p) => p.planId),
  );
  const notes = await listProfessionalPlanNotes(db, clinicId, professionalId);
  for (const plan of plans) {
    if ((notes.get(plan.planId) ?? null) === plan.note) continue;
    unwrapOne(
      await db
        .from("professional_insurance_plans")
        .update({ note: plan.note })
        .eq("clinic_id", clinicId)
        .eq("professional_id", professionalId)
        .eq("insurance_plan_id", plan.planId)
        .select("insurance_plan_id")
        .maybeSingle(),
      "Observação do convênio",
    );
  }
  unwrap(
    await db.rpc("set_professional_accepts_private", { p_clinic_id: clinicId, p_professional_id: professionalId, p_accepts: input.acceptsPrivate }),
    "Atende particular",
  );
}
