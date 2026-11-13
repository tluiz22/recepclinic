import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, withDatabase, type TestUser } from "./helpers";

// Frente Usabilidade, U1: a visita anônima do portal. Só avança, não cruza clínicas e o relatório é do Administrador.

let clinicA: string;
let clinicB: string;
let admin: TestUser;
let reception: TestUser;

beforeAll(async () => {
  clinicA = await createClinic("Visitas A");
  clinicB = await createClinic("Visitas B");
  admin = await createUser("visitas-admin");
  reception = await createUser("visitas-recepcao");
  await addMember(clinicA, admin.id, ["admin"]);
  await addMember(clinicA, reception.id, ["reception"]);
});

afterAll(async () => {
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([admin, reception]);
});

const furthestOf = (id: string) =>
  withDatabase(async (db) => (await db.query("select clinic_id, furthest from public.portal_visits where id = $1", [id])).rows[0] ?? null);

describe("portal_visit_step", () => {
  it("abre, avança e não volta", async () => {
    const id = randomUUID();
    const db = clinicServiceClient(clinicA);
    expect((await db.rpc("portal_visit_step", { p_visit_id: id, p_entry: "clinic", p_step: 1 })).error).toBeNull();
    await db.rpc("portal_visit_step", { p_visit_id: id, p_entry: "clinic", p_step: 4 });
    await db.rpc("portal_visit_step", { p_visit_id: id, p_entry: "clinic", p_step: 2 });
    expect(await furthestOf(id)).toEqual({ clinic_id: clinicA, furthest: 4 });
  });

  it("visita de outra clínica não muda", async () => {
    const id = randomUUID();
    await clinicServiceClient(clinicA).rpc("portal_visit_step", { p_visit_id: id, p_entry: "clinic", p_step: 2 });
    await clinicServiceClient(clinicB).rpc("portal_visit_step", { p_visit_id: id, p_entry: "clinic", p_step: 8 });
    expect(await furthestOf(id)).toEqual({ clinic_id: clinicA, furthest: 2 });
  });

  it("recusa passo fora de 1 a 8 e entrada desconhecida", async () => {
    const db = clinicServiceClient(clinicA);
    expect((await db.rpc("portal_visit_step", { p_visit_id: randomUUID(), p_entry: "clinic", p_step: 9 })).error).not.toBeNull();
    expect((await db.rpc("portal_visit_step", { p_visit_id: randomUUID(), p_entry: "site", p_step: 1 })).error).not.toBeNull();
  });

  it("login comum não grava nem lê a tabela", async () => {
    expect((await admin.client.rpc("portal_visit_step", { p_visit_id: randomUUID(), p_entry: "clinic", p_step: 1 })).error).not.toBeNull();
    const { data } = await admin.client.from("portal_visits").select("id");
    expect(data ?? []).toEqual([]);
  });
});

describe("metrics_portal_steps", () => {
  const range = { p_start: "2000-01-01T00:00:00Z", p_end: "2100-01-01T00:00:00Z" };

  it("Administrador vê as visitas por entrada e passo", async () => {
    const db = clinicServiceClient(clinicA);
    await db.rpc("portal_visit_step", { p_visit_id: randomUUID(), p_entry: "whatsapp", p_step: 8 });
    const { data, error } = await admin.client.rpc("metrics_portal_steps", { p_clinic_id: clinicA, ...range });
    expect(error).toBeNull();
    expect(data).toEqual(expect.arrayContaining([{ entry: "whatsapp", furthest: 8, visits: 1 }]));
  });

  it("Recepção não vê nada", async () => {
    const { data } = await reception.client.rpc("metrics_portal_steps", { p_clinic_id: clinicA, ...range });
    expect(data ?? []).toEqual([]);
  });
});
