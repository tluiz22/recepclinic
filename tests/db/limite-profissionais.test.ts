import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { createProfessional, setProfessionalActive, type ProfessionalInput } from "../../src/lib/data/config/professionals";
import {
  getProfessionalLimit,
  listClinicsAccess,
  listProfessionalLimitChanges,
  setClinicProfessionalLimit,
} from "../../src/lib/data/features";
import { addMember, adminClient, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { codeOf } from "./agendaFixture";

// Limite de profissionais ativos por clínica (D11, cliente, 05/out/2026).

let clinicId: string;
let admin: TestUser;
let support: TestUser;
const asDb = (user: TestUser) => user.client as unknown as DbClient;
const input = (name: string): ProfessionalInput => ({
  userId: null,
  displayName: name,
  profession: "Médica",
  specialty: null,
  council: null,
  councilNumber: null,
  councilState: null,
});

beforeAll(async () => {
  // Clínica nova, com o limite padrão (1).
  const { data, error } = await adminClient().from("clinics").insert({ name: "Clínica do limite" }).select("id").single();
  if (error) throw error;
  clinicId = data.id;
  [admin, support] = await Promise.all([createUser("lim-admin"), createUser("lim-suporte")]);
  await addMember(clinicId, admin.id, ["admin"]);
  await makePlatformStaff(support.id);
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers([admin, support]);
});

describe("limite de profissionais ativos", () => {
  it("clínica nova começa com 1; no limite não cadastra nem reativa; desativar libera a vaga", async () => {
    expect(await getProfessionalLimit(asDb(admin), clinicId)).toEqual({ max: 1, active: 0 });
    const first = await createProfessional(asDb(admin), clinicId, input("Dra. Um"));
    expect(await codeOf(() => createProfessional(asDb(admin), clinicId, input("Dr. Dois")))).toBe("limit_reached");

    await setProfessionalActive(asDb(admin), clinicId, first.id, false);
    const second = await createProfessional(asDb(admin), clinicId, input("Dr. Dois"));
    expect(await codeOf(() => setProfessionalActive(asDb(admin), clinicId, first.id, true))).toBe("limit_reached");
    expect(await getProfessionalLimit(asDb(admin), clinicId)).toEqual({ max: 1, active: 1 });
    // Salvar o profissional ativo não conta de novo.
    await setProfessionalActive(asDb(admin), clinicId, second.id, true);
  });

  it("só o Suporte muda o limite; o Administrador da clínica continua mudando o nome", async () => {
    const { error } = await asDb(admin).from("clinics").update({ max_professionals: 10 }).eq("id", clinicId);
    expect(error?.code).toBe("42501");
    const { error: nameError } = await asDb(admin).from("clinics").update({ name: "Clínica do limite (nome novo)" }).eq("id", clinicId);
    expect(nameError).toBeNull();
    expect(await codeOf(() => setClinicProfessionalLimit(asDb(admin), clinicId, 10))).toBe("forbidden");
    expect(await codeOf(() => setClinicProfessionalLimit(asDb(support), clinicId, 0))).toBe("invalid");
  });

  it("o Suporte aumenta e baixa; baixar não desativa ninguém; o histórico guarda quem e quando", async () => {
    await setClinicProfessionalLimit(asDb(support), clinicId, 3);
    await createProfessional(asDb(admin), clinicId, input("Dra. Três"));
    await createProfessional(asDb(admin), clinicId, input("Dr. Quatro"));
    expect((await listClinicsAccess(asDb(support))).find((c) => c.id === clinicId)).toMatchObject({ maxProfessionals: 3, activeProfessionals: 3 });

    await setClinicProfessionalLimit(asDb(support), clinicId, 1);
    expect(await getProfessionalLimit(asDb(admin), clinicId)).toEqual({ max: 1, active: 3 });
    expect(await codeOf(() => createProfessional(asDb(admin), clinicId, input("Dra. Cinco")))).toBe("limit_reached");

    const history = await listProfessionalLimitChanges(asDb(support), clinicId);
    expect(history.map((h) => [h.from, h.to, h.actorId])).toEqual([
      [3, 1, support.id],
      [1, 3, support.id],
    ]);
  });
});
