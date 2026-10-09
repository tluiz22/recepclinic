import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import {
  createAgenda,
  getMemberAgendaAccess,
  listAgendas,
  setAgendaActive,
  setMemberAgendaAccess,
  updateAgenda,
  type Agenda,
} from "../../src/lib/data/config/agendas";
import {
  addAvailabilityWindow,
  listAvailability,
  removeAvailabilityWindow,
  setAvailabilityWindowActive,
} from "../../src/lib/data/config/availability";
import { getClinicSettings, updateClinicSettings } from "../../src/lib/data/config/clinic";
import { addClinicHoliday, listClinicHolidays, removeClinicHoliday } from "../../src/lib/data/config/holidays";
import {
  createInsurancePlan,
  listProfessionalExclusions,
  searchInsurancePlans,
  setInsurancePlanActive,
  setProfessionalExclusions,
} from "../../src/lib/data/config/insurance";
import { createLocation, listLocations, setLocationActive, type Location } from "../../src/lib/data/config/locations";
import {
  createNotificationRecipient,
  listNotificationRecipients,
  setNotificationRecipientActive,
} from "../../src/lib/data/config/notificationRecipients";
import { createProfessional, listProfessionals, updateProfessional, type Professional } from "../../src/lib/data/config/professionals";
import {
  createService,
  listServices,
  servicePriceAt,
  setServiceActive,
  setServiceAgendas,
  setServiceLocations,
  updateService,
  type Service,
} from "../../src/lib/data/config/services";
import { DataError } from "../../src/lib/data/errors";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";

// F3.4 — acesso à configuração, numa clínica criada para o teste (os dados de
// teste do seed ficam intactos para os outros arquivos).
const CLINIC_B = "0b000000-0000-4000-8000-000000000001";

let clinicId: string;
let admin: TestUser;
let reception: TestUser;
let professionalUser: TestUser;
const users: TestUser[] = [];

const db = (user: TestUser) => user.client as unknown as DbClient;

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DataError) return error.code;
    throw error;
  }
  return "ok";
}

let professional: Professional;
let doctorAgenda: Agenda;
let examsAgenda: Agenda;
let office: Location;
let homeVisit: Location;
let consultation: Service;
let groupExam: Service;
let examA: Service;
let examB: Service;

beforeAll(async () => {
  clinicId = await createClinic("Clínica do teste de configuração");
  admin = await createUser("cfg-admin");
  reception = await createUser("cfg-recepcao");
  professionalUser = await createUser("cfg-profissional");
  users.push(admin, reception, professionalUser);
  await addMember(clinicId, admin.id, ["admin"]);
  await addMember(clinicId, reception.id, ["reception"]);
  await addMember(clinicId, professionalUser.id, ["professional"]);
});

afterAll(async () => {
  await deleteClinics([clinicId]);
  await deleteUsers(users);
});

describe("configuração da clínica", () => {
  it("lê os padrões e o Administrador altera", async () => {
    const before = await getClinicSettings(db(reception), clinicId);
    expect(before).toMatchObject({ name: "Clínica do teste de configuração", timezone: "America/Fortaleza", profile: "mixed" });

    const after = await updateClinicSettings(db(admin), clinicId, {
      name: "Clínica Teste",
      timezone: "America/Manaus",
      reminderHour: 9,
      brandColor: "#0f766e",
      botNotes: "  Estacionamento no local.  ",
    });
    expect(after).toMatchObject({
      name: "Clínica Teste",
      timezone: "America/Manaus",
      reminderHour: 9,
      brandColor: "#0F766E",
      botNotes: "Estacionamento no local.",
    });
  });

  it("Recepção não altera; dado inválido nem chega ao banco", async () => {
    expect(await codeOf(() => updateClinicSettings(db(reception), clinicId, { reminderHour: 10 }))).toBe("not_found");
    expect((await getClinicSettings(db(admin), clinicId)).reminderHour).toBe(9);
    expect(await codeOf(() => updateClinicSettings(db(admin), clinicId, { timezone: "Manaus" }))).toBe("invalid");
  });

  it("Administrador de uma clínica não altera outra", async () => {
    expect(await codeOf(() => updateClinicSettings(db(admin), CLINIC_B, { botNotes: "invasão" }))).toBe("not_found");
  });
});

