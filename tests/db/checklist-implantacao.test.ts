import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { setClinicStatus } from "../../src/lib/data/onboarding";
import { loadOnboardingChecklist, setOnboardingCheck } from "../../src/lib/data/onboardingChecklist";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, readyToActivate, type TestUser } from "./helpers";

// IS3 — Checklist de implantação (cliente, 03/nov/2026; docs/arquivo/modulos/implantacao-segura.md): o Suporte marca os itens; a
// ativação pelo Suporte só passa no banco com os obrigatórios que ele confere.

let clinicId: string;
let admin: TestUser;
let support: TestUser;
const asDb = (client: unknown) => client as DbClient;
const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "erro";
  }
};

beforeAll(async () => {
  clinicId = await createClinic("Clínica Checklist IS3");
  await adminClient().from("clinics").update({ status: "onboarding" }).eq("id", clinicId);
  [admin, support] = await Promise.all([createUser("is3-admin"), createUser("is3-suporte")]);
  await addMember(clinicId, admin.id, ["admin"]);
  await makePlatformStaff(support.id);
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers([admin, support]);
});

describe("checklist de implantação", () => {
  it("começa com os obrigatórios faltando; o teste do bot e os recomendados não bloqueiam", async () => {
    const checklist = await loadOnboardingChecklist(asDb(support.client), clinicId, []);
    const missing = checklist.missingRequired.map((i) => i.key);
    expect(missing).toEqual(
      expect.arrayContaining(["contract", "facebook_login", "whatsapp_business", "automations_off", "card_default", "invite_accepted", "whatsapp_connected", "test_delivered"]),
    );
    expect(missing).not.toContain("bot_test");
    expect(missing).not.toContain("business_verification");
    expect(checklist.items.find((i) => i.key === "bot_test")).toMatchObject({ group: "Depois de ativar", required: false });
  });

  it("só o Suporte marca; desmarcar apaga", async () => {
    expect(await codeOf(() => setOnboardingCheck(asDb(admin.client), clinicId, "contract", true, admin.id))).toBe("forbidden");
    await setOnboardingCheck(asDb(support.client), clinicId, "contract", true, support.id);
    let items = (await loadOnboardingChecklist(asDb(support.client), clinicId, [])).items;
    expect(items.find((i) => i.key === "contract")).toMatchObject({ done: true, kind: "manual" });
    // O Administrador vê a checklist da própria clínica.
    expect((await loadOnboardingChecklist(asDb(admin.client), clinicId, [])).items.find((i) => i.key === "contract")?.done).toBe(true);
    await setOnboardingCheck(asDb(support.client), clinicId, "contract", false, support.id);
    items = (await loadOnboardingChecklist(asDb(support.client), clinicId, [])).items;
    expect(items.find((i) => i.key === "contract")?.done).toBe(false);
    expect(await codeOf(() => setOnboardingCheck(asDb(support.client), clinicId, "inventado", true, support.id))).toBe("invalid");
  });

  it("ativar pelo Suporte: o banco recusa sem os obrigatórios e aceita com eles", async () => {
    const { error } = await support.client.from("clinics").update({ status: "active" }).eq("id", clinicId);
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("mensagem de teste entregue");
    expect(error?.message).toContain("cartão definido como padrão na Meta");
    await readyToActivate(clinicId);
    await setClinicStatus(asDb(support.client), clinicId, "active");
    const { data } = await adminClient().from("clinics").select("status").eq("id", clinicId).single();
    expect(data!.status).toBe("active");
    const checklist = await loadOnboardingChecklist(asDb(support.client), clinicId, []);
    expect(checklist.items.find((i) => i.key === "test_delivered")?.done).toBe(true);
    expect(checklist.items.find((i) => i.key === "invite_accepted")?.done).toBe(true);
  });
});
