import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { loadClinicContext, logPlatformAccess } from "../../src/lib/data/clinicContext";
import { addMember, adminClient, anonClient, createUser, deleteUsers, signInSeedUser, type TestUser } from "./helpers";

// F3.2 — contexto da clínica lido com o login de cada pessoa dos dados de teste.
const CLINIC_A = "0a000000-0000-4000-8000-000000000001"; // Clínica Exemplo Saúde
const CLINIC_B = "0b000000-0000-4000-8000-000000000001"; // Odonto Exemplo
const MISSING = "0f000000-0000-4000-8000-0000000000ff";

const agendaIds = new Map<string, string>();
const created: TestUser[] = [];

async function seedUser(email: string): Promise<{ db: DbClient; id: string }> {
  const client = await signInSeedUser(email);
  const { data } = await client.auth.getUser();
  return { db: client as unknown as DbClient, id: data.user!.id };
}

async function contextOf(email: string, preferred: string | null = null) {
  const { db, id } = await seedUser(email);
  return loadClinicContext(db, id, preferred);
}

function okContext(result: Awaited<ReturnType<typeof loadClinicContext>>) {
  if (result.status !== "ok") throw new Error(`esperava contexto, veio ${result.status}`);
  return result;
}

const agendas = (...names: string[]) => names.map((name) => agendaIds.get(name)).sort();

beforeAll(async () => {
  const { data, error } = await adminClient().from("agendas").select("id, name");
  if (error) throw error;
  for (const row of data) agendaIds.set(row.name, row.id);
});

afterAll(async () => {
  await deleteUsers(created);
});

describe("contexto de cada papel", () => {
  it("Administrador: a própria clínica, fuso, perfil e todas as agendas", async () => {
    const { context, remembered } = okContext(await contextOf("admin@exemplo-saude.local"));
    expect(remembered).toBe(false);
    expect(context).toMatchObject({
      clinicId: CLINIC_A,
      clinicName: "Clínica Exemplo Saúde",
      clinicStatus: "active",
      clinicProfile: "mixed",
      timezone: "America/Fortaleza",
      roles: ["admin"],
      isPlatformStaff: false,
    });
    expect([...context.agendaIds].sort()).toEqual(agendas("Dra. Helena Costa", "Marina Alves", "Rafael Lima", "Exames"));
  });

  it("Profissional: só a própria agenda", async () => {
    const { context } = okContext(await contextOf("pediatra@exemplo-saude.local"));
    expect(context.roles).toEqual(["professional"]);
    expect(context.agendaIds).toEqual(agendas("Dra. Helena Costa"));
  });

  it("Recepção restrita: só as agendas liberadas", async () => {
    const { context } = okContext(await contextOf("recepcao2@exemplo-saude.local"));
    expect(context.roles).toEqual(["reception"]);
    expect([...context.agendaIds].sort()).toEqual(agendas("Marina Alves", "Rafael Lima"));
  });

  it("Administrador + Profissional da outra clínica: a clínica dele, perfil adulto", async () => {
    const { context } = okContext(await contextOf("admin@odonto-exemplo.local"));
    expect(context.clinicId).toBe(CLINIC_B);
    expect(context.clinicProfile).toBe("adult");
    expect([...context.roles].sort()).toEqual(["admin", "professional"]);
    expect(context.agendaIds).toEqual(agendas("Dra. Beatriz Nunes"));
  });

  it("cookie de outra clínica não abre a outra clínica", async () => {
    const { context, remembered } = okContext(await contextOf("admin@exemplo-saude.local", CLINIC_B));
    expect(context.clinicId).toBe(CLINIC_A);
    expect(remembered).toBe(false);
  });
});

describe("login sem clínica", () => {
  it("sem papel em clínica nenhuma: sem acesso", async () => {
    const user = await createUser("sem-clinica");
    created.push(user);
    expect(await loadClinicContext(user.client as unknown as DbClient, user.id, CLINIC_A)).toEqual({
      status: "no_access",
    });
  });
});