describe("profissionais, locais e agendas", () => {
  beforeAll(async () => {
    professional = await createProfessional(db(admin), clinicId, {
      userId: professionalUser.id,
      displayName: "Dra. Teste",
      profession: "Médica",
      specialty: "Pediatria",
      council: "crm",
      councilNumber: "1234",
      councilState: "ce",
    });
    doctorAgenda = await createAgenda(db(admin), clinicId, {
      name: "Dra. Teste",
      kind: "professional",
      professionalId: professional.id,
      bufferMinutes: 10,
    });
    examsAgenda = await createAgenda(db(admin), clinicId, { name: "Exames", kind: "resource", professionalId: null, bufferMinutes: 0 });
    office = await createLocation(db(admin), clinicId, { name: "Consultório", type: "clinic", address: "Rua A, 1" });
    homeVisit = await createLocation(db(admin), clinicId, { name: "Domiciliar", type: "home_visit", address: null });
  });

  it("cadastra com os dados normalizados", async () => {
    expect(professional).toMatchObject({ council: "CRM", councilState: "CE", userId: professionalUser.id, isActive: true });
    expect((await listProfessionals(db(reception), clinicId)).map((p) => p.displayName)).toEqual(["Dra. Teste"]);
    expect((await listLocations(db(reception), clinicId)).map((l) => l.name)).toEqual(["Consultório", "Domiciliar"]);
  });

  it("RQE opcional, um ou vários; sem o campo, fica como está", async () => {
    // O WhatsApp é obrigatório no cadastro (cliente, 09/out/2026).
    const { id, isActive: _active, ...rest } = professional;
    const base = { ...rest, phone: "(84) 99999-0000" };
    expect(await updateProfessional(db(admin), clinicId, id, { ...base, rqe: "6271 / 8890" })).toMatchObject({ rqe: "6271, 8890" });
    expect(await codeOf(() => updateProfessional(db(admin), clinicId, id, { ...base, rqe: "RQE 6271" }))).toBe("invalid");
    const { rqe: _rqe, ...withoutRqe } = base;
    expect(await updateProfessional(db(admin), clinicId, id, withoutRqe)).toMatchObject({ rqe: "6271, 8890" });
    expect(await updateProfessional(db(admin), clinicId, id, { ...base, rqe: "" })).toMatchObject({ rqe: null });
  });

  it("cada login vê só as agendas que pode (D6)", async () => {
    expect((await listAgendas(db(reception), clinicId)).map((a) => a.name)).toEqual(["Dra. Teste", "Exames"]);
    expect((await listAgendas(db(professionalUser), clinicId)).map((a) => a.name)).toEqual(["Dra. Teste"]);
  });

  it("Recepção não cadastra; Administrador não cadastra em outra clínica", async () => {
    expect(await codeOf(() => createLocation(db(reception), clinicId, { name: "Sala 2", type: "clinic", address: null }))).toBe(
      "forbidden",
    );
    expect(await codeOf(() => createLocation(db(admin), CLINIC_B, { name: "Intruso", type: "clinic", address: null }))).toBe(
      "forbidden",
    );
  });

  it("agenda: altera nome e intervalo; desativada some da lista padrão", async () => {
    const renamed = await updateAgenda(db(admin), clinicId, examsAgenda.id, { name: "Exames e testes", bufferMinutes: 5 });
    expect(renamed).toMatchObject({ name: "Exames e testes", bufferMinutes: 5, kind: "resource" });
    const extra = await createAgenda(db(admin), clinicId, { name: "Sala extra", kind: "resource", professionalId: null, bufferMinutes: 0 });
    await setAgendaActive(db(admin), clinicId, extra.id, false);
    expect((await listAgendas(db(admin), clinicId)).map((a) => a.name)).not.toContain("Sala extra");
    expect((await listAgendas(db(admin), clinicId, { includeInactive: true })).map((a) => a.name)).toContain("Sala extra");
  });

  it("local desativado sai da lista padrão", async () => {
    const old = await createLocation(db(admin), clinicId, { name: "Antigo", type: "clinic", address: null });
    await setLocationActive(db(admin), clinicId, old.id, false);
    expect((await listLocations(db(admin), clinicId)).map((l) => l.name)).not.toContain("Antigo");
  });

  it("acesso da Recepção restrito a uma agenda e de volta a todas", async () => {
    const restricted = await setMemberAgendaAccess(db(admin), clinicId, reception.id, "restricted", [examsAgenda.id]);
    expect(restricted).toEqual({ userId: reception.id, scope: "restricted", grantedAgendaIds: [examsAgenda.id] });
    expect((await listAgendas(db(reception), clinicId)).map((a) => a.id)).toEqual([examsAgenda.id]);

    const all = await setMemberAgendaAccess(db(admin), clinicId, reception.id, "all", []);
    expect(all).toEqual({ userId: reception.id, scope: "all", grantedAgendaIds: [] });
    expect(await getMemberAgendaAccess(db(admin), clinicId, reception.id)).toEqual(all);
    expect((await listAgendas(db(reception), clinicId)).length).toBe(2);
  });

  it("Recepção não muda o próprio acesso", async () => {
    expect(await codeOf(() => setMemberAgendaAccess(db(reception), clinicId, reception.id, "restricted", []))).toBe("not_found");
  });
});

