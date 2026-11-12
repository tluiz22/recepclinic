import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { cancelByClinic } from "../../src/lib/data/agenda/blocks";
import { createPortalLink, getPortalLink, linkSpentByBooking, portalLinkState, renewPortalLink, sessionLinkFor, PORTAL_REBOOKING_TTL_MS } from "../../src/lib/data/portal/links";
import {
  cancelMine,
  findMyAppointment,
  isRescheduleSlotFree,
  leadHoursOf,
  listMyAppointments,
  outsideLead,
  rescheduleDates,
  rescheduleMine,
  rescheduleScope,
  rescheduleSlots,
} from "../../src/lib/data/portal/myAppointments";
import { adminClient, clinicServiceClient } from "./helpers";
import { asDb, at, MON1, MON2, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F3c da recepção digital: Minhas consultas (P12) com a antecedência da clínica (RD10, só no portal), remarcar pelos
// dias e horários do mesmo profissional, cancelar pelo canal do portal, o link do bot sem a antecedência (F3-4) e a
// remarcação depois do cancelamento pela clínica (F3-3).

const TZ = "America/Fortaleza";
const PREFIX = "+55849912391";
const PHONE = `${PREFIX}01`;
const NOW = new Date("2031-03-01T12:00:00Z");
let f: AgendaFixture;
let service: DbClient;

/** Marca na agenda da Dra. Agenda; o paciente fica só com este (a regra de um atendimento futuro por agenda). */
const book = async (patientId: string, date: string, time: string, agendaId = f.ids.agendaDra, serviceId = f.ids.consulta) => {
  await adminClient().from("appointments").update({ status: "canceled", canceled_at: new Date().toISOString() }).eq("patient_id", patientId).in("status", ["scheduled", "confirmed"]);
  return (
    await bookAppointment(asDb(f.reception), f.clinicId, {
      patientId,
      serviceId,
      agendaId,
      start: at(date, time),
      locationId: f.ids.office,
      channel: "admin",
      actorId: f.reception.id,
      anyTime: true,
      acceptedWarnings: true,
    })
  ).appointment;
};

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Minhas consultas", PREFIX);
  service = clinicServiceClient(f.clinicId) as unknown as DbClient;
  await adminClient().from("clinics").update({ portal_slug: `mc-${Date.now()}` }).eq("id", f.clinicId);
});

afterAll(async () => f.cleanup());

