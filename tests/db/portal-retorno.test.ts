import type { AstroCookies } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { confirmPortalBooking, loadHold } from "../../src/lib/data/portal/booking";
import { ensureSession, holdSlot, readSession, sendCode, verifyCode, type PortalSession } from "../../src/lib/data/portal/identity";
import { loadPortal, professionalDates, professionalSlots, type PortalClinic, type PortalProfessional } from "../../src/lib/data/portal/portal";
import { confirmPortalReturn, findReturnCard, loadReturnOptions, portalOffersReturn, returnScope, setHoldReturn, type ReturnCard } from "../../src/lib/data/portal/returnVisit";
import { registerPatient } from "../../src/lib/data/patients";
import { addDays, todayIn } from "../../src/lib/clinicTime";
import { adminClient, clinicServiceClient } from "./helpers";
import { asDb, at, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F2d da recepção digital: o retorno pelo portal, com as regras do bot (consulta de origem na mesma agenda, prazo,
// domiciliar, retorno já marcado, atendimento futuro) e a marcação ligada à consulta de origem, uma vez só.
// Datas reais (a reserva vence pelo relógio do banco): consultas de origem em segundas passadas, retorno na próxima.

const TZ = "America/Fortaleza";
let fixture: AgendaFixture;
let service: DbClient;
let portal: PortalClinic;
let dra: PortalProfessional;
const today = todayIn(TZ);
// A segunda-feira desta semana (hoje, se for segunda) e as outras a partir dela.
const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
const thisMonday = addDays(today, -((weekday + 6) % 7));
const monday = (weeks: number) => addDays(thisMonday, 7 * weeks);
let phoneSeq = 0;
const newPhone = () => `+55849${String(Date.now() % 1_000_000).padStart(6, "0")}${String(++phoneSeq).padStart(2, "0")}`.slice(0, 14);

function jar(): AstroCookies {
  const values = new Map<string, string>();
  return {
    get: (name: string) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name: string, value: string) => void values.set(name, value),
  } as unknown as AstroCookies;
}

async function verified(phone: string): Promise<PortalSession> {
  const cookies = jar();
  const session = await ensureSession(service, fixture.clinicId, cookies, { ip: "200.9.8", secure: false });
  const sent = await sendCode(service, fixture.clinicId, session, phone, { ip: "200.9.8", sender: null, devMode: true });
  if (sent.status !== "sent" || !sent.devCode) throw new Error(sent.status);
  const result = await verifyCode(service, fixture.clinicId, session, sent.devCode);
  if (result.status !== "ok") throw new Error(result.status);
  return (await readSession(service, fixture.clinicId, cookies))!;
}

/** Paciente novo (celular próprio) com uma Consulta realizada na segunda indicada (no consultório ou domiciliar). */
async function patientWithConsultation(name: string, date: string, time: string, { home = false } = {}): Promise<{ phone: string; patientId: string; originId: string }> {
  const phone = newPhone();
  const created = await registerPatient(asDb(fixture.admin), fixture.clinicId, { fullName: name, birthdate: "1990-05-05", contact: { mode: "self", phone } }, today);
  if (created.status !== "created") throw new Error(created.status);
  const start = at(date, time);
  const { appointment } = await bookAppointment(
    asDb(fixture.admin),
    fixture.clinicId,
    {
      patientId: created.patient.id,
      serviceId: fixture.ids.consulta,
      agendaId: fixture.ids.agendaDra,
      start,
      locationId: home ? fixture.ids.home : fixture.ids.office,
      homeVisitAddress: home ? "Rua do Paciente, 10" : null,
      channel: "admin",
      actorId: fixture.admin.id,
      // A equipe marca no passado (Marcar, cliente 28/out/2026).
      anyTime: true,
      acceptedWarnings: true,
      pastFrom: new Date(start.getTime() - 86_400_000),
    },
  );
  const { error } = await adminClient().from("appointments").update({ status: "completed" }).eq("id", appointment.id);
  if (error) throw error;
  return { phone, patientId: created.patient.id, originId: appointment.id };
}

/** Os horários livres do retorno na próxima segunda (no recorte do retorno). */
async function freeReturnStarts(card: ReturnCard): Promise<Date[]> {
  const scope = returnScope(card);
  return (await professionalSlots(service, fixture.clinicId, card.professional, card.service.id, monday(1), TZ, new Date(), null, scope)).map((s) => s.start);
}

/** Sessão comprovada com o primeiro horário livre do retorno reservado e a consulta de origem na reserva. */
async function holdingReturn(card: ReturnCard, phone: string): Promise<{ session: PortalSession; holdId: string }> {
  const session = await verified(phone);
  const [start] = await freeReturnStarts(card);
  const hold = await holdSlot(service, fixture.clinicId, session.id, {
    agendaId: card.professional.agendaId,
    serviceId: card.service.id,
    locationId: fixture.ids.office,
    start,
    end: new Date(start.getTime() + card.service.durationMinutes * 60_000),
  });
  if (hold.status !== "ok") throw new Error(hold.status);
  expect(await setHoldReturn(service, fixture.clinicId, session.id, hold.holdId, card)).toBe(true);
  return { session, holdId: hold.holdId };
}

const confirm = (session: PortalSession, holdId: string, card: ReturnCard) => confirmPortalReturn(service, portal, { sessionId: session.id, holdId, sender: null });

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do retorno", "849222800");
  service = clinicServiceClient(fixture.clinicId) as unknown as DbClient;
  const loaded = await loadPortal(service, fixture.clinicId, "x");
  if (loaded.status !== "open") throw new Error("portal indisponível");
  portal = loaded;
  dra = portal.professionals.find((p) => p.name === "Dra. Agenda")!;
});

