import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  adminClient,
  clinicServiceClient,
  createClinic,
  createUser,
  deleteClinics,
  deleteUsers,
  type TestUser,
} from "./helpers";

let clinicA: string;
let clinicB: string;
let adminA: TestUser;
let receptionA: TestUser;
let professionalA: TestUser;
let adminB: TestUser;
let contactA: string;
let patientA: string;
let planA: string;
let planB: string;

const PHONE = "+5584988887777";

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await adminClient().from(table).insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}

// "Amanhã" com folga: dois dias depois do dia UTC atual nunca é hoje em nenhum fuso do Brasil.
const daysFromToday = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

beforeAll(async () => {
  clinicA = await createClinic("Clínica A (pacientes)");
  clinicB = await createClinic("Clínica B (pacientes)");
  [adminA, receptionA, professionalA, adminB] = await Promise.all([
    createUser("admin-a"),
    createUser("recep-a"),
    createUser("prof-a"),
    createUser("admin-b"),
  ]);
  await addMember(clinicA, adminA.id, ["admin"]);
  await addMember(clinicA, receptionA.id, ["reception"]);
  await addMember(clinicA, professionalA.id, ["professional"]);
  await addMember(clinicB, adminB.id, ["admin"]);

  planA = await insert("insurance_plans", { clinic_id: clinicA, name: "Unimed" });
  planB = await insert("insurance_plans", { clinic_id: clinicB, name: "Unimed" });
  contactA = await insert("contacts", { clinic_id: clinicA, full_name: "Maria Silva", phone: PHONE });
  patientA = await insert("patients", {
    clinic_id: clinicA, contact_id: contactA, full_name: "João Silva", birthdate: "2019-05-10",
    insurance_plan_id: planA, insurance_card_number: "0001234", insurance_card_valid_until: "2027-12-31",
  });
});

afterAll(async () => {
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([adminA, receptionA, professionalA, adminB]);
});

describe("isolamento entre clínicas", () => {
  it("toda a equipe de A vê os contatos e pacientes de A", async () => {
    for (const user of [adminA, receptionA, professionalA]) {
      const { data: contacts } = await user.client.from("contacts").select("id");
      expect(contacts).toEqual([{ id: contactA }]);
      const { data: patients } = await user.client.from("patients").select("id");
      expect(patients).toEqual([{ id: patientA }]);
    }
  });

  it("outra clínica não vê nem altera", async () => {
    const { data: contacts } = await adminB.client.from("contacts").select("id");
    expect(contacts).toEqual([]);
    const { data: patients } = await adminB.client.from("patients").select("id");
    expect(patients).toEqual([]);
    const { data: updated } = await adminB.client.from("patients").update({ notes: "invasão" }).eq("id", patientA).select("id");
    expect(updated).toEqual([]);
    const { error } = await adminB.client.from("contacts").insert({ clinic_id: clinicA, full_name: "X", phone: "+5584911112222" });
    expect(error?.code).toBe("42501");
  });

  it("o mesmo telefone pode ser contato em outra clínica, mas não duas vezes na mesma", async () => {
    const { error: otherClinic } = await adminB.client.from("contacts").insert({ clinic_id: clinicB, full_name: "Maria", phone: PHONE });
    expect(otherClinic).toBeNull();
    const { error: sameClinic } = await receptionA.client.from("contacts").insert({ clinic_id: clinicA, full_name: "Maria 2", phone: PHONE });
    expect(sameClinic?.code).toBe("23505");
  });

  it("paciente não pode apontar para contato de outra clínica", async () => {
    const { error } = await adminB.client
      .from("patients")
      .insert({ clinic_id: clinicB, contact_id: contactA, full_name: "Cruzado", birthdate: "2020-01-01" });
    expect(error?.code).toBe("23503");
  });
});

describe("quem altera", () => {
  it("Recepção e Profissional cadastram e editam", async () => {
    const { data, error } = await professionalA.client
      .from("patients")
      .insert({ clinic_id: clinicA, contact_id: contactA, full_name: "Ana Silva", birthdate: "2021-03-01" })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { data: updated } = await receptionA.client.from("patients").update({ notes: "Alergia a dipirona" }).eq("id", data!.id).select("notes");
    expect(updated).toEqual([{ notes: "Alergia a dipirona" }]);
  });

  it("só o Administrador apaga de vez; os outros desativam", async () => {
    const { data } = await adminClient()
      .from("patients")
      .insert({ clinic_id: clinicA, contact_id: contactA, full_name: "Para apagar", birthdate: "2020-01-01" })
      .select("id")
      .single();
    const id = data!.id;

    const { data: byReception } = await receptionA.client.from("patients").delete().eq("id", id).select("id");
    expect(byReception).toEqual([]);
    const { data: deactivated } = await receptionA.client.from("patients").update({ is_active: false }).eq("id", id).select("is_active");
    expect(deactivated).toEqual([{ is_active: false }]);

    const { data: byAdmin } = await adminA.client.from("patients").delete().eq("id", id).select("id");
    expect(byAdmin).toEqual([{ id }]);
  });

  it("contato com pacientes não é apagado (os pacientes precisam sair antes)", async () => {
    const { error } = await adminA.client.from("contacts").delete().eq("id", contactA);
    expect(error?.code).toBe("23503");
  });
});

