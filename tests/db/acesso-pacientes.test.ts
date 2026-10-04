import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "../../src/lib/clinicTime";
import type { DbClient } from "../../src/lib/data/clients";
import { createClinicServiceClient } from "../../src/lib/data/clinicService";
import { createInsurancePlan } from "../../src/lib/data/config/insurance";
import { DataError } from "../../src/lib/data/errors";
import {
  findContactByPhone,
  getPatient,
  listContactPatients,
  registerPatient,
  searchContacts,
  searchPatients,
  setContactActive,
  setPatientActive,
  setPatientInsurance,
  updatePatient,
  type RegisterPatientResult,
} from "../../src/lib/data/patients";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, signInSeedUser, type TestUser } from "./helpers";

// F3.5 — acesso a pacientes, numa clínica criada para o teste.
const TODAY = todayIn("America/Fortaleza");

let clinicId: string;
let admin: TestUser;
let reception: TestUser;
const users: TestUser[] = [];
const db = (user: TestUser) => user.client as unknown as DbClient;

async function failure(run: () => Promise<unknown>): Promise<{ code: string; fields: Record<string, string> }> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DataError) return { code: error.code, fields: error.fields };
    throw error;
  }
  return { code: "ok", fields: {} };
}

function created(result: RegisterPatientResult) {
  if (result.status !== "created") throw new Error(`esperava "created", veio ${result.status}`);
  return result;
}

// Idade com folga de alguns dias para não cair no aniversário.
const yearsAgo = (years: number) => addDays(TODAY, -Math.round(years * 365.25) - 10);

beforeAll(async () => {
  clinicId = await createClinic("Clínica do teste de pacientes");
  admin = await createUser("pac-admin");
  reception = await createUser("pac-recepcao");
  users.push(admin, reception);
  await addMember(clinicId, admin.id, ["admin"]);
  await addMember(clinicId, reception.id, ["reception"]);
  await adminClient().from("clinic_settings").update({ consultation_age_limit_years: 14 }).eq("clinic_id", clinicId);
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers(users);
});

describe("cadastro com responsável (outra pessoa)", () => {
  it("cria contato e paciente, com o telefone em E.164", async () => {
    const result = created(
      await registerPatient(
        db(reception),
        clinicId,
        { fullName: " Ana Souza ", birthdate: yearsAgo(5), contact: { mode: "new", fullName: "Maria Souza", phone: "(85) 99999-0001" } },
        TODAY,
      ),
    );
    expect(result.contact).toMatchObject({ fullName: "Maria Souza", phone: "+5585999990001" });
    expect(result.patient).toMatchObject({ fullName: "Ana Souza", isContactSelf: false, insurance: null });
    expect(result.overConsultationAgeLimit).toBe(false);
  });

  it("telefone já cadastrado reaproveita o contato; mesmo nascimento avisa duplicado", async () => {
    const contact = (await findContactByPhone(db(reception), clinicId, "85999990001"))!;
    const sibling = created(
      await registerPatient(
        db(reception),
        clinicId,
        { fullName: "Bruno Souza", birthdate: yearsAgo(8), contact: { mode: "new", fullName: "Outro nome", phone: "+5585999990001" } },
        TODAY,
      ),
    );
    expect(sibling.contact.id).toBe(contact.id);

    const twin = { fullName: "Bia Souza", birthdate: yearsAgo(5), contact: { mode: "existing" as const, contactId: contact.id } };
    const warning = await registerPatient(db(reception), clinicId, twin, TODAY);
    expect(warning).toEqual({ status: "possible_duplicate", contact: expect.objectContaining({ id: contact.id }), existingNames: ["Ana Souza"] });
    created(await registerPatient(db(reception), clinicId, { ...twin, confirmDuplicate: true }, TODAY));
    expect((await listContactPatients(db(reception), clinicId, contact.id)).map((p) => p.fullName)).toEqual([
      "Ana Souza",
      "Bia Souza",
      "Bruno Souza",
    ]);
  });

  it("contato desativado volta ativo ao cadastrar de novo pelo telefone", async () => {
    const first = created(
      await registerPatient(
        db(reception),
        clinicId,
        { fullName: "Caio Lima", birthdate: yearsAgo(3), contact: { mode: "new", fullName: "Paula Lima", phone: "85999990002" } },
        TODAY,
      ),
    );
    await setContactActive(db(reception), clinicId, first.contact.id, false);
    const again = created(
      await registerPatient(
        db(reception),
        clinicId,
        { fullName: "Clara Lima", birthdate: yearsAgo(1), contact: { mode: "new", fullName: "Paula Lima", phone: "85999990002" } },
        TODAY,
      ),
    );
    expect(again.contact).toMatchObject({ id: first.contact.id, isActive: true });
    expect((await findContactByPhone(db(reception), clinicId, "85999990002"))?.isActive).toBe(true);
  });
});

