import { chooseActiveClinic, type ClinicContext, type Membership } from "../clinicAccess";
import { isFeatureKey } from "../features";
import type { DbClient } from "./clients";

// Contexto da clínica de cada requisição do painel (F3.2): lido com o login da
// pessoa, então o RLS já limita o que volta (agendas inclusive).

export type ClinicContextResult =
  | { status: "ok"; context: ClinicContext; remembered: boolean }
  | { status: "choose_clinic" }
  | { status: "no_access" };

export class ClinicContextError extends Error {
  constructor(step: string, cause: unknown) {
    super(`Falha ao carregar o contexto da clínica (${step})`, { cause });
    this.name = "ClinicContextError";
  }
}

function check<T>(step: string, result: { data: T; error: unknown }): T {
  if (result.error) throw new ClinicContextError(step, result.error);
  return result.data;
}

export async function loadClinicContext(
  db: DbClient,
  userId: string,
  preferredClinicId: string | null | undefined,
): Promise<ClinicContextResult> {
  const [memberRows, staffRow] = await Promise.all([
    db.from("clinic_members").select("clinic_id, roles, created_at").eq("user_id", userId).then((r) => check("membros", r)),
    db.from("platform_staff").select("user_id").eq("user_id", userId).maybeSingle().then((r) => check("suporte", r)),
  ]);

  const memberships: Membership[] = (memberRows ?? []).map((row) => ({
    clinicId: row.clinic_id,
    roles: row.roles,
    joinedAt: row.created_at,
  }));
  const isPlatformStaff = staffRow !== null;

  const choice = chooseActiveClinic({ memberships, isPlatformStaff, preferredClinicId });
  if (choice.kind === "no_access") return { status: "no_access" };
  if (choice.kind === "choose") return { status: "choose_clinic" };

  const { clinicId } = choice;
  const [clinic, settings, agendas, features] = await Promise.all([
    db.from("clinics").select("id, name, status").eq("id", clinicId).maybeSingle().then((r) => check("clínica", r)),
    db
      .from("clinic_settings")
      .select("timezone, profile")
      .eq("clinic_id", clinicId)
      .maybeSingle()
      .then((r) => check("configuração", r)),
    db.from("agendas").select("id").eq("clinic_id", clinicId).order("name").then((r) => check("agendas", r)),
    db.from("clinic_features").select("feature_key").eq("clinic_id", clinicId).then((r) => check("matriz de acesso", r)),
  ]);

  if (!clinic || !settings) {
    // Suporte com o cookie de uma clínica que não existe mais: segue como se
    // não houvesse cookie. Para membro não acontece (a clínica vem do vínculo).
    if (choice.kind === "support") {
      return memberships.length ? loadClinicContext(db, userId, null) : { status: "choose_clinic" };
    }
    throw new ClinicContextError("clínica sem configuração", { clinicId });
  }

  return {
    status: "ok",
    remembered: choice.kind === "support" || choice.remembered,
    context: {
      userId,
      clinicId,
      clinicName: clinic.name,
      clinicStatus: clinic.status,
      clinicProfile: settings.profile,
      timezone: settings.timezone,
      roles: memberships.find((membership) => membership.clinicId === clinicId)?.roles ?? [],
      isPlatformStaff,
      agendaIds: (agendas ?? []).map((agenda) => agenda.id),
      features: (features ?? []).map((row) => row.feature_key).filter(isFeatureKey),
    },
  };
}

/** Registra uma leitura do Suporte na clínica (D6). Erro aqui barra a resposta. */
export async function logPlatformAccess(
  db: DbClient,
  clinicId: string,
  method: string,
  path: string,
): Promise<void> {
  const { error } = await db.rpc("log_platform_access", { p_clinic_id: clinicId, p_method: method, p_path: path });
  if (error) throw new ClinicContextError("registro de leitura do Suporte", error);
}
