import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { DataError, fromDbError, unwrap, unwrapOne, Validation } from "../errors";

// Agendas (D2): de um profissional ou da equipe (ex.: "Exames"), e o
// acesso de cada membro a elas (D6 revista). A listagem já vem filtrada pelo
// RLS: cada login só recebe as agendas que pode ver.

export type AgendaKind = Enums<"agenda_kind">;
export type AgendaScope = Enums<"agenda_scope">;

export type Agenda = {
  id: string;
  name: string;
  kind: AgendaKind;
  professionalId: string | null;
  /** Intervalo entre atendimentos desta agenda, em minutos. */
  bufferMinutes: number;
  isActive: boolean;
};

// Sem nome (cliente, 06/nov/2026): a de um profissional tem sempre o nome dele e a da equipe, "Exames"; quem grava o
// nome é o banco (app.check_team_agenda), também quando o profissional é renomeado.
export type AgendaInput = Omit<Agenda, "id" | "isActive" | "name">;

const COLUMNS = "id, name, kind, professional_id, buffer_minutes, is_active";

type Row = {
  id: string;
  name: string;
  kind: AgendaKind;
  professional_id: string | null;
  buffer_minutes: number;
  is_active: boolean;
};

const toAgenda = (row: Row): Agenda => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  professionalId: row.professional_id,
  bufferMinutes: row.buffer_minutes,
  isActive: row.is_active,
});

export function validateAgenda(input: AgendaInput) {
  const v = new Validation();
  const row = {
    // O banco troca pelo nome do profissional (ou "Exames"); fica um texto para a coluna obrigatória.
    name: TEAM_AGENDA_NAME,
    kind: input.kind,
    professional_id: input.kind === "professional" ? input.professionalId : null,
    buffer_minutes: input.bufferMinutes,
  };
  v.check(row.kind === "professional" || row.kind === "resource", "kind", "Tipo de agenda inválido");
  v.check(row.kind !== "professional" || !!row.professional_id, "professionalId", "Escolha o profissional da agenda");
  v.check(
    Number.isInteger(row.buffer_minutes) && row.buffer_minutes >= 0,
    "bufferMinutes",
    "Intervalo em minutos inteiros, a partir de 0",
  );
  v.throwIfInvalid("Agenda");
  return row;
}