afterAll(async () => {
  await fixture?.cleanup();
});

describe("retorno pelo portal", () => {
  it("a clínica com o serviço de retorno mostra o botão", async () => {
    expect(await portalOffersReturn(service, portal)).toBe(true);
  });

  it("consulta com direito: o cartão, os horários só até o fim do prazo e a marcação ligada à consulta de origem", async () => {
    const { phone, patientId, originId } = await patientWithConsultation("Rita Retorno Lima", monday(-1), "08:00");
    const options = await loadReturnOptions(service, portal, phone);
    expect(options.cards).toHaveLength(1);
    const card = options.cards[0];
    expect(card).toMatchObject({ originId, originDate: monday(-1), patient: { id: patientId }, professional: { id: dra.id } });
    expect(card.lastDate! >= addDays(monday(-1), 29)).toBe(true);

    // Horários: só os locais do retorno e nunca depois do fim do prazo.
    const scope = returnScope(card);
    const dates = await professionalDates(service, fixture.clinicId, card.professional, card.service.id, TZ, { scope });
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every((d) => d <= card.lastDate!)).toBe(true);

    const { session, holdId } = await holdingReturn(card, phone);
    const hold = await loadHold(service, fixture.clinicId, session.id, holdId);
    expect(hold).toMatchObject({ state: "active", returnOriginId: originId, patientId });

    const outcome = await confirm(session, holdId, card);
    expect(outcome.status).toBe("booked");
    const appointmentId = (outcome as { appointmentId: string }).appointmentId;
    const db = adminClient();
    const { data: appointment } = await db
      .from("appointments")
      .select("booking_channel, portal_entry, patient_id, origin_appointment_id, services ( category )")
      .eq("id", appointmentId)
      .single();
    expect(appointment).toMatchObject({ booking_channel: "portal", portal_entry: "clinic_link", patient_id: patientId, origin_appointment_id: originId, services: { category: "return_visit" } });
    const { data: queue } = await db.from("notice_queue").select("kind, status").eq("appointment_id", appointmentId);
    expect(queue).toEqual([{ kind: "confirmation", status: "pending" }]);

    // Recarregar: o mesmo atendimento, sem marcar de novo.
    expect(await confirm(session, holdId, card)).toEqual({ status: "booked", appointmentId });
    const { count } = await db.from("appointments").select("id", { count: "exact", head: true }).eq("origin_appointment_id", originId);
    expect(count).toBe(1);

    // Depois de marcado: a consulta passa a "sem direito" (o retorno já foi marcado e há atendimento futuro).
    const after = await loadReturnOptions(service, portal, phone);
    expect(after.cards).toHaveLength(0);
    expect(after.refusals.map((r) => r.kind)).toEqual(["used"]);
  });

  it("duplo toque: um retorno só", async () => {
    const { phone } = await patientWithConsultation("Duplo Retorno Silva", monday(-1), "08:30");
    const card = (await loadReturnOptions(service, portal, phone)).cards[0];
    const { session, holdId } = await holdingReturn(card, phone);
    const results = await Promise.all([confirm(session, holdId, card), confirm(session, holdId, card)]);
    expect(results.some((r) => r.status === "booked")).toBe(true);
    expect(results.every((r) => r.status === "booked" || r.status === "confirming")).toBe(true);
    const { count } = await adminClient().from("appointments").select("id", { count: "exact", head: true }).eq("origin_appointment_id", card.originId).neq("status", "canceled");
    expect(count).toBe(1);
  });

  it("prazo vencido, domiciliar: sem cartão, com o motivo", async () => {
    const expired = await patientWithConsultation("Prazo Vencido Souza", monday(-6), "09:00");
    const options = await loadReturnOptions(service, portal, expired.phone);
    expect(options.cards).toHaveLength(0);
    expect(options.refusals).toHaveLength(1);
    expect(options.refusals[0]).toMatchObject({ kind: "expired", originDate: monday(-6) });

    const home = await patientWithConsultation("Domiciliar Costa", monday(-1), "14:00", { home: true });
    expect((await loadReturnOptions(service, portal, home.phone)).refusals.map((r) => r.kind)).toEqual(["home_visit"]);
  });

  it("retorno marcado por outro canal entre a reserva e a confirmação: não marca de novo", async () => {
    const { phone, patientId, originId } = await patientWithConsultation("Outro Canal Rocha", monday(-1), "09:30");
    const card = (await loadReturnOptions(service, portal, phone)).cards[0];
    const { session, holdId } = await holdingReturn(card, phone);
    // A recepção marca o retorno ligado à mesma consulta.
    await bookAppointment(
      asDb(fixture.reception),
      fixture.clinicId,
      { patientId, serviceId: card.service.id, agendaId: fixture.ids.agendaDra, start: (await freeReturnStarts(card))[1], locationId: fixture.ids.office, originAppointmentId: originId, channel: "admin", actorId: fixture.reception.id },
    );
    expect((await confirm(session, holdId, card)).status).toBe("no_patient");
    expect(await findReturnCard(service, portal, phone, originId)).toBeNull();
    const hold = await loadHold(service, fixture.clinicId, session.id, holdId);
    // Sem direito no meio do caminho: o horário é solto para todos.
    expect(hold?.state).toBe("gone");
  });

  it("a reserva de um retorno não se marca como consulta, e outra sessão não grava o retorno", async () => {
    const { phone } = await patientWithConsultation("Reserva Trocada Dias", monday(-1), "10:00");
    const card = (await loadReturnOptions(service, portal, phone)).cards[0];
    const { session, holdId } = await holdingReturn(card, phone);
    const asConsultation = await confirmPortalBooking(service, fixture.clinicId, {
      sessionId: session.id,
      holdId,
      professional: dra,
      timeZone: TZ,
      insurancePlanId: null,
      entry: "clinic_link",
      sender: null,
    });
    expect(asConsultation.status).toBe("expired");

    const other = await verified(newPhone());
    expect(await setHoldReturn(service, fixture.clinicId, other.id, holdId, card)).toBe(false);
    // O cartão é do celular comprovado: outro celular não acha a consulta.
    expect(await findReturnCard(service, portal, newPhone(), card.originId)).toBeNull();
  });
});
