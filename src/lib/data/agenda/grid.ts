import { dayBounds } from "../../clinicTime";
import type { DbClient } from "../clients";
import { unwrap } from "../errors";

// Dados da Agenda em colunas (F5a): especialidades dos profissionais (grupos e filtro) e as reservas do portal do dia
// (tracejadas na grade, "Em reserva até 10:42"). Leitura com o login de quem olha.

/** Especialidades de cada profissional, na ordem do cadastro (a primeira dá o grupo da coluna). */
export async function loadSpecialtiesByProfessional(db: DbClient, clinicId: string): Promise<Map<string, string[]>> {
  const rows = unwrap(
    await db.from("professional_specialties").select("professional_id, position, kb_specialties ( name, is_active )").eq("clinic_id", clinicId).order("position"),
    "Especialidades dos profissionais",
  ) as unknown as { professional_id: string; kb_specialties: { name: string; is_active: boolean } | null }[];
  const result = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.kb_specialties?.is_active) continue;
    result.set(row.professional_id, [...(result.get(row.professional_id) ?? []), row.kb_specialties.name]);
  }
  return result;
}

export type PortalHold = { agendaId: string; serviceId: string | null; start: Date; end: Date; expiresAt: Date };

/** Reservas do portal ainda valendo entre dois dias (inclusive), nas agendas dadas. */
export async function listPortalHolds(
  db: DbClient,
  clinicId: string,
  { fromDate, toDate, agendaIds, timeZone }: { fromDate: string; toDate: string; agendaIds: string[]; timeZone: string },
  now: Date = new Date(),
): Promise<PortalHold[]> {
  if (agendaIds.length === 0) return [];
  const rows = unwrap(
    await db
      .from("slot_holds")
      .select("agenda_id, service_id, starts_at, ends_at, expires_at")
      .eq("clinic_id", clinicId)
      .in("agenda_id", agendaIds)
      .is("released_at", null)
      .is("appointment_id", null)
      .gt("expires_at", now.toISOString())
      .lt("starts_at", dayBounds(toDate, timeZone).end.toISOString())
      .gt("ends_at", dayBounds(fromDate, timeZone).start.toISOString())
      .order("starts_at"),
    "Reservas do portal",
  );
  return rows.map((h) => ({
    agendaId: h.agenda_id,
    serviceId: h.service_id,
    start: new Date(h.starts_at),
    end: new Date(h.ends_at),
    expiresAt: new Date(h.expires_at),
  }));
}

/** Janelas de atendimento do dia da semana (minutos do dia), para a grade cobrir o horário de atendimento inteiro. */
export async function loadWindowSpans(db: DbClient, clinicId: string, agendaIds: string[], weekday: number): Promise<{ start: number; end: number }[]> {
  if (agendaIds.length === 0) return [];
  const rows = unwrap(
    await db.from("availability_windows").select("start_time, end_time").eq("clinic_id", clinicId).eq("is_active", true).eq("weekday", weekday).in("agenda_id", agendaIds),
    "Horários de atendimento",
  );
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return rows.map((w) => ({ start: minutes(w.start_time), end: minutes(w.end_time) }));
}
