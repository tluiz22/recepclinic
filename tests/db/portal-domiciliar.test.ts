import type { AstroCookies } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { confirmPortalBooking, lastHomeAddress, loadHold, setHoldAddress, setHoldPatient } from "../../src/lib/data/portal/booking";
import { ensureSession, holdSlot, readSession, sendCode, verifyCode, type PortalSession } from "../../src/lib/data/portal/identity";
import { findMyAppointment, rescheduleMine, rescheduleScope, rescheduleSlots } from "../../src/lib/data/portal/myAppointments";
import { loadPortal, locationsAt, placesOf, priceAt, professionalDates, professionalSlots, type PortalProfessional } from "../../src/lib/data/portal/portal";
import { addDays, todayIn } from "../../src/lib/clinicTime";
import { adminClient, clinicServiceClient } from "./helpers";
import { setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F3e-1 da recepção digital (D5, seção 15.5): atendimento em casa pelo portal. O domiciliar entra nos locais do
// profissional, com o valor de lá; o endereço vai na reserva depois do paciente e, na marcação, para o atendimento e
// para o padrão do contato (como o bot). Remarcar em casa mantém ou troca o endereço. O retorno fica no consultório.
// Datas reais (a reserva vence pelo relógio do banco).

const TZ = "America/Fortaleza";
let fixture: AgendaFixture;
let service: DbClient;
let dra: PortalProfessional;
const today = todayIn(TZ);
const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
const nextMonday = addDays(today, 7 - ((weekday + 6) % 7));
let phoneSeq = 40;
const newPhone = () => `+55849${String(Date.now() % 1_000_000).padStart(6, "0")}${String(++phoneSeq).padStart(2, "0")}`.slice(0, 14);
const ADDRESS = "Rua dos Ipês, 45, Apto 302, Lagoa Nova. Ponto de referência: em frente à padaria";

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

/** Sessão comprovada com o primeiro horário em casa da segunda escolhida reservado (cada teste usa uma segunda). */
async function holdingHome(date = nextMonday, phone = newPhone()): Promise<{ session: PortalSession; holdId: string; phone: string }> {
  const session = await verified(phone);
  const consultation = dra.consultations[0];
  const [slot] = await professionalSlots(service, fixture.clinicId, dra, consultation.serviceId, date, TZ, new Date(), session.id, { locations: locationsAt(dra, "home_visit") });
  if (!slot) throw new Error("sem horário em casa");
  const hold = await holdSlot(service, fixture.clinicId, session.id, {
    agendaId: dra.agendaId,
    serviceId: consultation.serviceId,
    locationId: slot.locationId,
    start: slot.start,
    end: new Date(slot.start.getTime() + consultation.durationMinutes * 60_000),
  });
  if (hold.status !== "ok") throw new Error(hold.status);
  return { session, holdId: hold.holdId, phone };
}

const confirm = (session: PortalSession, holdId: string) =>
  confirmPortalBooking(service, fixture.clinicId, { sessionId: session.id, holdId, professional: dra, timeZone: TZ, insurancePlanId: null, entry: "clinic_link", sender: null });

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do domiciliar", "849222800");
  service = clinicServiceClient(fixture.clinicId) as unknown as DbClient;
  const loaded = await loadPortal(service, fixture.clinicId, "x");
  if (loaded.status !== "open") throw new Error("portal indisponível");
  dra = loaded.professionals.find((p) => p.agendaId === fixture.ids.agendaDra)!;
});

afterAll(async () => {
  await fixture?.cleanup();
});

