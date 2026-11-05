import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_TIMEZONE, todayIn } from "../../src/lib/clinicTime";
import type { DbClient } from "../../src/lib/data/clients";
import { createMetaPriceVersion, deleteMetaPriceVersion, listMessageCounts, listMetaPriceVersions } from "../../src/lib/data/metaPricing";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// CU2 — Preços da Meta e mensagens por categoria (cliente, 05/nov/2026): todos leem os preços; só o Suporte cadastra
// (do mês atual em diante, no dia 1º) e apaga (só a futura). A contagem separa modelos, serviço e pelo app.

let clinicId: string;
let otherClinicId: string;
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
const today = todayIn(DEFAULT_TIMEZONE);
const monthAhead = (months: number) => {
  const [year, month] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return date.toISOString().slice(0, 7);
};
const input = (month: string) => ({
  validFrom: month,
  utilityBrl: "0,0400",
  authenticationBrl: "0,0400",
  serviceBrl: "0,0400",
  freeServicePerMonth: "1000",
  usdBrl: "5,20",
  source: "Teste CU2",
});

beforeAll(async () => {
  [clinicId, otherClinicId] = await Promise.all([createClinic("Clínica CU2"), createClinic("Clínica CU2 outra")]);
  [admin, support] = await Promise.all([createUser("cu2-admin"), createUser("cu2-suporte")]);
  await addMember(clinicId, admin.id, ["admin"]);
  await makePlatformStaff(support.id);
  const base = { direction: "outbound", contact_phone: "+5584999990001" };
  const rows = [
    { ...base, clinic_id: clinicId, message_type: "appointment_reminder", template_name: "lembrete", status: "delivered" },
    { ...base, clinic_id: clinicId, message_type: "appointment_confirmation", template_name: "confirmacao", status: "sent" },
    { ...base, clinic_id: clinicId, message_type: "appointment_confirmation", template_name: "confirmacao", status: "failed" },
    { ...base, clinic_id: clinicId, message_type: "bot_reply", template_name: null, status: "read" },
    { ...base, clinic_id: clinicId, message_type: "bot_reply", template_name: null, status: "skipped_window" },
    { ...base, clinic_id: clinicId, message_type: "agent_reply", template_name: null, status: "sent" },
    { ...base, clinic_id: clinicId, message_type: "app_auto_reply", template_name: null, status: "sent" },
    { ...base, clinic_id: clinicId, direction: "inbound", message_type: "text", template_name: null, status: "received" },
    { ...base, clinic_id: otherClinicId, message_type: "bot_reply", template_name: null, status: "sent" },
  ];
  const { error } = await adminClient().from("whatsapp_messages").insert(rows);
  if (error) throw error;
});

afterAll(async () => {
  await adminClient().from("meta_price_versions").delete().eq("source", "Teste CU2");
  await deleteClinics([clinicId, otherClinicId]);
  await deleteUsers([admin, support]);
});

describe("preços da Meta", () => {
  it("a vigência de 01/out/2026 vem na migração e todos leem", async () => {
    const versions = await listMetaPriceVersions(asDb(admin.client));
    const october = versions.find((v) => v.validFrom === "2026-10-01")!;
    expect(october).toMatchObject({ utilityBrl: 0.035, authenticationBrl: 0.035, serviceBrl: 0.035, freeServicePerMonth: 1000, usdBrl: 5.15 });
  });

  it("só o Suporte cadastra, do mês atual em diante; só a futura sai", async () => {
    expect(await codeOf(() => createMetaPriceVersion(asDb(admin.client), input(monthAhead(2)), today))).not.toBe("ok");
    expect(await codeOf(() => createMetaPriceVersion(asDb(support.client), input(monthAhead(-1)), today))).toBe("invalid");
    // O banco também recusa o mês passado e o dia diferente de 1º, mesmo sem a validação da tela.
    const past = await support.client.from("meta_price_versions").insert({ ...row(), valid_from: `${monthAhead(-1)}-01` });
    expect(past.error).not.toBeNull();
    const midMonth = await support.client.from("meta_price_versions").insert({ ...row(), valid_from: `${monthAhead(3)}-15` });
    expect(midMonth.error).not.toBeNull();

    const id = await createMetaPriceVersion(asDb(support.client), input(monthAhead(2)), today);
    expect(await codeOf(() => createMetaPriceVersion(asDb(support.client), input(monthAhead(2)), today))).toBe("duplicate");
    const created = (await listMetaPriceVersions(asDb(support.client))).find((v) => v.id === id)!;
    expect(created).toMatchObject({ validFrom: `${monthAhead(2)}-01`, utilityBrl: 0.04, usdBrl: 5.2, createdBy: support.id });

    expect(await codeOf(() => deleteMetaPriceVersion(asDb(admin.client), id))).toBe("not_found");
    const october = (await listMetaPriceVersions(asDb(support.client))).find((v) => v.validFrom === "2026-10-01")!;
    expect(await codeOf(() => deleteMetaPriceVersion(asDb(support.client), october.id))).toBe("not_found");
    const update = await support.client.from("meta_price_versions").update({ utility_brl: 1 }).eq("id", october.id).select("id");
    expect(update.data ?? []).toEqual([]);
    await deleteMetaPriceVersion(asDb(support.client), id);
    expect((await listMetaPriceVersions(asDb(support.client))).some((v) => v.id === id)).toBe(false);
  });
});

describe("mensagens por categoria", () => {
  it("separa modelos, serviço e pelo app, sem falhas, puladas nem recebidas", async () => {
    const month = `${today.slice(0, 7)}-01`;
    const mine = await listMessageCounts(asDb(admin.client), month, clinicId);
    expect(mine).toEqual([{ clinicId, month, templates: 2, service: 1, appReplies: 2 }]);
    // A clínica só vê a sua; o Suporte vê todas.
    expect((await listMessageCounts(asDb(admin.client), month)).map((r) => r.clinicId)).toEqual([clinicId]);
    const all = await listMessageCounts(asDb(support.client), month);
    expect(all.find((r) => r.clinicId === otherClinicId)).toMatchObject({ templates: 0, service: 1, appReplies: 0 });
  });
});

function row() {
  return { utility_brl: 0.04, authentication_brl: 0.04, service_brl: 0.04, free_service_per_month: 1000, usd_brl: 5.2, source: "Teste CU2" };
}
