import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { cancelByClinic } from "../../src/lib/data/agenda/blocks";
import { listAwaitingRebooking } from "../../src/lib/data/daily";
import { listPendingReminders, loadRelationshipLists, relationshipCounts } from "../../src/lib/data/relationship";
import { listWaitlist } from "../../src/lib/data/waitlist/entries";
import { asDb, at, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// CRM A1 — Central de Relacionamento: lembretes que pedem ação (Q4, Q11),
// as mesmas listas do Resumo do Dia, contadores = linhas e isolamento entre
// clínicas pelo RLS.

let clinic: AgendaFixture;
let other: AgendaFixture;
const ids = { failed: "", unanswered: "", recent: "" };

const book = (f: AgendaFixture, patientId: string, time: string, agendaId = f.ids.agendaDra) =>
  bookAppointment(
    asDb(f.reception),
    f.clinicId,
    { patientId, serviceId: f.ids.consulta, agendaId, start: at(MON1, time), locationId: f.ids.office, channel: "admin", actorId: f.reception.id },
    NOW,
  );

/** Lembrete enviado `minutesAgo` antes do NOW do teste. */
async function sendReminder(clinicId: string, appointmentId: string, status: string, minutesAgo: number, delivered: boolean) {
  const sentAt = new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
  const { error } = await adminClient()
    .from("whatsapp_messages")
    .insert({ clinic_id: clinicId, appointment_id: appointmentId, direction: "outbound", message_type: "appointment_reminder", status, created_at: sentAt });
  expect(error).toBeNull();
  if (delivered) await adminClient().from("appointments").update({ reminder_sent_at: sentAt }).eq("id", appointmentId);
}

beforeAll(async () => {
  clinic = await setupAgendaClinic("Clínica do teste do Relacionamento", "849444500");
  other = await setupAgendaClinic("Outra clínica do Relacionamento", "849444600");
  const { ids: p } = clinic;
  ids.failed = (await book(clinic, p.p1, "08:00")).appointment.id;
  ids.unanswered = (await book(clinic, p.p2, "09:00")).appointment.id;
  ids.recent = (await book(clinic, p.p3, "10:00")).appointment.id;
  await sendReminder(clinic.clinicId, ids.failed, "failed", 60, false);
  await sendReminder(clinic.clinicId, ids.unanswered, "delivered", 180, true);
  await sendReminder(clinic.clinicId, ids.recent, "delivered", 30, true);
});

afterAll(async () => {
  await clinic.cleanup();
  await other.cleanup();
});

describe("lembretes que pedem ação", () => {
  it("não entregue e sem resposta há mais de 2 horas, dos atendimentos por vir, na ordem do horário", async () => {
    const pending = await listPendingReminders(asDb(clinic.reception), clinic.clinicId, NOW);
    expect(pending.map((r) => [r.appointment.id, r.kind])).toEqual([
      [ids.failed, "not_delivered"],
      [ids.unanswered, "no_answer"],
    ]);
    expect(pending[1].sentAt.toISOString()).toBe(new Date(NOW.getTime() - 180 * 60_000).toISOString());
  });

  it("sai sozinho ao confirmar a presença ou ao cancelar (Q11)", async () => {
    const later = new Date(NOW.getTime() + 60_000);
    await adminClient().from("appointments").update({ patient_confirmed_at: NOW.toISOString() }).eq("id", ids.unanswered);
    await adminClient().from("appointments").update({ status: "canceled", canceled_at: NOW.toISOString() }).eq("id", ids.failed);
    expect(await listPendingReminders(asDb(clinic.reception), clinic.clinicId, later)).toEqual([]);
  });

  it("sem o item Lembrete automático, nada", async () => {
    // Paciente Um: o atendimento das 8h foi cancelado no teste anterior.
    const extra = (await book(clinic, clinic.ids.p1, "11:00")).appointment.id;
    await sendReminder(clinic.clinicId, extra, "failed", 60, false);
    expect((await listPendingReminders(asDb(clinic.reception), clinic.clinicId, NOW)).map((r) => r.appointment.id)).toEqual([extra]);
    const { data: all } = await adminClient().from("features").select("key");
    const keys = (all ?? []).map((row) => row.key as string);
    await adminClient().rpc("set_clinic_features", { p_clinic_id: clinic.clinicId, p_features: keys.filter((k) => k !== "reminders") });
    expect(await listPendingReminders(asDb(clinic.reception), clinic.clinicId, NOW)).toEqual([]);
    await adminClient().rpc("set_clinic_features", { p_clinic_id: clinic.clinicId, p_features: keys });
  });

  it("outra clínica não vê nada (RLS), nem pedindo pelo id da clínica", async () => {
    expect(await listPendingReminders(asDb(other.reception), clinic.clinicId, NOW)).toEqual([]);
    expect(await listPendingReminders(asDb(other.admin), other.clinicId, NOW)).toEqual([]);
  });
});

describe("as mesmas listas do Resumo do Dia", () => {
  it("contador = linhas, e a lista é a mesma do Resumo (Aguardando remarcação e Lista de espera)", async () => {
    const canceled = (await book(clinic, clinic.ids.p2, "08:00", clinic.ids.agendaDra2)).appointment.id;
    await cancelByClinic(asDb(clinic.admin), clinic.clinicId, [canceled], clinic.admin.id, NOW);
    const errors: string[] = [];
    const lists = await loadRelationshipLists(asDb(clinic.reception), clinic.clinicId, ["aguardando_remarcacao", "lembretes", "lista_espera"], (tab) => errors.push(tab), NOW);
    expect(errors).toEqual([]);
    const resumo = await listAwaitingRebooking(asDb(clinic.reception), clinic.clinicId, NOW);
    expect(lists.aguardando_remarcacao!.map((a) => a.id)).toEqual(resumo.map((a) => a.id));
    expect(lists.aguardando_remarcacao!.map((a) => a.id)).toContain(canceled);
    expect(lists.lista_espera!.map((e) => e.appointment.id)).toEqual((await listWaitlist(asDb(clinic.reception), clinic.clinicId)).map((e) => e.appointment.id));
    const counts = relationshipCounts(lists);
    expect(counts.aguardando_remarcacao).toBe(lists.aguardando_remarcacao!.length);
    expect(counts.lembretes).toBe(lists.lembretes!.length);
    expect(counts.lista_espera).toBe(lists.lista_espera!.length);
  });

  it("a outra clínica conta zero nas listas da primeira", async () => {
    const lists = await loadRelationshipLists(asDb(other.reception), clinic.clinicId, ["aguardando_remarcacao", "lembretes", "lista_espera"], () => {}, NOW);
    expect(relationshipCounts(lists)).toEqual({ aguardando_remarcacao: 0, lembretes: 0, lista_espera: 0 });
  });
});
