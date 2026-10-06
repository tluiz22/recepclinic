import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { bookAppointment, getAppointment } from "../../src/lib/data/agenda/appointments";
import { createBookingLink, type BookingLinkInput } from "../../src/lib/data/agenda/links";
import {
  confirmBookingLink,
  listLinkDates,
  listLinkGroupSessions,
  listLinkSlots,
  loadBookingPage,
} from "../../src/lib/data/agenda/publicBooking";
import { getService } from "../../src/lib/data/config/services";
import { adminClient, clinicServiceClient, createClinic, deleteClinics } from "./helpers";
import { asDb, at, codeOf, MON1, MON2, MON3, MON4, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F5.2 — Página pública /agendar/[token] com a credencial limitada à clínica.

let fixture: AgendaFixture;
let otherClinic: string;
let bot: DbClient;
const contacts: Record<string, { contactId: string; phone: string }> = {};

async function link(patient: "p1" | "p2" | "p3", input: Partial<BookingLinkInput> & Pick<BookingLinkInput, "serviceId">, now: Date = NOW) {
  return createBookingLink(
    bot,
    fixture.clinicId,
    {
      mode: "create",
      contactId: contacts[patient].contactId,
      patientId: fixture.ids[patient],
      agendaId: null,
      locationId: null,
      locationCategory: "clinic",
      appointmentId: null,
      originAppointmentId: null,
      contactPhone: contacts[patient].phone,
      homeVisitAddress: null,
      ttlMs: 30 * 60_000,
      ...input,
    },
    now,
  );
}

const times = (slots: { start: Date }[]) => slots.map((slot) => slot.start.toISOString());

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do link público", "849222500");
  otherClinic = await createClinic("Outra clínica (link público)");
  bot = clinicServiceClient(fixture.clinicId) as unknown as DbClient;
  const { data, error } = await adminClient()
    .from("patients")
    .select("id, contact_id, contacts ( phone )")
    .eq("clinic_id", fixture.clinicId);
  if (error) throw error;
  for (const key of ["p1", "p2", "p3"] as const) {
    const row = data.find((p) => p.id === fixture.ids[key])! as unknown as { contact_id: string; contacts: { phone: string } };
    contacts[key] = { contactId: row.contact_id, phone: row.contacts.phone };
  }
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteClinics([otherClinic]);
});

