import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { listPortalHolds } from "../../src/lib/data/agenda/grid";
import { checkFreeTime, getFreeSlots, HELD_REASON, listFreeGaps, listFreeGapsRange, TEAM_HOLDS } from "../../src/lib/data/agenda/slots";
import { adminClient } from "./helpers";
import { asDb, at, codeOf, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F5a (agenda em colunas, R3): horários livres por período (os Próximos horários livres) com o tipo de local, reservas
// do portal lidas pela equipe e a Marcar da equipe recusando o horário em reserva.
let fixture: AgendaFixture;
const TZ = "America/Fortaleza";
beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da agenda em colunas", "859999950");
});
afterAll(async () => {
  await fixture.cleanup();
});

/** Reserva do portal na agenda da Dra., ainda valendo (a validade é do relógio de agora). */
async function holdAt(start: Date, minutes = 30): Promise<string> {
  const { clinicId, ids } = fixture;
  const db = adminClient();
  const { data: session, error } = await db
    .from("portal_sessions")
    .insert({ clinic_id: clinicId, token_hash: `f5a-${Math.random()}`, phone: "+5585999995099", phone_verified_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  const { data: hold, error: holdError } = await db
    .from("slot_holds")
    .insert({
      clinic_id: clinicId,
      session_id: session!.id,
      agenda_id: ids.agendaDra,
      service_id: ids.consulta,
      location_id: ids.office,
      phone: "+5585999995099",
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (holdError) throw holdError;
  return hold!.id;
}

describe("horários livres por período", () => {
  it("os dias do período batem com os de cada dia, com a data e o tipo de local", async () => {
    const { ids, admin, clinicId } = fixture;
    const a = asDb(admin);
    const agendaIds = [ids.agendaDra, ids.agendaExams];
    const range = await listFreeGapsRange(a, clinicId, { fromDate: MON1, toDate: MON2, agendaIds, timeZone: TZ }, NOW);
    for (const date of [MON1, MON2]) {
      const day = await listFreeGaps(a, clinicId, { date, agendaIds, timeZone: TZ }, NOW);
      const key = (g: { agendaId: string; time: string }) => `${g.agendaId} ${g.time}`;
      expect(range.filter((g) => g.date === date).map(key).sort()).toEqual(day.map(key).sort());
    }
    const dra = range.filter((g) => g.agendaId === ids.agendaDra && g.date === MON1);
    expect(dra.find((g) => g.time === "08:00")?.places).toEqual(["clinic"]);
    expect(dra.find((g) => g.time === "14:00")?.places).toEqual(["home_visit"]);
  });
});

describe("reserva do portal para a equipe", () => {
  it("a equipe lê a reserva valendo; a liberada some", async () => {
    const { ids, admin, clinicId } = fixture;
    const holdId = await holdAt(at(MON1, "09:00"));
    const holds = await listPortalHolds(asDb(admin), clinicId, { fromDate: MON1, toDate: MON1, agendaIds: [ids.agendaDra], timeZone: TZ });
    expect(holds.map((h) => h.start.getTime())).toContain(at(MON1, "09:00").getTime());
    await adminClient().from("slot_holds").update({ released_at: new Date().toISOString() }).eq("id", holdId);
    const after = await listPortalHolds(asDb(admin), clinicId, { fromDate: MON1, toDate: MON1, agendaIds: [ids.agendaDra], timeZone: TZ });
    expect(after.map((h) => h.start.getTime())).not.toContain(at(MON1, "09:00").getTime());
  });

  it("a Marcar da equipe recusa o horário em reserva (lista e outro horário); sem reserva, marca", async () => {
    const { ids, reception, clinicId } = fixture;
    const r = asDb(reception);
    const start = at(MON1, "10:00");
    const holdId = await holdAt(start);
    const listed = await getFreeSlots(r, clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, date: MON1, holds: TEAM_HOLDS }, NOW);
    expect(listed.map((s) => s.time)).not.toContain("10:00");
    const check = await checkFreeTime(r, clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, locationId: ids.office, start, respectHolds: true }, NOW);
    expect(check).toEqual({ ok: false, reason: HELD_REASON });
    // Sem a regra da equipe (portal e bot), a conferência segue como antes.
    expect((await checkFreeTime(r, clinicId, { serviceId: ids.consulta, agendaId: ids.agendaDra, locationId: ids.office, start }, NOW)).ok).toBe(true);
    const book = () =>
      bookAppointment(r, clinicId, { patientId: ids.p2, serviceId: ids.consulta, agendaId: ids.agendaDra, start, locationId: ids.office, channel: "admin", actorId: reception.id, anyTime: true }, NOW);
    expect(await codeOf(book)).toBe("conflict");
    await adminClient().from("slot_holds").update({ released_at: new Date().toISOString() }).eq("id", holdId);
    const booked = await book();
    expect(booked.appointment.scheduledAt.getTime()).toBe(start.getTime());
  });
});
