import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { createAgenda, getMemberAgendaAccess, type Agenda } from "../../src/lib/data/config/agendas";
import { addAvailabilityWindows, listAvailability } from "../../src/lib/data/config/availability";
import { updateClinicSettings } from "../../src/lib/data/config/clinic";
import { addClinicHoliday } from "../../src/lib/data/config/holidays";
import { createInsurancePlan, listPlanExclusions, listProfessionalExclusions, setPlanExclusions } from "../../src/lib/data/config/insurance";
import { createLocation, type Location } from "../../src/lib/data/config/locations";
import { createProfessional, listProfessionals, type Professional } from "../../src/lib/data/config/professionals";
import { createService, setServiceAgendas, setServiceLocations } from "../../src/lib/data/config/services";
import { inviteMember, listTeam, removeMember, updateMember } from "../../src/lib/data/config/team";
import type { OnboardingDeps } from "../../src/lib/data/onboarding";
import { createPasswordLink, findUserIdByEmail } from "../../src/lib/data/platform";
import type { Email } from "../../src/lib/email";
import { codeOf } from "./agendaFixture";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";

// F4.4b — Configurações II: horários em vários dias, feriado repetido,
// convênio visto pelo plano, hora do lembrete e equipe (convite, papéis,
// profissional obrigatório, acesso às agendas e remoção).

const env = { supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!, supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY! };
const sent: Email[] = [];
const deps: OnboardingDeps = {
  findUserIdByEmail: (email) => findUserIdByEmail(email, env),
  createPasswordLink: (email, kind) => createPasswordLink(email, kind, env),
  sendEmail: async (email) => {
    sent.push(email);
  },
  baseUrl: "http://localhost:4321",
};

