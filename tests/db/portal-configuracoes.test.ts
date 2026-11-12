import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { loadPortalSettings, setPortalLeadHours, setShowInPortal } from "../../src/lib/data/config/portal";
import { confirmPortalBooking, setHoldPatient } from "../../src/lib/data/portal/booking";
import { ensureSession, holdSlot, readSession, sendCode, verifyCode } from "../../src/lib/data/portal/identity";
import { loadPortal } from "../../src/lib/data/portal/portal";
import { todayIn } from "../../src/lib/clinicTime";
import type { AstroCookies } from "astro";
import { adminClient, clinicServiceClient } from "./helpers";
import { asDb, at, MON1, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F3d da recepção digital: Configurações › Portal (antecedência e "Mostrar no portal", só o Administrador) e a origem
// do link marcado por lugar (`?de=instagram`) gravada na marcação.

const TZ = "America/Fortaleza";
let f: AgendaFixture;
let service: DbClient;

function jar(): AstroCookies {
  const values = new Map<string, string>();
  return {
    get: (name: string) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name: string, value: string) => void values.set(name, value),
  } as unknown as AstroCookies;
}

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica Configurações do portal", "+55849912392");
  service = clinicServiceClient(f.clinicId) as unknown as DbClient;
  await adminClient().from("clinics").update({ portal_slug: `cfg-${Date.now()}` }).eq("id", f.clinicId);
});

afterAll(async () => f.cleanup());

describe("Configurações › Portal (F3d)", () => {
  it("o Administrador muda a antecedência (0 a 168 h) e tira e põe o profissional no portal", async () => {
    const admin = asDb(f.admin);
    let settings = await loadPortalSettings(admin, f.clinicId);
    expect(settings.leadHours).toBe(0);
    expect(settings.slug).toMatch(/^cfg-/);
    expect(settings.professionals.map((p) => p.name)).toEqual(["Dr. Segundo", "Dra. Agenda"]);
    await setPortalLeadHours(admin, f.clinicId, 48);
    await expect(setPortalLeadHours(admin, f.clinicId, 200)).rejects.toMatchObject({ code: "invalid", fields: { lead_hours: expect.any(String) } });
    await expect(setPortalLeadHours(admin, f.clinicId, Number.NaN)).rejects.toMatchObject({ code: "invalid" });
    const segundo = settings.professionals.find((p) => p.name === "Dr. Segundo")!;
    expect(await setShowInPortal(admin, f.clinicId, segundo.id, false)).toBe("Dr. Segundo");
    settings = await loadPortalSettings(admin, f.clinicId);
    expect(settings.leadHours).toBe(48);
    expect(settings.professionals.find((p) => p.id === segundo.id)!.showInPortal).toBe(false);
    const portal = await loadPortal(service, f.clinicId, "x");
    expect(portal.status === "open" && portal.professionals.some((p) => p.id === segundo.id)).toBe(false);
    await setShowInPortal(admin, f.clinicId, segundo.id, true);
  });

  it("a Recepção não muda a antecedência", async () => {
    await expect(setPortalLeadHours(asDb(f.reception), f.clinicId, 12)).rejects.toBeTruthy();
    expect((await loadPortalSettings(asDb(f.admin), f.clinicId)).leadHours).toBe(48);
  });

  it("link marcado por lugar: a marcação grava a origem (Instagram)", async () => {
    const portal = await loadPortal(service, f.clinicId, "x");
    if (portal.status !== "open") throw new Error("portal");
    const dra = portal.professionals.find((p) => p.name === "Dra. Agenda")!;
    const cookies = jar();
    const phone = "+5584991239299";
    const session = await ensureSession(service, f.clinicId, cookies, { ip: "200.9.7", secure: false });
    const sent = await sendCode(service, f.clinicId, session, phone, { ip: "200.9.7", sender: null, devMode: true });
    if (sent.status !== "sent" || !sent.devCode) throw new Error(sent.status);
    await verifyCode(service, f.clinicId, session, sent.devCode);
    const verified = (await readSession(service, f.clinicId, cookies))!;
    const start = at(MON1, "11:00");
    const hold = await holdSlot(service, f.clinicId, verified.id, { agendaId: dra.agendaId, serviceId: dra.consultations[0].serviceId, locationId: dra.locations[0].id, start, end: new Date(start.getTime() + 30 * 60_000) });
    if (hold.status !== "ok") throw new Error(hold.status);
    const today = todayIn(TZ);
    await setHoldPatient(service, f.clinicId, verified.id, hold.holdId, { newPatient: { for: "self", name: "Origem Instagram Lima", birthdate: `${Number(today.slice(0, 4)) - 30}${today.slice(4)}`, contactName: null } });
    const outcome = await confirmPortalBooking(service, f.clinicId, { sessionId: verified.id, holdId: hold.holdId, professional: dra, timeZone: TZ, insurancePlanId: null, entry: "clinic_link", place: "instagram", sender: null });
    expect(outcome.status).toBe("booked");
    const { data } = await adminClient().from("appointments").select("portal_entry, portal_place").eq("id", (outcome as { appointmentId: string }).appointmentId).single();
    expect(data).toEqual({ portal_entry: "clinic_link", portal_place: "instagram" });
  });
});
