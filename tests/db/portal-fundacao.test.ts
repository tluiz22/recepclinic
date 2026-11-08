import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInsurancePlan, listProfessionalPlanNotes, listProfessionalPlans, setProfessionalCoverage } from "../../src/lib/data/config/insurance";
import { createProfessional, listProfessionals } from "../../src/lib/data/config/professionals";
import { setClinicFeatures } from "../../src/lib/data/features";
import { adminClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F1 da recepção digital integrada (docs/implementacao-recepcao-digital.md, cliente, 08/nov/2026): o item
// Portal na matriz, os apelidos do endereço, "Atende particular" e a observação por convênio.

let fixture: AgendaFixture;
let support: TestUser;
let other: string;
let draId: string;
let unimed: string;
let amil: string;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da fundação do portal", "849555100");
  support = await createUser("suporte-portal");
  await makePlatformStaff(support.id);
  other = await createClinic("Outra clínica do portal", []);
  const { data } = await adminClient().from("agendas").select("professional_id").eq("id", fixture.ids.agendaDra).single();
  draId = data!.professional_id as string;
  unimed = (await createInsurancePlan(asDb(fixture.admin), fixture.clinicId, { name: "Unimed", alternativeNames: [], ansCode: null })).id;
  amil = (await createInsurancePlan(asDb(fixture.admin), fixture.clinicId, { name: "Amil", alternativeNames: [], ansCode: null })).id;
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteClinics([other]);
  await deleteUsers([support]);
});

describe("matriz: o bot depende do Portal", () => {
  it("bot sem o Portal é recusado; com ele, liga; o Portal sozinho também", async () => {
    expect(await codeOf(() => setClinicFeatures(asDb(support), other, ["whatsapp_bot"]))).not.toBe("ok");
    await setClinicFeatures(asDb(support), other, ["portal", "whatsapp_bot"]);
    await setClinicFeatures(asDb(support), other, ["portal"]);
    const { data } = await adminClient().from("clinic_features").select("feature_key").eq("clinic_id", other);
    expect(data!.map((r) => r.feature_key)).toEqual(["portal"]);
  });
});

describe("apelidos do endereço do portal", () => {
  it("profissional: automático pelo nome, sem acento; repetido ganha -2; não muda depois", async () => {
    const { clinicId, admin } = fixture;
    const input = { userId: null, displayName: "Dra. Ângela Lima", profession: "Médica", specialtyIds: undefined, council: null, councilNumber: null, councilState: null };
    const a = await createProfessional(asDb(admin), clinicId, input);
    const b = await createProfessional(asDb(admin), clinicId, input);
    const all = await listProfessionals(asDb(admin), clinicId, { includeInactive: true });
    expect(all.find((p) => p.id === a.id)?.portalSlug).toBe("dra-angela-lima");
    expect(all.find((p) => p.id === b.id)?.portalSlug).toBe("dra-angela-lima-2");
    const { error } = await asDb(admin).from("professionals").update({ portal_slug: "outro" }).eq("id", a.id);
    expect(error?.code).toBe("42501");
    // Mudar o nome não muda o endereço.
    await asDb(admin).from("professionals").update({ display_name: "Dra. Ângela Souza" }).eq("id", a.id);
    expect((await listProfessionals(asDb(admin), clinicId, { includeInactive: true })).find((p) => p.id === a.id)?.portalSlug).toBe("dra-angela-lima");
  });

  it("clínica: só o Suporte escolhe; formato e endereço único conferidos", async () => {
    const set = (who: TestUser, clinic: string, slug: string | null) => asDb(who).rpc("set_clinic_portal_slug", { p_clinic_id: clinic, p_slug: slug as string });
    expect((await set(fixture.admin, fixture.clinicId, "vila-serena")).error?.code).toBe("42501");
    expect((await set(support, fixture.clinicId, "Vila Serena!")).error?.code).toBe("22023");
    expect((await set(support, fixture.clinicId, "vila-serena-teste")).error).toBeNull();
    expect((await set(support, other, "vila-serena-teste")).error?.code).toBe("23505");
    const { data } = await adminClient().from("clinics").select("portal_slug").eq("id", fixture.clinicId).single();
    expect(data!.portal_slug).toBe("vila-serena-teste");
    expect((await set(support, fixture.clinicId, null)).error).toBeNull();
  });
});

describe("particular e convênios do profissional", () => {
  it("só convênio, com observação; a trilha registra a observação", async () => {
    const { clinicId, admin } = fixture;
    await setProfessionalCoverage(asDb(admin), clinicId, draId, {
      acceptsPrivate: false,
      plans: [
        { planId: unimed, note: "  Precisa de autorização prévia.  " },
        { planId: amil, note: null },
      ],
    });
    expect(await listProfessionalPlans(asDb(admin), clinicId, draId)).toEqual([amil, unimed].sort());
    expect(Object.fromEntries(await listProfessionalPlanNotes(asDb(admin), clinicId, draId))).toEqual({ [unimed]: "Precisa de autorização prévia." });
    expect((await listProfessionals(asDb(admin), clinicId)).find((p) => p.id === draId)?.acceptsPrivate).toBe(false);
    const { data: log } = await adminClient().from("insurance_change_log").select("action").eq("clinic_id", clinicId).eq("action", "note_updated");
    expect(log!.length).toBe(1);
  });

  it("sem particular e sem convênio é recusado", async () => {
    expect(await codeOf(() => setProfessionalCoverage(asDb(fixture.admin), fixture.clinicId, draId, { acceptsPrivate: false, plans: [] }))).toBe("invalid");
  });

  it("a Recepção sem a permissão de convênios não muda nada", async () => {
    const { clinicId, reception } = fixture;
    expect(await codeOf(() => setProfessionalCoverage(asDb(reception), clinicId, draId, { acceptsPrivate: true, plans: [{ planId: unimed, note: "x" }] }))).not.toBe("ok");
    const { error } = await asDb(reception).rpc("set_professional_accepts_private", { p_clinic_id: clinicId, p_professional_id: draId, p_accepts: true });
    expect(error?.code).toBe("42501");
    expect((await listProfessionals(asDb(fixture.admin), clinicId)).find((p) => p.id === draId)?.acceptsPrivate).toBe(false);
  });

  it("volta a atender particular", async () => {
    await setProfessionalCoverage(asDb(fixture.admin), fixture.clinicId, draId, { acceptsPrivate: true, plans: [] });
    expect((await listProfessionals(asDb(fixture.admin), fixture.clinicId)).find((p) => p.id === draId)?.acceptsPrivate).toBe(true);
    expect(await listProfessionalPlans(asDb(fixture.admin), fixture.clinicId, draId)).toEqual([]);
  });
});

describe("prazos do portal e canal", () => {
  it("reserva de 3 a 10 minutos (padrão 5) e antecedência padrão de 24 h", async () => {
    const { data } = await adminClient().from("clinic_settings").select("portal_hold_minutes, portal_cancel_lead_hours").eq("clinic_id", fixture.clinicId).single();
    expect(data).toEqual({ portal_hold_minutes: 5, portal_cancel_lead_hours: 24 });
    const { error } = await adminClient().from("clinic_settings").update({ portal_hold_minutes: 11 }).eq("clinic_id", fixture.clinicId);
    expect(error?.code).toBe("23514");
  });
});
