import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, cancelAppointment } from "../../src/lib/data/agenda/appointments";
import type { DbClient } from "../../src/lib/data/clients";
import {
  activeWaitlistAppointmentIds,
  joinWaitlist,
  leaveWaitlist,
  listRecentOffers,
  listWaitlist,
} from "../../src/lib/data/waitlist/entries";
import { adminClient, clinicServiceClient, type TestUser } from "./helpers";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";

// F3.7a — entrar, sair e consultar a lista de espera, numa clínica criada para
// o teste (tests/db/agendaFixture.ts).
let fixture: AgendaFixture;
let clinicId: string;
let reception: TestUser;
let ids: AgendaIds;
let bot: DbClient;
const db = asDb;

const book = async (patient: string, service: string, agenda: string, start: Date) =>
  (await bookAppointment(db(reception), clinicId, { patientId: patient, serviceId: service, agendaId: agenda, start, channel: "admin", actorId: reception.id }, NOW))
    .appointment;

const trailOf = async (appointmentId: string) => {
  const { data } = await adminClient()
    .from("appointment_events")
    .select("event_type, channel, actor_id, details")
    .eq("appointment_id", appointmentId)
    .like("event_type", "waitlist_%")
    .order("occurred_at");
  return data!;
};

const entryOf = async (appointmentId: string) => {
  const { data } = await adminClient()
    .from("waitlist_entries")
    .select("id, status, created_via, ended_reason, ended_by")
    .eq("appointment_id", appointmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data!;
};

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da lista de espera", "859777800");
  ({ clinicId, reception, ids } = fixture);
  bot = clinicServiceClient(clinicId) as unknown as DbClient;
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("entrar na lista", () => {
  it("a recepção inclui pelo painel, com quem incluiu na trilha; incluir de novo não é erro", async () => {
    const appointment = await book(ids.p1, ids.consulta, ids.agendaDra, at(MON1, "11:00"));
    expect(await joinWaitlist(db(reception), clinicId, appointment.id, { via: "admin", actorId: reception.id }, NOW)).toBe("joined");
    expect(await joinWaitlist(db(reception), clinicId, appointment.id, { via: "admin", actorId: reception.id }, NOW)).toBe("already");
    expect(await entryOf(appointment.id)).toMatchObject({ status: "active", created_via: "admin" });
    expect(await trailOf(appointment.id)).toEqual([{ event_type: "waitlist_joined", channel: "admin", actor_id: reception.id, details: {} }]);
  });

  it("o bot inclui com a credencial da clínica", async () => {
    const appointment = await book(ids.p2, ids.exame, ids.agendaExams, at(MON1, "08:00"));
    expect(await joinWaitlist(bot, clinicId, appointment.id, { via: "whatsapp_bot", actorId: null }, NOW)).toBe("joined");
    expect(await entryOf(appointment.id)).toMatchObject({ status: "active", created_via: "whatsapp_bot" });
  });

  it("cancelado, passado ou sessão de série não entra", async () => {
    const canceled = await book(ids.p3, ids.consulta, ids.agendaDra, at(MON1, "09:00"));
    await cancelAppointment(db(reception), clinicId, canceled.id, { channel: "admin", actorId: reception.id }, NOW);
    expect(await codeOf(() => joinWaitlist(db(reception), clinicId, canceled.id, { via: "admin", actorId: reception.id }, NOW))).toBe("invalid");

    const later = new Date(at(MON1, "10:00").getTime() + 60_000);
    const past = await book(ids.p3, ids.consulta, ids.agendaDra, at(MON1, "10:00"));
    expect(await codeOf(() => joinWaitlist(db(reception), clinicId, past.id, { via: "admin", actorId: reception.id }, later))).toBe("invalid");

    const { data: series } = await adminClient()
      .from("appointment_series")
      .insert({
        clinic_id: clinicId, patient_id: ids.p3, service_id: ids.consulta, agenda_id: ids.agendaDra, location_id: ids.office,
        weekday: 1, start_time: "10:00", duration_minutes: 30, starts_on: MON1,
      })
      .select("id")
      .single();
    await adminClient().from("appointments").update({ series_id: series!.id }).eq("id", past.id);
    expect(await codeOf(() => joinWaitlist(db(reception), clinicId, past.id, { via: "admin", actorId: reception.id }, NOW))).toBe("invalid");
  });

  it("atendimento de outra clínica não é encontrado", async () => {
    const appointment = await book(ids.p3, ids.exame, ids.agendaExams, at(MON1, "08:20"));
    const other = clinicServiceClient(crypto.randomUUID()) as unknown as DbClient;
    expect(await codeOf(() => joinWaitlist(other, clinicId, appointment.id, { via: "whatsapp_bot", actorId: null }, NOW))).toBe("not_found");
  });
});

describe("sair da lista", () => {
  it("retirado pela tela: status, quem retirou e trilha; retirar de novo devolve false", async () => {
    const appointment = await book(ids.p2, ids.consulta, ids.agendaDra, at(MON1, "11:30"));
    await joinWaitlist(db(reception), clinicId, appointment.id, { via: "admin", actorId: reception.id }, NOW);
    expect(await leaveWaitlist(db(reception), clinicId, appointment.id, { channel: "admin", actorId: reception.id }, NOW)).toBe(true);
    expect(await leaveWaitlist(db(reception), clinicId, appointment.id, { channel: "admin", actorId: reception.id }, NOW)).toBe(false);
    expect(await entryOf(appointment.id)).toMatchObject({ status: "removed", ended_reason: "admin", ended_by: reception.id });
    expect((await trailOf(appointment.id)).at(-1)).toEqual({ event_type: "waitlist_left", channel: "admin", actor_id: reception.id, details: { reason: "admin" } });
  });

  it("quem sai perde a oferta em aberto e a vaga volta para a fila (sem service role)", async () => {
    const waiting = await book(ids.p3, ids.consulta, ids.agendaDra2, at(MON1, "08:30"));
    await joinWaitlist(bot, clinicId, waiting.id, { via: "whatsapp_bot", actorId: null }, NOW);
    // Vaga aberta na mesma agenda e serviço, oferecida a quem espera.
    const source = await book(ids.p1, ids.consulta, ids.agendaDra2, at(MON1, "08:00"));
    await cancelAppointment(db(reception), clinicId, source.id, { channel: "admin", actorId: reception.id }, NOW);
    const { data: opening } = await adminClient().from("waitlist_openings").select("id").eq("opened_by_appointment_id", source.id).single();
    await adminClient().from("waitlist_openings").update({ status: "offering" }).eq("id", opening!.id);
    const entry = await entryOf(waiting.id);
    const { data: offer } = await adminClient()
      .from("waitlist_offers")
      .insert({
        clinic_id: clinicId, entry_id: entry.id, appointment_id: waiting.id, opening_id: opening!.id,
        slot_scheduled_at: at(MON1, "08:00").toISOString(), slot_location_id: ids.office, slot_duration_minutes: 30,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      })
      .select("id")
      .single();

    expect(await leaveWaitlist(bot, clinicId, waiting.id, { channel: "whatsapp_bot", actorId: null }, NOW)).toBe(true);

    expect(await entryOf(waiting.id)).toMatchObject({ status: "left", ended_reason: "bot", ended_by: null });
    const { data: offerRow } = await adminClient().from("waitlist_offers").select("status, details").eq("id", offer!.id).single();
    expect(offerRow).toEqual({ status: "withdrawn", details: { reason: "entry_left" } });
    const { data: openingRow } = await adminClient().from("waitlist_openings").select("status").eq("id", opening!.id).single();
    expect(openingRow!.status).toBe("open");

    const history = await listRecentOffers(db(reception), clinicId);
    expect(history.find((item) => item.id === offer!.id)).toMatchObject({ status: "withdrawn", reason: "entry_left", patientName: "Paciente Três" });
  });
});

describe("consultar a fila", () => {
  it("lista na ordem de entrada, com atendimento, paciente, contato e oferta em aberto; filtra por agenda", async () => {
    const first = await book(ids.p2, ids.consulta, ids.agendaDra2, at(MON1, "08:00"));
    const second = await book(ids.p1, ids.exame, ids.agendaExams, at(MON1, "08:40"));
    await joinWaitlist(db(reception), clinicId, first.id, { via: "admin", actorId: reception.id }, new Date(NOW.getTime() + 1000));
    await joinWaitlist(db(reception), clinicId, second.id, { via: "booking_link", actorId: null }, new Date(NOW.getTime() + 2000));

    const all = await listWaitlist(db(reception), clinicId);
    const ours = all.filter((entry) => [first.id, second.id].includes(entry.appointment.id));
    expect(ours.map((entry) => entry.appointment.id)).toEqual([first.id, second.id]);
    expect(ours[1]).toMatchObject({
      createdVia: "booking_link",
      appointment: { serviceName: "Exame", agendaName: "Exames", locationName: "Consultório", isHomeVisit: false },
      patient: { id: ids.p1, fullName: "Paciente Um" },
      contact: { fullName: "Resp. Paciente Um", phone: expect.stringMatching(/85977780001$/) },
      pendingOffer: null,
    });

    const exams = await listWaitlist(db(reception), clinicId, { agendaIds: [ids.agendaExams] });
    expect(exams.map((entry) => entry.appointment.agendaId)).toEqual(exams.map(() => ids.agendaExams));
    expect(exams.some((entry) => entry.appointment.id === second.id)).toBe(true);

    const active = await activeWaitlistAppointmentIds(db(reception), clinicId, [first.id, second.id, crypto.randomUUID()]);
    expect(active).toEqual(new Set([first.id, second.id]));
  });
});