describe("Minhas consultas (F3c)", () => {
  it("lista só as próximas consultas dos pacientes do celular, e só eles alteram", async () => {
    const mine = await book(f.ids.p1, MON1, "08:00");
    const other = await book(f.ids.p2, MON1, "08:30");
    const items = await listMyAppointments(service, f.clinicId, PHONE, NOW);
    expect(items.map((i) => i.id)).toEqual([mine.id]);
    expect(items[0]).toMatchObject({ patientName: "Paciente Um", professionalName: "Dra. Agenda", category: "consultation" });
    expect(await findMyAppointment(service, f.clinicId, PHONE, other.id, { now: NOW })).toBeNull();
    expect(await findMyAppointment(service, f.clinicId, PHONE, "nao-e-id", { now: NOW })).toBeNull();
  });

  it("antecedência da clínica (padrão 0 h, sem prazo; com 24 h): dentro dela não cancela pelo portal; fora, cancela pelo canal do portal", async () => {
    expect(await leadHoursOf(service, f.clinicId)).toBe(0);
    const appointment = await book(f.ids.p1, MON1, "09:00");
    const item = (await findMyAppointment(service, f.clinicId, PHONE, appointment.id, { now: NOW }))!;
    const close = new Date(at(MON1, "09:00").getTime() - 2 * 3_600_000);
    expect(outsideLead(item.start, 24, close)).toBe(false);
    expect(await cancelMine(service, f.clinicId, { item, leadHours: 24, sender: null }, close)).toEqual({ status: "lead" });
    expect(await cancelMine(service, f.clinicId, { item, leadHours: 24, sender: null }, NOW)).toEqual({ status: "done", appointmentId: appointment.id });
    const { data } = await adminClient().from("appointments").select("status, canceled_via").eq("id", appointment.id).single();
    expect(data).toEqual({ status: "canceled", canceled_via: "portal" });
    // Cancelado: some da lista e não cancela de novo.
    expect(await cancelMine(service, f.clinicId, { item, leadHours: 24, sender: null }, NOW)).toEqual({ status: "gone" });
  });

  it("remarcar: dias e horários do mesmo profissional (o horário de hoje não é novo) e a remarcação pelo portal", async () => {
    const appointment = await book(f.ids.p1, MON1, "10:00");
    const item = (await findMyAppointment(service, f.clinicId, PHONE, appointment.id, { now: NOW }))!;
    const scope = await rescheduleScope(service, f.clinicId, item, { timeZone: TZ, sessionId: null, rebook: false, now: NOW });
    expect(scope.locations.map((l) => l.id)).toEqual([f.ids.office]);
    const dates = await rescheduleDates(service, f.clinicId, item, scope, NOW);
    expect(dates).toContain(MON2);
    const slots = await rescheduleSlots(service, f.clinicId, item, scope, MON1, NOW);
    expect(slots.some((s) => s.start.getTime() === at(MON1, "10:00").getTime())).toBe(false);
    const slot = { start: at(MON2, "11:00"), locationId: f.ids.office };
    expect(await isRescheduleSlotFree(service, f.clinicId, item, scope, slot, TZ, NOW)).toBe(true);
    // Local de outro serviço ou outro tipo: recusado.
    expect(await isRescheduleSlotFree(service, f.clinicId, item, scope, { ...slot, locationId: f.ids.home }, TZ, NOW)).toBe(false);
    expect(await rescheduleMine(service, f.clinicId, { item, slot, scope, rebook: false, leadHours: 24, sender: null }, NOW)).toEqual({ status: "done", appointmentId: appointment.id });
    const { data } = await adminClient().from("appointments").select("scheduled_at, status").eq("id", appointment.id).single();
    expect(new Date(data!.scheduled_at).getTime()).toBe(slot.start.getTime());
  });

  it("horário tomado por outro canal no meio: \"taken\"", async () => {
    const appointment = await book(f.ids.p1, MON2, "08:00");
    const item = (await findMyAppointment(service, f.clinicId, PHONE, appointment.id, { now: NOW }))!;
    const scope = await rescheduleScope(service, f.clinicId, item, { timeZone: TZ, sessionId: null, rebook: false, now: NOW });
    await book(f.ids.p3, MON2, "09:00");
    const outcome = await rescheduleMine(service, f.clinicId, { item, slot: { start: at(MON2, "09:00"), locationId: f.ids.office }, scope, rebook: false, leadHours: null, sender: null }, NOW);
    expect(outcome).toEqual({ status: "taken" });
  });

  it("link do bot para remarcar: libera sem a antecedência (F3-4) só para aquele atendimento", async () => {
    const appointment = await book(f.ids.p1, MON2, "10:00");
    const link = await createPortalLink(service, f.clinicId, { phone: PHONE, purpose: "reschedule", appointmentId: appointment.id });
    expect(await sessionLinkFor(service, f.clinicId, { linkId: link.id }, appointment.id)).toMatchObject({ noLead: true, rebook: false });
    expect(await sessionLinkFor(service, f.clinicId, { linkId: link.id }, f.ids.p1)).toMatchObject({ noLead: false, rebook: false });
    expect(await sessionLinkFor(service, f.clinicId, null, appointment.id)).toMatchObject({ noLead: false });
    // Vencido há mais de 30 min (a folga) ou trocado por outro: não libera mais.
    expect(await sessionLinkFor(service, f.clinicId, { linkId: link.id }, appointment.id, new Date(link.expiresAt.getTime() + 31 * 60_000))).toMatchObject({ noLead: false });
    expect(await sessionLinkFor(service, f.clinicId, { linkId: link.id }, appointment.id, new Date(link.expiresAt.getTime() + 10 * 60_000))).toMatchObject({ noLead: true });
    await createPortalLink(service, f.clinicId, { phone: PHONE, purpose: "reschedule", appointmentId: appointment.id });
    expect(await sessionLinkFor(service, f.clinicId, { linkId: link.id }, appointment.id)).toMatchObject({ noLead: false });
  });

  it("cancelamento pela clínica com o portal: o aviso leva o link do portal, que marca de novo o mesmo atendimento", async () => {
    const appointment = await book(f.ids.p1, MON2, "11:00");
    const [canceled] = await cancelByClinic(asDb(f.admin), f.clinicId, [appointment.id], f.admin.id, NOW);
    expect(canceled.rebookingLink).toBeNull();
    expect(canceled.portalLink).toMatchObject({ purpose: "reschedule", appointmentId: appointment.id, canceledAppointmentId: appointment.id, phone: PHONE });
    const allowed = await sessionLinkFor(service, f.clinicId, { linkId: canceled.portalLink!.id }, appointment.id);
    expect(allowed).toMatchObject({ noLead: true, rebook: true });
    const item = (await findMyAppointment(service, f.clinicId, PHONE, appointment.id, { now: NOW, canceledByClinic: true }))!;
    expect(item.status).toBe("canceled");
    const scope = await rescheduleScope(service, f.clinicId, item, { timeZone: TZ, sessionId: null, rebook: true, now: NOW });
    const outcome = await rescheduleMine(service, f.clinicId, { item, slot: { start: at(MON2, "11:30"), locationId: f.ids.office }, scope, rebook: true, leadHours: null, sender: null }, NOW);
    expect(outcome.status).toBe("done");
    const { data } = await adminClient().from("appointments").select("patient_id, agenda_id, booking_channel, status").eq("id", (outcome as { appointmentId: string }).appointmentId).single();
    expect(data).toEqual({ patient_id: f.ids.p1, agenda_id: f.ids.agendaDra, booking_channel: "portal", status: "scheduled" });
  });

  it("revisão: links de remarcar de atendimentos diferentes do mesmo celular não se anulam; o novo link da clínica mantém os 2 dias e a origem", async () => {
    const a = await book(f.ids.p1, MON2, "08:30");
    const b = await book(f.ids.p2, MON2, "09:30", f.ids.agendaDra, f.ids.consulta);
    const phone = PHONE;
    const first = await createPortalLink(service, f.clinicId, { phone, purpose: "reschedule", appointmentId: a.id });
    await createPortalLink(service, f.clinicId, { phone, purpose: "reschedule", appointmentId: b.id });
    expect(portalLinkState((await getPortalLink(service, f.clinicId, first.id))!)).toBe("valid");
    const again = await createPortalLink(service, f.clinicId, { phone, purpose: "reschedule", appointmentId: a.id });
    expect(portalLinkState((await getPortalLink(service, f.clinicId, first.id))!)).toBe("expired");
    // A marcação de uma consulta nova não gasta o link de remarcar.
    expect(linkSpentByBooking(again)).toBe(false);
    expect(linkSpentByBooking({ purpose: "book", usedAt: null })).toBe(true);
    expect(linkSpentByBooking({ purpose: "book", usedAt: new Date() })).toBe(false);

    const rebook = await createPortalLink(service, f.clinicId, { phone, purpose: "reschedule", appointmentId: a.id, canceledAppointmentId: a.id, originAppointmentId: null, ttlMs: PORTAL_REBOOKING_TTL_MS });
    const renewed = await renewPortalLink(service, f.clinicId, rebook.id);
    expect(renewed).toMatchObject({ canceledAppointmentId: a.id });
    expect(renewed.expiresAt.getTime() - Date.now()).toBeGreaterThan(PORTAL_REBOOKING_TTL_MS - 60_000);
  });
});
