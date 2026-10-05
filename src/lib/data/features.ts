import { isFeatureKey, missingDependencies, type FeatureKey } from "../features";
import type { DbClient } from "./clients";
import { DataError, fromDbError, unwrap } from "./errors";

// Matriz de acesso por clínica (D11): leitura pela equipe e pelo bot da
// própria clínica; gravação só pelo Administrador do sistema (Suporte
// RecepClinic), pela função set_clinic_features do banco. Quem liberou e
// quando fica na linha; o que foi desligado fica no registro do Suporte.

/** Itens liberados para a clínica. */
export async function getClinicFeatures(db: DbClient, clinicId: string): Promise<FeatureKey[]> {
  const rows = unwrap(await db.from("clinic_features").select("feature_key").eq("clinic_id", clinicId), "Matriz de acesso");
  return rows.map((row) => row.feature_key).filter(isFeatureKey);
}

/** O item está liberado para a clínica (bot e envios conferem antes de agir). */
export async function hasFeature(db: DbClient, clinicId: string, key: FeatureKey): Promise<boolean> {
  return (await getClinicFeatures(db, clinicId)).includes(key);
}

export type FeatureGrant = { key: FeatureKey; enabledBy: string | null; enabledAt: Date };

export type ClinicAccessSummary = {
  id: string;
  name: string;
  status: string;
  features: FeatureGrant[];
  /** Limite de profissionais ativos (D11) e quantos estão ativos. */
  maxProfessionals: number;
  activeProfessionals: number;
};

/**
 * Clínicas e o que cada uma tem liberado (tela da matriz do Administrador do
 * sistema, F4). Para quem não é do Suporte, o RLS devolve só as próprias.
 */
export async function listClinicsAccess(db: DbClient): Promise<ClinicAccessSummary[]> {
  const rows = unwrap(
    await db
      .from("clinics")
      .select("id, name, status, max_professionals, clinic_features ( feature_key, enabled_by, enabled_at ), professionals ( is_active )")
      .order("name"),
    "Clínicas",
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    features: row.clinic_features
      .filter((grant) => isFeatureKey(grant.feature_key))
      .map((grant) => ({ key: grant.feature_key as FeatureKey, enabledBy: grant.enabled_by, enabledAt: new Date(grant.enabled_at) })),
    maxProfessionals: row.max_professionals,
    activeProfessionals: row.professionals.filter((p) => p.is_active).length,
  }));
}

/**
 * Troca o que a clínica tem liberado (o que não está na lista é desligado).
 * Só o Administrador do sistema; um item sem o item de que depende é recusado.
 */
export async function setClinicFeatures(db: DbClient, clinicId: string, keys: FeatureKey[]): Promise<void> {
  const unique = [...new Set(keys)];
  const missing = missingDependencies(unique);
  if (missing.length) {
    const fields = Object.fromEntries(missing.map(({ feature, needs }) => [feature, `Depende de ${needs}`]));
    throw new DataError("invalid", "Matriz de acesso: item sem o item de que depende", fields);
  }
  const { error } = await db.rpc("set_clinic_features", { p_clinic_id: clinicId, p_features: unique });
  if (error) {
    if ((error as { code?: string }).code === "P0002") throw new DataError("not_found", "Matriz de acesso: clínica não encontrada", {}, { cause: error });
    throw fromDbError(error, "Matriz de acesso");
  }
}

export type FeatureChange = { at: Date; actorId: string; feature: FeatureKey; enabled: boolean };

