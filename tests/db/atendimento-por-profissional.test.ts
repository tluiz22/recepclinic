import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agendaOfProfessional, createAgenda, updateAgendaAttendance } from "../../src/lib/data/config/agendas";
import { createProfessional } from "../../src/lib/data/config/professionals";
import { addMember, adminClient, createUser, deleteUsers, type TestUser } from "./helpers";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// Item 4 da validação (cliente, 08/nov/2026): perfil, prazo para oferecer horários e idade limite saem da clínica e
// passam a ser de cada profissional (na agenda dele) e da Equipe. O perfil da clínica (palavras das telas) é calculado.

let f: AgendaFixture;
let doctor: TestUser;
let draId: string;

const clinicProfile = async () =>
  ((await adminClient().from("clinic_settings").select("profile").eq("clinic_id", f.clinicId).single()).data as { profile: string }).profile;
const attendanceOf = async (agendaId: string) =>
  (await adminClient().from("agendas").select("profile, booking_horizon_days, consultation_age_limit_years").eq("id", agendaId).single()).data;

beforeAll(async () => {
  f = await setupAgendaClinic("Clínica do atendimento por profissional", "+55849911881");
  doctor = await createUser("atendimento-dra");
  await addMember(f.clinicId, doctor.id, ["professional"]);
  const { data } = await adminClient().from("agendas").select("professional_id").eq("id", f.ids.agendaDra).single();
  draId = data!.professional_id!;
  await adminClient().from("professionals").update({ user_id: doctor.id }).eq("id", draId);
});

afterAll(async () => {
  await f.cleanup();
  await deleteUsers([doctor]);
});

describe("atendimento por profissional", () => {
  it("o perfil da clínica sai dos perfis das agendas ativas", async () => {
    await adminClient().from("agendas").update({ profile: "pediatric" }).eq("clinic_id", f.clinicId);
    expect(await clinicProfile()).toBe("pediatric");
    await adminClient().from("agendas").update({ profile: "adult" }).eq("id", f.ids.agendaDra2);
    expect(await clinicProfile()).toBe("mixed");
    // A agenda adulta desativada não conta.
    await adminClient().from("agendas").update({ is_active: false }).eq("id", f.ids.agendaDra2);
    expect(await clinicProfile()).toBe("pediatric");
    await adminClient().from("agendas").update({ is_active: true, profile: "pediatric" }).eq("id", f.ids.agendaDra2);
  });

  it("agenda nova começa com o perfil da clínica, 60 dias e sem idade limite", async () => {
    const a = asDb(f.admin);
    const pro = await createProfessional(a, f.clinicId, {
      userId: null,
      displayName: "Dr. Novo do Atendimento",
      profession: "Médico",
      council: null,
      councilNumber: null,
      councilState: null,
      phone: "+5584999990001",
    });
    const agenda = await createAgenda(a, f.clinicId, { kind: "professional", professionalId: pro.id, bufferMinutes: 0 });
    expect(agenda).toMatchObject({ profile: "pediatric", bookingHorizonDays: 60, consultationAgeLimitYears: null });
    expect((await agendaOfProfessional(a, f.clinicId, pro.id))?.id).toBe(agenda.id);
  });

  it("o Administrador e o profissional com login (o dele) mudam; a Recepção e o profissional (o de outro), não", async () => {
    const values = { profile: "adult" as const, bookingHorizonDays: 30, consultationAgeLimitYears: 12 };
    await updateAgendaAttendance(asDb(f.admin), f.clinicId, f.ids.agendaDra2, values);
    expect(await attendanceOf(f.ids.agendaDra2)).toEqual({ profile: "adult", booking_horizon_days: 30, consultation_age_limit_years: 12 });

    await updateAgendaAttendance(asDb(doctor), f.clinicId, f.ids.agendaDra, { ...values, consultationAgeLimitYears: null });
    expect(await attendanceOf(f.ids.agendaDra)).toEqual({ profile: "adult", booking_horizon_days: 30, consultation_age_limit_years: null });

    expect(await codeOf(() => updateAgendaAttendance(asDb(doctor), f.clinicId, f.ids.agendaDra2, { ...values, bookingHorizonDays: 90 }))).not.toBe("ok");
    expect(await codeOf(() => updateAgendaAttendance(asDb(f.reception), f.clinicId, f.ids.agendaDra, { ...values, bookingHorizonDays: 90 }))).not.toBe("ok");
    expect((await attendanceOf(f.ids.agendaDra2))!.booking_horizon_days).toBe(30);
    expect((await attendanceOf(f.ids.agendaDra))!.booking_horizon_days).toBe(30);
  });

  it("recusa prazo fora de 7 a 365 dias e idade limite inválida", async () => {
    const a = asDb(f.admin);
    expect(await codeOf(() => updateAgendaAttendance(a, f.clinicId, f.ids.agendaDra, { profile: "adult", bookingHorizonDays: 400, consultationAgeLimitYears: null }))).toBe("invalid");
    expect(await codeOf(() => updateAgendaAttendance(a, f.clinicId, f.ids.agendaDra, { profile: "adult", bookingHorizonDays: 30, consultationAgeLimitYears: 0 }))).toBe("invalid");
  });
});
