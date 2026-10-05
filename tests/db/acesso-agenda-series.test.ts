import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, cancelAppointment, getAppointment, listUpcomingAppointments } from "../../src/lib/data/agenda/appointments";
import { cancelByClinic, createBlock, findBlockConflicts, listBlocks, removeBlock, updateBlock } from "../../src/lib/data/agenda/blocks";
import {
  BOT_LINK_TTL_MS,
  bookingLinkLastDate,
  claimBookingLink,
  createBookingLink,
  getBookingLink,
  linkState,
} from "../../src/lib/data/agenda/links";
import { changeSeriesFrom, createSeries, endSeriesFrom, extendSeries, getSeries, listSeriesSkips } from "../../src/lib/data/agenda/series";
import { getFreeSlots } from "../../src/lib/data/agenda/slots";
import { setMemberAgendaAccess } from "../../src/lib/data/config/agendas";
import { addClinicHoliday } from "../../src/lib/data/config/holidays";
import { adminClient, type TestUser } from "./helpers";
import { asDb, at, codeOf, MON1, MON2, MON3, MON4, NOW, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";

// F3.6b — bloqueios, links e séries recorrentes (D9), numa clínica criada
// para o teste (tests/db/agendaFixture.ts).
let fixture: AgendaFixture;
let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let ids: AgendaIds;
const db = asDb;

const book = (patient: string, service: string, agenda: string, start: Date, extra: Record<string, unknown> = {}, now = NOW) =>
  bookAppointment(db(reception), clinicId, { patientId: patient, serviceId: service, agendaId: agenda, start, channel: "admin", actorId: reception.id, ...extra }, now);

const localDate = (instant: Date) => instant.toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" });
const contactOf = async (patientId: string) => {
  const { data } = await adminClient().from("patients").select("contact_id, contacts ( phone )").eq("id", patientId).single();
  return data as unknown as { contact_id: string; contacts: { phone: string } };
};

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste de séries", "859777700");
  ({ clinicId, admin, reception, ids } = fixture);
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("links de agendamento", () => {
  it("link do bot vale 30 minutos e só é usado uma vez", async () => {
    const contact = await contactOf(ids.p1);
    const link = await createBookingLink(
      db(reception),
      clinicId,
      {
        mode: "create",
        contactId: contact.contact_id,
        patientId: ids.p1,
        serviceId: ids.consulta,
        agendaId: null,
        locationId: null,
        locationCategory: "clinic",
        appointmentId: null,
        originAppointmentId: null,
        contactPhone: contact.contacts.phone,
        homeVisitAddress: null,
        ttlMs: BOT_LINK_TTL_MS,
      },
      NOW,
    );
    expect(link.expiresAt.getTime() - NOW.getTime()).toBe(30 * 60_000);
    expect(linkState(link, NOW)).toBe("valid");
    expect(await claimBookingLink(db(reception), clinicId, link.id, new Date(link.expiresAt.getTime() + 1))).toBe(false);
    expect(await claimBookingLink(db(reception), clinicId, link.id, NOW)).toBe(true);
    expect(await claimBookingLink(db(reception), clinicId, link.id, NOW)).toBe(false);
    expect(linkState(await getBookingLink(db(reception), clinicId, link.id), NOW)).toBe("used");
  });

  it("remarcação precisa do atendimento", async () => {
    const contact = await contactOf(ids.p1);
    expect(
      await codeOf(() =>
        createBookingLink(db(reception), clinicId, {
          mode: "reschedule",
          contactId: contact.contact_id,
          patientId: ids.p1,
          serviceId: ids.consulta,
          agendaId: null,
          locationId: null,
          locationCategory: null,
          appointmentId: null,
          originAppointmentId: null,
          contactPhone: contact.contacts.phone,
          homeVisitAddress: null,
          ttlMs: BOT_LINK_TTL_MS,
        }),
      ),
    ).toBe("invalid");
  });
});

describe("bloqueios", () => {
  it("mostra os atingidos, cancela só os escolhidos com link de remarcação de 2 dias, e tira os horários", async () => {
    const a1 = (await book(ids.p1, ids.consulta, ids.agendaDra, at(MON1, "08:30"))).appointment;
    const a2 = (await book(ids.p2, ids.consulta, ids.agendaDra, at(MON1, "09:30"))).appointment;
    const conflicts = await findBlockConflicts(db(reception), clinicId, { agendaId: ids.agendaDra, startsAt: at(MON1, "08:45"), endsAt: at(MON1, "10:00") });
    // a1 (08:30–09:00) já está em andamento às 08:45: também é atingido.
    expect(conflicts.map((a) => a.id).sort()).toEqual([a1.id, a2.id].sort());

    const { block, canceled } = await createBlock(
      db(reception),
      clinicId,
      { agendaId: ids.agendaDra, startsAt: at(MON1, "08:45"), endsAt: at(MON1, "10:00"), reason: " Reunião ", cancelAppointmentIds: [a1.id], actorId: reception.id },
      NOW,
    );
    expect(block.reason).toBe("Reunião");
    expect(canceled.map((c) => c.appointment.id)).toEqual([a1.id]);
    const link = canceled[0].rebookingLink!;
    expect(link).toMatchObject({ mode: "create", patientId: ids.p1, serviceId: ids.consulta, agendaId: ids.agendaDra, locationCategory: "clinic", returnDeadlineWaived: false });
    expect(link.expiresAt.getTime() - NOW.getTime()).toBe(2 * 24 * 60 * 60_000);
    expect((await getAppointment(db(reception), clinicId, a2.id)).status).toBe("scheduled");

    const { data: trail } = await adminClient().from("appointment_events").select("event_type, channel").eq("appointment_id", a1.id).order("occurred_at");
    expect(trail?.at(-1)).toEqual({ event_type: "canceled", channel: "schedule_block" });

    const slots = await getFreeSlots(db(reception), clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, date: MON1, locationId: ids.office }, NOW);
    expect(slots.some((s) => s.start >= at(MON1, "08:45") && s.start < at(MON1, "10:00"))).toBe(false);
  });

  it("editar e remover o bloqueio devolvem os horários", async () => {
    const [block] = await listBlocks(db(reception), clinicId, { from: at(MON1, "00:00"), to: at(MON2, "00:00"), agendaIds: [ids.agendaDra] });
    await updateBlock(db(reception), clinicId, block.id, { startsAt: at(MON1, "11:00"), endsAt: at(MON1, "12:00"), reason: "Reunião", actorId: reception.id }, NOW);
    let slots = await getFreeSlots(db(reception), clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, date: MON1, locationId: ids.office }, NOW);
    expect(slots.some((s) => s.start.getTime() === at(MON1, "09:00").getTime())).toBe(true);
    expect(slots.some((s) => s.start.getTime() === at(MON1, "11:00").getTime())).toBe(false);

    await removeBlock(db(reception), clinicId, block.id, reception.id, NOW);
    slots = await getFreeSlots(db(reception), clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, date: MON1, locationId: ids.office }, NOW);
    expect(slots.some((s) => s.start.getTime() === at(MON1, "11:00").getTime())).toBe(true);
    expect(await codeOf(() => removeBlock(db(reception), clinicId, block.id, null, NOW))).toBe("not_found");
    expect(await codeOf(() => updateBlock(db(reception), clinicId, block.id, { startsAt: at(MON1, "11:00"), endsAt: at(MON1, "10:00"), reason: "x", actorId: null }, NOW))).toBe("invalid");
  });

  it("cancelamento do dia: retorno domiciliar ganha link com endereço e sem prazo", async () => {
    const consult = (await book(ids.p3, ids.consulta, ids.agendaDra, at(MON1, "14:00"), { homeVisitAddress: "Rua C, 3" })).appointment;
    const later = at(MON2, "07:00");
    // Retorno sugere no máximo 4 horários por dia (piloto): filtra pelo domiciliar.
    const ret = (await book(ids.p3, ids.retorno, ids.agendaDra, at(MON2, "14:00"), { homeVisitAddress: "Rua C, 3", locationId: ids.home }, later)).appointment;
    expect(ret.originAppointmentId).toBe(consult.id);
    const [result] = await cancelByClinic(db(reception), clinicId, [ret.id], reception.id, later);
    expect(result.rebookingLink).toMatchObject({
      originAppointmentId: consult.id,
      returnDeadlineWaived: true,
      locationCategory: "home_visit",
      homeVisitAddress: "Rua C, 3",
    });
    expect(await bookingLinkLastDate(db(reception), clinicId, result.rebookingLink!, later)).toBeNull();
    expect(await bookingLinkLastDate(db(reception), clinicId, { ...result.rebookingLink!, returnDeadlineWaived: false }, later)).toBe("2031-04-09");
  });
});

