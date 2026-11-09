import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { createBlock } from "../../src/lib/data/agenda/blocks";
import { createProfessional } from "../../src/lib/data/config/professionals";
import {
  isSlotStillFree,
  loadPortal,
  nextFreeSlot,
  portalSpecialties,
  professionalDates,
  professionalSlots,
  type PortalClinic,
} from "../../src/lib/data/portal/portal";
import { adminClient, anonClient, clinicServiceClient, createClinic, deleteClinics } from "./helpers";
import { asDb, at, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F2a da recepção digital: o portal acha a clínica pelo apelido e mostra profissionais, valores, convênios e
// horários (sem marcar), com a credencial limitada à clínica.

const TZ = "America/Fortaleza";
let fixture: AgendaFixture;
let service: DbClient;
let offClinic: string;
let draId: string;
let dr2Id: string;
let planId: string;
const slug = `portal-teste-${Date.now().toString(36)}`;

async function open(): Promise<PortalClinic> {
  const portal = await loadPortal(service, fixture.clinicId, slug);
  if (portal.status !== "open") throw new Error("portal indisponível");
  return portal;
}

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste do portal", "849222700");
  service = clinicServiceClient(fixture.clinicId) as unknown as DbClient;
  offClinic = await createClinic("Clínica sem o portal", []);
  const admin = adminClient();
  const { data: pros, error } = await admin.from("professionals").select("id, display_name").eq("clinic_id", fixture.clinicId);
  if (error) throw error;
  draId = pros.find((p) => p.display_name === "Dra. Agenda")!.id;
  dr2Id = pros.find((p) => p.display_name === "Dr. Segundo")!.id;
  const { data: plan, error: planError } = await admin.from("insurance_plans").insert({ clinic_id: fixture.clinicId, name: "Unimed" }).select("id").single();
  if (planError) throw planError;
  planId = plan.id;
  const { error: linkError } = await admin
    .from("professional_insurance_plans")
    .insert({ clinic_id: fixture.clinicId, professional_id: dr2Id, insurance_plan_id: planId, note: "Precisa de autorização." });
  if (linkError) throw linkError;
  const { error: privateError } = await admin.from("professionals").update({ accepts_private: false }).eq("id", dr2Id);
  if (privateError) throw privateError;
  const { error: slugError } = await admin.rpc("set_clinic_portal_slug", { p_clinic_id: fixture.clinicId, p_slug: slug });
  if (slugError) throw slugError;
});

afterAll(async () => {
  await fixture?.cleanup();
  await deleteClinics([offClinic]);
});

describe("endereço da clínica", () => {
  it("a plataforma acha a clínica pelo apelido; o público e a credencial da clínica não", async () => {
    const { data } = await adminClient().rpc("resolve_portal_clinic", { p_slug: slug });
    expect(data).toBe(fixture.clinicId);
    expect((await adminClient().rpc("resolve_portal_clinic", { p_slug: "nao-existe-xyz" })).data).toBeNull();
    expect((await anonClient().rpc("resolve_portal_clinic", { p_slug: slug })).error).not.toBeNull();
    expect((await clinicServiceClient(fixture.clinicId).rpc("resolve_portal_clinic", { p_slug: slug })).error).not.toBeNull();
  });

  it("recusa os endereços reservados do sistema", async () => {
    const { error } = await adminClient().rpc("set_clinic_portal_slug", { p_clinic_id: offClinic, p_slug: "admin" });
    expect(error?.code).toBe("22023");
    expect(error?.hint).toBe("portal_slug_reserved");
  });

  it("profissional com o nome de um passo do portal ganha o -2", async () => {
    const pro = await createProfessional(asDb(fixture.admin), fixture.clinicId, {
      userId: null,
      displayName: "Médicos",
      profession: "Médica",
      council: null,
      councilNumber: null,
      councilState: null,
    });
    expect(pro.portalSlug).toBe("medicos-2");
    await adminClient().from("professionals").update({ is_active: false }).eq("id", pro.id);
  });
});