describe("serviços", () => {
  beforeAll(async () => {
    consultation = await createService(db(admin), clinicId, {
      name: "Consulta",
      category: "consultation",
      durationMinutes: 30,
      priceCents: 30000,
      returnDeadlineDays: null,
      preparationInstructions: null,
      schedulingMode: "individual",
    });
    const exam = (name: string, schedulingMode: "individual" | "group") =>
      createService(db(admin), clinicId, {
        name,
        category: "exam",
        durationMinutes: 20,
        priceCents: 15000,
        returnDeadlineDays: null,
        preparationInstructions: "Jejum de 4h",
        schedulingMode,
      });
    groupExam = await exam("Teste da orelhinha (turma)", "group");
    examA = await exam("Exame A", "individual");
    examB = await exam("Exame B", "individual");
  });

  it("agendas e locais do serviço, com preço próprio por local", async () => {
    await setServiceAgendas(db(admin), clinicId, consultation.id, [doctorAgenda.id]);
    const withLocations = await setServiceLocations(db(admin), clinicId, consultation.id, [
      { locationId: office.id, priceCents: null },
      { locationId: homeVisit.id, priceCents: 45000 },
    ]);
    expect(withLocations.agendaIds).toEqual([doctorAgenda.id]);
    expect(servicePriceAt(withLocations, office.id)).toBe(30000);
    expect(servicePriceAt(withLocations, homeVisit.id)).toBe(45000);

    // Tirar o domiciliar e mudar o preço do consultório.
    const changed = await setServiceLocations(db(admin), clinicId, consultation.id, [{ locationId: office.id, priceCents: 32000 }]);
    expect(changed.locations).toEqual([{ locationId: office.id, priceCents: 32000 }]);
    expect(servicePriceAt(changed, homeVisit.id)).toBeNull();
  });

  it("alterar mantém a categoria; desativado some da lista padrão", async () => {
    const updated = await updateService(db(admin), clinicId, consultation.id, {
      name: "Consulta pediátrica",
      durationMinutes: 40,
      priceCents: 35000,
      returnDeadlineDays: null,
      preparationInstructions: null,
      schedulingMode: "individual",
    });
    expect(updated).toMatchObject({ name: "Consulta pediátrica", category: "consultation", durationMinutes: 40 });

    const old = await createService(db(admin), clinicId, {
      name: "Antigo",
      category: "consultation",
      durationMinutes: 30,
      priceCents: 0,
      returnDeadlineDays: null,
      preparationInstructions: null,
      schedulingMode: "individual",
    });
    await setServiceActive(db(admin), clinicId, old.id, false);
    expect((await listServices(db(reception), clinicId)).map((s) => s.name)).not.toContain("Antigo");
    expect((await listServices(db(reception), clinicId, { category: "exam" })).length).toBe(3);
  });

  it("serviço não é ligado a agenda de outra clínica", async () => {
    const { data: agendaB } = await adminClient().from("agendas").select("id").eq("clinic_id", CLINIC_B).limit(1).single();
    expect(await codeOf(() => setServiceAgendas(db(admin), clinicId, consultation.id, [doctorAgenda.id, agendaB!.id]))).toBe("invalid");
    expect((await listServices(db(admin), clinicId)).find((s) => s.id === consultation.id)?.agendaIds).toEqual([doctorAgenda.id]);
  });
});

