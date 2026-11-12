import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { getPortalMetrics } from "../../src/lib/data/portalMetrics";
import { registerPatient } from "../../src/lib/data/patients";
import { asDb, at, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient } from "./helpers";

// F6, parte 2: Métricas › Portal. Visitas, celular confirmado, horário reservado, marcações e bloqueios.

let fixture: AgendaFixture;
let other: AgendaFixture;
const period = () => ({ start: new Date(Date.now() - 3600_000), end: new Date(Date.now() + 3600_000) });

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste das métricas do portal", "849333700");
  other = await setupAgendaClinic("Outra clínica do teste das métricas do portal", "849333800");
  const { clinicId, ids, admin } = fixture;
  const db = adminClient();
  const session = async (n: number, verified: boolean) => {
    const { data } = await db
      .from("portal_sessions")
      .insert({ clinic_id: clinicId, token_hash: `mp-${clinicId}-${n}`, expires_at: new Date(Date.now() + 3600_000).toISOString(), ...(verified ? { phone: `+5584933370${n}00`, phone_verified_at: new Date().toISOString() } : {}) })
      .select("id")
      .single();
    return data!.id as string;
  };
  const { data: link, error: linkError } = await db.from("portal_links").insert({ clinic_id: clinicId, phone: "+558493337011", purpose: "book", expires_at: new Date(Date.now() + 3600_000).toISOString() } as never).select("id").single();
  if (linkError) throw linkError;
  await db.from("portal_sessions").insert({ clinic_id: clinicId, token_hash: `mp-link-${clinicId}`, link_id: link!.id, expires_at: new Date(Date.now() + 3600_000).toISOString() });
  await db.from("portal_sessions").insert({ clinic_id: other.clinicId, token_hash: `mp-outra-${other.clinicId}`, expires_at: new Date(Date.now() + 3600_000).toISOString() });
  await session(1, false);
  await session(2, true);
  const held = await session(3, true);
  const start = at(MON1, "08:00");
  await db.from("slot_holds").insert({ clinic_id: clinicId, agenda_id: ids.agendaDra, service_id: ids.consulta, location_id: ids.office, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 1800_000).toISOString(), session_id: held, phone: "+558493337000", expires_at: new Date(Date.now() + 300_000).toISOString() });
  await db.from("portal_blocks").insert({ clinic_id: clinicId, key: "phone:+558493337000", action: "code", level: 1, blocked_until: new Date(Date.now() + 900_000).toISOString() });
  const r = await registerPatient(asDb(admin), clinicId, { fullName: "Paciente do Portal", birthdate: "2020-01-01", contact: { mode: "new", fullName: "Resp. Portal", phone: "84933370099" } }, "2031-03-09");
  if (r.status !== "created") throw new Error(r.status);
  await bookAppointment(asDb(admin), clinicId, { patientId: r.patient.id, serviceId: ids.consulta, agendaId: ids.agendaDra, start: at(MON1, "09:00"), locationId: ids.office, channel: "portal", actorId: admin.id }, NOW);
});

afterAll(async () => {
  await fixture.cleanup();
  await other.cleanup();
});

describe("métricas do portal", () => {
  it("conta visitas, celular confirmado, horário reservado, marcações e bloqueios do período", async () => {
    const m = await getPortalMetrics(asDb(fixture.admin), fixture.clinicId, period().start, period().end);
    expect(m).toEqual({ visits: 4, fromBotLink: 1, verified: 3, held: 1, booked: 1, blocks: 1 });
  });

  it("outro período não traz nada", async () => {
    const m = await getPortalMetrics(asDb(fixture.admin), fixture.clinicId, new Date("2020-01-01"), new Date("2020-02-01"));
    expect(m).toEqual({ visits: 0, fromBotLink: 0, verified: 0, held: 0, booked: 0, blocks: 0 });
  });

  it("outra clínica só vê as dela", async () => {
    const m = await getPortalMetrics(asDb(other.admin), other.clinicId, period().start, period().end);
    expect(m).toEqual({ visits: 1, fromBotLink: 0, verified: 0, held: 0, booked: 0, blocks: 0 });
    const cross = await getPortalMetrics(asDb(other.admin), fixture.clinicId, period().start, period().end);
    expect(cross).toEqual({ visits: 0, fromBotLink: 0, verified: 0, held: 0, booked: 0, blocks: 0 });
  });
});
