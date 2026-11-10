import type { AstroCookies } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { ensureSession, hitLimit, holdSlot, readSession, releaseHold, sendCode, verifyCode, type PortalSession } from "../../src/lib/data/portal/identity";
import { loadPortal, type PortalProfessional } from "../../src/lib/data/portal/portal";
import { portalPhoneBlock, releasePortalPhone } from "../../src/lib/data/portalPhone";
import { LIMITS } from "../../src/lib/portalIdentity";
import { addMember, adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// Desbloqueio do portal pela recepção, na ficha do paciente (validação da F3, cliente, 10/nov/2026; migração
// 20270109130000): a faixa mostra o bloqueio do celular (código pedido demais ou o limite do dia) e "Liberar agora"
// solta os dois. Só Administrador e Recepção da clínica.

let fixture: AgendaFixture;
let service: DbClient;
let otherClinic: string;
let outsider: TestUser;
let dra: PortalProfessional;

function jar(): AstroCookies {
  const values = new Map<string, string>();
  return {
    get: (name: string) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name: string, value: string) => void values.set(name, value),
  } as unknown as AstroCookies;
}

async function verified(phone: string): Promise<PortalSession> {
  const cookies = jar();
  const session = await ensureSession(service, fixture.clinicId, cookies, { ip: "200.9.9", secure: false });
  const sent = await sendCode(service, fixture.clinicId, session, phone, { ip: "200.9.9", sender: null, devMode: true });
  if (sent.status !== "sent" || !sent.devCode) throw new Error(sent.status);
  const result = await verifyCode(service, fixture.clinicId, session, sent.devCode);
  if (result.status !== "ok") throw new Error(result.status);
  return (await readSession(service, fixture.clinicId, cookies))!;
}

const slotAt = (time: string) => ({
  agendaId: dra.agendaId,
  serviceId: dra.consultations[0].serviceId,
  locationId: dra.locations[0].id,
  start: at(MON1, time),
  end: new Date(at(MON1, time).getTime() + 30 * 60_000),
});

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do desbloqueio do portal", "849333700");
  service = clinicServiceClient(fixture.clinicId) as unknown as DbClient;
  otherClinic = await createClinic("Outra clínica (desbloqueio)");
  outsider = await createUser("desbloqueio-de-fora");
  await addMember(otherClinic, outsider.id, ["reception"]);
  const portal = await loadPortal(service, fixture.clinicId, "x");
  if (portal.status !== "open") throw new Error("portal indisponível");
  dra = portal.professionals.find((p) => p.name === "Dra. Agenda")!;
});

afterAll(async () => {
  await fixture?.cleanup();
  await deleteClinics([otherClinic]);
  await deleteUsers([outsider]);
});

describe("desbloqueio do celular no portal", () => {
  it("código pedido demais: a faixa mostra até quando; a Recepção libera e o código volta a sair", async () => {
    const phone = "+5584999970001";
    const reception = asDb(fixture.reception);
    expect(await portalPhoneBlock(reception, fixture.clinicId, phone)).toBeNull();
    for (let i = 0; i < LIMITS.codePerPhone.limit; i++) expect(await hitLimit(service, fixture.clinicId, `phone:${phone}`, LIMITS.codePerPhone)).toBeNull();
    const until = await hitLimit(service, fixture.clinicId, `phone:${phone}`, LIMITS.codePerPhone);
    expect(until).not.toBeNull();
    expect(await portalPhoneBlock(reception, fixture.clinicId, phone)).toEqual({ blockedUntil: until, limitUntil: null });

    // Outra clínica não vê nem libera.
    expect(await codeOf(() => portalPhoneBlock(asDb(outsider), fixture.clinicId, phone))).not.toBe("ok");
    expect(await codeOf(() => releasePortalPhone(asDb(outsider), fixture.clinicId, phone))).toBe("forbidden");

    await releasePortalPhone(reception, fixture.clinicId, phone);
    expect(await portalPhoneBlock(reception, fixture.clinicId, phone)).toBeNull();
    expect(await hitLimit(service, fixture.clinicId, `phone:${phone}`, LIMITS.codePerPhone)).toBeNull();
    const { data } = await adminClient().from("portal_blocks").select("released_by").eq("clinic_id", fixture.clinicId).eq("key", `phone:${phone}`).single();
    expect(data!.released_by).toBe(fixture.reception.id);
  });

  it("limite do dia: 5 consultas marcadas bloqueiam; liberar recomeça a contagem (mais 5)", async () => {
    const phone = "+5584999970002";
    const admin = asDb(fixture.admin);
    const ana = await verified(phone);
    const times = ["08:30", "09:30", "10:30", "11:00", "11:30"];
    for (const time of times) expect((await holdSlot(service, fixture.clinicId, ana.id, slotAt(time))).status).toBe("ok");
    await releaseHold(service, fixture.clinicId, ana.id);
    const booked = await bookAppointment(
      admin,
      fixture.clinicId,
      { patientId: fixture.ids.p2, serviceId: dra.consultations[0].serviceId, agendaId: dra.agendaId, locationId: dra.locations[0].id, start: at(MON1, "11:30"), channel: "admin", actorId: fixture.admin.id },
      NOW,
    );
    const { data: holds } = await adminClient().from("slot_holds").select("id, created_at").eq("clinic_id", fixture.clinicId).eq("phone", phone).order("created_at");
    expect(holds).toHaveLength(5);
    await adminClient().from("slot_holds").update({ appointment_id: booked.appointment.id }).in("id", holds!.map((h) => h.id));

    expect((await holdSlot(service, fixture.clinicId, ana.id, slotAt("08:30"))).status).toBe("limit");
    const block = await portalPhoneBlock(admin, fixture.clinicId, phone);
    // Libera sozinho quando a mais antiga das 5 fizer 24 h.
    expect(block).toEqual({ blockedUntil: null, limitUntil: new Date(new Date(holds![0].created_at).getTime() + 24 * 3_600_000) });

    await releasePortalPhone(admin, fixture.clinicId, phone);
    expect(await portalPhoneBlock(admin, fixture.clinicId, phone)).toBeNull();
    expect((await holdSlot(service, fixture.clinicId, ana.id, slotAt("08:30"))).status).toBe("ok");
    await releaseHold(service, fixture.clinicId, ana.id);
  });

  it("celular inválido é recusado", async () => {
    expect(await codeOf(() => releasePortalPhone(asDb(fixture.reception), fixture.clinicId, "84999970003"))).toBe("invalid");
  });
});
