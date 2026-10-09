import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { countSystemErrorsSince, loadCronHeartbeats, recordCronHeartbeat, recordSystemError } from "../../src/lib/data/platform";
import { listSystemErrors } from "../../src/lib/data/systemErrors";
import { addMember, adminClient, anonClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// F9.3 — erros do sistema e execução das rotinas: só a plataforma grava, só o
// Suporte lê.
const env = { supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!, supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY! };
const asDb = (user: TestUser) => user.client as unknown as DbClient;
const marker = `teste-${randomUUID().slice(0, 8)}`;
const job = `rotina-${marker}`;

let clinicId: string;
let support: TestUser;
let admin: TestUser;

beforeAll(async () => {
  clinicId = await createClinic("Clínica do teste de erros");
  support = await createUser("suporte-erros");
  await makePlatformStaff(support.id);
  admin = await createUser("admin-erros");
  await addMember(clinicId, admin.id, ["admin"]);
});

afterAll(async () => {
  await adminClient().from("system_errors").delete().like("scope", `${marker}%`);
  await adminClient().from("cron_heartbeats").delete().eq("job", job);
  await deleteClinics([clinicId]);
  await deleteUsers([support, admin]);
});

describe("erros do sistema", () => {
  it("a plataforma grava; o Suporte lê com o nome da clínica", async () => {
    const since = new Date(Date.now() - 1000);
    await recordSystemError({ scope: `${marker} envio`, clinicId, ids: { atendimento: "a1" }, message: "Error: falhou" }, env);
    await recordSystemError({ scope: `${marker} sem clínica`, clinicId: null, ids: {}, message: "" }, env);

    const mine = (await listSystemErrors(asDb(support))).filter((e) => e.scope.startsWith(marker));
    expect(mine.map((e) => e.scope).sort()).toEqual([`${marker} envio`, `${marker} sem clínica`]);
    expect(mine.find((e) => e.clinicId === clinicId)).toMatchObject({ clinicName: "Clínica do teste de erros", ids: { atendimento: "a1" } });

    const filtered = await listSystemErrors(asDb(support), { clinicId });
    expect(filtered.every((e) => e.clinicId === clinicId)).toBe(true);

    expect(await countSystemErrorsSince(since, env)).toBeGreaterThanOrEqual(2);
  });

  it("o Administrador da clínica, a credencial da clínica e o anônimo não leem nem gravam", async () => {
    expect((await admin.client.from("system_errors").select("id").like("scope", `${marker}%`)).data).toEqual([]);
    for (const client of [admin.client, clinicServiceClient(clinicId), anonClient()]) {
      const { error } = await client.from("system_errors").insert({ scope: `${marker} intruso`, message: "x" });
      expect(error).not.toBeNull();
    }
    const { data } = await clinicServiceClient(clinicId).from("system_errors").select("id");
    expect(data ?? []).toEqual([]);
  });

  it("clínica apagada: o erro fica, sem a clínica", async () => {
    const other = await createClinic("Clínica que vai sair");
    await recordSystemError({ scope: `${marker} órfão`, clinicId: other, ids: {}, message: "" }, env);
    await deleteClinics([other]);
    const orphan = (await listSystemErrors(asDb(support))).find((e) => e.scope === `${marker} órfão`);
    expect(orphan).toMatchObject({ clinicId: null, clinicName: null });
  });
});

describe("execução das rotinas", () => {
  it("grava e atualiza a última execução; só o Suporte lê pelo painel", async () => {
    const first = new Date("2026-10-09T12:00:00Z");
    const second = new Date("2026-10-09T12:05:00Z");
    await recordCronHeartbeat(job, { clinics: 3, errors: 0 }, first, env);
    await recordCronHeartbeat(job, { clinics: 3, errors: 1 }, second, env);

    const beat = (await loadCronHeartbeats(env)).find((b) => b.job === job);
    expect(beat?.lastFinishedAt.toISOString()).toBe(second.toISOString());

    expect((await support.client.from("cron_heartbeats").select("errors").eq("job", job)).data).toEqual([{ errors: 1 }]);
    expect((await admin.client.from("cron_heartbeats").select("errors").eq("job", job)).data).toEqual([]);
    const { error } = await admin.client.from("cron_heartbeats").upsert({ job, last_finished_at: new Date().toISOString() });
    expect(error).not.toBeNull();
  });
});
