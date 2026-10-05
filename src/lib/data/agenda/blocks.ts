import type { DbClient } from "../clients";
import { cleanText, unwrap, unwrapOne, Validation } from "../errors";
import { cancelAppointments, listAppointmentsBetween, type Appointment } from "./appointments";
import { createRebookingLink, type BookingLink } from "./links";

// Bloqueios por agenda e cancelamento do dia pela clínica (Fases 12 e 13 do
// piloto). O bloqueio é criado em duas etapas na tela: primeiro a lista dos
// atendimentos atingidos, depois a escolha de cancelar ou não. Cancela-se
// exatamente a lista mostrada (não é recalculada). Cada cancelado ganha um
// link de remarcação (2 dias); o aviso pelo WhatsApp entra com o bot (F6/F7).
// Editar não pergunta de novo pelos atendimentos (como no piloto); remover
// não apaga (fica o histórico).

export type ScheduleBlock = {
  id: string;
  agendaId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  removedAt: Date | null;
};

export type CanceledWithLink = { appointment: Appointment; rebookingLink: BookingLink | null };

const COLUMNS = "id, agenda_id, starts_at, ends_at, reason, removed_at";

type Row = { id: string; agenda_id: string; starts_at: string; ends_at: string; reason: string; removed_at: string | null };

const toBlock = (row: Row): ScheduleBlock => ({
  id: row.id,
  agendaId: row.agenda_id,
  startsAt: new Date(row.starts_at),
  endsAt: new Date(row.ends_at),
  reason: row.reason,
  removedAt: row.removed_at ? new Date(row.removed_at) : null,
});

function validatePeriod(startsAt: Date, endsAt: Date, reason: string): string {
  const v = new Validation();
  const clean = cleanText(reason) ?? "";
  v.check(!Number.isNaN(startsAt.getTime()) && !Number.isNaN(endsAt.getTime()) && endsAt > startsAt, "endsAt", "O fim precisa ser depois do início");
  v.check(clean.length > 0, "reason", "Informe o motivo");
  v.throwIfInvalid("Bloqueio");
  return clean;
}

/** Bloqueios ativos que cruzam o período (das agendas que o login pode ver). */
export async function listBlocks(
  db: DbClient,
  clinicId: string,
  { from, to, agendaIds }: { from: Date; to: Date; agendaIds?: string[] },
): Promise<ScheduleBlock[]> {
  let query = db
    .from("schedule_blocks")
    .select(COLUMNS)
    .eq("clinic_id", clinicId)
    .is("removed_at", null)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString())
    .order("starts_at");
  if (agendaIds) query = query.in("agenda_id", agendaIds);
  return unwrap(await query, "Bloqueios").map(toBlock);
}

/** Atendimentos ativos da agenda que cruzam o período (a tela pergunta se cancela). */
export async function findBlockConflicts(
  db: DbClient,
  clinicId: string,
  { agendaId, startsAt, endsAt }: { agendaId: string; startsAt: Date; endsAt: Date },
): Promise<Appointment[]> {
  const dayBefore = new Date(startsAt.getTime() - 24 * 60 * 60_000);
  const candidates = await listAppointmentsBetween(db, clinicId, { from: dayBefore, to: endsAt, agendaIds: [agendaId], statuses: ["scheduled", "confirmed"] });
  return candidates.filter((a) => a.scheduledAt < endsAt && new Date(a.scheduledAt.getTime() + a.durationMinutes * 60_000) > startsAt);
}

async function cancelWithLinks(
  db: DbClient,
  clinicId: string,
  appointmentIds: string[],
  trailChannel: "mass_cancel" | "schedule_block",
  actorId: string | null,
  now: Date,
): Promise<CanceledWithLink[]> {
  const { canceled } = await cancelAppointments(db, clinicId, appointmentIds, { channel: "admin", trailChannel, actorId }, now);
  const result: CanceledWithLink[] = [];
  for (const appointment of canceled) {
    let rebookingLink: BookingLink | null = null;
    try {
      rebookingLink = await createRebookingLink(db, clinicId, appointment, now);
    } catch (error) {
      // Melhor esforço, como no piloto: falha num link não desfaz os cancelamentos.
      console.error("[bloqueio] não gerou link de remarcação", appointment.id, error);
    }
    result.push({ appointment, rebookingLink });
  }
  return result;
}

export async function createBlock(
  db: DbClient,
  clinicId: string,
  input: { agendaId: string; startsAt: Date; endsAt: Date; reason: string; cancelAppointmentIds: string[]; actorId: string | null },
  now: Date = new Date(),
): Promise<{ block: ScheduleBlock; canceled: CanceledWithLink[] }> {
  const reason = validatePeriod(input.startsAt, input.endsAt, input.reason);
  const canceled = input.cancelAppointmentIds.length
    ? await cancelWithLinks(db, clinicId, input.cancelAppointmentIds, "schedule_block", input.actorId, now)
    : [];
  const id = crypto.randomUUID();
  // Sem `.select()` no insert: a leitura passa pelo acesso à agenda (mesmo cuidado de agendas).
  unwrap(
    await db.from("schedule_blocks").insert({
      id,
      clinic_id: clinicId,
      agenda_id: input.agendaId,
      starts_at: input.startsAt.toISOString(),
      ends_at: input.endsAt.toISOString(),
      reason,
      created_by: input.actorId,
    }),
    "Bloqueio",
  );
  const block = toBlock(unwrapOne(await db.from("schedule_blocks").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Bloqueio"));
  return { block, canceled };
}

export async function updateBlock(
  db: DbClient,
  clinicId: string,
  id: string,
  input: { startsAt: Date; endsAt: Date; reason: string; actorId: string | null },
  now: Date = new Date(),
): Promise<ScheduleBlock> {
  const reason = validatePeriod(input.startsAt, input.endsAt, input.reason);
  return toBlock(
    unwrapOne(
      await db
        .from("schedule_blocks")
        .update({ starts_at: input.startsAt.toISOString(), ends_at: input.endsAt.toISOString(), reason, updated_at: now.toISOString(), updated_by: input.actorId })
        .eq("clinic_id", clinicId)
        .eq("id", id)
        .is("removed_at", null)
        .select(COLUMNS)
        .maybeSingle(),
      "Bloqueio",
    ),
  );
}

export async function removeBlock(db: DbClient, clinicId: string, id: string, actorId: string | null, now: Date = new Date()): Promise<void> {
  unwrapOne(
    await db
      .from("schedule_blocks")
      .update({ removed_at: now.toISOString(), removed_by: actorId })
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .is("removed_at", null)
      .select("id")
      .maybeSingle(),
    "Bloqueio",
  );
}

/** Cancelamento pela clínica de uma lista de atendimentos (dia inteiro, Fase 12), com link de remarcação. */
export async function cancelByClinic(
  db: DbClient,
  clinicId: string,
  appointmentIds: string[],
  actorId: string | null,
  now: Date = new Date(),
): Promise<CanceledWithLink[]> {
  return cancelWithLinks(db, clinicId, appointmentIds, "mass_cancel", actorId, now);
}

