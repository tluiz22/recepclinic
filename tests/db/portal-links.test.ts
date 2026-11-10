import type { AstroCookies } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { confirmPortalBooking, setHoldPatient } from "../../src/lib/data/portal/booking";
import { forgetPhone, holdSlot, readSession, type PortalSession } from "../../src/lib/data/portal/identity";
import { createPortalLink, getPortalLink, openLinkSession, portalLinkState, portalLinkTarget } from "../../src/lib/data/portal/links";
import { loadPortal, type PortalClinic, type PortalProfessional } from "../../src/lib/data/portal/portal";
import { resolveClinicByPortalLink } from "../../src/lib/data/platform";
import { todayIn } from "../../src/lib/clinicTime";
import { adminClient, clinicServiceClient, createClinic, deleteClinics } from "./helpers";
import { at, MON1, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F3a da recepção digital: o link do bot abre o portal com o celular da conversa comprovado, vale 30 min, uma
// marcação por link, revogado por um novo; a marcação sai com a origem WhatsApp.

const TZ = "America/Fortaleza";
const env = () => ({
  supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
  supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
  supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
  supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
});
let fixture: AgendaFixture;
let service: DbClient;
let otherClinic: string;
let portal: PortalClinic;
let dra: PortalProfessional;
const today = todayIn(TZ);
const yearsAgo = (n: number) => `${Number(today.slice(0, 4)) - n}${today.slice(4)}`;
let phoneSeq = 0;
const newPhone = () => `+55849${String(Date.now() % 1_000_000).padStart(6, "0")}${String(++phoneSeq).padStart(2, "0")}`.slice(0, 14);

function jar(): AstroCookies {
  const values = new Map<string, string>();
  return {
    get: (name: string) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name: string, value: string) => void values.set(name, value),
  } as unknown as AstroCookies;
}

async function openLink(phone: string): Promise<{ session: PortalSession; linkId: string; cookies: AstroCookies }> {
  const link = await createPortalLink(service, fixture.clinicId, { phone, purpose: "book", professionalId: dra.id });
  const cookies = jar();
  await openLinkSession(service, fixture.clinicId, link, cookies, { ip: "200.9.8", secure: false });
  return { session: (await readSession(service, fixture.clinicId, cookies))!, linkId: link.id, cookies };
}

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do link do bot", "849222901");
  service = clinicServiceClient(fixture.clinicId) as unknown as DbClient;
  otherClinic = await createClinic("Outra clínica (link do bot)");
  const loaded = await loadPortal(service, fixture.clinicId, "x");
  if (loaded.status !== "open") throw new Error("portal indisponível");
  portal = loaded;
  dra = portal.professionals.find((p) => p.name === "Dra. Agenda")!;
});

afterAll(async () => {
  await fixture?.cleanup();
  await deleteClinics([otherClinic]);
});

describe("link do bot no portal", () => {
  it("abre a sessão com o celular da conversa comprovado e leva ao atendimento do profissional", async () => {
    const phone = newPhone();
    const { session, linkId } = await openLink(phone);
    expect(session).toMatchObject({ phone, verified: true, linkId });
    expect(await resolveClinicByPortalLink(linkId, env())).toBe(fixture.clinicId);
    expect(await resolveClinicByPortalLink("00000000-0000-4000-8000-000000000000", env())).toBeNull();
    expect(portalLinkTarget({ purpose: "book", professionalId: dra.id, serviceId: null, appointmentId: null }, portal, "/c")).toBe(`/c/${dra.slug}/atendimento`);
    expect(portalLinkTarget({ purpose: "return", professionalId: null, serviceId: null, appointmentId: null }, portal, "/c")).toBe("/c/retorno");
    // Profissional que saiu do portal: o início da clínica.
    expect(portalLinkTarget({ purpose: "book", professionalId: "00000000-0000-4000-8000-000000000000", serviceId: null, appointmentId: null }, portal, "/c")).toBe("/c");
  });

  it("um link novo do mesmo celular e finalidade revoga o anterior; vencido não vale", async () => {
    const phone = newPhone();
    const first = await createPortalLink(service, fixture.clinicId, { phone, purpose: "book" });
    const second = await createPortalLink(service, fixture.clinicId, { phone, purpose: "book" });
    const other = await createPortalLink(service, fixture.clinicId, { phone, purpose: "return" });
    expect(portalLinkState((await getPortalLink(service, fixture.clinicId, first.id))!)).toBe("expired");
    expect(portalLinkState((await getPortalLink(service, fixture.clinicId, second.id))!)).toBe("valid");
    expect(portalLinkState((await getPortalLink(service, fixture.clinicId, other.id))!)).toBe("valid");
    const old = await createPortalLink(service, fixture.clinicId, { phone: newPhone(), purpose: "book" }, new Date(Date.now() - 31 * 60_000));
    expect(portalLinkState(old)).toBe("expired");
  });

  it("marca pela origem WhatsApp e gasta o link (uma marcação por link)", async () => {
    const { session, linkId } = await openLink(newPhone());
    const start = at(MON1, "10:00");
    const hold = await holdSlot(service, fixture.clinicId, session.id, {
      agendaId: dra.agendaId,
      serviceId: dra.consultations[0].serviceId,
      locationId: dra.locations[0].id,
      start,
      end: new Date(start.getTime() + 30 * 60_000),
    });
    if (hold.status !== "ok") throw new Error(hold.status);
    await setHoldPatient(service, fixture.clinicId, session.id, hold.holdId, { newPatient: { for: "self", name: "Link Bot Souza", birthdate: yearsAgo(35), contactName: null } });
    const outcome = await confirmPortalBooking(service, fixture.clinicId, {
      sessionId: session.id,
      holdId: hold.holdId,
      professional: dra,
      timeZone: TZ,
      insurancePlanId: null,
      entry: "professional_link",
      sender: null,
    });
    expect(outcome.status).toBe("booked");
    const { data } = await adminClient().from("appointments").select("booking_channel, portal_entry").eq("id", (outcome as { appointmentId: string }).appointmentId).single();
    expect(data).toEqual({ booking_channel: "portal", portal_entry: "whatsapp" });
    expect(portalLinkState((await getPortalLink(service, fixture.clinicId, linkId))!)).toBe("used");
  });

  it("Usar outro número: a sessão perde o celular e o link", async () => {
    const { session, cookies } = await openLink(newPhone());
    await forgetPhone(service, fixture.clinicId, session.id);
    expect(await readSession(service, fixture.clinicId, cookies)).toMatchObject({ phone: null, verified: false, linkId: null });
  });

  it("isolamento: outra clínica não lê nem abre o link", async () => {
    const link = await createPortalLink(service, fixture.clinicId, { phone: newPhone(), purpose: "book" });
    const outside = clinicServiceClient(otherClinic) as unknown as DbClient;
    expect(await getPortalLink(outside, otherClinic, link.id)).toBeNull();
    const { data } = await outside.from("portal_links").select("id").eq("id", link.id);
    expect(data).toEqual([]);
  });
});