describe("paciente que é o próprio contato", () => {
  it("menor de 18 não pode; adulto com telefone novo pode, e avisa a idade limite da consulta", async () => {
    const minor = await failure(() =>
      registerPatient(db(reception), clinicId, { fullName: "Teen", birthdate: yearsAgo(17), contact: { mode: "self", phone: "85999990003" } }, TODAY),
    );
    expect(minor).toEqual({ code: "invalid", fields: { isContactSelf: "Paciente menor de 18 anos precisa de um responsável (outra pessoa)." } });

    const adult = created(
      await registerPatient(db(reception), clinicId, { fullName: "Pedro Alves", birthdate: yearsAgo(30), contact: { mode: "self", phone: "85999990003" } }, TODAY),
    );
    expect(adult.patient.isContactSelf).toBe(true);
    expect(adult.contact.fullName).toBe("Pedro Alves");
    expect(adult.overConsultationAgeLimit).toBe(true);
  });

  it("telefone de contato existente pede confirmação; confirmado, liga ao mesmo contato", async () => {
    const maria = (await findContactByPhone(db(reception), clinicId, "85999990001"))!;
    const input = { fullName: "Maria Souza", birthdate: yearsAgo(35), contact: { mode: "self" as const, phone: "85999990001" } };
    expect(await registerPatient(db(reception), clinicId, input, TODAY)).toEqual({
      status: "confirm_same_person",
      contact: expect.objectContaining({ id: maria.id }),
    });
    const self = created(
      await registerPatient(db(reception), clinicId, { ...input, contact: { ...input.contact, confirmedContactId: maria.id } }, TODAY),
    );
    expect(self.contact.id).toBe(maria.id);
  });

  it("só um próprio paciente por contato", async () => {
    const maria = (await findContactByPhone(db(reception), clinicId, "85999990001"))!;
    const second = await failure(() =>
      registerPatient(
        db(reception),
        clinicId,
        { fullName: "Maria S.", birthdate: yearsAgo(40), contact: { mode: "self", phone: "85999990001", confirmedContactId: maria.id } },
        TODAY,
      ),
    );
    expect(second.code).toBe("duplicate");
  });
});

describe("nascimento (achados 1 e 2 da F1)", () => {
  const input = (birthdate: string) => ({
    fullName: "Data Teste",
    birthdate,
    contact: { mode: "new" as const, fullName: "Resp. Data", phone: "85999990009" },
  });

  it("amanhã (no fuso da clínica) e data inexistente são recusados antes do banco", async () => {
    expect((await failure(() => registerPatient(db(reception), clinicId, input(addDays(TODAY, 1)), TODAY))).fields).toHaveProperty("birthdate");
    expect((await failure(() => registerPatient(db(reception), clinicId, input("2015-02-31"), TODAY))).fields).toHaveProperty("birthdate");
    expect(await findContactByPhone(db(reception), clinicId, "85999990009")).toBeNull();
  });

  it("e o banco também recusa, se alguém passar por fora", async () => {
    const contact = (await findContactByPhone(db(reception), clinicId, "85999990001"))!;
    const { error } = await db(reception)
      .from("patients")
      .insert({ clinic_id: clinicId, contact_id: contact.id, full_name: "Futuro", birthdate: addDays(TODAY, 1) });
    expect(error?.code).toBe("22008");
  });
});

