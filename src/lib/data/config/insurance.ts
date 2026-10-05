import type { DbClient } from "../clients";
import { cleanText, unwrap, unwrapOne, Validation } from "../errors";

// Convênios e planos de saúde atendidos (D10): nomes alternativos para a
// busca, e exceções por profissional (por padrão, todo profissional atende
// todos os planos ativos). Saem por desativação.

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

/** Planos que o profissional NÃO atende (exceções). */
export async function listProfessionalExclusions(db: DbClient, clinicId: string, professionalId: string): Promise<string[]> {
  const rows = unwrap(
    await db
      .from("professional_insurance_exclusions")
      .select("insurance_plan_id")
      .eq("clinic_id", clinicId)
      .eq("professional_id", professionalId),
    "Planos não atendidos",
  );
  return rows.map((row) => row.insurance_plan_id).sort();
}

export async function setProfessionalExclusions(
  db: DbClient,
  clinicId: string,
  professionalId: string,
  insurancePlanIds: string[],
): Promise<string[]> {
  const wanted = [...new Set(insurancePlanIds)];
  const current = await listProfessionalExclusions(db, clinicId, professionalId);
  const toAdd = wanted.filter((id) => !current.includes(id));
  const toRemove = current.filter((id) => !wanted.includes(id));
  if (toAdd.length) {
    unwrap(
      await db
        .from("professional_insurance_exclusions")
        .insert(toAdd.map((insurance_plan_id) => ({ clinic_id: clinicId, professional_id: professionalId, insurance_plan_id }))),
      "Planos não atendidos",
    );
  }
  if (toRemove.length) {
    unwrap(
      await db
        .from("professional_insurance_exclusions")
        .delete()
        .eq("clinic_id", clinicId)
        .eq("professional_id", professionalId)
        .in("insurance_plan_id", toRemove),
      "Planos não atendidos",
    );
  }
  return listProfessionalExclusions(db, clinicId, professionalId);
}

/** Profissionais que NÃO atendem o plano (a mesma exceção, vista pelo plano; tela do convênio, F4.4b). */
export async function listPlanExclusions(db: DbClient, clinicId: string, insurancePlanId: string): Promise<string[]> {
  const rows = unwrap(
    await db
      .from("professional_insurance_exclusions")
      .select("professional_id")
      .eq("clinic_id", clinicId)
      .eq("insurance_plan_id", insurancePlanId),
    "Profissionais que não atendem o plano",
  );
  return rows.map((row) => row.professional_id).sort();
}

export async function setPlanExclusions(
  db: DbClient,
  clinicId: string,
  insurancePlanId: string,
  professionalIds: string[],
): Promise<string[]> {
  const wanted = [...new Set(professionalIds)];
  const current = await listPlanExclusions(db, clinicId, insurancePlanId);
  const toAdd = wanted.filter((id) => !current.includes(id));
  const toRemove = current.filter((id) => !wanted.includes(id));
  if (toAdd.length) {
    unwrap(
      await db
        .from("professional_insurance_exclusions")
        .insert(toAdd.map((professional_id) => ({ clinic_id: clinicId, professional_id, insurance_plan_id: insurancePlanId }))),
      "Profissionais que não atendem o plano",
    );
  }
  if (toRemove.length) {
    unwrap(
      await db
        .from("professional_insurance_exclusions")
        .delete()
        .eq("clinic_id", clinicId)
        .eq("insurance_plan_id", insurancePlanId)
        .in("professional_id", toRemove),
      "Profissionais que não atendem o plano",
    );
  }
  return listPlanExclusions(db, clinicId, insurancePlanId);
}

/** O profissional atende o plano? (ativo e fora das exceções) */
export function professionalAcceptsPlan(plan: Pick<InsurancePlan, "id" | "isActive">, exclusions: string[]): boolean {
  return plan.isActive && !exclusions.includes(plan.id);
}