let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let existing: TestUser;
const users: TestUser[] = [];
const createdUsers: string[] = [];
const db = (user: TestUser) => user.client as unknown as DbClient;
const newEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@teste.recepclinic.local`;
const clinic = () => ({ id: clinicId, name: "Clínica Configurações II" });

let doctorA: Professional;
let doctorB: Professional;
let agendaA: Agenda;
let agendaB: Agenda;
let office: Location;

beforeAll(async () => {
  clinicId = await createClinic("Clínica Configurações II");
  [admin, reception, existing] = await Promise.all([createUser("c2-admin"), createUser("c2-recepcao"), createUser("c2-existente")]);
  users.push(admin, reception, existing);
  await addMember(clinicId, admin.id, ["admin"]);
  await addMember(clinicId, reception.id, ["reception"]);
  doctorA = await createProfessional(db(admin), clinicId, { userId: null, displayName: "Dra. A", profession: "Médica", specialty: null, council: null, councilNumber: null, councilState: null });
  doctorB = await createProfessional(db(admin), clinicId, { userId: null, displayName: "Dr. B", profession: "Médico", specialty: null, council: null, councilNumber: null, councilState: null });
  agendaA = await createAgenda(db(admin), clinicId, { name: "Agenda A", kind: "professional", professionalId: doctorA.id, bufferMinutes: 0 });
  agendaB = await createAgenda(db(admin), clinicId, { name: "Agenda B", kind: "professional", professionalId: doctorB.id, bufferMinutes: 0 });
  office = await createLocation(db(admin), clinicId, { name: "Consultório", type: "clinic", address: null });
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers(users);
  for (const id of createdUsers) await adminClient().auth.admin.deleteUser(id);
});

describe("horários em vários dias", () => {
  const window = () => ({ agendaId: agendaA.id, locationId: office.id, serviceId: null, startTime: "08:00", endTime: "12:00", capacity: null });

  it("grava um horário por dia marcado", async () => {
    const created = await addAvailabilityWindows(db(admin), clinicId, window(), [1, 3, 5]);
    expect(created.map((w) => w.weekday)).toEqual([1, 3, 5]);
  });

  it("conflito num dia: nenhum dia é gravado", async () => {
    const before = await listAvailability(db(admin), clinicId, agendaA.id);
    expect(await codeOf(() => addAvailabilityWindows(db(admin), clinicId, { ...window(), startTime: "11:00", endTime: "13:00" }, [2, 3]))).toBe("conflict");
    expect(await listAvailability(db(admin), clinicId, agendaA.id)).toEqual(before);
    expect(await codeOf(() => addAvailabilityWindows(db(admin), clinicId, window(), []))).toBe("invalid");
  });
});

it("feriado repetido na mesma data: aviso próprio", async () => {
  await addClinicHoliday(db(admin), clinicId, { date: "2031-08-15", description: "Padroeira" });
  const error = await addClinicHoliday(db(admin), clinicId, { date: "2031-08-15", description: "Outro" }).catch((e) => e);
  expect(error).toMatchObject({ code: "duplicate", fields: { date: "Já existe um feriado nessa data." } });
});

it("convênio: quem não atende, visto pelo plano, é a mesma exceção do profissional", async () => {
  const plan = await createInsurancePlan(db(admin), clinicId, { name: "Unimed", alternativeNames: [], ansCode: null });
  expect(await setPlanExclusions(db(admin), clinicId, plan.id, [doctorB.id])).toEqual([doctorB.id]);
  expect(await listProfessionalExclusions(db(admin), clinicId, doctorB.id)).toEqual([plan.id]);
  expect(await setPlanExclusions(db(admin), clinicId, plan.id, [])).toEqual([]);
  expect(await listPlanExclusions(db(admin), clinicId, plan.id)).toEqual([]);
});

it("hora do lembrete: só das 6h às 20h (cliente, 09/out), também no banco", async () => {
  expect((await updateClinicSettings(db(admin), clinicId, { reminderHour: 20 })).reminderHour).toBe(20);
  expect((await updateClinicSettings(db(admin), clinicId, { reminderHour: 6 })).reminderHour).toBe(6);
  expect(await codeOf(() => updateClinicSettings(db(admin), clinicId, { reminderHour: 5 }))).toBe("invalid");
  const { error } = await admin.client.from("clinic_settings").update({ reminder_hour: 21 }).eq("clinic_id", clinicId);
  expect(error?.code).toBe("23514");
});

describe("equipe", () => {
  it("só o Administrador vê os e-mails da equipe", async () => {
    const { data: byAdmin } = await admin.client.rpc("list_clinic_member_emails", { p_clinic_id: clinicId });
    expect(byAdmin.map((row: { email: string }) => row.email).sort()).toEqual([admin.email, reception.email].sort());
    const { data: byReception } = await reception.client.rpc("list_clinic_member_emails", { p_clinic_id: clinicId });
    expect(byReception).toEqual([]);
  });

  it("convida Profissional: precisa do cadastro, liga o login e começa só com a própria agenda", async () => {
    const access = { roles: ["professional" as const], professionalId: null, agendaScope: "restricted" as const, grantedAgendaIds: [] };
    expect(await codeOf(() => inviteMember(db(admin), admin.id, clinic(), newEmail("c2-prof"), access, deps))).toBe("invalid");

    const email = newEmail("c2-prof");
    const result = await inviteMember(db(admin), admin.id, clinic(), email, { ...access, professionalId: doctorA.id }, deps);
    createdUsers.push(result.userId);
    expect(result).toMatchObject({ existingUser: false, email: { sent: true } });
    expect(sent.at(-1)!.to).toBe(email);

    const member = (await listTeam(db(admin), clinicId)).find((m) => m.userId === result.userId)!;
    expect(member).toMatchObject({ email, roles: ["professional"], agendaScope: "restricted", professionalId: doctorA.id });
    expect(member.invitation).toMatchObject({ acceptedAt: null });

    // O mesmo cadastro não liga a outra pessoa; o mesmo e-mail não entra duas vezes.
    const other = { ...access, professionalId: doctorA.id };
    expect(await codeOf(() => inviteMember(db(admin), admin.id, clinic(), newEmail("c2-outro"), other, deps))).toBe("invalid");
    expect(await codeOf(() => inviteMember(db(admin), admin.id, clinic(), email, { ...access, professionalId: doctorB.id }, deps))).toBe("duplicate");
  });

  it("quem já tem login entra direto como Recepção, com todas as agendas", async () => {
    const access = { roles: ["reception" as const], professionalId: null, agendaScope: "all" as const, grantedAgendaIds: [] };
    const result = await inviteMember(db(admin), admin.id, clinic(), existing.email, access, deps);
    expect(result).toMatchObject({ userId: existing.id, existingUser: true });
    expect(await getMemberAgendaAccess(db(admin), clinicId, existing.id)).toMatchObject({ scope: "all", grantedAgendaIds: [] });
  });

  it("muda papéis, troca o profissional ligado e restringe as agendas", async () => {
    await updateMember(db(admin), admin.id, clinicId, existing.id, {
      roles: ["professional"],
      professionalId: doctorB.id,
      agendaScope: "restricted",
      grantedAgendaIds: [agendaA.id],
    });
    const member = (await listTeam(db(admin), clinicId)).find((m) => m.userId === existing.id)!;
    expect(member).toMatchObject({ roles: ["professional"], professionalId: doctorB.id, agendaScope: "restricted", grantedAgendaIds: [agendaA.id] });

    // A pessoa vê a própria agenda (B) e a liberada (A).
    const { data: visible } = await existing.client.from("agendas").select("id").eq("clinic_id", clinicId);
    expect(visible!.map((a) => a.id).sort()).toEqual([agendaA.id, agendaB.id].sort());

    // Sem o papel Profissional, o cadastro fica livre.
    await updateMember(db(admin), admin.id, clinicId, existing.id, { roles: ["reception"], professionalId: doctorB.id, agendaScope: "all", grantedAgendaIds: [] });
    expect((await listProfessionals(db(admin), clinicId)).find((p) => p.id === doctorB.id)!.userId).toBeNull();
  });

  it("ninguém tira o próprio papel de Administrador nem se remove; a Recepção não mexe na equipe", async () => {
    const asReception = { roles: ["reception" as const], professionalId: null, agendaScope: "all" as const, grantedAgendaIds: [] };
    const error = await updateMember(db(admin), admin.id, clinicId, admin.id, asReception).catch((e) => e);
    expect(error).toMatchObject({ code: "invalid", fields: { roles: expect.stringContaining("próprio papel de Administrador") } });
    expect(await codeOf(() => removeMember(db(admin), admin.id, clinicId, admin.id))).toBe("invalid");
    expect(await codeOf(() => removeMember(db(reception), reception.id, clinicId, existing.id))).toBe("not_found");
  });

  it("remover tira o acesso e o convite (dá para convidar de novo)", async () => {
    await removeMember(db(admin), admin.id, clinicId, existing.id);
    expect((await listTeam(db(admin), clinicId)).some((m) => m.userId === existing.id)).toBe(false);
    const { data: invitations } = await adminClient().from("clinic_invitations").select("id").eq("clinic_id", clinicId).eq("user_id", existing.id);
    expect(invitations).toEqual([]);
    const { data: agendas } = await existing.client.from("agendas").select("id").eq("clinic_id", clinicId);
    expect(agendas).toEqual([]);

    const again = await inviteMember(db(admin), admin.id, clinic(), existing.email, { roles: ["reception"], professionalId: null, agendaScope: "all", grantedAgendaIds: [] }, deps);
    expect(again.existingUser).toBe(true);
  });
});

describe("item desligado depois de criado (ajuste da validação, 05/out)", () => {
  it("domiciliar e exame já gravados não entram em serviço nem em horário novo; o já ligado fica guardado", async () => {
    const home = await createLocation(db(admin), clinicId, { name: "Domiciliar", type: "home_visit", address: null });
    const service = await createService(db(admin), clinicId, { name: "Consulta", category: "consultation", durationMinutes: 30, priceCents: 10000, returnDeadlineDays: null, preparationInstructions: null, schedulingMode: "individual" });
    const exam = await createService(db(admin), clinicId, { name: "Exame", category: "exam", durationMinutes: 30, priceCents: 10000, returnDeadlineDays: null, preparationInstructions: null, schedulingMode: "individual" });
    await setServiceAgendas(db(admin), clinicId, exam.id, [agendaB.id]);
    await setServiceLocations(db(admin), clinicId, service.id, [{ locationId: home.id, priceCents: null }]);

    const { data: all } = await adminClient().from("features").select("key");
    const keys = all!.map((row) => row.key as string).filter((key) => key !== "home_visit" && key !== "exams");
    await adminClient().rpc("set_clinic_features", { p_clinic_id: clinicId, p_features: keys });
    try {
      // Sem o item: a ligação antiga fica guardada com `keep`; uma nova é recusada.
      const kept = await setServiceLocations(db(admin), clinicId, service.id, [{ locationId: office.id, priceCents: null }], { keep: [home.id] });
      expect(kept.locations.map((l) => l.locationId).sort()).toEqual([home.id, office.id].sort());
      const other = await createService(db(admin), clinicId, { name: "Retorno", category: "return_visit", durationMinutes: 30, priceCents: 0, returnDeadlineDays: 30, preparationInstructions: null, schedulingMode: "individual" });
      expect(await codeOf(() => setServiceLocations(db(admin), clinicId, other.id, [{ locationId: home.id, priceCents: null }]))).toBe("not_enabled");

      const window = { agendaId: agendaB.id, serviceId: null, startTime: "18:00", endTime: "19:00", capacity: null };
      expect(await codeOf(() => addAvailabilityWindows(db(admin), clinicId, { ...window, locationId: home.id }, [6]))).toBe("not_enabled");
      expect(await codeOf(() => addAvailabilityWindows(db(admin), clinicId, { ...window, locationId: office.id, serviceId: exam.id }, [6]))).toBe("not_enabled");
    } finally {
      await adminClient().rpc("set_clinic_features", { p_clinic_id: clinicId, p_features: all!.map((row) => row.key as string) });
    }
  });
});