describe("regras do cadastro", () => {
  it("o contato é o próprio paciente no máximo uma vez", async () => {
    const { data: contact } = await adminClient()
      .from("contacts")
      .insert({ clinic_id: clinicA, full_name: "Carlos", phone: "+5584977776666" })
      .select("id")
      .single();
    const self = { clinic_id: clinicA, contact_id: contact!.id, full_name: "Carlos", birthdate: "1980-01-01", is_contact_self: true };
    const { error: first } = await receptionA.client.from("patients").insert(self);
    expect(first).toBeNull();
    const { error: second } = await receptionA.client.from("patients").insert(self);
    expect(second?.code).toBe("23505");
  });

  it("recusa data de nascimento futura e anterior a 1900", async () => {
    const base = { clinic_id: clinicA, contact_id: contactA, full_name: "Teste" };
    const { error: future } = await receptionA.client.from("patients").insert({ ...base, birthdate: daysFromToday(2) });
    expect(future?.message).toContain("Data de nascimento no futuro");
    const { error: old } = await receptionA.client.from("patients").insert({ ...base, birthdate: "1899-12-31" });
    expect(old?.code).toBe("23514");
    const { error: updateFuture } = await receptionA.client.from("patients").update({ birthdate: daysFromToday(2) }).eq("id", patientA);
    expect(updateFuture?.message).toContain("Data de nascimento no futuro");
  });

  it("recusa data que não existe no calendário", async () => {
    const { error } = await receptionA.client
      .from("patients")
      .insert({ clinic_id: clinicA, contact_id: contactA, full_name: "Teste", birthdate: "2015-02-31" });
    expect(error?.code).toBe("22008");
  });

  it("telefone do contato em E.164", async () => {
    const { error } = await receptionA.client.from("contacts").insert({ clinic_id: clinicA, full_name: "X", phone: "84 98888-7777" });
    expect(error?.code).toBe("23514");
  });
});

describe("convênio do paciente (D10)", () => {
  it("guarda plano, carteirinha e validade", async () => {
    const { data } = await receptionA.client
      .from("patients")
      .select("insurance_plan_id, insurance_card_number, insurance_card_valid_until")
      .eq("id", patientA)
      .single();
    expect(data).toEqual({ insurance_plan_id: planA, insurance_card_number: "0001234", insurance_card_valid_until: "2027-12-31" });
  });

  it("particular: sem plano e sem carteirinha", async () => {
    const { error } = await receptionA.client
      .from("patients")
      .insert({ clinic_id: clinicA, contact_id: contactA, full_name: "Particular", birthdate: "2018-01-01", insurance_card_number: "999" });
    expect(error?.code).toBe("23514");
  });

  it("não aceita plano de outra clínica", async () => {
    const { data } = await receptionA.client.from("patients").update({ insurance_plan_id: planB }).eq("id", patientA).select("id");
    expect(data).toBeNull();
    const { data: check } = await adminClient().from("patients").select("insurance_plan_id").eq("id", patientA).single();
    expect(check?.insurance_plan_id).toBe(planA);
  });
});

describe("credencial do bot (clinic_service)", () => {
  it("cadastra contato e paciente na própria clínica e atualiza", async () => {
    const service = clinicServiceClient(clinicA);
    const { data: contact, error } = await service
      .from("contacts")
      .insert({ clinic_id: clinicA, full_name: "Pelo WhatsApp", phone: "+5584966665555" })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { data: patient, error: patientError } = await service
      .from("patients")
      .insert({ clinic_id: clinicA, contact_id: contact!.id, full_name: "Bebê", birthdate: "2025-01-01" })
      .select("id")
      .single();
    expect(patientError).toBeNull();
    const { data: updated } = await service.from("patients").update({ full_name: "Bebê Souza" }).eq("id", patient!.id).select("full_name");
    expect(updated).toEqual([{ full_name: "Bebê Souza" }]);
  });

  it("não grava nem lê em outra clínica", async () => {
    const service = clinicServiceClient(clinicA);
    const { error } = await service.from("contacts").insert({ clinic_id: clinicB, full_name: "X", phone: "+5584955554444" });
    expect(error?.code).toBe("42501");
    const { data } = await clinicServiceClient(clinicB).from("patients").select("id").eq("id", patientA);
    expect(data).toEqual([]);
  });

  it("não apaga", async () => {
    const { error } = await clinicServiceClient(clinicA).from("patients").delete().eq("id", patientA);
    expect(error?.code).toBe("42501");
  });
});
