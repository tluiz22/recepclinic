import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  adminClient,
  anonClient,
  clinicServiceClient,
  createClinic,
  createUser,
  deleteClinics,
  deleteUsers,
  makePlatformStaff,
  type TestUser,
} from "./helpers";

// Duas clínicas: A (admin, profissional, recepção) e B (admin). Mais um login
// sem clínica e um do Suporte RecepClinic.
let clinicA: string;
let clinicB: string;
let adminA: TestUser;
let professionalA: TestUser;
let receptionA: TestUser;
let adminB: TestUser;
let outsider: TestUser;
let support: TestUser;
const extraClinics: string[] = [];

beforeAll(async () => {
  clinicA = await createClinic("Clínica A (teste)");
  clinicB = await createClinic("Clínica B (teste)");
  [adminA, professionalA, receptionA, adminB, outsider, support] = await Promise.all([
    createUser("admin-a"),
    createUser("prof-a"),
    createUser("recep-a"),
    createUser("admin-b"),
    createUser("sem-clinica"),
    createUser("suporte"),
  ]);
  await addMember(clinicA, adminA.id, ["admin", "professional"]);
  await addMember(clinicA, professionalA.id, ["professional"]);
  await addMember(clinicA, receptionA.id, ["reception"]);
  await addMember(clinicB, adminB.id, ["admin"]);
  await makePlatformStaff(support.id);
});

afterAll(async () => {
  // Clínicas antes dos logins: apagar o login do último Administrador com a
  // clínica ainda existindo é barrado de propósito.
  await deleteClinics([clinicA, clinicB, ...extraClinics]);
  await deleteUsers([adminA, professionalA, receptionA, adminB, outsider, support]);
});

const ids = (rows: { id: string }[] | null) => (rows ?? []).map((row) => row.id).sort();

describe("clínicas", () => {
  it("cada membro vê só a própria clínica", async () => {
    const { data: fromA } = await receptionA.client.from("clinics").select("id");
    expect(ids(fromA)).toEqual([clinicA]);
    const { data: fromB } = await adminB.client.from("clinics").select("id");
    expect(ids(fromB)).toEqual([clinicB]);
  });

  it("login sem clínica e acesso anônimo não veem nenhuma", async () => {
    const { data: fromOutsider } = await outsider.client.from("clinics").select("id");
    expect(fromOutsider).toEqual([]);
    const { data: fromAnon } = await anonClient().from("clinics").select("id");
    expect(fromAnon).toEqual([]);
  });

  it("o Administrador edita a própria clínica", async () => {
    const { data, error } = await adminA.client
      .from("clinics")
      .update({ name: "Clínica A (teste, editada)" })
      .eq("id", clinicA)
      .select("name");
    expect(error).toBeNull();
    expect(data).toEqual([{ name: "Clínica A (teste, editada)" }]);
  });

  it("Recepção e Profissional não editam a clínica", async () => {
    for (const user of [receptionA, professionalA]) {
      const { data } = await user.client.from("clinics").update({ name: "invasão" }).eq("id", clinicA).select("id");
      expect(data).toEqual([]);
    }
  });

  it("o Administrador de B não edita a clínica A", async () => {
    const { data } = await adminB.client.from("clinics").update({ name: "invasão" }).eq("id", clinicA).select("id");
    expect(data).toEqual([]);
    const { data: check } = await adminClient().from("clinics").select("name").eq("id", clinicA).single();
    expect(check?.name).not.toBe("invasão");
  });

  it("só o Suporte cria e apaga clínicas", async () => {
    const { error: byAdmin } = await adminA.client.from("clinics").insert({ name: "Clínica nova" });
    expect(byAdmin?.code).toBe("42501");

    const { data, error } = await support.client.from("clinics").insert({ name: "Clínica C (teste)" }).select("id").single();
    expect(error).toBeNull();
    extraClinics.push(data!.id);

    const { data: deletedByAdmin } = await adminA.client.from("clinics").delete().eq("id", clinicA).select("id");
    expect(deletedByAdmin).toEqual([]);
  });
});