describe("edição, plano e desativação", () => {
  it("próprio contato não pode virar menor; o nome do contato acompanha o do paciente", async () => {
    const pedro = (await searchPatients(db(reception), clinicId, "Pedro"))[0];
    expect((await failure(() => updatePatient(db(reception), clinicId, pedro.id, { fullName: "Pedro", birthdate: yearsAgo(10) }, TODAY))).code).toBe(
      "invalid",
    );
    await updatePatient(db(reception), clinicId, pedro.id, { fullName: "Pedro Alves Filho", birthdate: yearsAgo(31), notes: "  " }, TODAY);
    expect((await findContactByPhone(db(reception), clinicId, "85999990003"))?.fullName).toBe("Pedro Alves Filho");
    expect((await getPatient(db(reception), clinicId, pedro.id)).notes).toBeNull();
  });

  it("plano com carteirinha; particular limpa tudo (D10)", async () => {
    const plan = await createInsurancePlan(db(admin), clinicId, { name: "Unimed", alternativeNames: [], ansCode: null });
    const ana = (await searchPatients(db(reception), clinicId, "Ana Souza"))[0];
    const withPlan = await setPatientInsurance(db(reception), clinicId, ana.id, { planId: plan.id, cardNumber: "0001", cardValidUntil: "2027-12-31" });
    expect(withPlan.insurance).toEqual({ planId: plan.id, cardNumber: "0001", cardValidUntil: "2027-12-31" });
    expect((await setPatientInsurance(db(reception), clinicId, ana.id, null)).insurance).toBeNull();
    expect((await failure(() => setPatientInsurance(db(reception), clinicId, ana.id, { planId: plan.id, cardValidUntil: "2027-02-30" }))).code).toBe(
      "invalid",
    );
  });

  it("busca por nome e por telefone do contato; desativado não aparece", async () => {
    expect((await searchPatients(db(reception), clinicId, "souza")).map((p) => p.fullName)).toEqual([
      "Ana Souza",
      "Bia Souza",
      "Bruno Souza",
      "Maria Souza",
    ]);
    const byPhone = await searchPatients(db(reception), clinicId, "99999-0002");
    expect(byPhone.map((p) => [p.fullName, p.contact.fullName])).toEqual([
      ["Caio Lima", "Paula Lima"],
      ["Clara Lima", "Paula Lima"],
    ]);
    await setPatientActive(db(reception), clinicId, byPhone[0].id, false);
    expect((await searchPatients(db(reception), clinicId, "99999-0002")).map((p) => p.fullName)).toEqual(["Clara Lima"]);
    expect((await searchContacts(db(reception), clinicId, "Paula")).map((c) => c.phone)).toEqual(["+5585999990002"]);
    expect(await searchPatients(db(reception), clinicId, "a")).toEqual([]);
  });

  it("% e _ na busca são texto, não curinga", async () => {
    expect(await searchPatients(db(reception), clinicId, "%%")).toEqual([]);
    expect(await searchPatients(db(reception), clinicId, "__")).toEqual([]);
  });
});

describe("isolamento", () => {
  it("o bot da clínica cadastra na própria clínica e não na outra", async () => {
    const bot = createClinicServiceClient(clinicId, {
      supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!,
      supabaseAnonKey: process.env.SUPABASE_LOCAL_ANON_KEY!,
      supabaseJwtSecret: process.env.SUPABASE_LOCAL_JWT_SECRET!,
    });
    const viaBot = created(
      await registerPatient(bot, clinicId, { fullName: "Via WhatsApp", birthdate: yearsAgo(2), contact: { mode: "new", fullName: "Mãe", phone: "85999990010" } }, TODAY),
    );
    expect(viaBot.patient.fullName).toBe("Via WhatsApp");

    const other = "0b000000-0000-4000-8000-000000000001";
    expect(
      (await failure(() =>
        registerPatient(bot, other, { fullName: "Intruso", birthdate: yearsAgo(2), contact: { mode: "new", fullName: "X", phone: "85999990011" } }, TODAY),
      )).code,
    ).toBe("forbidden");
  });

  it("Administrador de outra clínica não vê os pacientes desta", async () => {
    const outsider = (await signInSeedUser("admin@odonto-exemplo.local")) as unknown as DbClient;
    expect(await searchPatients(outsider, clinicId, "souza")).toEqual([]);
    const ana = (await searchPatients(db(reception), clinicId, "Ana Souza"))[0];
    expect((await failure(() => getPatient(outsider, clinicId, ana.id))).code).toBe("not_found");
  });
});