/** Histórico das mudanças da matriz de uma clínica (registro do Suporte, mais recentes primeiro). */
export async function listFeatureChanges(db: DbClient, clinicId: string, limit = 100): Promise<FeatureChange[]> {
  const rows = unwrap(
    await db
      .from("platform_audit_log")
      .select("occurred_at, actor_user_id, operation, old_row, new_row")
      .eq("clinic_id", clinicId)
      .eq("table_name", "clinic_features")
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit),
    "Histórico da matriz de acesso",
  );
  return rows.flatMap((row) => {
    const data = (row.operation === "DELETE" ? row.old_row : row.new_row) as { feature_key?: string } | null;
    const key = data?.feature_key;
    if (!key || !isFeatureKey(key) || row.operation === "UPDATE") return [];
    return [{ at: new Date(row.occurred_at), actorId: row.actor_user_id, feature: key, enabled: row.operation === "INSERT" }];
  });
}

// ---------------------------------------------------------------------------
// Limite de profissionais ativos (D11, cliente, 05/out/2026)
// ---------------------------------------------------------------------------

/** Limite da clínica e quantos profissionais estão ativos (tela de Profissionais). */
export async function getProfessionalLimit(db: DbClient, clinicId: string): Promise<{ max: number; active: number }> {
  const [clinic, active] = await Promise.all([
    db.from("clinics").select("max_professionals").eq("id", clinicId).maybeSingle(),
    db.from("professionals").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).eq("is_active", true),
  ]);
  const row = unwrap(clinic, "Clínica");
  if (active.error) throw fromDbError(active.error, "Profissionais");
  if (!row) throw new DataError("not_found", "Clínica: não encontrada");
  return { max: row.max_professionals, active: active.count ?? 0 };
}

/** Suporte: muda o limite. Baixar abaixo dos ativos não desativa ninguém. */
export async function setClinicProfessionalLimit(db: DbClient, clinicId: string, limit: number): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new DataError("invalid", "Limite de profissionais: pelo menos 1", { maxProfessionals: "O limite precisa ser de pelo menos 1 profissional." });
  }
  const { error } = await db.rpc("set_clinic_professional_limit", { p_clinic_id: clinicId, p_limit: limit });
  if (error) {
    if ((error as { code?: string }).code === "P0002") throw new DataError("not_found", "Clínica: não encontrada", {}, { cause: error });
    throw fromDbError(error, "Limite de profissionais");
  }
}

export type ProfessionalLimitChange = { at: Date; actorId: string; from: number; to: number };

/** Histórico das mudanças do limite (registro do Suporte, mais recentes primeiro). */
export async function listProfessionalLimitChanges(db: DbClient, clinicId: string, limit = 50): Promise<ProfessionalLimitChange[]> {
  const rows = unwrap(
    await db
      .from("platform_audit_log")
      .select("occurred_at, actor_user_id, old_row, new_row")
      .eq("clinic_id", clinicId)
      .eq("table_name", "clinics")
      .eq("operation", "UPDATE")
      .order("occurred_at", { ascending: false })
      .limit(limit),
    "Histórico do limite de profissionais",
  );
  return rows.flatMap((row) => {
    const from = (row.old_row as { max_professionals?: number } | null)?.max_professionals;
    const to = (row.new_row as { max_professionals?: number } | null)?.max_professionals;
    if (from === undefined || to === undefined || from === to) return [];
    return [{ at: new Date(row.occurred_at), actorId: row.actor_user_id, from, to }];
  });
}

/** Nome de cada pessoa do Suporte (quem liberou e quem mudou, na tela da matriz). */
export async function listPlatformStaffNames(db: DbClient): Promise<Map<string, string>> {
  const rows = unwrap(await db.from("platform_staff").select("user_id, display_name"), "Suporte");
  return new Map(rows.map((row) => [row.user_id, row.display_name]));
}

/** Agendas do próprio profissional (métricas pessoais, D11): as ligadas ao login dele. */
export async function ownAgendaIds(db: DbClient, clinicId: string, userId: string): Promise<string[]> {
  const rows = unwrap(
    await db
      .from("agendas")
      .select("id, professionals!inner ( user_id )")
      .eq("clinic_id", clinicId)
      .eq("professionals.user_id", userId),
    "Agendas do profissional",
  );
  return rows.map((row) => row.id);
}