describe("quem aparece", () => {
  it("item do portal desligado na Matriz: indisponível", async () => {
    const portal = await loadPortal(clinicServiceClient(offClinic) as unknown as DbClient, offClinic, "x");
    expect(portal.status).toBe("unavailable");
  });

  it("profissionais com Consulta no consultório, em ordem, com valores e convênios", async () => {
    const portal = await open();
    expect(portal.professionals.map((p) => p.name)).toEqual(["Dr. Segundo", "Dra. Agenda"]);
    const [dr2, dra] = portal.professionals;
    expect(dra).toMatchObject({ acceptsPrivate: true, privatePriceCents: 30000, privatePriceVaries: false, plans: [] });
    expect(dra.consultations.map((c) => c.name)).toEqual(["Consulta"]);
    // Domiciliar fica fora do portal.
    expect(dra.locations.map((l) => l.name)).toEqual(["Consultório"]);
    expect(dr2).toMatchObject({ acceptsPrivate: false, plans: [{ id: planId, name: "Unimed", note: "Precisa de autorização." }] });
    expect(portal.locations.map((l) => l.address)).toEqual(["Rua A, 1"]);
    expect(portalSpecialties(portal.professionals).map((s) => s.name)).toEqual(["Outros profissionais"]);
  });

  it("fora do portal ou desativado: some", async () => {
    await adminClient().from("professionals").update({ show_in_portal: false }).eq("id", dr2Id);
    try {
      expect((await open()).professionals.map((p) => p.name)).toEqual(["Dra. Agenda"]);
    } finally {
      await adminClient().from("professionals").update({ show_in_portal: true }).eq("id", dr2Id);
    }
  });

  it("sem particular e sem convênio (não há como marcar): some", async () => {
    await adminClient().from("insurance_plans").update({ is_active: false }).eq("id", planId);
    try {
      expect((await open()).professionals.map((p) => p.name)).toEqual(["Dra. Agenda"]);
    } finally {
      await adminClient().from("insurance_plans").update({ is_active: true }).eq("id", planId);
    }
  });

  it("a foto do profissional tem link; a da equipe não é lida pela credencial da clínica", async () => {
    const admin = adminClient();
    const path = `${fixture.clinicId}/profissionais/${draId}/foto.png`;
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    expect((await admin.storage.from("profile-photos").upload(path, png, { contentType: "image/png", upsert: true })).error).toBeNull();
    const teamPath = `${fixture.clinicId}/equipe/${fixture.admin.id}/foto.png`;
    expect((await admin.storage.from("profile-photos").upload(teamPath, png, { contentType: "image/png", upsert: true })).error).toBeNull();
    await admin.from("professionals").update({ photo_path: path }).eq("id", draId);
    try {
      const dra = (await open()).professionals.find((p) => p.id === draId)!;
      expect(dra.photoUrl).toMatch(/^https?:\/\//);
      const team = await service.storage.from("profile-photos").createSignedUrl(teamPath, 60);
      expect(team.data?.signedUrl ?? null).toBeNull();
    } finally {
      await admin.from("professionals").update({ photo_path: null }).eq("id", draId);
      await admin.storage.from("profile-photos").remove([path, teamPath]);
    }
  });
});

describe("horários", () => {
  it("as mesmas regras do bot: só o consultório, a cada 30 min, no prazo", async () => {
    const dra = (await open()).professionals.find((p) => p.id === draId)!;
    const consulta = dra.consultations[0].serviceId;
    const dates = await professionalDates(service, fixture.clinicId, dra, consulta, TZ, { count: 2, now: NOW });
    expect(dates).toEqual([MON1, MON2]);
    const slots = await professionalSlots(service, fixture.clinicId, dra, consulta, MON1, TZ, NOW);
    expect(slots.map((s) => s.time)).toEqual(["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
    expect(await nextFreeSlot(service, fixture.clinicId, dra, TZ, NOW)).toEqual(at(MON1, "08:00"));
    // Depois do prazo do profissional (60 dias), nada.
    expect(await professionalSlots(service, fixture.clinicId, dra, consulta, "2031-06-02", TZ, NOW)).toEqual([]);
  });

  it("o Continuar confere de novo: horário bloqueado deixa de valer", async () => {
    const dra = (await open()).professionals.find((p) => p.id === draId)!;
    const choice = { serviceId: dra.consultations[0].serviceId, locationId: dra.locations[0].id, start: at(MON1, "09:00") };
    expect(await isSlotStillFree(service, fixture.clinicId, dra, choice, TZ, NOW)).toBe(true);
    expect(await isSlotStillFree(service, fixture.clinicId, dra, { ...choice, start: at(MON1, "09:10") }, TZ, NOW)).toBe(false);
    await createBlock(
      asDb(fixture.admin),
      fixture.clinicId,
      { agendaId: dra.agendaId, startsAt: at(MON1, "09:00"), endsAt: at(MON1, "09:30"), reason: "Reunião", cancelAppointmentIds: [], actorId: null },
      NOW,
    );
    expect(await isSlotStillFree(service, fixture.clinicId, dra, choice, TZ, NOW)).toBe(false);
  });
});
