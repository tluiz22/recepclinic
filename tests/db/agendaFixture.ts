import type { DbClient } from "../../src/lib/data/clients";
import { createAgenda } from "../../src/lib/data/config/agendas";
import { addAvailabilityWindow } from "../../src/lib/data/config/availability";
import { createLocation } from "../../src/lib/data/config/locations";
import { createProfessional } from "../../src/lib/data/config/professionals";
import { createService, setServiceAgendas, setServiceLocations, type ServiceInput } from "../../src/lib/data/config/services";
import { DataError } from "../../src/lib/data/errors";
import { registerPatient } from "../../src/lib/data/patients";
import { addMember, createClinic, createUser, deleteClinics, deleteUsers, type TestUser } from "./helpers";

// Clínica de teste da agenda (F3.6): duas agendas de profissional, uma de
// exames, consultório e domiciliar, consulta/retorno/exame/turma, horários
// às segundas e três pacientes. Datas em março/2031; "agora" é o domingo
// anterior, ao meio-dia em Fortaleza.

export const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);
export const MON1 = "2031-03-10";
export const MON2 = "2031-03-17";
export const MON3 = "2031-03-24";
export const MON4 = "2031-03-31";
export const NOW = at("2031-03-09", "12:00");

export type AgendaIds = Record<
  "agendaDra" | "agendaDra2" | "agendaExams" | "office" | "home" | "consulta" | "retorno" | "exame" | "turma" | "p1" | "p2" | "p3",
  string
>;

export type AgendaFixture = {
  clinicId: string;
  admin: TestUser;
  reception: TestUser;
  ids: AgendaIds;
  cleanup: () => Promise<void>;
};

export const asDb = (user: TestUser) => user.client as unknown as DbClient;

export async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DataError) return error.code;
    throw error;
  }
  return "ok";
}

export async function setupAgendaClinic(name: string, phonePrefix: string): Promise<AgendaFixture> {
  const clinicId = await createClinic(name);
  const admin = await createUser("ag-admin");
  const reception = await createUser("ag-recepcao");
  await addMember(clinicId, admin.id, ["admin"]);
  await addMember(clinicId, reception.id, ["reception"]);
  const ids = {} as AgendaIds;

  const a = asDb(admin);
  const professional = (displayName: string) =>
    createProfessional(a, clinicId, { userId: null, displayName, profession: "Médica", specialty: null, council: null, councilNumber: null, councilState: null });
  const dra = await professional("Dra. Agenda");
  const dra2 = await professional("Dr. Segundo");
  ids.agendaDra = (await createAgenda(a, clinicId, { name: "Dra. Agenda", kind: "professional", professionalId: dra.id, bufferMinutes: 0 })).id;
  ids.agendaDra2 = (await createAgenda(a, clinicId, { name: "Dr. Segundo", kind: "professional", professionalId: dra2.id, bufferMinutes: 0 })).id;
  ids.agendaExams = (await createAgenda(a, clinicId, { name: "Exames", kind: "resource", professionalId: null, bufferMinutes: 0 })).id;
  ids.office = (await createLocation(a, clinicId, { name: "Consultório", type: "clinic", address: "Rua A, 1" })).id;
  ids.home = (await createLocation(a, clinicId, { name: "Domiciliar", type: "home_visit", address: null })).id;

  const service = async (input: Partial<ServiceInput> & Pick<ServiceInput, "name" | "category">, agendas: string[], locations: string[]) => {
    const created = await createService(a, clinicId, {
      durationMinutes: 30,
      priceCents: 30000,
      returnDeadlineDays: null,
      preparationInstructions: null,
      schedulingMode: "individual",
      ...input,
    });
    await setServiceAgendas(a, clinicId, created.id, agendas);
    await setServiceLocations(a, clinicId, created.id, locations.map((locationId) => ({ locationId, priceCents: locationId === ids.home ? 45000 : null })));
    return created.id;
  };
  ids.consulta = await service({ name: "Consulta", category: "consultation" }, [ids.agendaDra, ids.agendaDra2], [ids.office, ids.home]);
  ids.retorno = await service({ name: "Retorno", category: "return_visit", durationMinutes: 20, priceCents: 0, returnDeadlineDays: 30 }, [ids.agendaDra], [ids.office, ids.home]);
  ids.exame = await service({ name: "Exame", category: "exam", durationMinutes: 20, priceCents: 15000 }, [ids.agendaExams], [ids.office]);
  ids.turma = await service({ name: "Turma", category: "exam", durationMinutes: 60, priceCents: 9000, schedulingMode: "group" }, [ids.agendaExams], [ids.office]);

  const window = (agendaId: string, locationId: string, startTime: string, endTime: string, extra = {}) =>
    addAvailabilityWindow(a, clinicId, { agendaId, locationId, serviceId: null, weekday: 1, startTime, endTime, capacity: null, ...extra });
  await window(ids.agendaDra, ids.office, "08:00", "12:00");
  await window(ids.agendaDra, ids.home, "14:00", "15:00");
  await window(ids.agendaDra2, ids.office, "08:00", "09:00");
  await window(ids.agendaExams, ids.office, "08:00", "09:00", { serviceId: ids.exame });
  await window(ids.agendaExams, ids.office, "10:00", "11:00", { serviceId: ids.turma, capacity: 2 });

  const patient = async (fullName: string, phone: string) => {
    const result = await registerPatient(a, clinicId, { fullName, birthdate: "2020-01-01", contact: { mode: "new", fullName: `Resp. ${fullName}`, phone } }, "2031-03-09");
    if (result.status !== "created") throw new Error(result.status);
    return result.patient.id;
  };
  ids.p1 = await patient("Paciente Um", `${phonePrefix}01`);
  ids.p2 = await patient("Paciente Dois", `${phonePrefix}02`);
  ids.p3 = await patient("Paciente Três", `${phonePrefix}03`);

  return {
    clinicId,
    admin,
    reception,
    ids,
    cleanup: async () => {
      await deleteClinics([clinicId]);
      await deleteUsers([admin, reception]);
    },
  };
}
