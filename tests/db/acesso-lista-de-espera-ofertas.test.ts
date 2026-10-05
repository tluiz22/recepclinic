import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, cancelAppointment, getAppointment } from "../../src/lib/data/agenda/appointments";
import type { DbClient } from "../../src/lib/data/clients";
import { registerPatient } from "../../src/lib/data/patients";
import { joinWaitlist } from "../../src/lib/data/waitlist/entries";
import {
  acceptOffer,
  advanceOpening,
  closePastEntries,
  declineOffer,
  expireOffers,
  OFFER_MINUTES,
  processWaitlist,
  type OfferSender,
  type OfferToSend,
} from "../../src/lib/data/waitlist/offers";
import { adminClient, clinicServiceClient, type TestUser } from "./helpers";
import { asDb, at, MON1, MON2, MON3, MON4, NOW, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";

// F3.7b — motor de ofertas da lista de espera, com a credencial da clínica
// (clinic_service). A agenda "Dr. Segundo" tem só 08:00 e 08:30 às segundas,
// o que deixa controlar o "horário livre antes da vaga".
let fixture: AgendaFixture;
let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let ids: AgendaIds;
let bot: DbClient;
const more = {} as Record<"p4" | "p5" | "p6", string>;
const db = asDb;

const book = async (patient: string, start: Date) =>
  (await bookAppointment(db(reception), clinicId, { patientId: patient, serviceId: ids.consulta, agendaId: ids.agendaDra2, start, channel: "admin", actorId: reception.id }, NOW))
    .appointment;

const join = (appointmentId: string, now: Date) => joinWaitlist(bot, clinicId, appointmentId, { via: "whatsapp_bot", actorId: null }, now);

const contactOf = async (patientId: string) => {
  const { data } = await adminClient().from("patients").select("contact_id").eq("id", patientId).single();
  return data!.contact_id as string;
};

const offersOf = async (openingId: string) => {
  const { data } = await adminClient()
    .from("waitlist_offers")
    .select("id, appointment_id, status, details, whatsapp_message_id")
    .eq("opening_id", openingId)
    .order("offered_at");
  return data!;
};

const openingRow = async (id: string) => {
  const { data } = await adminClient().from("waitlist_openings").select("status, closed_reason").eq("id", id).single();
  return data!;
};

const entryStatus = async (appointmentId: string) => {
  const { data } = await adminClient().from("waitlist_entries").select("status, ended_reason").eq("appointment_id", appointmentId).single();
  return data!;
};

/** Vaga gravada direto (como o gatilho grava) na agenda Dr. Segundo. */
const insertOpening = async (slot: Date) => {
  const { data, error } = await adminClient()
    .from("waitlist_openings")
    .insert({
      clinic_id: clinicId, reason: "canceled", service_id: ids.consulta, agenda_id: ids.agendaDra2,
      slot_scheduled_at: slot.toISOString(), slot_location_id: ids.office, slot_duration_minutes: 30,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
};

/** Envio de mentira: registra o que seria enviado; `skip` = contatos que não podem receber. */
const fakeSender = (skip: string[] = []) => {
  const sent: OfferToSend[] = [];
  const send: OfferSender = async (offer) => {
    if (skip.includes(offer.contact.id)) return { sent: false, reason: "outside_24h_no_template" };
    sent.push(offer);
    return { sent: true, messageId: `wamid.${sent.length}` };
  };
  return { sent, send };
};

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste de ofertas", "859777900");
  ({ clinicId, admin, reception, ids } = fixture);
  bot = clinicServiceClient(clinicId) as unknown as DbClient;
  for (const [key, suffix] of [["p4", "04"], ["p5", "05"], ["p6", "06"]] as const) {
    const result = await registerPatient(
      db(admin),
      clinicId,
      { fullName: `Paciente ${suffix}`, birthdate: "2020-01-01", contact: { mode: "new", fullName: `Resp. ${suffix}`, phone: `859777900${suffix}` } },
      "2031-03-09",
    );
    if (result.status !== "created") throw new Error(result.status);
    more[key] = result.patient.id;
  }
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("vaga aberta pelo cancelamento → oferta → Sim", () => {
  it("oferece a quem espera, e o Sim antecipa, tira da lista e preenche a vaga", async () => {
    const waiting = await book(ids.p1, at(MON2, "08:00"));
    await join(waiting.id, NOW);
    await book(ids.p3, at(MON1, "08:00")); // ocupa o horário antes da vaga
    const source = await book(ids.p2, at(MON1, "08:30"));
    await cancelAppointment(db(reception), clinicId, source.id, { channel: "admin", actorId: reception.id }, NOW);
    const { data: opening } = await adminClient().from("waitlist_openings").select("id").eq("opened_by_appointment_id", source.id).single();

    const { sent, send } = fakeSender();
    const totals = await processWaitlist(bot, clinicId, send, NOW);
    expect(totals).toMatchObject({ offered: 1, skipped: 0, closedOpenings: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      clinicId,
      timeZone: "America/Fortaleza",
      contact: { id: await contactOf(ids.p1) },
      patientName: "Paciente Um",
      appointmentId: waiting.id,
      serviceName: "Consulta",
      serviceCategory: "consultation",
      currentStart: at(MON2, "08:00"),
      slotStart: at(MON1, "08:30"),
      slotLocationName: "Consultório",
      slotIsHomeVisit: false,
      expiresAt: new Date(NOW.getTime() + OFFER_MINUTES * 60_000),
    });
    const [offer] = await offersOf(opening!.id);
    expect(offer).toMatchObject({ status: "pending", whatsapp_message_id: "wamid.1" });
    expect(await openingRow(opening!.id)).toMatchObject({ status: "offering" });

    // Outra pessoa não responde pela oferta.
    expect(await acceptOffer(bot, clinicId, offer.id, await contactOf(ids.p2), NOW)).toEqual({ kind: "not_found" });

    const answer = await acceptOffer(bot, clinicId, offer.id, await contactOf(ids.p1), NOW);
    expect(answer).toEqual({ kind: "accepted", appointmentId: waiting.id, patientName: "Paciente Um", from: at(MON2, "08:00"), to: at(MON1, "08:30") });
    expect((await getAppointment(bot, clinicId, waiting.id)).scheduledAt).toEqual(at(MON1, "08:30"));
    expect(await entryStatus(waiting.id)).toEqual({ status: "advanced", ended_reason: "advanced" });
    expect(await openingRow(opening!.id)).toMatchObject({ status: "filled" });
    const { data: trail } = await adminClient().from("appointment_events").select("event_type, channel, details").eq("appointment_id", waiting.id).eq("event_type", "waitlist_advanced");
    expect(trail).toEqual([{ event_type: "waitlist_advanced", channel: "whatsapp_bot", details: { from: at(MON2, "08:00").toISOString(), to: at(MON1, "08:30").toISOString() } }]);

    expect(await acceptOffer(bot, clinicId, offer.id, null, NOW)).toEqual({ kind: "already_accepted" });
  });
});

describe("pular, Não e fila vazia", () => {
  it("quem não pode receber é pulado; o Não passa a vaga adiante e, sem mais ninguém, ela se encerra", async () => {
    const now = at(MON3, "06:00"); // 08:00 livre não conta (antes do mínimo de 2h)
    const first = await book(more.p4, at(MON4, "08:00"));
    const second = await book(more.p5, at(MON4, "08:30"));
    await join(first.id, NOW);
    await join(second.id, new Date(NOW.getTime() + 1000));
    const opening = await insertOpening(at(MON3, "08:30"));

    const { sent, send } = fakeSender([await contactOf(more.p4)]);
    expect(await advanceOpening(bot, clinicId, opening, send, now)).toEqual({ offered: true, skipped: 1, closed: false });
    expect(sent.map((offer) => offer.appointmentId)).toEqual([second.id]);
    const offers = await offersOf(opening);
    expect(offers.map((o) => [o.appointment_id, o.status, o.details])).toEqual([
      [first.id, "skipped", { reason: "outside_24h_no_template" }],
      [second.id, "pending", {}],
    ]);

    const answer = await declineOffer(bot, clinicId, offers[1].id, await contactOf(more.p5), send, now);
    expect(answer).toEqual({ kind: "declined", patientName: "Paciente 05", currentStart: at(MON4, "08:30"), stillInList: true });
    expect((await offersOf(opening))[1].status).toBe("declined");
    expect(await openingRow(opening)).toEqual({ status: "closed", closed_reason: "no_candidates" });
    expect(await getAppointment(bot, clinicId, second.id)).toMatchObject({ scheduledAt: at(MON4, "08:30") });
  });
});

describe("prazo e atendimentos que passaram", () => {
  it("oferta sem resposta vence, a vaga volta para a fila e o Sim atrasado não remarca", async () => {
    const day = "2031-04-07";
    const now = at(day, "06:00");
    const waiting = await book(more.p6, at("2031-04-14", "08:00"));
    await join(waiting.id, NOW);
    const opening = await insertOpening(at(day, "08:30"));
    const { send } = fakeSender();
    await advanceOpening(bot, clinicId, opening, send, now);
    const [offer] = await offersOf(opening);

    const later = new Date(now.getTime() + (OFFER_MINUTES + 1) * 60_000);
    expect(await expireOffers(bot, clinicId, later)).toBe(1);
    expect((await offersOf(opening))[0].status).toBe("expired");
    expect(await openingRow(opening)).toMatchObject({ status: "open" });
    expect(await acceptOffer(bot, clinicId, offer.id, await contactOf(more.p6), later)).toEqual({ kind: "late", stillInList: true });
    expect((await getAppointment(bot, clinicId, waiting.id)).scheduledAt).toEqual(at("2031-04-14", "08:00"));

    // Passou do horário do atendimento: sai da lista sozinho.
    expect(await closePastEntries(bot, clinicId, at("2031-04-14", "08:05"))).toBeGreaterThanOrEqual(1);
    expect(await entryStatus(waiting.id)).toEqual({ status: "closed", ended_reason: "past" });
  });
});

describe("vagas que se encerram sem oferta", () => {
  const day = "2031-04-28"; // 21/04 é feriado (Tiradentes)
  const { send, sent } = fakeSender();

  it("começa em menos de 2h", async () => {
    const opening = await insertOpening(at(day, "08:30"));
    expect(await advanceOpening(bot, clinicId, opening, send, at(day, "07:00"))).toMatchObject({ closed: true, closedReason: "too_late" });
  });

  it("há horário livre antes dela", async () => {
    const opening = await insertOpening(at(day, "08:30"));
    expect(await advanceOpening(bot, clinicId, opening, send, at(day, "05:00"))).toMatchObject({ closed: true, closedReason: "earlier_free" });
    expect(await openingRow(opening)).toEqual({ status: "closed", closed_reason: "earlier_free" });
  });

  it("o horário não está mais livre", async () => {
    const opening = await insertOpening(at(day, "08:15"));
    expect(await advanceOpening(bot, clinicId, opening, send, at(day, "06:00"))).toMatchObject({ closed: true, closedReason: "slot_unavailable" });
    expect(sent).toEqual([]);
  });

  it("vaga de outra clínica não é tocada", async () => {
    const opening = await insertOpening(at(day, "08:30"));
    const other = clinicServiceClient(crypto.randomUUID()) as unknown as DbClient;
    expect(await advanceOpening(other, clinicId, opening, send, at(day, "06:00"))).toEqual({ offered: false, skipped: 0, closed: false });
    expect(await openingRow(opening)).toMatchObject({ status: "open" });
  });
});
