import type { Enums } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { cleanText, DataError, unwrap, unwrapOne, Validation } from "../errors";

// Agendas (D2): de um profissional ou de um recurso (ex.: "Exames"), e o
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

export type AgendaInput = Omit<Agenda, "id" | "isActive">;

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
    name: cleanText(input.name) ?? "",
    kind: input.kind,
    professional_id: input.kind === "professional" ? input.professionalId : null,
    buffer_minutes: input.bufferMinutes,
  };
  v.check(row.name.length > 0, "name", "Informe o nome da agenda");
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

export async function createAgenda(db: DbClient, clinicId: string, input: AgendaInput): Promise<Agenda> {
  const row = validateAgenda(input);
  // Sem `.select()` no insert: a leitura das agendas passa por
  // app.can_access_agenda, que consulta a própria tabela e ainda não enxerga a
  // linha nova no mesmo comando. Por isso o id sai daqui e a leitura vem depois.
  const id = crypto.randomUUID();
  unwrap(await db.from("agendas").insert({ id, clinic_id: clinicId, ...row }), "Agenda");
  return toAgenda(unwrapOne(await db.from("agendas").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Agenda"));
}

/** O tipo e o profissional da agenda não mudam (os atendimentos já feitos são dele). */
export async function updateAgenda(
  db: DbClient,
  clinicId: string,
  id: string,
  input: Pick<AgendaInput, "name" | "bufferMinutes">,
): Promise<Agenda> {
  const v = new Validation();
  const name = cleanText(input.name) ?? "";
  v.check(name.length > 0, "name", "Informe o nome da agenda");
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
        .update({ name, buffer_minutes: input.bufferMinutes })
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