describe("link de agendamento na página pública", () => {
  it("primeiro horário disponível: junta as agendas do serviço; mesmo horário aparece uma vez", async () => {
    const created = await link("p1", { serviceId: fixture.ids.consulta });
    const page = await loadBookingPage(bot, fixture.clinicId, created.id, NOW);
    expect(page.state).toBe("form");
    expect(page.service).toMatchObject({ name: "Consulta", category: "consultation", isGroup: false });
    expect(page.patient.fullName).toBe("Paciente Um");
    expect(page.contact).toEqual({ fullName: "Resp. Paciente Um", phone: contacts.p1.phone });
    expect(page.candidates.agendas.map((a) => a.name)).toEqual(["Dr. Segundo", "Dra. Agenda"]);
    expect(page.candidates.locations.map((l) => l.name)).toEqual(["Consultório"]);

    const dates = await listLinkDates(bot, fixture.clinicId, page, NOW);
    expect(dates.slice(0, 2).map((d) => d.date)).toEqual([MON1, MON2]);
    const slots = await listLinkSlots(bot, fixture.clinicId, page, MON1, NOW);
    expect(slots[0]).toMatchObject({ agendaName: "Dr. Segundo", locationName: "Consultório", remaining: null });
    expect(slots[0].start.toISOString()).toBe(at(MON1, "08:00").toISOString());
    // 08:00 e 08:30 nas duas agendas: uma vez cada; depois só a Dra. Agenda.
    expect(slots.filter((s) => s.start.getTime() === at(MON1, "08:00").getTime())).toHaveLength(1);
    expect(slots.find((s) => s.start.getTime() === at(MON1, "09:00").getTime())?.agendaName).toBe("Dra. Agenda");
  });

  it("confirmar marca, usa o link e mostra o atendimento; de novo, o link já não vale", async () => {
    const created = await link("p1", { serviceId: fixture.ids.consulta });
    const result = await confirmBookingLink(
      bot,
      fixture.clinicId,
      created.id,
      { start: at(MON1, "09:00"), agendaId: fixture.ids.agendaDra, locationId: fixture.ids.office },
      NOW,
    );
    expect(result.status).toBe("confirmed");
    const page = await loadBookingPage(bot, fixture.clinicId, created.id, NOW);
    expect(page.state).toBe("used");
    expect(page.appointment).toMatchObject({ status: "scheduled", agendaName: "Dra. Agenda", locationName: "Consultório", address: "Rua A, 1" });
    expect(page.appointment!.scheduledAt.toISOString()).toBe(at(MON1, "09:00").toISOString());
    const appointment = await getAppointment(asDb(fixture.admin), fixture.clinicId, (result as { appointmentId: string }).appointmentId);
    expect(appointment).toMatchObject({ bookingChannel: "whatsapp_bot", patientId: fixture.ids.p1 });
    const { data: trail } = await adminClient().from("appointment_events").select("event_type, channel").eq("appointment_id", appointment.id);
    expect(trail).toEqual([{ event_type: "created", channel: "booking_link" }]);

    expect(
      await confirmBookingLink(bot, fixture.clinicId, created.id, { start: at(MON1, "10:00"), agendaId: fixture.ids.agendaDra, locationId: fixture.ids.office }, NOW),
    ).toEqual({ status: "unavailable" });
  });

  it("horário ocupado entre a escolha e a confirmação: avisa e devolve o link", async () => {
    await bookAppointment(asDb(fixture.admin), fixture.clinicId, {
      patientId: fixture.ids.p3, serviceId: fixture.ids.consulta, agendaId: fixture.ids.agendaDra2, start: at(MON2, "08:00"), channel: "admin", actorId: fixture.admin.id,
    }, NOW);
    const created = await link("p2", { serviceId: fixture.ids.consulta, agendaId: fixture.ids.agendaDra2 });
    expect(
      await confirmBookingLink(bot, fixture.clinicId, created.id, { start: at(MON2, "08:00"), agendaId: fixture.ids.agendaDra2, locationId: fixture.ids.office }, NOW),
    ).toEqual({ status: "slot_taken" });
    expect((await loadBookingPage(bot, fixture.clinicId, created.id, NOW)).state).toBe("form");
    // Agenda fora do link também não marca.
    expect(
      await confirmBookingLink(bot, fixture.clinicId, created.id, { start: at(MON2, "09:00"), agendaId: fixture.ids.agendaDra, locationId: fixture.ids.office }, NOW),
    ).toEqual({ status: "slot_taken" });
  });

  it("domiciliar: só os locais domiciliares, com o endereço do link", async () => {
    const created = await link("p2", { serviceId: fixture.ids.consulta, locationCategory: "home_visit", homeVisitAddress: "Rua do Paciente, 99" });
    const page = await loadBookingPage(bot, fixture.clinicId, created.id, NOW);
    expect(page.candidates.locations.map((l) => l.name)).toEqual(["Domiciliar"]);
    const slots = await listLinkSlots(bot, fixture.clinicId, page, MON1, NOW);
    expect(slots[0]).toMatchObject({ agendaName: "Dra. Agenda", locationName: "Domiciliar" });
    const result = await confirmBookingLink(
      bot, fixture.clinicId, created.id, { start: slots[0].start, agendaId: slots[0].agendaId, locationId: slots[0].locationId }, NOW,
    );
    expect(result.status).toBe("confirmed");
    expect((await loadBookingPage(bot, fixture.clinicId, created.id, NOW)).appointment?.address).toBe("Rua do Paciente, 99");
  });

  it("remarcação: mesma agenda, o próprio horário não ocupa; o atendimento muda de data", async () => {
    const { appointment } = await bookAppointment(asDb(fixture.admin), fixture.clinicId, {
      patientId: fixture.ids.p3, serviceId: fixture.ids.consulta, agendaId: fixture.ids.agendaDra, start: at(MON1, "10:00"), channel: "admin", actorId: fixture.admin.id,
    }, NOW);
    const created = await link("p3", { serviceId: fixture.ids.consulta, mode: "reschedule", appointmentId: appointment.id });
    const page = await loadBookingPage(bot, fixture.clinicId, created.id, NOW);
    expect(page.candidates.agendas.map((a) => a.name)).toEqual(["Dra. Agenda"]);
    expect(page.appointment?.scheduledAt.toISOString()).toBe(at(MON1, "10:00").toISOString());
    expect(times(await listLinkSlots(bot, fixture.clinicId, page, MON1, NOW))).toContain(at(MON1, "10:00").toISOString());

    const result = await confirmBookingLink(
      bot, fixture.clinicId, created.id, { start: at(MON3, "11:00"), agendaId: fixture.ids.agendaDra, locationId: fixture.ids.office }, NOW,
    );
    expect(result).toEqual({ status: "confirmed", appointmentId: appointment.id });
    const moved = await getAppointment(asDb(fixture.admin), fixture.clinicId, appointment.id);
    expect(moved.scheduledAt.toISOString()).toBe(at(MON3, "11:00").toISOString());
  });

  it("retorno da consulta: só datas até o prazo; um retorno por consulta", async () => {
    const later = at(MON2, "12:00");
    // Consulta já passada (o domiciliar futuro do Paciente Dois travaria a marcação pela tela).
    const { data: origin, error } = await adminClient()
      .from("appointments")
      .insert({
        clinic_id: fixture.clinicId, patient_id: fixture.ids.p2, service_id: fixture.ids.consulta, agenda_id: fixture.ids.agendaDra,
        location_id: fixture.ids.office, scheduled_at: at(MON1, "11:00").toISOString(), duration_minutes: 30, booking_channel: "admin",
      })
      .select("id")
      .single();
    if (error) throw error;
    const first = await link("p2", { serviceId: fixture.ids.retorno, agendaId: fixture.ids.agendaDra, originAppointmentId: origin.id }, later);
    const page = await loadBookingPage(bot, fixture.clinicId, first.id, later);
    expect(page.lastDate).toBe("2031-04-09");
    expect((await listLinkDates(bot, fixture.clinicId, page, later)).map((d) => d.date)).toEqual([MON3, MON4, "2031-04-07"]);
    expect(await listLinkSlots(bot, fixture.clinicId, page, "2031-04-14", later)).toEqual([]);

    const second = await link("p2", { serviceId: fixture.ids.retorno, agendaId: fixture.ids.agendaDra, originAppointmentId: origin.id }, later);
    const booked = await confirmBookingLink(
      bot, fixture.clinicId, first.id, { start: at(MON4, "08:00"), agendaId: fixture.ids.agendaDra, locationId: fixture.ids.office }, later,
    );
    expect(booked.status).toBe("confirmed");
    const returnVisit = await getAppointment(asDb(fixture.admin), fixture.clinicId, (booked as { appointmentId: string }).appointmentId);
    expect(returnVisit.originAppointmentId).toBe(origin.id);
    // O segundo link já foi invalidado ao marcar (mesmo serviço); o retorno da consulta já foi usado.
    expect((await loadBookingPage(bot, fixture.clinicId, second.id, later)).state).toBe("used");
    const third = await link("p2", { serviceId: fixture.ids.retorno, agendaId: fixture.ids.agendaDra, originAppointmentId: origin.id }, later);
    expect(
      await confirmBookingLink(bot, fixture.clinicId, third.id, { start: at(MON4, "09:00"), agendaId: fixture.ids.agendaDra, locationId: fixture.ids.office }, later),
    ).toEqual({ status: "return_used" });
  });

  it("turma: sessões com vagas; confirmar ocupa uma vaga; lista de espera pedida entra", async () => {
    const created = await link("p1", { serviceId: fixture.ids.turma, joinWaitlist: true });
    const page = await loadBookingPage(bot, fixture.clinicId, created.id, NOW);
    expect(page.service.isGroup).toBe(true);
    const sessions = await listLinkGroupSessions(bot, fixture.clinicId, page, NOW);
    expect(sessions[0]).toMatchObject({ agendaName: "Exames", locationName: "Consultório", remaining: 2 });
    expect(sessions[0].start.toISOString()).toBe(at(MON1, "10:00").toISOString());

    const result = await confirmBookingLink(
      bot, fixture.clinicId, created.id, { start: sessions[0].start, agendaId: sessions[0].agendaId, locationId: sessions[0].locationId }, NOW,
    );
    expect(result.status).toBe("confirmed");
    const next = await listLinkGroupSessions(bot, fixture.clinicId, page, NOW);
    expect(next[0].remaining).toBe(1);
    const { data } = await adminClient()
      .from("waitlist_entries")
      .select("created_via")
      .eq("appointment_id", (result as { appointmentId: string }).appointmentId);
    expect(data).toEqual([{ created_via: "booking_link" }]);
  });

  it("link vencido mostra expirado; a credencial de outra clínica não abre o link", async () => {
    const created = await link("p3", { serviceId: fixture.ids.exame, ttlMs: 60_000 }, at("2031-03-01", "08:00"));
    expect((await loadBookingPage(bot, fixture.clinicId, created.id, NOW)).state).toBe("expired");
    const other = clinicServiceClient(otherClinic) as unknown as DbClient;
    expect(await codeOf(() => loadBookingPage(other, otherClinic, created.id, NOW))).toBe("not_found");
    expect(await codeOf(() => loadBookingPage(other, fixture.clinicId, created.id, NOW))).toBe("not_found");
  });
});

describe("página pública do preparo (F5.3)", () => {
  it("a credencial da clínica lê o preparo do exame; a de outra clínica não", async () => {
    await adminClient()
      .from("services")
      .update({ preparation_instructions: "*Jejum* de 4 horas." })
      .eq("id", fixture.ids.exame);
    const exam = await getService(bot, fixture.clinicId, fixture.ids.exame);
    expect(exam).toMatchObject({ name: "Exame", category: "exam", preparationInstructions: "*Jejum* de 4 horas." });
    const other = clinicServiceClient(otherClinic) as unknown as DbClient;
    expect(await codeOf(() => getService(other, fixture.clinicId, fixture.ids.exame))).toBe("not_found");
  });
});
