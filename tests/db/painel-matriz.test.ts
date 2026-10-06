import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { listClinicsAccess, listFeatureChanges, listPlatformStaffNames, setClinicFeatures } from "../../src/lib/data/features";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { codeOf } from "./agendaFixture";

// F4.2 — tela da matriz de acesso: o Suporte grava, vê quem liberou cada item
// e o histórico com o nome de quem mudou; a equipe da clínica não.

let clinicId: string;
let support: TestUser;
let admin: TestUser;
const asDb = (user: TestUser) => user.client as unknown as DbClient;

beforeAll(async () => {
  clinicId = await createClinic("Clínica da tela da matriz", []);
  [support, admin] = await Promise.all([createUser("pm-suporte"), createUser("pm-admin")]);
  await makePlatformStaff(support.id);
  await adminClient().from("platform_staff").update({ display_name: "Ana do Suporte" }).eq("user_id", support.id);
  await addMember(clinicId, admin.id, ["admin"]);
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers([support, admin]);
});

describe("matriz de acesso pela tela", () => {
  it("o Suporte libera e desliga; a tela mostra quem e quando", async () => {
    await setClinicFeatures(asDb(support), clinicId, ["whatsapp_bot", "waitlist", "exams"]);
    await setClinicFeatures(asDb(support), clinicId, ["whatsapp_bot", "exams"]);

    const names = await listPlatformStaffNames(asDb(support));
    expect(names.get(support.id)).toBe("Ana do Suporte");

    const clinic = (await listClinicsAccess(asDb(support))).find((c) => c.id === clinicId)!;
    expect(clinic.features.map((f) => [f.key, f.enabledBy]).sort()).toEqual([
      ["exams", support.id],
      ["whatsapp_bot", support.id],
    ]);

    const history = await listFeatureChanges(asDb(support), clinicId);
    expect(history.map((h) => [h.feature, h.enabled, names.get(h.actorId)])).toEqual(
      expect.arrayContaining([
        ["waitlist", false, "Ana do Suporte"],
        ["waitlist", true, "Ana do Suporte"],
        ["exams", true, "Ana do Suporte"],
      ]),
    );
  });

  it("a equipe da clínica não grava a matriz nem vê a lista do Suporte", async () => {
    expect(await codeOf(() => setClinicFeatures(asDb(admin), clinicId, ["metrics_personal"]))).toBe("forbidden");
    expect((await listPlatformStaffNames(asDb(admin))).size).toBe(0);
    expect(await codeOf(() => setClinicFeatures(asDb(support), clinicId, ["waitlist"]))).toBe("invalid");
  });
});