describe("dias e horários (sobreposição por agenda)", () => {
  const base = { capacity: null as number | null, serviceId: null as string | null, weekday: 1 };

  beforeAll(async () => {
    for (const exam of [groupExam, examA, examB]) await setServiceAgendas(db(admin), clinicId, exam.id, [examsAgenda.id]);
  });

  it("geral cruzando outro geral da mesma agenda conflita, mesmo em outro local", async () => {
    await addAvailabilityWindow(db(admin), clinicId, { ...base, agendaId: doctorAgenda.id, locationId: office.id, startTime: "08:00", endTime: "12:00" });
    expect(
      await codeOf(() =>
        addAvailabilityWindow(db(admin), clinicId, { ...base, agendaId: doctorAgenda.id, locationId: homeVisit.id, startTime: "11:00", endTime: "14:00" }),
      ),
    ).toBe("conflict");
    // Encostando: pode.
    await addAvailabilityWindow(db(admin), clinicId, { ...base, agendaId: doctorAgenda.id, locationId: homeVisit.id, startTime: "12:00", endTime: "14:00" });
  });

  it("agendas diferentes nunca conflitam", async () => {
    await addAvailabilityWindow(db(admin), clinicId, {
      ...base,
      agendaId: examsAgenda.id,
      locationId: office.id,
      serviceId: examA.id,
      startTime: "08:00",
      endTime: "12:00",
    });
  });

  it("exames individuais diferentes dividem horário; o mesmo exame, não", async () => {
    const window = { ...base, agendaId: examsAgenda.id, locationId: office.id, startTime: "09:00", endTime: "10:00" };
    await addAvailabilityWindow(db(admin), clinicId, { ...window, serviceId: examB.id });
    expect(await codeOf(() => addAvailabilityWindow(db(admin), clinicId, { ...window, serviceId: examA.id }))).toBe("conflict");
  });

  it("turma exige vagas e não cruza com nenhum outro", async () => {
    const window = { ...base, agendaId: examsAgenda.id, locationId: office.id, serviceId: groupExam.id };
    expect(await codeOf(() => addAvailabilityWindow(db(admin), clinicId, { ...window, startTime: "14:00", endTime: "16:00" }))).toBe("invalid");
    expect(
      await codeOf(() => addAvailabilityWindow(db(admin), clinicId, { ...window, capacity: 6, startTime: "11:00", endTime: "13:00" })),
    ).toBe("conflict");
    const group = await addAvailabilityWindow(db(admin), clinicId, { ...window, capacity: 6, startTime: "14:00", endTime: "16:00" });
    expect(group.capacity).toBe(6);
  });

  it("individual não aceita vagas; serviço fora da agenda é recusado", async () => {
    const window = { ...base, agendaId: examsAgenda.id, locationId: office.id, startTime: "16:00", endTime: "17:00" };
    expect(await codeOf(() => addAvailabilityWindow(db(admin), clinicId, { ...window, serviceId: examA.id, capacity: 3 }))).toBe("invalid");
    expect(await codeOf(() => addAvailabilityWindow(db(admin), clinicId, { ...window, serviceId: consultation.id }))).toBe("invalid");
    expect(await codeOf(() => addAvailabilityWindow(db(admin), clinicId, { ...window, startTime: "18:00", endTime: "17:00" }))).toBe(
      "invalid",
    );
  });

  it("reativar confere a sobreposição de novo", async () => {
    const agenda = doctorAgenda.id;
    const tuesday = { ...base, weekday: 2, agendaId: agenda, locationId: office.id };
    const first = await addAvailabilityWindow(db(admin), clinicId, { ...tuesday, startTime: "08:00", endTime: "12:00" });
    await setAvailabilityWindowActive(db(admin), clinicId, first.id, false);
    await addAvailabilityWindow(db(admin), clinicId, { ...tuesday, startTime: "10:00", endTime: "11:00" });
    expect(await codeOf(() => setAvailabilityWindowActive(db(admin), clinicId, first.id, true))).toBe("conflict");

    await removeAvailabilityWindow(db(admin), clinicId, first.id);
    const tuesdays = (await listAvailability(db(reception), clinicId, agenda, { includeInactive: true })).filter((w) => w.weekday === 2);
    expect(tuesdays.map((w) => `${w.startTime}-${w.endTime}`)).toEqual(["10:00-11:00"]);
  });

  it("exame inativo não conta para a sobreposição", async () => {
    const wednesday = { ...base, weekday: 3, agendaId: examsAgenda.id, locationId: office.id, startTime: "09:00", endTime: "10:00" };
    await addAvailabilityWindow(db(admin), clinicId, { ...wednesday, serviceId: examB.id });
    const group = { ...wednesday, serviceId: groupExam.id, capacity: 4 };
    expect(await codeOf(() => addAvailabilityWindow(db(admin), clinicId, group))).toBe("conflict");
    await setServiceActive(db(admin), clinicId, examB.id, false);
    expect((await addAvailabilityWindow(db(admin), clinicId, group)).capacity).toBe(4);
  });

  it("Recepção não mexe nos horários", async () => {
    expect(
      await codeOf(() =>
        addAvailabilityWindow(db(reception), clinicId, { ...base, weekday: 5, agendaId: doctorAgenda.id, locationId: office.id, startTime: "08:00", endTime: "09:00" }),
      ),
    ).toBe("forbidden");
  });
});

