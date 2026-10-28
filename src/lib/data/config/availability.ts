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
//   - as duas são do mesmo serviço;
//   - uma delas é geral (sem serviço) ou de turma, e nenhuma é de exame.
// Exame (individual ou turma) cruza com qualquer outro horário (cliente,
// 28/out/2026, como na marcação: exame fica em paralelo com tudo). Serviços
// individuais diferentes podem dividir horário (regra do piloto para exames):
// a trava de horário da agenda impede dois atendimentos ao mesmo tempo.
// Janelas inativas e de serviços inativos não contam.
//
// Horário de um serviço num local que ele não usa (C5; cliente, 28/out/2026):
// salva e marca o local no cadastro do serviço (com o valor do serviço), para
// o horário valer no bot e no link (antes ficava cadastrado sem valer).

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
export function findWindowConflict(
  candidate: Comparable,
  existing: AvailabilityWindow[],
  examServiceIds: ReadonlySet<string> = new Set(),
): WindowConflict | null {
  const isExam = (serviceId: string | null) => serviceId !== null && examServiceIds.has(serviceId);
  for (const other of existing) {
    if (!other.isActive || other.id === candidate.id || other.weekday !== candidate.weekday) continue;
    if (!(candidate.startTime < other.endTime && candidate.endTime > other.startTime)) continue;
    if (candidate.serviceId !== null && candidate.serviceId === other.serviceId) return { kind: "same_service", window: other };
    if (isExam(candidate.serviceId) || isExam(other.serviceId)) continue;
    if (candidate.serviceId === null || other.serviceId === null) return { kind: "general", window: other };
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

/** Serviços de exame da clínica (cruzam com qualquer horário). */
async function examServiceIds(db: DbClient, clinicId: string): Promise<Set<string>> {
  const rows = unwrap(await db.from("services").select("id").eq("clinic_id", clinicId).eq("category", "exam"), "Exames da clínica");
  return new Set(rows.map((row) => row.id));
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

/** O local que o horário marcou no serviço ("Consultório A" em "Prick test"). */
export type LocationAdded = { service: string; location: string } | null;

/**
 * Serviço da janela: precisa ser atendido na agenda; turma exige vagas,
 * individual não aceita. Devolve o local a marcar no serviço, se ele ainda não é oferecido ali.
 */
async function checkWindowService(db: DbClient, clinicId: string, input: AvailabilityWindowInput): Promise<{ serviceId: string; locationId: string } | null> {
  if (input.serviceId === null) {
    if (input.capacity !== null) throw new DataError("invalid", "Horário de atendimento: vagas só em horário de turma", { capacity: "Vagas só para serviço em turma" });
    return null;
  }
  const service = unwrapOne(
    await db
      .from("services")
      .select("scheduling_mode, service_agendas ( agenda_id ), service_locations ( location_id )")
      .eq("clinic_id", clinicId)
      .eq("id", input.serviceId)
      .maybeSingle(),
    "Serviço do horário",
  ) as unknown as { scheduling_mode: string; service_agendas: { agenda_id: string }[]; service_locations: { location_id: string }[] };

  const v = new Validation();
  v.check(service.service_agendas.some((link) => link.agenda_id === input.agendaId), "serviceId", "O serviço não é atendido nesta agenda");
  if (service.scheduling_mode === "group") v.check(input.capacity !== null, "capacity", "Informe as vagas da turma");
  else v.check(input.capacity === null, "capacity", "Vagas só para serviço em turma");
  v.throwIfInvalid("Horário de atendimento");
  return service.service_locations.some((link) => link.location_id === input.locationId) ? null : { serviceId: input.serviceId, locationId: input.locationId };
}

/** Marca o local no serviço (valor do serviço), depois de o horário ser salvo. */
async function addServiceLocation(db: DbClient, clinicId: string, missing: { serviceId: string; locationId: string } | null): Promise<LocationAdded> {
  if (!missing) return null;
  unwrap(
    await db
      .from("service_locations")
      .upsert({ clinic_id: clinicId, service_id: missing.serviceId, location_id: missing.locationId, price_cents: null }, { onConflict: "service_id,location_id", ignoreDuplicates: true }),
    "Locais do serviço",
  );
  const [service, location] = await Promise.all([
    db.from("services").select("name").eq("clinic_id", clinicId).eq("id", missing.serviceId).maybeSingle().then((r) => unwrapOne(r, "Serviço")),
    db.from("locations").select("name").eq("clinic_id", clinicId).eq("id", missing.locationId).maybeSingle().then((r) => unwrapOne(r, "Local")),
  ]);
  return { service: service.name, location: location.name };
}

export const WEEKDAY_NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

function conflictError(conflict: WindowConflict): DataError {
  const { window } = conflict;
  const reason = {
    general: "cruza com outro horário desta agenda",
    same_service: "cruza com outro horário do mesmo serviço",
    group: "cruza com um horário de turma",
  }[conflict.kind];
  const when = `${WEEKDAY_NAMES[window.weekday].toLowerCase()}, ${window.startTime}–${window.endTime}`;
  return new DataError("conflict", `Horário de atendimento: ${reason} (${when})`, {
    startTime: reason,
  });
}

export async function addAvailabilityWindow(
  db: DbClient,
  clinicId: string,
  input: AvailabilityWindowInput,
): Promise<AvailabilityWindow> {
  const {
    windows: [created],
  } = await addAvailabilityWindows(db, clinicId, input, [input.weekday]);
  return created;
}

/**
 * O mesmo horário em vários dias da semana (tela de Horários, F4.4b): confere
 * todos antes e grava de uma vez, então um conflito num dia não deixa os
 * outros pela metade.
 */
export async function addAvailabilityWindows(
  db: DbClient,
  clinicId: string,
  input: Omit<AvailabilityWindowInput, "weekday">,
  weekdays: number[],
): Promise<{ windows: AvailabilityWindow[]; locationAdded: LocationAdded }> {
  const days = [...new Set(weekdays)].sort();
  if (!days.length) throw new DataError("invalid", "Horário de atendimento: escolha ao menos um dia", { weekday: "Escolha ao menos um dia da semana" });
  const inputs = days.map((weekday) => ({ ...input, weekday }));
  for (const one of inputs) validateWindowShape(one);
  const missing = await checkWindowService(db, clinicId, inputs[0]);
  const [existing, exams] = await Promise.all([windowsThatCount(db, clinicId, input.agendaId), examServiceIds(db, clinicId)]);
  for (const one of inputs) {
    const conflict = findWindowConflict(one, existing, exams);
    if (conflict) throw conflictError(conflict);
  }
  const windows = unwrap(
    await db
      .from("availability_windows")
      .insert(
        inputs.map((one) => ({
          clinic_id: clinicId,
          agenda_id: one.agendaId,
          location_id: one.locationId,
          service_id: one.serviceId,
          weekday: one.weekday,
          start_time: one.startTime,
          end_time: one.endTime,
          capacity: one.capacity,
        })),
      )
      .select(COLUMNS),
    "Horário de atendimento",
  ).map(toWindow);
  return { windows, locationAdded: await addServiceLocation(db, clinicId, missing) };
}

/**
 * Editar um horário (cliente, 21/out/2026): dia, início, fim, local, serviço e
 * vagas, com as mesmas regras do adicionar; a sobreposição não conta o próprio
 * horário e só vale se ele está ativo. Os atendimentos já marcados ficam como estão.
 */
export async function updateAvailabilityWindow(
  db: DbClient,
  clinicId: string,
  id: string,
  input: Omit<AvailabilityWindowInput, "agendaId">,
): Promise<{ window: AvailabilityWindow; locationAdded: LocationAdded }> {
  const current = toWindow(
    unwrapOne(await db.from("availability_windows").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Horário de atendimento"),
  );
  const next = { ...input, agendaId: current.agendaId };
  validateWindowShape(next);
  const missing = await checkWindowService(db, clinicId, next);
  if (current.isActive) {
    const conflict = findWindowConflict({ ...next, id }, await windowsThatCount(db, clinicId, current.agendaId), await examServiceIds(db, clinicId));
    if (conflict) throw conflictError(conflict);
  }
  const window = toWindow(
    unwrapOne(
      await db
        .from("availability_windows")
        .update({
          location_id: next.locationId,
          service_id: next.serviceId,
          weekday: next.weekday,
          start_time: next.startTime,
          end_time: next.endTime,
          capacity: next.capacity,
        })
        .eq("clinic_id", clinicId)
        .eq("id", id)
        .select(COLUMNS)
        .maybeSingle(),
      "Horário de atendimento",
    ),
  );
  return { window, locationAdded: await addServiceLocation(db, clinicId, missing) };
}

/** Horários ativos de um serviço (a tela do serviço avisa antes de tirar um local que eles usam). */
export async function listServiceWindows(db: DbClient, clinicId: string, serviceId: string): Promise<AvailabilityWindow[]> {
  return unwrap(
    await db
      .from("availability_windows")
      .select(COLUMNS)
      .eq("clinic_id", clinicId)
      .eq("service_id", serviceId)
      .eq("is_active", true)
      .order("weekday")
      .order("start_time"),
    "Horários do serviço",
  ).map(toWindow);
}

/**
 * Tirar um local do serviço (C5; cliente, 28/out/2026): os horários do serviço
 * nos locais que ele deixou de usar ficam desativados (não somem). Devolve quantos.
 */
export async function deactivateServiceWindowsOutside(db: DbClient, clinicId: string, serviceId: string, locationIds: string[]): Promise<number> {
  let query = db.from("availability_windows").update({ is_active: false }).eq("clinic_id", clinicId).eq("service_id", serviceId).eq("is_active", true);
  if (locationIds.length) query = query.not("location_id", "in", `(${locationIds.join(",")})`);
  return unwrap(await query.select("id"), "Horários do serviço").length;
}

/** Reativar confere a sobreposição de novo (pode ter entrado outro horário no lugar). */
export async function setAvailabilityWindowActive(db: DbClient, clinicId: string, id: string, isActive: boolean): Promise<void> {
  if (isActive) {
    const window = toWindow(
      unwrapOne(await db.from("availability_windows").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Horário de atendimento"),
    );
    const conflict = findWindowConflict(window, await windowsThatCount(db, clinicId, window.agendaId), await examServiceIds(db, clinicId));
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
