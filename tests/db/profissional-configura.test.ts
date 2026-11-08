import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAvailabilityWindow } from "../../src/lib/data/config/availability";
import { setAgendaActive, updateAgenda } from "../../src/lib/data/config/agendas";
import { listProfessionals, setProfessionalActive, updateProfessional } from "../../src/lib/data/config/professionals";
import { setProfessionalBotInfo } from "../../src/lib/data/config/professionalBotInfo";
import { createService, setServiceActive, setServiceLocations, updateService, type ServiceInput } from "../../src/lib/data/config/services";
import { addMember, adminClient, createUser, deleteUsers, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// O profissional configura o que é dele (MS, S1; cliente, 07/nov/2026): com login, o próprio cadastro, a própria
// agenda (o intervalo), os horários dela e os serviços dele; o resto (outro profissional, a equipe, desativar o
// cadastro ou a agenda) segue só com o Administrador.

let f: AgendaFixture;
let doctor: TestUser;
let draId: string;
let dra2Id: string;
const base: Omit<ServiceInput, "name" | "category"> = {
  durationMinutes: 30,
  priceCents: 10000,
  returnDeadlineDays: null,
  preparationInstructions: null,
  schedulingMode: "individual",
};

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica do profissional que configura", "+55849911770");
  doctor = await createUser("ms-s1-dra");
  await addMember(f.clinicId, doctor.id, ["professional"]);
  const { data: agendas } = await adminClient().from("agendas").select("id, professional_id").in("id", [f.ids.agendaDra, f.ids.agendaDra2]);
  draId = agendas!.find((a) => a.id === f.ids.agendaDra)!.professional_id!;
  dra2Id = agendas!.find((a) => a.id === f.ids.agendaDra2)!.professional_id!;
  await adminClient().from("professionals").update({ user_id: doctor.id }).eq("id", draId);
});

afterAll(async () => {
  await f.cleanup();
  await deleteUsers([doctor]);
});

describe("serviços", () => {
  it("cadastra, edita e desativa os dele; o banco liga à agenda dele", async () => {
    const db = asDb(doctor);
    const own = await createService(db, f.clinicId, { ...base, name: "Consulta da Dra.", category: "consultation" }, { professionalId: draId });
    expect(own).toMatchObject({ professionalId: draId, agendaIds: [f.ids.agendaDra] });
    const withLocation = await setServiceLocations(db, f.clinicId, own.id, [{ locationId: f.ids.office, priceCents: 12000 }]);
    expect(withLocation.locations).toEqual([{ locationId: f.ids.office, priceCents: 12000 }]);
    expect((await updateService(db, f.clinicId, own.id, { ...base, name: "Consulta da Dra. (nova)" })).name).toBe("Consulta da Dra. (nova)");
    await setServiceActive(db, f.clinicId, own.id, false);
    await setServiceActive(db, f.clinicId, own.id, true);
  });

  it("não cadastra para outro profissional nem para a equipe; não mexe nos de outro", async () => {
    const db = asDb(doctor);
    expect(await codeOf(() => createService(db, f.clinicId, { ...base, name: "Do Dr.", category: "consultation" }, { professionalId: dra2Id }))).not.toBe("ok");
    expect(await codeOf(() => createService(db, f.clinicId, { ...base, name: "Da equipe", category: "exam" }, { team: true }))).not.toBe("ok");
    expect(await codeOf(() => updateService(db, f.clinicId, f.ids.consulta2, { ...base, name: "Invadido" }))).toBe("not_found");
    expect(await codeOf(() => setServiceActive(db, f.clinicId, f.ids.exame, false))).toBe("not_found");
    expect(await codeOf(() => setServiceLocations(db, f.clinicId, f.ids.consulta2, [{ locationId: f.ids.office, priceCents: 1 }]))).not.toBe("ok");
    const { data } = await adminClient().from("services").select("name, is_active").in("id", [f.ids.consulta2, f.ids.exame]);
    expect(data!.map((s) => s.name).sort()).toEqual(["Consulta", "Exame"]);
    expect(data!.every((s) => s.is_active)).toBe(true);
  });
});

describe("agenda e horários", () => {
  const window = (agendaId: string) =>
    addAvailabilityWindow(asDb(doctor), f.clinicId, { agendaId, locationId: f.ids.office, serviceId: null, weekday: 6, startTime: "08:00", endTime: "09:00", capacity: null });

  it("muda o intervalo e os horários da agenda dele, não os da outra", async () => {
    expect((await updateAgenda(asDb(doctor), f.clinicId, f.ids.agendaDra, { bufferMinutes: 5 })).bufferMinutes).toBe(5);
    expect((await window(f.ids.agendaDra)).agendaId).toBe(f.ids.agendaDra);
    expect(await codeOf(() => window(f.ids.agendaDra2))).not.toBe("ok");
    expect(await codeOf(() => updateAgenda(asDb(doctor), f.clinicId, f.ids.agendaDra2, { bufferMinutes: 5 }))).toBe("not_found");
  });

  it("não desativa a própria agenda", async () => {
    expect(await codeOf(() => setAgendaActive(asDb(doctor), f.clinicId, f.ids.agendaDra, false))).not.toBe("ok");
    const { data } = await adminClient().from("agendas").select("is_active").eq("id", f.ids.agendaDra).single();
    expect(data!.is_active).toBe(true);
  });
});

describe("cadastro", () => {
  it("edita o próprio cadastro e as informações do bot; não desativa nem edita o de outro", async () => {
    const db = asDb(doctor);
    const me = (await listProfessionals(db, f.clinicId)).find((p) => p.id === draId)!;
    const { data: specialty } = await adminClient().from("kb_specialties").select("id").eq("is_active", true).limit(1).single();
    const input = {
      userId: me.userId,
      displayName: "Dra. Agenda Atualizada",
      profession: me.profession,
      specialtyIds: [specialty!.id],
      council: me.council,
      councilNumber: me.councilNumber,
      councilState: me.councilState,
      rqe: me.rqe,
      phone: "+5584991177099",
    };
    expect((await updateProfessional(db, f.clinicId, draId, input)).displayName).toBe("Dra. Agenda Atualizada");
    await setProfessionalBotInfo(db, f.clinicId, draId, { paymentInfo: "Pix da Dra.", insuranceInfo: null, notes: null });
    expect(await codeOf(() => setProfessionalActive(db, f.clinicId, draId, false))).not.toBe("ok");
    expect(await codeOf(() => updateProfessional(db, f.clinicId, dra2Id, { ...input, displayName: "Invadido" }))).not.toBe("ok");
    expect(await codeOf(() => setProfessionalBotInfo(db, f.clinicId, dra2Id, { paymentInfo: "x", insuranceInfo: null, notes: null }))).not.toBe("ok");
    const { data } = await adminClient().from("professionals").select("display_name, is_active").eq("id", dra2Id).single();
    expect(data).toEqual({ display_name: "Dr. Segundo", is_active: true });
  });

  it("a Recepção continua sem gravar serviços", async () => {
    expect(await codeOf(() => createService(asDb(f.reception), f.clinicId, { ...base, name: "Da recepção", category: "consultation" }, { professionalId: draId }))).not.toBe("ok");
  });
});
