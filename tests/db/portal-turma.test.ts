import type { AstroCookies } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { confirmPortalBooking, setHoldPatient } from "../../src/lib/data/portal/booking";
import { ensureSession, holdGroupSlot, readSession, sendCode, verifyCode, type PortalSession } from "../../src/lib/data/portal/identity";
import { examProfessional, groupSessions, isSlotStillFree, loadPortal, nextFreeSlot, professionalDates, professionalSlots, type PortalProfessional } from "../../src/lib/data/portal/portal";
import { adminClient, clinicServiceClient } from "./helpers";
import { setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F3e-2 da recepção digital (D5, seção 15.5): exame em turma pelo portal. A turma da agenda da equipe entra na lista de
// exames; os dias são as sessões com vaga; a reserva segura uma vaga (não o horário inteiro) e conta para os outros
// pacientes do portal; a turma cheia (marcados mais reservas) some e recusa a reserva. Fixture: capacidade 2, às 10:00
// de segunda. Datas reais (a reserva vence pelo relógio do banco).

const TZ = "America/Fortaleza";
let fixture: AgendaFixture;
let service: DbClient;
let turma: PortalProfessional;
let phoneSeq = 60;
const newPhone = () => `+55849${String(Date.now() % 1_000_000).padStart(6, "0")}${String(++phoneSeq).padStart(2, "0")}`.slice(0, 14);

function jar(): AstroCookies {
  const values = new Map<string, string>();
  return {
    get: (name: string) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name: string, value: string) => void values.set(name, value),
  } as unknown as AstroCookies;
}

async function verified(phone = newPhone()): Promise<PortalSession> {
  const cookies = jar();
  const session = await ensureSession(service, fixture.clinicId, cookies, { ip: "200.9.9", secure: false });
  const sent = await sendCode(service, fixture.clinicId, session, phone, { ip: "200.9.9", sender: null, devMode: true });
  if (sent.status !== "sent" || !sent.devCode) throw new Error(sent.status);
  const result = await verifyCode(service, fixture.clinicId, session, sent.devCode);
  if (result.status !== "ok") throw new Error(result.status);
  return (await readSession(service, fixture.clinicId, cookies))!;
}

const holdOn = (session: PortalSession, s: { start: Date; locationId: string; capacity: number }) =>
  holdGroupSlot(service, fixture.clinicId, session.id, {
    agendaId: turma.agendaId,
    serviceId: turma.consultations[0].serviceId,
    locationId: s.locationId,
    start: s.start,
    end: new Date(s.start.getTime() + 60 * 60_000),
    capacity: s.capacity,
  });

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da turma", "849222900");
  service = clinicServiceClient(fixture.clinicId) as unknown as DbClient;
  const loaded = await loadPortal(service, fixture.clinicId, "x");
  if (loaded.status !== "open") throw new Error("portal indisponível");
  turma = examProfessional(loaded, loaded.exams.find((e) => e.serviceId === fixture.ids.turma)!)!;
});

afterAll(async () => {
  await fixture?.cleanup();
});

describe("exame em turma pelo portal", () => {
  it("a turma entra na lista de exames, com as sessões com vaga como dias e horários", async () => {
    expect(turma.exam).toMatchObject({ serviceId: fixture.ids.turma, isGroup: true });
    const sessions = await groupSessions(service, fixture.clinicId, turma, TZ, { count: 3 });
    expect(sessions.length).toBe(3);
    expect(sessions.every((s) => s.time === "10:00" && s.capacity === 2)).toBe(true);
    expect(await professionalDates(service, fixture.clinicId, turma, fixture.ids.turma, TZ, { count: 2 })).toEqual(sessions.slice(0, 2).map((s) => s.date));
    const slots = await professionalSlots(service, fixture.clinicId, turma, fixture.ids.turma, sessions[0].date, TZ);
    expect(slots.map((s) => s.start.getTime())).toEqual([sessions[0].start.getTime()]);
    expect((await nextFreeSlot(service, fixture.clinicId, turma, TZ))?.getTime()).toBe(sessions[0].start.getTime());
  });

  it("cada reserva segura uma vaga; cheia (reservas), a turma some e recusa outra reserva", async () => {
    const [, second] = await groupSessions(service, fixture.clinicId, turma, TZ, { count: 2 });
    const ana = await verified();
    const bia = await verified();
    const caio = await verified();
    expect((await holdOn(ana, second)).status).toBe("ok");
    // A própria reserva não ocupa a vaga de quem pergunta; para os outros, sobra uma.
    expect(await isSlotStillFree(service, fixture.clinicId, turma, { serviceId: fixture.ids.turma, locationId: second.locationId, start: second.start }, TZ, new Date(), bia.id)).toBe(true);
    expect((await holdOn(bia, second)).status).toBe("ok");
    // Duas reservas na turma de 2: para o terceiro, cheia.
    const forCaio = await groupSessions(service, fixture.clinicId, turma, TZ, { count: 3, sessionId: caio.id });
    expect(forCaio.some((s) => s.start.getTime() === second.start.getTime())).toBe(false);
    expect((await holdOn(caio, second)).status).toBe("taken");
    // A mesma sessão de novo: a mesma reserva (recarregou a página).
    expect((await holdOn(ana, second)).status).toBe("ok");
  });

  it("marca pela reserva da vaga, como turma (um atendimento por participante)", async () => {
    const [, , third] = await groupSessions(service, fixture.clinicId, turma, TZ, { count: 3 });
    const session = await verified();
    const hold = await holdOn(session, third);
    if (hold.status !== "ok") throw new Error(hold.status);
    await setHoldPatient(service, fixture.clinicId, session.id, hold.holdId, { newPatient: { for: "self", name: "Turma Nova Souza", birthdate: "1985-03-03", contactName: null } });
    const outcome = await confirmPortalBooking(service, fixture.clinicId, { sessionId: session.id, holdId: hold.holdId, professional: turma, timeZone: TZ, insurancePlanId: null, entry: "clinic_link", sender: null });
    expect(outcome.status).toBe("booked");
    const { data } = await adminClient().from("appointments").select("service_id, is_group_session, booking_channel, scheduled_at").eq("id", (outcome as { appointmentId: string }).appointmentId).single();
    expect(data).toMatchObject({ service_id: fixture.ids.turma, is_group_session: true, booking_channel: "portal" });
    expect(new Date(data!.scheduled_at).getTime()).toBe(third.start.getTime());
  });

  it("a reserva de turma não serve para serviço individual nem para outra clínica", async () => {
    const session = await verified();
    const [first] = await groupSessions(service, fixture.clinicId, turma, TZ, { count: 1 });
    const { error } = await service.rpc("portal_hold_group_slot", {
      p_clinic_id: fixture.clinicId,
      p_session_id: session.id,
      p_agenda_id: turma.agendaId,
      p_service_id: fixture.ids.exame,
      p_location_id: first.locationId,
      p_starts_at: first.start.toISOString(),
      p_ends_at: new Date(first.start.getTime() + 3_600_000).toISOString(),
      p_capacity: 2,
      p_max_per_day: 5,
    });
    expect(error?.code).toBe("42501");
  });
});
