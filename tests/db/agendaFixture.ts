import type { DbClient } from "../../src/lib/data/clients";
import { createAgenda } from "../../src/lib/data/config/agendas";
import { addAvailabilityWindow } from "../../src/lib/data/config/availability";
import { createLocation } from "../../src/lib/data/config/locations";
import { createProfessional } from "../../src/lib/data/config/professionals";
import { createService, setServiceLocations, type ServiceInput, type ServiceOwner } from "../../src/lib/data/config/services";
import { DataError } from "../../src/lib/data/errors";
import { registerPatient } from "../../src/lib/data/patients";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, teamAgendaId, type TestUser } from "./helpers";

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
  "agendaDra" | "agendaDra2" | "agendaExams" | "office" | "home" | "consulta" | "consulta2" | "retorno" | "exame" | "turma" | "p1" | "p2" | "p3",
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

/** A Consulta da agenda (MS: uma cópia por profissional). */
export const consultaAt = (ids: AgendaIds, agendaId: string) => (agendaId === ids.agendaDra2 ? ids.consulta2 : ids.consulta);

export async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DataError) return error.code;
    throw error;
  }
  return "ok";
}

/**
 * `oneBotProfessional`: o Dr. Segundo fica desativado (a agenda dele continua, com horário), e a clínica vale como
 * de um profissional no bot (MB, 07/nov/2026: sem a pergunta da especialidade e do profissional).
 */
export async function setupAgendaClinic(name: string, phonePrefix: string, { oneBotProfessional = false } = {}): Promise<AgendaFixture> {
  const clinicId = await createClinic(name);
  const admin = await createUser("ag-admin");
  const reception = await createUser("ag-recepcao");
  await addMember(clinicId, admin.id, ["admin"]);
  await addMember(clinicId, reception.id, ["reception"]);
  const ids = {} as AgendaIds;

  const a = asDb(admin);
  const professional = (displayName: string) =>
    createProfessional(a, clinicId, { userId: null, displayName, profession: "Médica", council: null, councilNumber: null, councilState: null });
  const dra = await professional("Dra. Agenda");
  const dra2 = await professional("Dr. Segundo");
  ids.agendaDra = (await createAgenda(a, clinicId, { kind: "professional", professionalId: dra.id, bufferMinutes: 0 })).id;
  ids.agendaDra2 = (await createAgenda(a, clinicId, { kind: "professional", professionalId: dra2.id, bufferMinutes: 0 })).id;
  ids.agendaExams = await teamAgendaId(clinicId);
  ids.office = (await createLocation(a, clinicId, { name: "Consultório", type: "clinic", address: "Rua A, 1" })).id;
  ids.home = (await createLocation(a, clinicId, { name: "Domiciliar", type: "home_visit", address: null })).id;

  // Serviço por profissional (MS, 07/nov/2026): o dono decide a agenda.
  const service = async (input: Partial<ServiceInput> & Pick<ServiceInput, "name" | "category">, owner: ServiceOwner, locations: string[]) => {
    const created = await createService(
      a,
      clinicId,
      {
        durationMinutes: 30,
        priceCents: 30000,
        returnDeadlineDays: null,
        preparationInstructions: null,
        schedulingMode: "individual",
        ...input,
      },
      owner,
    );
    await setServiceLocations(a, clinicId, created.id, locations.map((locationId) => ({ locationId, priceCents: locationId === ids.home ? 45000 : null })));
    return created.id;
  };
  ids.consulta = await service({ name: "Consulta", category: "consultation" }, { professionalId: dra.id }, [ids.office, ids.home]);
  ids.consulta2 = await service({ name: "Consulta", category: "consultation" }, { professionalId: dra2.id }, [ids.office, ids.home]);
  ids.retorno = await service({ name: "Retorno", category: "return_visit", durationMinutes: 20, priceCents: 0, returnDeadlineDays: 30 }, { professionalId: dra.id }, [ids.office, ids.home]);
  ids.exame = await service({ name: "Exame", category: "exam", durationMinutes: 20, priceCents: 15000 }, { team: true }, [ids.office]);
  ids.turma = await service({ name: "Turma", category: "exam", durationMinutes: 60, priceCents: 9000, schedulingMode: "group" }, { team: true }, [ids.office]);

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
  if (oneBotProfessional) {
    const { error } = await adminClient().from("professionals").update({ is_active: false }).eq("id", dra2.id);
    if (error) throw error;
  }

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

/** Todos os profissionais da clínica atendem o plano (MC, 07/nov/2026: a ligação é positiva). */
export async function linkPlanToAllProfessionals(clinicId: string, planId: string): Promise<void> {
  const { data: pros, error } = await adminClient().from("professionals").select("id").eq("clinic_id", clinicId);
  if (error) throw error;
  const rows = (pros ?? []).map((p) => ({ clinic_id: clinicId, professional_id: p.id, insurance_plan_id: planId }));
  if (rows.length) {
    const { error: linkError } = await adminClient().from("professional_insurance_plans").insert(rows);
    if (linkError) throw linkError;
  }
}

/** Informações que o bot responde, iguais para todos os profissionais da clínica (MI, 07/nov/2026). */
export async function setBotInfoForAll(clinicId: string, info: { payment_info?: string | null; insurance_info?: string | null; notes?: string | null }): Promise<void> {
  const { data: pros, error } = await adminClient().from("professionals").select("id").eq("clinic_id", clinicId);
  if (error) throw error;
  const rows = (pros ?? []).map((p) => ({ clinic_id: clinicId, professional_id: p.id, ...info }));
  if (!rows.length) return;
  const { error: saveError } = await adminClient().from("professional_bot_info").upsert(rows, { onConflict: "professional_id" });
  if (saveError) throw saveError;
}
