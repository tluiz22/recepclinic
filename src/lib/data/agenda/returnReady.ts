import { localDateOf, todayIn } from "../../clinicTime";
import type { DbClient } from "../clients";
import { unwrap } from "../errors";
import { findBlockingAppointment, listUpcomingAppointments, returnLastDate } from "./appointments";
import type { AgendaAppointment } from "./view";

// "Marcar retorno" no cartão da Consulta realizada (cliente, 19/out/2026): o
// botão só aparece na Consulta apta, pelas mesmas regras do bot (Fase 17):
//   1. Consulta com "Compareceu";
//   2. a última Consulta do paciente nessa agenda;
//   3. não domiciliar;
//   4. sem Retorno ligado (cancelado não conta);
//   5. dentro do prazo de algum serviço de Retorno da agenda;
//   6. sem Consulta/Retorno futuro na mesma agenda (a trava de duplicidade);
//   7. a agenda atende algum serviço de Retorno ativo.

/** Consulta apta: o serviço de Retorno já escolhido (null = mais de um, a recepção escolhe). */
export type ReturnReady = { serviceId: string | null };

type ReturnService = { id: string; deadlineDays: number | null };

export async function listReturnReady(
  db: DbClient,
  clinicId: string,
  appointments: Pick<AgendaAppointment, "id" | "agendaId" | "patientId" | "category" | "status" | "isHomeVisit" | "scheduledAt">[],
  timeZone: string,
  now: Date = new Date(),
): Promise<Map<string, ReturnReady>> {
  const result = new Map<string, ReturnReady>();
  const done = appointments.filter((a) => a.category === "consultation" && a.status === "completed" && !a.isHomeVisit && a.scheduledAt <= now);
  if (!done.length) return result;

  const services = unwrap(
    await db
      .from("services")
      .select("id, return_deadline_days, service_agendas ( agenda_id )")
      .eq("clinic_id", clinicId)
      .eq("category", "return_visit")
      .eq("is_active", true)
      .order("created_at"),
    "Serviços de retorno",
  ) as unknown as { id: string; return_deadline_days: number | null; service_agendas: { agenda_id: string }[] }[];
  const returnsByAgenda = new Map<string, ReturnService[]>();
  for (const s of services) {
    for (const { agenda_id } of s.service_agendas) {
      returnsByAgenda.set(agenda_id, [...(returnsByAgenda.get(agenda_id) ?? []), { id: s.id, deadlineDays: s.return_deadline_days }]);
    }
  }
  const candidates = done.filter((a) => returnsByAgenda.has(a.agendaId));
  if (!candidates.length) return result;

  const patientIds = [...new Set(candidates.map((a) => a.patientId))];
  const agendaIds = [...new Set(candidates.map((a) => a.agendaId))];
  const [latestRows, usedRows, upcoming] = await Promise.all([
    db
      .from("appointments")
      .select("id, patient_id, agenda_id, services!inner ( category )")
      .eq("clinic_id", clinicId)
      .in("patient_id", patientIds)
      .in("agenda_id", agendaIds)
      .eq("services.category", "consultation")
      .in("status", ["completed", "scheduled", "confirmed"])
      .lt("scheduled_at", now.toISOString())
      .order("scheduled_at", { ascending: false })
      .then((r) => unwrap(r, "Últimas consultas") as unknown as { id: string; patient_id: string; agenda_id: string }[]),
    db
      .from("appointments")
      .select("origin_appointment_id")
      .eq("clinic_id", clinicId)
      .in("origin_appointment_id", candidates.map((a) => a.id))
      .neq("status", "canceled")
      .then((r) => unwrap(r, "Retornos das consultas")),
    listUpcomingAppointments(db, clinicId, patientIds, now),
  ]);

  // Já vem da mais recente para a mais antiga: fica a primeira de cada paciente na agenda.
  const latest = new Map<string, string>();
  for (const row of latestRows) {
    const key = `${row.patient_id}:${row.agenda_id}`;
    if (!latest.has(key)) latest.set(key, row.id);
  }
  const used = new Set(usedRows.map((row) => row.origin_appointment_id));
  const today = todayIn(timeZone, now);

  for (const a of candidates) {
    if (latest.get(`${a.patientId}:${a.agendaId}`) !== a.id || used.has(a.id)) continue;
    const returns = returnsByAgenda.get(a.agendaId)!;
    const date = localDateOf(a.scheduledAt, timeZone);
    const inTime = returns.filter((s) => {
      const lastDate = returnLastDate(date, s.deadlineDays);
      return lastDate === null || today <= lastDate;
    });
    if (!inTime.length) continue;
    const blocking = findBlockingAppointment(upcoming.get(a.patientId) ?? [], { serviceId: inTime[0].id, agendaId: a.agendaId, category: "return_visit" });
    if (blocking) continue;
    result.set(a.id, { serviceId: inTime.length === 1 ? inTime[0].id : null });
  }
  return result;
}