describe("atendimento em casa pelo portal", () => {
  it("o domiciliar entra nos locais do profissional (consultório primeiro), com o valor de lá", async () => {
    expect(dra.locations.map((l) => [l.id, l.type])).toEqual([
      [fixture.ids.office, "clinic"],
      [fixture.ids.home, "home_visit"],
    ]);
    expect(placesOf(dra)).toEqual(["clinic", "home_visit"]);
    expect(dra.consultations[0].prices.home_visit).toBe(45000);
    // O valor do local escolhido (revisão e tela final, cliente 10/nov), não o menor.
    expect(priceAt(dra.consultations[0], fixture.ids.home)).toBe(45000);
    expect(priceAt(dra.consultations[0], fixture.ids.office)).toBe(30000);
    expect(priceAt(dra.consultations[0], null)).toBe(30000);
    // Os dias em casa são só os do horário em casa (o consultório não entra).
    const home = await professionalDates(service, fixture.clinicId, dra, dra.consultations[0].serviceId, TZ, { count: 3, scope: { locations: locationsAt(dra, "home_visit") } });
    expect(home.length).toBeGreaterThan(0);
    const slots = await professionalSlots(service, fixture.clinicId, dra, dra.consultations[0].serviceId, nextMonday, TZ, new Date(), null, { locations: locationsAt(dra, "home_visit") });
    expect(new Set(slots.map((s) => s.locationId))).toEqual(new Set([fixture.ids.home]));
  });

  it("sem o endereço não marca; com ele, o atendimento e o contato ficam com o endereço", async () => {
    const { session, holdId, phone } = await holdingHome();
    expect(await setHoldPatient(service, fixture.clinicId, session.id, holdId, { newPatient: { for: "self", name: "Maria Casa Souza", birthdate: "1944-05-01", contactName: null } })).toBe(true);
    expect((await confirm(session, holdId)).status).toBe("no_address");

    expect(await lastHomeAddress(service, fixture.clinicId, phone)).toBeNull();
    expect(await setHoldAddress(service, fixture.clinicId, session.id, holdId, ADDRESS)).toBe(true);
    expect((await loadHold(service, fixture.clinicId, session.id, holdId))?.homeVisitAddress).toBe(ADDRESS);
    const outcome = await confirm(session, holdId);
    expect(outcome.status).toBe("booked");
    const appointmentId = (outcome as { appointmentId: string }).appointmentId;
    const { data: appointment } = await adminClient().from("appointments").select("location_id, home_visit_address, booking_channel").eq("id", appointmentId).single();
    expect(appointment).toMatchObject({ location_id: fixture.ids.home, home_visit_address: ADDRESS, booking_channel: "portal" });
    // A próxima marcação oferece "o mesmo endereço da última visita".
    expect(await lastHomeAddress(service, fixture.clinicId, phone)).toBe(ADDRESS);
  });

  it("a reserva de outra sessão não recebe endereço", async () => {
    const { holdId } = await holdingHome(addDays(nextMonday, 7));
    const other = await verified(newPhone());
    expect(await setHoldAddress(service, fixture.clinicId, other.id, holdId, ADDRESS)).toBe(false);
  });

  it("remarcar em casa mantém o endereço ou grava o novo (no atendimento e no contato)", async () => {
    const { session, holdId, phone } = await holdingHome(addDays(nextMonday, 14));
    await setHoldPatient(service, fixture.clinicId, session.id, holdId, { newPatient: { for: "self", name: "José Casa Lima", birthdate: "1950-02-02", contactName: null } });
    await setHoldAddress(service, fixture.clinicId, session.id, holdId, ADDRESS);
    const booked = await confirm(session, holdId);
    expect(booked.status).toBe("booked");
    const id = (booked as { appointmentId: string }).appointmentId;

    const item = (await findMyAppointment(service, fixture.clinicId, phone, id))!;
    expect(item).toMatchObject({ locationType: "home_visit", homeVisitAddress: ADDRESS });
    const scope = await rescheduleScope(service, fixture.clinicId, item, { timeZone: TZ, sessionId: null, rebook: false });
    expect(scope.locations.map((l) => l.id)).toEqual([fixture.ids.home]);
    const [slot] = await rescheduleSlots(service, fixture.clinicId, item, scope, addDays(nextMonday, 21));
    expect(slot).toBeTruthy();

    const moved = "Rua Nova, 10, Tirol";
    const outcome = await rescheduleMine(service, fixture.clinicId, { item, slot, scope, rebook: false, leadHours: null, sender: null, homeVisitAddress: moved, phone });
    expect(outcome.status).toBe("done");
    const { data: after } = await adminClient().from("appointments").select("home_visit_address, scheduled_at").eq("id", (outcome as { appointmentId: string }).appointmentId).single();
    expect(after?.home_visit_address).toBe(moved);
    expect(await lastHomeAddress(service, fixture.clinicId, phone)).toBe(moved);
  });
});
