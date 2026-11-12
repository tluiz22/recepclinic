import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { listActiveBlocks, releaseBlock } from "../../src/lib/data/portalBlocks";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// F6, parte 3: Sistema › Portal. O Suporte vê os bloqueios ativos de todas as clínicas (celular, IP e sessão) e libera;
// o Administrador de uma clínica só vê os dela; o que venceu ou foi liberado sai da lista.

let clinicA: string;
let clinicB: string;
let support: TestUser;
let adminA: TestUser;
let outsider: TestUser;
const asDb = (user: TestUser) => user.client as unknown as DbClient;
const ids: Record<string, string> = {};

async function block(clinicId: string, key: string, action: string, level: number, minutes: number) {
  const { data, error } = await adminClient()
    .from("portal_blocks")
    .insert({ clinic_id: clinicId, key, action, level, blocked_until: new Date(Date.now() + minutes * 60_000).toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  [clinicA, clinicB] = await Promise.all([createClinic("Clínica A dos bloqueios", ["portal"]), createClinic("Clínica B dos bloqueios", ["portal"])]);
  [support, adminA, outsider] = await Promise.all([createUser("pb-suporte"), createUser("pb-admin"), createUser("pb-fora")]);
  await makePlatformStaff(support.id);
  await addMember(clinicA, adminA.id, ["admin"]);
  ids.phone = await block(clinicA, "phone:+5584999990001", "code", 1, 15);
  ids.ip = await block(clinicB, "ip:200.1.2", "verify", 2, 60);
  ids.session = await block(clinicB, "session:0a1b2c3d-1111-2222-3333-444455556666", "slots", 1, 15);
  ids.expired = await block(clinicA, "phone:+5584999990002", "code", 1, -5);
});

afterAll(async () => {
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([support, adminA, outsider]);
});

describe("bloqueios do portal para o Suporte", () => {
  it("o Suporte vê os ativos de todas as clínicas, sem os vencidos", async () => {
    const { blocks: list } = await listActiveBlocks(asDb(support), { clinicIds: [clinicA, clinicB] });
    expect(list.map((b) => b.kind).sort()).toEqual(["ip", "phone", "session"]);
    const phone = list.find((b) => b.kind === "phone")!;
    expect(phone.timezone).toBeTruthy();
    expect(phone).toMatchObject({ clinicName: "Clínica A dos bloqueios", target: "(84) 99999-0001", actionLabel: "Pediu o código demais", level: 1 });
  });

  it("o Administrador da clínica só vê os dela; quem é de fora, nada", async () => {
    const mine = (await listActiveBlocks(asDb(adminA))).blocks.map((b) => b.id);
    expect(mine).toEqual([ids.phone]);
    expect((await listActiveBlocks(asDb(outsider))).blocks).toEqual([]);
  });

  it("o Suporte libera; o bloqueio sai da lista e a liberação fica registrada", async () => {
    expect(await releaseBlock(asDb(support), ids.ip)).toBe(true);
    expect(await releaseBlock(asDb(support), ids.ip)).toBe(false);
    const list = (await listActiveBlocks(asDb(support), { clinicIds: [clinicA, clinicB] })).blocks.map((b) => b.id);
    expect(list).not.toContain(ids.ip);
    const { data } = await adminClient().from("portal_blocks").select("released_at, released_by").eq("id", ids.ip).single();
    expect(data?.released_at).not.toBeNull();
    expect(data?.released_by).toBe(support.id);
  });

  it("quem é de fora não libera", async () => {
    expect(await releaseBlock(asDb(outsider), ids.session)).toBe(false);
    const direct = await outsider.client.rpc("portal_release_block", { p_block_id: ids.session });
    expect(direct.error?.code).toBe("42501");
    const { data } = await adminClient().from("portal_blocks").select("released_at").eq("id", ids.session).single();
    expect(data?.released_at).toBeNull();
  });
});