describe("equipe (clinic_members)", () => {
  it("membros veem os colegas da própria clínica e nenhum de outra", async () => {
    const { data } = await receptionA.client.from("clinic_members").select("user_id, clinic_id");
    expect(new Set(data!.map((row) => row.clinic_id))).toEqual(new Set([clinicA]));
    expect(data!.map((row) => row.user_id).sort()).toEqual([adminA.id, professionalA.id, receptionA.id].sort());
  });

  it("Recepção e Profissional não mexem na equipe", async () => {
    for (const user of [receptionA, professionalA]) {
      const { error: insertError } = await user.client
        .from("clinic_members")
        .insert({ clinic_id: clinicA, user_id: outsider.id, roles: ["reception"] });
      expect(insertError?.code).toBe("42501");

      const { data: updated } = await user.client
        .from("clinic_members")
        .update({ roles: ["admin"] })
        .eq("clinic_id", clinicA)
        .eq("user_id", user.id)
        .select("user_id");
      expect(updated).toEqual([]);
    }
  });

  it("o Administrador adiciona, troca o papel e remove alguém da equipe", async () => {
    const { error: insertError } = await adminA.client
      .from("clinic_members")
      .insert({ clinic_id: clinicA, user_id: outsider.id, roles: ["reception"] });
    expect(insertError).toBeNull();

    const { data: updated } = await adminA.client
      .from("clinic_members")
      .update({ roles: ["reception", "professional"] })
      .eq("clinic_id", clinicA)
      .eq("user_id", outsider.id)
      .select("roles");
    expect(updated).toEqual([{ roles: ["reception", "professional"] }]);

    const { data: deleted } = await adminA.client
      .from("clinic_members")
      .delete()
      .eq("clinic_id", clinicA)
      .eq("user_id", outsider.id)
      .select("user_id");
    expect(deleted).toEqual([{ user_id: outsider.id }]);
  });

  it("o Administrador de A não coloca ninguém na clínica B", async () => {
    const { error } = await adminA.client
      .from("clinic_members")
      .insert({ clinic_id: clinicB, user_id: adminA.id, roles: ["admin"] });
    expect(error?.code).toBe("42501");
  });

  it("membro precisa de pelo menos um papel", async () => {
    const { error } = await adminA.client
      .from("clinic_members")
      .insert({ clinic_id: clinicA, user_id: outsider.id, roles: [] });
    expect(error?.code).toBe("23514");
  });

  it("a clínica nunca fica sem Administrador", async () => {
    const { error: demote } = await adminB.client
      .from("clinic_members")
      .update({ roles: ["professional"] })
      .eq("clinic_id", clinicB)
      .eq("user_id", adminB.id);
    expect(demote?.message).toContain("pelo menos um Administrador");

    const { error: remove } = await adminB.client
      .from("clinic_members")
      .delete()
      .eq("clinic_id", clinicB)
      .eq("user_id", adminB.id);
    expect(remove?.message).toContain("pelo menos um Administrador");
  });
});

describe("Suporte RecepClinic", () => {
  it("vê todas as clínicas", async () => {
    const { data } = await support.client.from("clinics").select("id").in("id", [clinicA, clinicB]);
    expect(ids(data)).toEqual([clinicA, clinicB].sort());
  });

  it("cada alteração do Suporte fica registrada com a clínica", async () => {
    await support.client.from("clinics").update({ name: "Clínica B (teste, suporte)" }).eq("id", clinicB);

    const { data } = await adminClient()
      .from("platform_audit_log")
      .select("actor_user_id, clinic_id, table_name, operation, old_row, new_row")
      .eq("clinic_id", clinicB)
      .eq("operation", "UPDATE");
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ actor_user_id: support.id, clinic_id: clinicB, table_name: "clinics" });
    expect(data![0].new_row.name).toBe("Clínica B (teste, suporte)");
  });

  it("alterações de membros comuns não entram no registro do Suporte", async () => {
    const { data } = await adminClient()
      .from("platform_audit_log")
      .select("id")
      .eq("clinic_id", clinicA)
      .eq("table_name", "clinics");
    expect(data).toEqual([]);
  });

  it("o Administrador vê o registro do Suporte só da própria clínica", async () => {
    const { data: fromAdminB } = await adminB.client.from("platform_audit_log").select("clinic_id");
    expect(new Set(fromAdminB!.map((row) => row.clinic_id))).toEqual(new Set([clinicB]));

    const { data: fromAdminA } = await adminA.client.from("platform_audit_log").select("clinic_id");
    expect(fromAdminA!.every((row) => row.clinic_id === clinicA)).toBe(true);

    const { data: fromReception } = await receptionA.client.from("platform_audit_log").select("id");
    expect(fromReception).toEqual([]);
  });

  it("ninguém grava no registro pela API", async () => {
    const { error } = await support.client
      .from("platform_audit_log")
      .insert({ actor_user_id: support.id, clinic_id: clinicA, table_name: "x", operation: "INSERT" });
    expect(error?.code).toBe("42501");
  });

  it("a lista do Suporte só o Suporte vê; cada um vê se é do Suporte", async () => {
    const { data: fromAdmin } = await adminA.client.from("platform_staff").select("user_id");
    expect(fromAdmin).toEqual([]);
    const { data: fromSupport } = await support.client.from("platform_staff").select("user_id").eq("user_id", support.id);
    expect(fromSupport).toEqual([{ user_id: support.id }]);
  });

  it("ninguém se coloca no Suporte pela API", async () => {
    const { error } = await adminA.client.from("platform_staff").insert({ user_id: adminA.id });
    expect(error?.code).toBe("42501");
  });
});

describe("credencial limitada à clínica (bot e agendador)", () => {
  it("vê só a clínica do token", async () => {
    const { data, error } = await clinicServiceClient(clinicA).from("clinics").select("id");
    expect(error).toBeNull();
    expect(ids(data)).toEqual([clinicA]);
  });

  it("não vê a equipe nem o registro do Suporte", async () => {
    const service = clinicServiceClient(clinicA);
    const { data: members } = await service.from("clinic_members").select("user_id");
    expect(members ?? []).toEqual([]);
    const { data: audit } = await service.from("platform_audit_log").select("id");
    expect(audit ?? []).toEqual([]);
  });

  it("não altera a clínica", async () => {
    const { data } = await clinicServiceClient(clinicA).from("clinics").update({ name: "invasão" }).eq("id", clinicA).select("id");
    expect(data ?? []).toEqual([]);
  });

  it("token de outra clínica não enxerga A", async () => {
    const { data } = await clinicServiceClient(clinicB).from("clinics").select("id").eq("id", clinicA);
    expect(data).toEqual([]);
  });
});