describe("membro de duas clínicas", () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createUser("duas-clinicas");
    created.push(user);
    await addMember(CLINIC_A, user.id, ["reception"]);
    await addMember(CLINIC_B, user.id, ["admin"]);
  });

  it("sem cookie, abre a clínica em que entrou primeiro", async () => {
    const { context } = okContext(await loadClinicContext(user.client as unknown as DbClient, user.id, null));
    expect(context.clinicId).toBe(CLINIC_A);
    expect(context.roles).toEqual(["reception"]);
  });

  it("com cookie, abre a última usada, com os papéis dela", async () => {
    const result = okContext(await loadClinicContext(user.client as unknown as DbClient, user.id, CLINIC_B));
    expect(result.remembered).toBe(true);
    expect(result.context.clinicId).toBe(CLINIC_B);
    expect(result.context.roles).toEqual(["admin"]);
    expect(result.context.agendaIds).toEqual(agendas("Dra. Beatriz Nunes"));
  });
});

describe("Suporte RecepClinic", () => {
  let support: SupabaseClient;
  let supportId: string;

  beforeAll(async () => {
    const seed = await seedUser("suporte@recepclinic.local");
    support = seed.db as unknown as SupabaseClient;
    supportId = seed.id;
  });

  it("sem cookie, precisa escolher a clínica", async () => {
    expect(await loadClinicContext(support as unknown as DbClient, supportId, null)).toEqual({
      status: "choose_clinic",
    });
  });

  it("com cookie, abre qualquer clínica, sem papel próprio e com todas as agendas", async () => {
    const { context, remembered } = okContext(await loadClinicContext(support as unknown as DbClient, supportId, CLINIC_A));
    expect(remembered).toBe(true);
    expect(context).toMatchObject({ clinicId: CLINIC_A, roles: [], isPlatformStaff: true });
    expect(context.agendaIds).toHaveLength(4);
  });

  it("cookie de clínica que não existe: volta a pedir a escolha", async () => {
    expect(await loadClinicContext(support as unknown as DbClient, supportId, MISSING)).toEqual({
      status: "choose_clinic",
    });
  });
});

describe("registro das leituras do Suporte (D6)", () => {
  const countAccess = async (client: SupabaseClient, path: string) => {
    const { data } = await client.from("platform_access_log").select("id").eq("path", path);
    return data?.length ?? 0;
  };

  it("grava com o login do Suporte; o Administrador da clínica vê, o de outra não", async () => {
    const { db, id } = await seedUser("suporte@recepclinic.local");
    const path = `/admin/agenda?teste=${Date.now()}`;
    await logPlatformAccess(db, CLINIC_A, "GET", path);

    const { data: rows } = await adminClient().from("platform_access_log").select("*").eq("path", path);
    expect(rows).toEqual([expect.objectContaining({ actor_user_id: id, clinic_id: CLINIC_A, method: "GET" })]);

    expect(await countAccess(await signInSeedUser("admin@exemplo-saude.local"), path)).toBe(1);
    expect(await countAccess(await signInSeedUser("admin@odonto-exemplo.local"), path)).toBe(0);
    expect(await countAccess(await signInSeedUser("recepcao@exemplo-saude.local"), path)).toBe(0);
  });

  it("quem não é do Suporte não grava, nem pela função nem direto na tabela", async () => {
    const admin = await signInSeedUser("admin@exemplo-saude.local");
    const { error } = await admin.rpc("log_platform_access", { p_clinic_id: CLINIC_A, p_method: "GET", p_path: "/x" });
    expect(error?.code).toBe("42501");

    const { error: anonError } = await anonClient().rpc("log_platform_access", {
      p_clinic_id: CLINIC_A,
      p_method: "GET",
      p_path: "/x",
    });
    expect(anonError).not.toBeNull();

    const { error: insertError } = await admin
      .from("platform_access_log")
      .insert({ actor_user_id: (await admin.auth.getUser()).data.user!.id, clinic_id: CLINIC_A, method: "GET", path: "/y" });
    expect(insertError).not.toBeNull();
  });

  it("o Suporte não apaga nem altera o registro", async () => {
    const support = await signInSeedUser("suporte@recepclinic.local");
    const before = await countAccess(adminClient(), "/admin/agenda");
    await support.from("platform_access_log").delete().eq("path", "/admin/agenda");
    await support.from("platform_access_log").update({ path: "/apagado" }).eq("path", "/admin/agenda");
    expect(await countAccess(adminClient(), "/admin/agenda")).toBe(before);
  });

  it("clínica inexistente é recusada", async () => {
    const { db } = await seedUser("suporte@recepclinic.local");
    await expect(logPlatformAccess(db, MISSING, "GET", "/admin")).rejects.toThrow();
  });
});