export async function listAgendas(
  db: DbClient,
  clinicId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<Agenda[]> {
  let query = db.from("agendas").select(COLUMNS).eq("clinic_id", clinicId).order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  return unwrap(await query, "Agendas").map(toAgenda);
}

/**
 * Uma agenda por profissional (cliente, 21/out/2026): a desativada também
 * conta (reativa-se a antiga). Os profissionais ativos que ainda não têm.
 */
export function professionalsWithoutAgenda<P extends { id: string; isActive: boolean }>(
  professionals: readonly P[],
  agendas: readonly Pick<Agenda, "professionalId">[],
): P[] {
  const taken = new Set(agendas.map((a) => a.professionalId).filter(Boolean));
  return professionals.filter((p) => p.isActive && !taken.has(p.id));
}

/**
 * Agenda da equipe (o tipo `resource`): exames que não são feitos por um dos
 * profissionais cadastrados (cliente, 21/out/2026). Uma por clínica, só com o
 * item "Exames e procedimentos" (D11), só para serviços do tipo exame e
 * sempre com o nome "Exames"; o banco também confere.
 */
export const TEAM_AGENDA_NAME = "Exames";
export const TEAM_AGENDA_LABEL = "Equipe";

export async function createAgenda(db: DbClient, clinicId: string, input: AgendaInput): Promise<Agenda> {
  const row = validateAgenda(input);
  if (row.kind === "resource") {
    const existing = unwrap(await db.from("agendas").select("id, is_active").eq("clinic_id", clinicId).eq("kind", "resource").limit(1), "Agenda")[0];
    if (existing) {
      throw new DataError("invalid", "Agenda: a clínica já tem a agenda da equipe", {
        kind: existing.is_active
          ? "A clínica já tem a agenda da equipe (só pode haver uma)."
          : "A clínica já tem a agenda da equipe, desativada: reative-a em Agendas › Desativadas.",
      });
    }
  }
  if (row.professional_id) {
    const existing = unwrap(
      await db.from("agendas").select("id, is_active").eq("clinic_id", clinicId).eq("professional_id", row.professional_id).limit(1),
      "Agenda",
    )[0];
    if (existing) {
      throw new DataError(
        "invalid",
        "Agenda: profissional já tem agenda",
        {
          professionalId: existing.is_active
            ? "Este profissional já tem agenda."
            : "Este profissional já tem uma agenda desativada: reative-a em Agendas › Desativadas.",
        },
      );
    }
  }
  // Sem `.select()` no insert: a leitura das agendas passa por
  // app.can_access_agenda, que consulta a própria tabela e ainda não enxerga a
  // linha nova no mesmo comando. Por isso o id sai daqui e a leitura vem depois.
  const id = crypto.randomUUID();
  unwrap(await db.from("agendas").insert({ id, clinic_id: clinicId, ...row }), "Agenda");
  return toAgenda(unwrapOne(await db.from("agendas").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Agenda"));
}

/** O tipo e o profissional da agenda não mudam (os atendimentos já feitos são dele); o nome vem do profissional. */
export async function updateAgenda(db: DbClient, clinicId: string, id: string, input: Pick<AgendaInput, "bufferMinutes">): Promise<Agenda> {
  const v = new Validation();
  v.check(
    Number.isInteger(input.bufferMinutes) && input.bufferMinutes >= 0,
    "bufferMinutes",
    "Intervalo em minutos inteiros, a partir de 0",
  );
  v.throwIfInvalid("Agenda");
  return toAgenda(
    unwrapOne(
      await db
        .from("agendas")
        .update({ buffer_minutes: input.bufferMinutes })
        .eq("clinic_id", clinicId)
        .eq("id", id)
        .select(COLUMNS)
        .maybeSingle(),
      "Agenda",
    ),
  );
}

export async function setAgendaActive(db: DbClient, clinicId: string, id: string, isActive: boolean): Promise<void> {
  unwrapOne(
    await db.from("agendas").update({ is_active: isActive }).eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(),
    "Agenda",
  );
}

// ---------------------------------------------------------------------------
// Acesso de cada membro às agendas (D6 revista)
// ---------------------------------------------------------------------------

export type MemberAgendaAccess = {
  userId: string;
  /** 'all': todas; 'restricted': as do próprio profissional + as liberadas. */
  scope: AgendaScope;
  /** Agendas liberadas uma a uma (valem só em 'restricted'). */
  grantedAgendaIds: string[];
};

export async function getMemberAgendaAccess(db: DbClient, clinicId: string, userId: string): Promise<MemberAgendaAccess> {
  const [member, grants] = await Promise.all([
    db
      .from("clinic_members")
      .select("agenda_scope")
      .eq("clinic_id", clinicId)
      .eq("user_id", userId)
      .maybeSingle()
      .then((r) => unwrapOne(r, "Membro da equipe")),
    db
      .from("member_agenda_grants")
      .select("agenda_id")
      .eq("clinic_id", clinicId)
      .eq("user_id", userId)
      .then((r) => unwrap(r, "Agendas liberadas")),
  ]);
  return { userId, scope: member.agenda_scope, grantedAgendaIds: grants.map((g) => g.agenda_id).sort() };
}

/**
 * Define o acesso de um membro: escopo e agendas liberadas. Grava as novas
 * antes de tirar as antigas, para a pessoa nunca ficar sem nenhuma no meio.
 */
export async function setMemberAgendaAccess(
  db: DbClient,
  clinicId: string,
  userId: string,
  scope: AgendaScope,
  grantedAgendaIds: string[],
): Promise<MemberAgendaAccess> {
  if (scope !== "all" && scope !== "restricted") throw new DataError("invalid", "Acesso às agendas: escopo inválido");
  const wanted = [...new Set(grantedAgendaIds)];
  const current = await getMemberAgendaAccess(db, clinicId, userId);

  const toAdd = wanted.filter((id) => !current.grantedAgendaIds.includes(id));
  if (toAdd.length) {
    unwrap(
      await db
        .from("member_agenda_grants")
        .insert(toAdd.map((agenda_id) => ({ clinic_id: clinicId, user_id: userId, agenda_id }))),
      "Agendas liberadas",
    );
  }
  if (scope !== current.scope) {
    unwrapOne(
      await db
        .from("clinic_members")
        .update({ agenda_scope: scope })
        .eq("clinic_id", clinicId)
        .eq("user_id", userId)
        .select("user_id")
        .maybeSingle(),
      "Membro da equipe",
    );
  }
  const toRemove = current.grantedAgendaIds.filter((id) => !wanted.includes(id));
  if (toRemove.length) {
    unwrap(
      await db.from("member_agenda_grants").delete().eq("clinic_id", clinicId).eq("user_id", userId).in("agenda_id", toRemove),
      "Agendas liberadas",
    );
  }
  return getMemberAgendaAccess(db, clinicId, userId);
}

export type AgendaMigration = {
  windows: number;
  series: number;
  appointments: number;
  conflicts: { id: string; scheduled_at: string; patient: string }[];
  /** Serviços da agenda de origem com horário, atendimento futuro ou série, e se a de destino os atende. */
  services: { id: string; name: string; windows: number; appointments: number; series: number; target_attends: boolean }[];
  applied: boolean;
};

/**
 * Migrar de agenda (cliente, 02/nov/2026): os horários e os atendimentos futuros passam de `from` para `to`; o
 * histórico fica; com `serviceIds`, só o que é desses serviços (por serviço, 02/nov/2026). `apply = false` só conta (prévia). Só o Administrador (o banco confere). Atendimento que
 * cairia sobre outro já marcado na nova agenda não migra e volta em `conflicts`; exame não conflita.
 */
export async function migrateAgenda(
  db: DbClient,
  from: string,
  to: string,
  apply: boolean,
  /** Só estes serviços migram; `[]` não migra nada e só traz a lista de serviços; sem o campo, tudo. */
  serviceIds?: string[],
): Promise<AgendaMigration> {
  const { data, error } = await db.rpc("migrate_agenda", { p_from: from, p_to: to, p_apply: apply, ...(serviceIds ? { p_services: serviceIds } : {}) });
  if (error) {
    const message = (error as { message?: string }).message ?? "";
    if (message.startsWith("service_not_in_agenda:")) {
      throw new DataError(
        "invalid",
        "Agenda: serviço não atendido na nova agenda",
        { to: `A nova agenda ainda não atende: ${message.slice("service_not_in_agenda:".length).trim()}. Marque a agenda em Serviços e tente de novo.` },
        { cause: error },
      );
    }
    throw fromDbError(error, "Agenda");
  }
  return data as unknown as AgendaMigration;
}
