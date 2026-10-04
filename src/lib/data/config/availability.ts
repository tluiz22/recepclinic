import { isClockTime } from "../../clinicTime";
import type { DbClient } from "../clients";
import { DataError, unwrap, unwrapOne, Validation } from "../errors";

// Dias e horários de atendimento de cada agenda, por local. Uma janela pode
// valer só para um serviço (ex.: exame só na terça) e, se o serviço for em
// turma, define as vagas (`capacity`).
//
// Sobreposição (decisão do cliente, 04/out/2026, F3.4): vale **por agenda**,
// mesmo em locais diferentes; agendas diferentes nunca conflitam. Na mesma
// agenda e no mesmo dia, duas janelas ativas que se cruzam conflitam quando:
//   - uma delas é geral (sem serviço);
//   - as duas são do mesmo serviço;
//   - uma delas é de turma.
// Serviços individuais diferentes podem dividir horário (regra do piloto para
// exames): a trava de horário da agenda impede dois atendimentos ao mesmo tempo.
// Janelas inativas e de serviços inativos não contam.

export type AvailabilityWindow = {
  id: string;
  agendaId: string;
  locationId: string;
  /** null = qualquer serviço da agenda. */
  serviceId: string | null;
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  /** "HH:mm" no fuso da clínica. */
  startTime: string;
  endTime: string;
  /** Vagas da turma (só serviço em turma). */
  capacity: number | null;
  isActive: boolean;
};

export type AvailabilityWindowInput = Omit<AvailabilityWindow, "id" | "isActive">;

export type WindowConflictKind = "general" | "same_service" | "group";

export type WindowConflict = { kind: WindowConflictKind; window: AvailabilityWindow };

type Comparable = Pick<AvailabilityWindow, "weekday" | "startTime" | "endTime" | "serviceId" | "capacity"> & { id?: string };

/** Regra de sobreposição da agenda (ver o topo do arquivo). Devolve o primeiro conflito. */
export function findWindowConflict(candidate: Comparable, existing: AvailabilityWindow[]): WindowConflict | null {
  for (const other of existing) {
    if (!other.isActive || other.id === candidate.id || other.weekday !== candidate.weekday) continue;
    if (!(candidate.startTime < other.endTime && candidate.endTime > other.startTime)) continue;
    if (candidate.serviceId === null || other.serviceId === null) return { kind: "general", window: other };
    if (candidate.serviceId === other.serviceId) return { kind: "same_service", window: other };
    if (candidate.capacity !== null || other.capacity !== null) return { kind: "group", window: other };
  }
  return null;
}

const COLUMNS = "id, agenda_id, location_id, service_id, weekday, start_time, end_time, capacity, is_active";

type Row = {
  id: string;
  agenda_id: string;
  location_id: string;
  service_id: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  capacity: number | null;
  is_active: boolean;
};

const toWindow = (row: Row): AvailabilityWindow => ({
  id: row.id,
  agendaId: row.agenda_id,
  locationId: row.location_id,
  serviceId: row.service_id,
  weekday: row.weekday,
  startTime: row.start_time.slice(0, 5),
  endTime: row.end_time.slice(0, 5),
  capacity: row.capacity,
  isActive: row.is_active,
});

