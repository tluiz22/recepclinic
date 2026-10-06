import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEATURES, type FeatureKey } from "../../src/lib/features";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { cancelByClinic } from "../../src/lib/data/agenda/blocks";
import { createSeries } from "../../src/lib/data/agenda/series";
import type { DbClient } from "../../src/lib/data/clients";
import { loadClinicContext } from "../../src/lib/data/clinicContext";
import { createInsurancePlan } from "../../src/lib/data/config/insurance";
import { createLocation } from "../../src/lib/data/config/locations";
import { createNotificationRecipient } from "../../src/lib/data/config/notificationRecipients";
import { createService, setServiceActive } from "../../src/lib/data/config/services";
import {
  getClinicFeatures,
  listClinicsAccess,
  listFeatureChanges,
  ownAgendaIds,
  setClinicFeatures,
} from "../../src/lib/data/features";
import { joinWaitlist } from "../../src/lib/data/waitlist/entries";
import { processWaitlist } from "../../src/lib/data/waitlist/offers";
import { adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture, type AgendaIds } from "./agendaFixture";

// F3.8 — matriz de acesso por clínica (D11): quem grava, quem lê e as travas
// no banco para as funções que criam dados.
let fixture: AgendaFixture;
let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let ids: AgendaIds;
let support: TestUser;
let otherClinic: string;
const db = asDb;
const ALL = FEATURES.map((feature) => feature.key);

/** Muda a matriz como o Administrador do sistema. */
const setFeatures = (keys: FeatureKey[]) => setClinicFeatures(db(support), clinicId, keys);

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da matriz", "859778000");
  ({ clinicId, admin, reception, ids } = fixture);
  support = await createUser("suporte-matriz");
  await makePlatformStaff(support.id);
  otherClinic = await createClinic("Outra clínica da matriz", []);
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteClinics([otherClinic]);
  await deleteUsers([support]);
});

describe("itens da matriz", () => {
  it("a lista do banco é a mesma do código", async () => {
    const { data } = await adminClient().from("features").select("key, area, label, depends_on").order("sort_order");
    expect(data).toEqual(FEATURES.map((f) => ({ key: f.key, area: f.area, label: f.label, depends_on: f.dependsOn })));
  });

  it("clínica nova começa só com o básico", async () => {
    expect(await getClinicFeatures(adminClient() as unknown as DbClient, otherClinic)).toEqual([]);
  });
});

describe("quem grava e quem lê", () => {
  it("só o Administrador do sistema grava; quem liberou e o histórico ficam registrados", async () => {
    expect(await codeOf(() => setClinicFeatures(db(admin), clinicId, []))).toBe("forbidden");
    const { error: fromBot } = await clinicServiceClient(clinicId).rpc("set_clinic_features", { p_clinic_id: clinicId, p_features: [] });
    expect(fromBot?.code).toBe("42501");
    const { error: direct } = await admin.client.from("clinic_features").insert({ clinic_id: clinicId, feature_key: "metrics_personal" });
    expect(direct?.code).toBe("42501");

    await setFeatures([]);
    await setFeatures(["exams", "metrics_personal"]);
    expect((await getClinicFeatures(db(reception), clinicId)).sort()).toEqual(["exams", "metrics_personal"]);
    const { data: rows } = await adminClient().from("clinic_features").select("feature_key, enabled_by").eq("clinic_id", clinicId);
    expect(rows!.every((row) => row.enabled_by === support.id)).toBe(true);

    await setFeatures(["exams"]);
    const changes = await listFeatureChanges(db(support), clinicId);
    expect(changes[0]).toMatchObject({ feature: "metrics_personal", enabled: false, actorId: support.id });
    expect(changes.some((c) => c.feature === "metrics_personal" && c.enabled)).toBe(true);
  });

  it("item sem o item de que depende é recusado (aplicação e banco); item desconhecido também", async () => {
    expect(await codeOf(() => setFeatures(["waitlist"]))).toBe("invalid");
    const { error } = await support.client.rpc("set_clinic_features", { p_clinic_id: clinicId, p_features: ["metrics_funnel"] });
    expect(error?.message).toContain("depende de");
    const { error: unknown } = await support.client.rpc("set_clinic_features", { p_clinic_id: clinicId, p_features: ["xyz"] });
    expect(unknown?.code).toBe("22023");
  });

  it("a equipe e o bot leem só a própria clínica; o Suporte vê todas", async () => {
    await setFeatures(ALL);
    const bot = clinicServiceClient(clinicId) as unknown as DbClient;
    expect((await getClinicFeatures(bot, clinicId)).length).toBe(ALL.length);
    expect(await getClinicFeatures(db(admin), otherClinic)).toEqual([]);
    const { data: leaked } = await clinicServiceClient(otherClinic).from("clinic_features").select("feature_key").eq("clinic_id", clinicId);
    expect(leaked).toEqual([]);

    const clinics = await listClinicsAccess(db(support));
    expect(clinics.find((c) => c.id === clinicId)?.features.length).toBe(ALL.length);
    expect(clinics.some((c) => c.id === otherClinic)).toBe(true);
    expect((await listClinicsAccess(db(admin))).map((c) => c.id)).toEqual([clinicId]);
  });

  it("o contexto da clínica traz os itens liberados", async () => {
    await setFeatures(["exams", "metrics_personal"]);
    const result = await loadClinicContext(db(reception), reception.id, clinicId);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.context.features.sort()).toEqual(["exams", "metrics_personal"]);
  });
});