describe("feriados, contatos do resumo e planos", () => {
  it("feriado: um por data, data válida, remove", async () => {
    const holiday = await addClinicHoliday(db(admin), clinicId, { date: "2026-12-08", description: " Nossa Senhora " });
    expect(holiday.description).toBe("Nossa Senhora");
    expect(await codeOf(() => addClinicHoliday(db(admin), clinicId, { date: "2026-12-08", description: "De novo" }))).toBe("duplicate");
    expect(await codeOf(() => addClinicHoliday(db(admin), clinicId, { date: "2026-02-30", description: "Inexistente" }))).toBe("invalid");
    expect((await listClinicHolidays(db(reception), clinicId, "2026-12-01")).map((h) => h.date)).toEqual(["2026-12-08"]);
    await removeClinicHoliday(db(admin), clinicId, holiday.id);
    expect(await listClinicHolidays(db(admin), clinicId)).toEqual([]);
  });

  it("contato do resumo: telefone normalizado, sem repetir, desativa", async () => {
    const recipient = await createNotificationRecipient(db(admin), clinicId, {
      label: "Recepção",
      phone: "(85) 98888-0000",
      receivesConsultations: true,
      receivesExams: true,
    });
    expect(recipient.phone).toBe("+5585988880000");
    expect(
      await codeOf(() =>
        createNotificationRecipient(db(admin), clinicId, { label: "Outra", phone: "+55 85 98888-0000", receivesConsultations: false, receivesExams: true }),
      ),
    ).toBe("duplicate");
    await setNotificationRecipientActive(db(admin), clinicId, recipient.id, false);
    expect(await listNotificationRecipients(db(admin), clinicId)).toEqual([]);
  });

  it("planos: busca por nome parecido, nome repetido recusado, exceções por profissional", async () => {
    const unimed = await createInsurancePlan(db(admin), clinicId, { name: "Unimed", alternativeNames: ["Uni med"], ansCode: null });
    const hapvida = await createInsurancePlan(db(admin), clinicId, { name: "Hapvida", alternativeNames: [], ansCode: null });
    expect(await codeOf(() => createInsurancePlan(db(admin), clinicId, { name: "UNIMED", alternativeNames: [], ansCode: null }))).toBe(
      "duplicate",
    );

    const found = await searchInsurancePlans(db(reception), clinicId, "unimedi");
    expect(found[0]?.id).toBe(unimed.id);
    expect(await searchInsurancePlans(db(reception), clinicId, "  ")).toEqual([]);

    expect(await setProfessionalExclusions(db(admin), clinicId, professional.id, [hapvida.id])).toEqual([hapvida.id]);
    expect(await listProfessionalExclusions(db(reception), clinicId, professional.id)).toEqual([hapvida.id]);
    expect(await setProfessionalExclusions(db(admin), clinicId, professional.id, [])).toEqual([]);

    await setInsurancePlanActive(db(admin), clinicId, hapvida.id, false);
    expect((await searchInsurancePlans(db(reception), clinicId, "hapvida")).length).toBe(0);
  });
});