export async function listAvailability(
  db: DbClient,
  clinicId: string,
  agendaId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<AvailabilityWindow[]> {
  let query = db
    .from("availability_windows")
    .select(COLUMNS)
    .eq("clinic_id", clinicId)
    .eq("agenda_id", agendaId)
    .order("weekday")
    .order("start_time");
  if (!includeInactive) query = query.eq("is_active", true);
  return unwrap(await query, "Horários de atendimento").map(toWindow);
}

/** Janelas ativas da agenda que contam para a sobreposição (serviço inativo não conta). */
async function windowsThatCount(db: DbClient, clinicId: string, agendaId: string): Promise<AvailabilityWindow[]> {
  const rows = unwrap(
    await db
      .from("availability_windows")
      .select(`${COLUMNS}, services ( is_active )`)
      .eq("clinic_id", clinicId)
      .eq("agenda_id", agendaId)
      .eq("is_active", true),
    "Horários de atendimento",
  ) as unknown as (Row & { services: { is_active: boolean } | null })[];
  return rows.filter((row) => row.services?.is_active ?? true).map(toWindow);
}

function validateWindowShape(input: AvailabilityWindowInput): void {
  const v = new Validation();
  v.check(Number.isInteger(input.weekday) && input.weekday >= 0 && input.weekday <= 6, "weekday", "Dia da semana inválido");
  v.check(isClockTime(input.startTime), "startTime", "Hora de início no formato HH:mm");
  v.check(isClockTime(input.endTime), "endTime", "Hora de fim no formato HH:mm");
  v.check(!(isClockTime(input.startTime) && isClockTime(input.endTime)) || input.startTime < input.endTime, "endTime", "O fim precisa ser depois do início");
  v.check(input.capacity === null || (Number.isInteger(input.capacity) && input.capacity > 0), "capacity", "Vagas: número inteiro maior que 0");
  v.throwIfInvalid("Horário de atendimento");
}

/** Serviço da janela: precisa ser atendido na agenda; turma exige vagas, individual não aceita. */
async function checkWindowService(db: DbClient, clinicId: string, input: AvailabilityWindowInput): Promise<void> {
  if (input.serviceId === null) {
    if (input.capacity !== null) throw new DataError("invalid", "Horário de atendimento: vagas só em horário de turma", { capacity: "Vagas só para serviço em turma" });
    return;
  }
  const service = unwrapOne(
    await db
      .from("services")
      .select("scheduling_mode, service_agendas ( agenda_id )")
      .eq("clinic_id", clinicId)
      .eq("id", input.serviceId)
      .maybeSingle(),
    "Serviço do horário",
  ) as unknown as { scheduling_mode: string; service_agendas: { agenda_id: string }[] };

  const v = new Validation();
  v.check(service.service_agendas.some((link) => link.agenda_id === input.agendaId), "serviceId", "O serviço não é atendido nesta agenda");
  if (service.scheduling_mode === "group") v.check(input.capacity !== null, "capacity", "Informe as vagas da turma");
  else v.check(input.capacity === null, "capacity", "Vagas só para serviço em turma");
  v.throwIfInvalid("Horário de atendimento");
}

function conflictError(conflict: WindowConflict): DataError {
  const { window } = conflict;
  const reason = {
    general: "cruza com outro horário desta agenda",
    same_service: "cruza com outro horário do mesmo serviço",
    group: "cruza com um horário de turma",
  }[conflict.kind];
  return new DataError("conflict", `Horário de atendimento: ${reason} (${window.startTime}–${window.endTime})`, {
    startTime: reason,
  });
}

export async function addAvailabilityWindow(
  db: DbClient,
  clinicId: string,
  input: AvailabilityWindowInput,
): Promise<AvailabilityWindow> {
  validateWindowShape(input);
  await checkWindowService(db, clinicId, input);
  const conflict = findWindowConflict(input, await windowsThatCount(db, clinicId, input.agendaId));
  if (conflict) throw conflictError(conflict);
  return toWindow(
    unwrap(
      await db
        .from("availability_windows")
        .insert({
          clinic_id: clinicId,
          agenda_id: input.agendaId,
          location_id: input.locationId,
          service_id: input.serviceId,
          weekday: input.weekday,
          start_time: input.startTime,
          end_time: input.endTime,
          capacity: input.capacity,
        })
        .select(COLUMNS)
        .single(),
      "Horário de atendimento",
    ),
  );
}

/** Reativar confere a sobreposição de novo (pode ter entrado outro horário no lugar). */
export async function setAvailabilityWindowActive(db: DbClient, clinicId: string, id: string, isActive: boolean): Promise<void> {
  if (isActive) {
    const window = toWindow(
      unwrapOne(await db.from("availability_windows").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Horário de atendimento"),
    );
    const conflict = findWindowConflict(window, await windowsThatCount(db, clinicId, window.agendaId));
    if (conflict) throw conflictError(conflict);
  }
  unwrapOne(
    await db.from("availability_windows").update({ is_active: isActive }).eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(),
    "Horário de atendimento",
  );
}

export async function removeAvailabilityWindow(db: DbClient, clinicId: string, id: string): Promise<void> {
  unwrapOne(
    await db.from("availability_windows").delete().eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(),
    "Horário de atendimento",
  );
}