describe("séries recorrentes (D9)", () => {
  const seriesInput = (patientId: string, extra: Record<string, unknown> = {}) => ({
    patientId,
    serviceId: ids.consulta,
    agendaId: ids.agendaDra2,
    locationId: ids.office,
    intervalWeeks: 1,
    startsOn: MON1,
    startTime: "10:00",
    actorId: reception.id,
    ...extra,
  });

  it("por número de sessões: pula feriado, bloqueio e horário ocupado, e se estende até completar", async () => {
    await addClinicHoliday(db(admin), clinicId, { date: MON2, description: "Feriado municipal" });
    await createBlock(db(reception), clinicId, { agendaId: ids.agendaDra2, startsAt: at(MON3, "09:00"), endsAt: at(MON3, "12:00"), reason: "Curso", cancelAppointmentIds: [], actorId: null }, NOW);
    await book(ids.p3, ids.consulta, ids.agendaDra2, at(MON4, "08:00"));
    // Ocupa o horário da série em MON4 com um atendimento de outro paciente (fora das janelas: direto no banco).
    await adminClient().from("appointments").insert({
      clinic_id: clinicId,
      patient_id: ids.p2,
      service_id: ids.consulta,
      agenda_id: ids.agendaDra2,
      location_id: ids.office,
      scheduled_at: at(MON4, "10:00").toISOString(),
      duration_minutes: 30,
      booking_channel: "admin",
    });

    const { series, created, skipped } = await createSeries(db(reception), clinicId, seriesInput(ids.p1, { maxSessions: 3 }), NOW);
    expect(series).toMatchObject({ weekday: 1, intervalWeeks: 1, maxSessions: 3, durationMinutes: 30 });
    expect(created.map((a) => localDate(a.scheduledAt))).toEqual([MON1, "2031-04-07", "2031-04-14"]);
    expect(created.every((a) => a.seriesId === series.id && a.priceCents === 30000)).toBe(true);
    expect(skipped).toEqual([
      { date: MON2, reason: "holiday" },
      { date: MON3, reason: "block" },
      { date: MON4, reason: "conflict" },
    ]);
    expect(await listSeriesSkips(db(reception), clinicId, series.id)).toEqual(skipped);
    // Completa: não cria mais nada.
    expect(await extendSeries(db(reception), clinicId, series.id, NOW)).toEqual({ created: [], skipped: [] });
  });

  it("sem fim: cria até 3 meses à frente e o horizonte anda com o tempo", async () => {
    const { series, created, skipped } = await createSeries(db(reception), clinicId, seriesInput(ids.p2, { startTime: "15:00", agendaId: ids.agendaDra }), NOW);
    // Segundas de 10/03 a 09/06/2031; 17/03 é feriado da clínica e 21/04 é Tiradentes.
    expect(created).toHaveLength(12);
    expect(skipped.map((s) => s.date)).toEqual([MON2, "2031-04-21"]);
    expect(localDate(created.at(-1)!.scheduledAt)).toBe("2031-06-09");

    const twoWeeksLater = at("2031-03-23", "12:00");
    const more = await extendSeries(db(reception), clinicId, series.id, twoWeeksLater);
    // Duas semanas depois, o horizonte vai até 23/06.
    expect(more.created.map((a) => localDate(a.scheduledAt))).toEqual(["2031-06-16", "2031-06-23"]);
    expect(more.skipped).toEqual([]);
  });

  it("sessões de série não travam avulsos na mesma agenda, e avulso não trava a série (decisão de 04/out)", async () => {
    // p2 tem série sem fim na agenda da Dra. Agenda. Tira o avulso que p2 já
    // tinha lá (esse trava, corretamente) e marca outro: a série não trava.
    const upcoming = (await listUpcomingAppointments(db(reception), clinicId, [ids.p2], NOW)).get(ids.p2) ?? [];
    for (const appointment of upcoming.filter((a) => a.agendaId === ids.agendaDra && a.seriesId === null)) {
      await cancelAppointment(db(reception), clinicId, appointment.id, { channel: "admin", actorId: null }, NOW);
    }
    const extra = (await book(ids.p2, ids.consulta, ids.agendaDra, at(MON3, "08:00"))).appointment;
    expect(extra.seriesId).toBeNull();
    // E o avulso de p3 no Dr. Segundo (MON4) não impediu nada para p3 lá.
    const { created } = await createSeries(db(reception), clinicId, seriesInput(ids.p3, { startTime: "11:00", maxSessions: 1 }), NOW);
    expect(created).toHaveLength(1);
  });

  it(`"esta e as próximas" → encerrar: cancela daqui em diante e não cria mais`, async () => {
    const { series, created } = await createSeries(db(reception), clinicId, seriesInput(ids.p1, { startTime: "08:30", agendaId: ids.agendaDra, endsOn: "2031-04-30" }), NOW);
    const third = created[2];
    const { series: ended, canceled } = await endSeriesFrom(db(reception), clinicId, third.id, reception.id, NOW);
    expect(ended.endedAt).not.toBeNull();
    expect(canceled.map((a) => a.id)).toEqual(created.slice(2).map((a) => a.id));
    expect((await getAppointment(db(reception), clinicId, created[1].id)).status).toBe("scheduled");
    expect(await extendSeries(db(reception), clinicId, series.id, NOW)).toEqual({ created: [], skipped: [] });
  });

  it(`"esta e as próximas" → mudar dia e horário: abre outra série com as sessões que faltavam`, async () => {
    const { series, created } = await createSeries(db(reception), clinicId, seriesInput(ids.p3, { startTime: "16:00", agendaId: ids.agendaDra, maxSessions: 4 }), NOW);
    const result = await changeSeriesFrom(db(reception), clinicId, created[2].id, { startsOn: "2031-04-08", startTime: "09:00" }, reception.id, NOW);
    expect(result.ended.id).toBe(series.id);
    expect(result.canceled.map((a) => a.id)).toEqual(created.slice(2).map((a) => a.id));
    const next = result.next!;
    expect(next.series).toMatchObject({ weekday: 2, startTime: "09:00", maxSessions: 2, patientId: ids.p3 });
    expect(next.created.map((a) => localDate(a.scheduledAt))).toEqual(["2031-04-08", "2031-04-15"]);
    expect((await getSeries(db(reception), clinicId, series.id)).endedAt).not.toBeNull();
  });

  it(`"só esta sessão": cancelar uma não mexe na série`, async () => {
    const { series, created } = await createSeries(db(reception), clinicId, seriesInput(ids.p3, { startTime: "17:00", agendaId: ids.agendaDra, maxSessions: 2 }), NOW);
    await cancelAppointment(db(reception), clinicId, created[0].id, { channel: "whatsapp_bot", actorId: null }, NOW);
    expect((await getAppointment(db(reception), clinicId, created[1].id)).status).toBe("scheduled");
    expect((await getSeries(db(reception), clinicId, series.id)).endedAt).toBeNull();
  });

  it("turma não tem série; série no passado, sem endereço no domiciliar ou em agenda sem acesso é recusada", async () => {
    expect(await codeOf(() => createSeries(db(reception), clinicId, seriesInput(ids.p1, { serviceId: ids.turma, agendaId: ids.agendaExams }), NOW))).toBe("invalid");
    expect(await codeOf(() => createSeries(db(reception), clinicId, seriesInput(ids.p1, { startsOn: "2031-03-03" }), NOW))).toBe("invalid");
    expect(await codeOf(() => createSeries(db(reception), clinicId, seriesInput(ids.p1, { locationId: ids.home, agendaId: ids.agendaDra }), NOW))).toBe("invalid");
    await setMemberAgendaAccess(db(admin), clinicId, reception.id, "restricted", [ids.agendaExams]);
    try {
      expect(await codeOf(() => createSeries(db(reception), clinicId, seriesInput(ids.p1), NOW))).toBe("invalid");
    } finally {
      await setMemberAgendaAccess(db(admin), clinicId, reception.id, "all", []);
    }
  });
});