describe("travas no banco com o item desligado", () => {
  beforeAll(async () => {
    await setFeatures([]);
  });

  it("não cadastra serviço de exame, local domiciliar, convênio nem contato do resumo", async () => {
    const a = db(admin);
    expect(
      await codeOf(() =>
        createService(a, clinicId, {
          name: "Exame novo", category: "exam", durationMinutes: 20, priceCents: 0, returnDeadlineDays: null,
          preparationInstructions: null, schedulingMode: "individual",
        }),
      ),
    ).toBe("not_enabled");
    expect(await codeOf(() => createLocation(a, clinicId, { name: "Em casa", type: "home_visit", address: null }))).toBe("not_enabled");
    expect(await codeOf(() => createInsurancePlan(a, clinicId, { name: "Plano X", alternativeNames: [], ansCode: null }))).toBe("not_enabled");
    expect(
      await codeOf(() =>
        createNotificationRecipient(a, clinicId, { label: "Recepção", phone: "+5585977780099", receivesConsultations: true, receivesExams: false }),
      ),
    ).toBe("not_enabled");
  });

  it("consulta continua; exame, domiciliar e série não marcam", async () => {
    const book = (serviceId: string, agendaId: string, start: Date, extra = {}) =>
      bookAppointment(db(reception), clinicId, { patientId: ids.p1, serviceId, agendaId, start, channel: "admin", actorId: reception.id, ...extra }, NOW);
    expect(await codeOf(() => book(ids.exame, ids.agendaExams, at(MON1, "08:00")))).toBe("not_enabled");
    expect(await codeOf(() => book(ids.consulta, ids.agendaDra, at(MON1, "14:00"), { homeVisitAddress: "Rua B, 2" }))).toBe("not_enabled");
    expect(
      await codeOf(() =>
        createSeries(db(reception), clinicId, {
          patientId: ids.p2, serviceId: ids.consulta, agendaId: ids.agendaDra, locationId: ids.office,
          intervalWeeks: 1, startsOn: MON1, startTime: "10:00", maxSessions: 2, actorId: reception.id,
        }, NOW),
      ),
    ).toBe("not_enabled");
    expect(await codeOf(() => book(ids.consulta, ids.agendaDra, at(MON1, "08:00")))).toBe("ok");
  });

  it("lista de espera: não entra e o motor não roda; cancelamento pela clínica sem link do bot", async () => {
    const { appointment } = await bookAppointment(
      db(reception), clinicId,
      { patientId: ids.p3, serviceId: ids.consulta, agendaId: ids.agendaDra2, start: at(MON1, "08:00"), channel: "admin", actorId: reception.id },
      NOW,
    );
    expect(await codeOf(() => joinWaitlist(db(reception), clinicId, appointment.id, { via: "admin", actorId: reception.id }, NOW))).toBe("not_enabled");
    const bot = clinicServiceClient(clinicId) as unknown as DbClient;
    expect(await processWaitlist(bot, clinicId, async () => ({ sent: true, messageId: "x" }), NOW)).toEqual({
      expired: 0, closedEntries: 0, offered: 0, skipped: 0, closedOpenings: 0,
    });
    const [canceled] = await cancelByClinic(db(reception), clinicId, [appointment.id], reception.id, NOW);
    expect(canceled).toMatchObject({ appointment: { id: appointment.id, status: "canceled" }, rebookingLink: null });
  });

  it("desativar o que já existe continua permitido", async () => {
    expect(await codeOf(() => setServiceActive(db(admin), clinicId, ids.exame, false))).toBe("ok");
  });
});

describe("métricas pessoais", () => {
  it("as agendas do próprio profissional são as ligadas ao login dele", async () => {
    const doctor = await createUser("dra-matriz");
    try {
      await adminClient().from("clinic_members").insert({ clinic_id: clinicId, user_id: doctor.id, roles: ["professional"] });
      const { data: professional } = await adminClient()
        .from("professionals")
        .insert({ clinic_id: clinicId, user_id: doctor.id, display_name: "Dra. Matriz", profession: "Médica" })
        .select("id")
        .single();
      const { data: agenda } = await adminClient()
        .from("agendas")
        .insert({ clinic_id: clinicId, name: "Dra. Matriz", kind: "professional", professional_id: professional!.id })
        .select("id")
        .single();
      expect(await ownAgendaIds(db(admin), clinicId, doctor.id)).toEqual([agenda!.id]);
      expect(await ownAgendaIds(db(admin), clinicId, reception.id)).toEqual([]);
    } finally {
      await deleteUsers([doctor]);
    }
  });
});
