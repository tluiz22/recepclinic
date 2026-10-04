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

// Clínica A: Dr. João (login, restrito à própria agenda), Dra. Ana, agenda
// "Exames" com turma de 2 vagas às quartas 7h; recepção com todas as agendas.
// Clínica B: para isolamento.
let clinicA: string;
let clinicB: string;
let adminA: TestUser;
let receptionA: TestUser;
let drJoao: TestUser;
let adminB: TestUser;
const a = {} as Record<string, string>;
const b = {} as Record<string, string>;

// Segunda, 01/03/2027, e quarta, 03/03/2027, no fuso de Fortaleza.
const MONDAY = (time: string) => `2027-03-01T${time}:00-03:00`;
const GROUP_SLOT = "2027-03-03T07:00:00-03:00";

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await adminClient().from(table).insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function link(table: string, row: Record<string, unknown>): Promise<void> {
  const { error } = await adminClient().from(table).insert(row);
  if (error) throw error;
}

const appointment = (overrides: Record<string, unknown> = {}) => ({
  clinic_id: clinicA,
  patient_id: a.patient,
  service_id: a.consultation,
  agenda_id: a.agendaJoao,
  location_id: a.office,
  scheduled_at: MONDAY("10:00"),
  duration_minutes: 30,
  booking_channel: "admin",
  ...overrides,
});

beforeAll(async () => {
  clinicA = await createClinic("Clínica A (atendimentos)");
  clinicB = await createClinic("Clínica B (atendimentos)");
  [adminA, receptionA, drJoao, adminB] = await Promise.all([
    createUser("admin-a"),
    createUser("recep-a"),
    createUser("dr-joao"),
    createUser("admin-b"),
  ]);
  await addMember(clinicA, adminA.id, ["admin"]);
  await addMember(clinicA, receptionA.id, ["reception"]);
  await addMember(clinicA, drJoao.id, ["professional"]);
  await addMember(clinicB, adminB.id, ["admin"]);

  a.joao = await insert("professionals", { clinic_id: clinicA, user_id: drJoao.id, display_name: "Dr. João", profession: "Médico" });
  a.ana = await insert("professionals", { clinic_id: clinicA, display_name: "Dra. Ana", profession: "Psicóloga" });
  a.agendaJoao = await insert("agendas", { clinic_id: clinicA, name: "Dr. João", kind: "professional", professional_id: a.joao });
  a.agendaAna = await insert("agendas", { clinic_id: clinicA, name: "Dra. Ana", kind: "professional", professional_id: a.ana });
  a.agendaExams = await insert("agendas", { clinic_id: clinicA, name: "Exames", kind: "resource" });
  a.office = await insert("locations", { clinic_id: clinicA, name: "Consultório", type: "clinic", address: "Rua A, 1" });
  a.home = await insert("locations", { clinic_id: clinicA, name: "Domiciliar", type: "home_visit" });
  a.consultation = await insert("services", { clinic_id: clinicA, name: "Consulta", category: "consultation", duration_minutes: 30, price_cents: 25000 });
  a.therapy = await insert("services", { clinic_id: clinicA, name: "Sessão de terapia", category: "consultation", duration_minutes: 50, price_cents: 20000 });
  a.exam = await insert("services", {
    clinic_id: clinicA, name: "Espirometria", category: "exam", duration_minutes: 40, price_cents: 18000, scheduling_mode: "group",
  });
  for (const agenda of [a.agendaJoao, a.agendaAna]) {
    await link("service_agendas", { clinic_id: clinicA, service_id: a.consultation, agenda_id: agenda });
  }
  await link("service_agendas", { clinic_id: clinicA, service_id: a.therapy, agenda_id: a.agendaAna });
  await link("service_agendas", { clinic_id: clinicA, service_id: a.exam, agenda_id: a.agendaExams });
  await link("service_locations", { clinic_id: clinicA, service_id: a.consultation, location_id: a.home, price_cents: 40000 });
  await insert("availability_windows", {
    clinic_id: clinicA, agenda_id: a.agendaExams, location_id: a.office, service_id: a.exam,
    weekday: 3, start_time: "07:00", end_time: "08:00", capacity: 2,
  });
  a.unimed = await insert("insurance_plans", { clinic_id: clinicA, name: "Unimed" });
  a.contact = await insert("contacts", { clinic_id: clinicA, full_name: "Maria", phone: "+5584988880001" });
  a.patient = await insert("patients", {
    clinic_id: clinicA, contact_id: a.contact, full_name: "João Pedro", birthdate: "2019-01-01", insurance_plan_id: a.unimed,
  });
  a.patient2 = await insert("patients", { clinic_id: clinicA, contact_id: a.contact, full_name: "Ana Clara", birthdate: "2021-01-01" });
  a.patient3 = await insert("patients", { clinic_id: clinicA, contact_id: a.contact, full_name: "Lucas", birthdate: "2016-01-01" });

  b.contact = await insert("contacts", { clinic_id: clinicB, full_name: "Pedro", phone: "+5584988880002" });
  b.patient = await insert("patients", { clinic_id: clinicB, contact_id: b.contact, full_name: "Paciente B", birthdate: "2010-01-01" });
});

afterAll(async () => {
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([adminA, receptionA, drJoao, adminB]);
});

describe("trava de horário por agenda (D2)", () => {
  let first: string;

  it("marca um atendimento", async () => {
    const { data, error } = await receptionA.client.from("appointments").insert(appointment()).select("id").single();
    expect(error).toBeNull();
    first = data!.id;
  });

  it("a mesma agenda não aceita horário sobreposto", async () => {
    const { error } = await receptionA.client.from("appointments").insert(appointment({ scheduled_at: MONDAY("10:15") }));
    expect(error?.code).toBe("23P01");
  });

  it("encostado (termina quando o outro começa) pode", async () => {
    const { error } = await receptionA.client.from("appointments").insert(appointment({ scheduled_at: MONDAY("10:30") }));
    expect(error).toBeNull();
  });

  it("outra agenda, no mesmo horário, pode", async () => {
    const { error } = await receptionA.client
      .from("appointments")
      .insert(appointment({ agenda_id: a.agendaAna, patient_id: a.patient2, scheduled_at: MONDAY("10:15") }));
    expect(error).toBeNull();
  });

  it("atendimento cancelado libera o horário", async () => {
    await receptionA.client.from("appointments").update({ status: "canceled", canceled_at: new Date().toISOString(), canceled_via: "admin" }).eq("id", first);
    const { error } = await receptionA.client.from("appointments").insert(appointment({ patient_id: a.patient3 }));
    expect(error).toBeNull();
  });
});

describe("regras automáticas do atendimento", () => {
  it("preço do serviço; no local com preço próprio, o do local; recalcula ao trocar o local", async () => {
    const { data: office } = await receptionA.client
      .from("appointments")
      .insert(appointment({ scheduled_at: MONDAY("14:00") }))
      .select("id, price_cents")
      .single();
    expect(office!.price_cents).toBe(25000);

    const { data: moved } = await receptionA.client
      .from("appointments")
      .update({ location_id: a.home })
      .eq("id", office!.id)
      .select("price_cents")
      .single();
    expect(moved!.price_cents).toBe(40000);
  });

  it("preço informado na marcação é mantido", async () => {
    const { data } = await receptionA.client
      .from("appointments")
      .insert(appointment({ scheduled_at: MONDAY("15:00"), price_cents: 10000 }))
      .select("price_cents")
      .single();
    expect(data!.price_cents).toBe(10000);
  });

  it("convênio copiado do paciente na marcação; editável depois (D10)", async () => {
    const { data } = await receptionA.client
      .from("appointments")
      .insert(appointment({ scheduled_at: MONDAY("16:00") }))
      .select("id, insurance_plan_id")
      .single();
    expect(data!.insurance_plan_id).toBe(a.unimed);
    const { data: edited } = await receptionA.client
      .from("appointments")
      .update({ insurance_plan_id: null })
      .eq("id", data!.id)
      .select("insurance_plan_id")
      .single();
    expect(edited!.insurance_plan_id).toBeNull();

    const { data: privatePatient } = await receptionA.client
      .from("appointments")
      .insert(appointment({ patient_id: a.patient2, scheduled_at: MONDAY("17:00") }))
      .select("insurance_plan_id")
      .single();
    expect(privatePatient!.insurance_plan_id).toBeNull();
  });

  it("recusa agenda que não atende o serviço", async () => {
    const { error } = await receptionA.client
      .from("appointments")
      .insert(appointment({ service_id: a.therapy, agenda_id: a.agendaJoao, scheduled_at: MONDAY("18:00") }));
    expect(error?.message).toContain("não é atendido nesta agenda");
  });

  it("não liga paciente, serviço ou agenda de outra clínica", async () => {
    const { error } = await receptionA.client
      .from("appointments")
      .insert(appointment({ patient_id: b.patient, scheduled_at: MONDAY("19:00") }));
    expect(error?.code).toBe("23503");
  });
});

describe("turmas de exame", () => {
  const book = (client: TestUser["client"], patientId: string, when = GROUP_SLOT) =>
    client.rpc("book_group_session", {
      p_service_id: a.exam,
      p_agenda_id: a.agendaExams,
      p_location_id: a.office,
      p_patient_id: patientId,
      p_scheduled_at: when,
      p_booking_channel: "admin",
    });

  it("marca até lotar as vagas da janela, fora da trava de horário", async () => {
    const first = await book(receptionA.client, a.patient);
    expect(first.error).toBeNull();
    const second = await book(receptionA.client, a.patient2);
    expect(second.error).toBeNull();
    const third = await book(receptionA.client, a.patient3);
    expect(third.error?.message).toBe("slot_full");

    const { data } = await adminClient()
      .from("appointments")
      .select("is_group_session, duration_minutes, price_cents")
      .eq("id", first.data as string)
      .single();
    expect(data).toEqual({ is_group_session: true, duration_minutes: 40, price_cents: 18000 });
  });

  it("horário sem janela de turma é recusado", async () => {
    const { error } = await book(receptionA.client, a.patient3, "2027-03-03T09:00:00-03:00");
    expect(error?.message).toBe("no_window");
  });

  it("remarcar para uma turma lotada é recusado; para outra data com vaga, passa", async () => {
    const { data: other } = await book(receptionA.client, a.patient3, "2027-03-10T07:00:00-03:00");
    const full = await receptionA.client.rpc("reschedule_group_session", {
      p_appointment_id: other as string,
      p_scheduled_at: GROUP_SLOT,
      p_channel: "admin",
    });
    expect(full.error?.message).toBe("slot_full");

    const ok = await receptionA.client.rpc("reschedule_group_session", {
      p_appointment_id: other as string,
      p_scheduled_at: "2027-03-17T07:00:00-03:00",
      p_channel: "admin",
    });
    expect(ok.error).toBeNull();
    const { data } = await adminClient().from("appointments").select("scheduled_at, rescheduled_by").eq("id", other as string).single();
    expect(new Date(data!.scheduled_at).toISOString()).toBe("2027-03-17T10:00:00.000Z");
    expect(data!.rescheduled_by).toBe(receptionA.id);
  });

  it("sem acesso à agenda, não marca na turma", async () => {
    const { error } = await book(drJoao.client, a.patient3, "2027-03-24T07:00:00-03:00");
    expect(error?.code).toBe("42501");
    const fromOtherClinic = await book(adminB.client, a.patient3, "2027-03-24T07:00:00-03:00");
    expect(fromOtherClinic.error?.code).toBe("42501");
  });
});

describe("acesso pela agenda (D6 revista)", () => {
  it("o Profissional restrito vê só os atendimentos da própria agenda", async () => {
    const { data } = await drJoao.client.from("appointments").select("agenda_id");
    expect(data!.length).toBeGreaterThan(0);
    expect(new Set(data!.map((row) => row.agenda_id))).toEqual(new Set([a.agendaJoao]));
  });

  it("a Recepção vê todas as agendas", async () => {
    const { data } = await receptionA.client.from("appointments").select("agenda_id");
    expect(new Set(data!.map((row) => row.agenda_id))).toEqual(new Set([a.agendaJoao, a.agendaAna, a.agendaExams]));
  });

  it("o Profissional restrito marca na própria agenda, não na dos colegas", async () => {
    const { error: own } = await drJoao.client.from("appointments").insert(appointment({ scheduled_at: MONDAY("08:00") }));
    expect(own).toBeNull();
    const { error: other } = await drJoao.client
      .from("appointments")
      .insert(appointment({ agenda_id: a.agendaAna, scheduled_at: MONDAY("08:00") }));
    expect(other?.code).toBe("42501");
  });

  it("não move um atendimento para uma agenda sem acesso", async () => {
    const { data: own } = await drJoao.client
      .from("appointments")
      .select("id")
      .eq("scheduled_at", MONDAY("08:00"))
      .single();
    const { error } = await drJoao.client.from("appointments").update({ agenda_id: a.agendaAna }).eq("id", own!.id);
    expect(error?.code).toBe("42501");
  });

  it("a trilha segue o atendimento", async () => {
    const { data: anaAppointment } = await adminClient()
      .from("appointments")
      .select("id")
      .eq("agenda_id", a.agendaAna)
      .limit(1)
      .single();
    await link("appointment_events", { clinic_id: clinicA, appointment_id: anaAppointment!.id, event_type: "created", channel: "admin" });

    const { data: fromJoao } = await drJoao.client.from("appointment_events").select("id").eq("appointment_id", anaAppointment!.id);
    expect(fromJoao).toEqual([]);
    const { data: fromReception } = await receptionA.client.from("appointment_events").select("id").eq("appointment_id", anaAppointment!.id);
    expect(fromReception).toHaveLength(1);

    const { error } = await drJoao.client
      .from("appointment_events")
      .insert({ clinic_id: clinicA, appointment_id: anaAppointment!.id, event_type: "canceled", channel: "admin" });
    expect(error?.code).toBe("42501");
  });

  it("a trilha nunca é alterada nem apagada pela API", async () => {
    const { data: updated } = await adminA.client.from("appointment_events").update({ event_type: "canceled" }).eq("clinic_id", clinicA).select("id");
    expect(updated ?? []).toEqual([]);
    const { data: deleted } = await adminA.client.from("appointment_events").delete().eq("clinic_id", clinicA).select("id");
    expect(deleted ?? []).toEqual([]);
  });

  it("bloqueios por agenda seguem o mesmo acesso", async () => {
    await link("schedule_blocks", { clinic_id: clinicA, agenda_id: a.agendaAna, starts_at: MONDAY("12:00"), ends_at: MONDAY("13:00"), reason: "Congresso" });
    const { data: fromJoao } = await drJoao.client.from("schedule_blocks").select("id");
    expect(fromJoao).toEqual([]);
    const { error } = await drJoao.client
      .from("schedule_blocks")
      .insert({ clinic_id: clinicA, agenda_id: a.agendaJoao, starts_at: MONDAY("12:00"), ends_at: MONDAY("13:00"), reason: "Almoço" });
    expect(error).toBeNull();
  });
});

describe("séries recorrentes (D9)", () => {
  let seriesId: string;

  it("cria a série, as sessões ligadas a ela e as datas puladas", async () => {
    const { data, error } = await receptionA.client
      .from("appointment_series")
      .insert({
        clinic_id: clinicA, patient_id: a.patient2, service_id: a.therapy, agenda_id: a.agendaAna, location_id: a.office,
        interval_weeks: 1, weekday: 1, start_time: "09:00", duration_minutes: 50, starts_on: "2027-03-01", max_sessions: 4,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    seriesId = data!.id;

    for (const day of ["2027-03-01", "2027-03-15"]) {
      const { error: sessionError } = await receptionA.client.from("appointments").insert(
        appointment({
          patient_id: a.patient2, service_id: a.therapy, agenda_id: a.agendaAna, series_id: seriesId,
          scheduled_at: `${day}T09:00:00-03:00`, duration_minutes: 50,
        }),
      );
      expect(sessionError).toBeNull();
    }
    const { error: skipError } = await receptionA.client
      .from("appointment_series_skips")
      .insert({ clinic_id: clinicA, series_id: seriesId, skipped_on: "2027-03-08", reason: "conflict" });
    expect(skipError).toBeNull();

    const { data: sessions } = await receptionA.client.from("appointments").select("id").eq("series_id", seriesId);
    expect(sessions).toHaveLength(2);
  });

  it("fim por data ou por número de sessões, não os dois; o dia da semana bate com o início", async () => {
    const base = {
      clinic_id: clinicA, patient_id: a.patient2, service_id: a.therapy, agenda_id: a.agendaAna, location_id: a.office,
      start_time: "11:00", duration_minutes: 50,
    };
    const { error: both } = await receptionA.client
      .from("appointment_series")
      .insert({ ...base, weekday: 1, starts_on: "2027-03-01", ends_on: "2027-06-01", max_sessions: 10 });
    expect(both?.code).toBe("23514");
    const { error: weekday } = await receptionA.client
      .from("appointment_series")
      .insert({ ...base, weekday: 2, starts_on: "2027-03-01" });
    expect(weekday?.code).toBe("23514");
    const { error: noEnd } = await receptionA.client
      .from("appointment_series")
      .insert({ ...base, weekday: 1, starts_on: "2027-03-01", interval_weeks: 2 });
    expect(noEnd).toBeNull();
  });

  it("o Profissional sem acesso à agenda não vê a série nem as datas puladas", async () => {
    const { data: series } = await drJoao.client.from("appointment_series").select("id").eq("id", seriesId);
    expect(series).toEqual([]);
    const { data: skips } = await drJoao.client.from("appointment_series_skips").select("id").eq("series_id", seriesId);
    expect(skips).toEqual([]);
  });
});

describe("links de agendar e remarcar", () => {
  it("agenda vazia = primeiro horário disponível; remarcar exige o atendimento", async () => {
    const base = {
      clinic_id: clinicA, contact_id: a.contact, patient_id: a.patient, service_id: a.consultation,
      contact_phone: "+5584988880001", expires_at: "2027-03-01T00:00:00Z",
    };
    const { error: create } = await receptionA.client.from("booking_links").insert({ ...base, mode: "create" });
    expect(create).toBeNull();
    const { error: reschedule } = await receptionA.client.from("booking_links").insert({ ...base, mode: "reschedule" });
    expect(reschedule?.code).toBe("23514");
  });
});

describe("isolamento e credencial do bot", () => {
  it("outra clínica não vê atendimentos, séries, bloqueios, links nem trilha", async () => {
    for (const table of ["appointments", "appointment_series", "schedule_blocks", "booking_links", "appointment_events", "appointment_series_skips"]) {
      const { data } = await adminB.client.from(table).select("clinic_id");
      expect(data, table).toEqual([]);
    }
  });

  it("o bot vê e marca em todas as agendas da própria clínica", async () => {
    const service = clinicServiceClient(clinicA);
    const { data } = await service.from("appointments").select("agenda_id");
    expect(new Set(data!.map((row) => row.agenda_id))).toEqual(new Set([a.agendaJoao, a.agendaAna, a.agendaExams]));
    const { error } = await service
      .from("appointments")
      .insert(appointment({ agenda_id: a.agendaAna, scheduled_at: MONDAY("20:00"), booking_channel: "whatsapp_bot" }));
    expect(error).toBeNull();
  });

  it("o bot marca na turma da própria clínica", async () => {
    const { error } = await clinicServiceClient(clinicA).rpc("book_group_session", {
      p_service_id: a.exam, p_agenda_id: a.agendaExams, p_location_id: a.office, p_patient_id: a.patient,
      p_scheduled_at: "2027-03-31T07:00:00-03:00", p_booking_channel: "whatsapp_bot",
    });
    expect(error).toBeNull();
  });

  it("o bot de outra clínica não vê nem marca em A", async () => {
    const service = clinicServiceClient(clinicB);
    const { data } = await service.from("appointments").select("id").eq("clinic_id", clinicA);
    expect(data).toEqual([]);
    const { error } = await service.from("appointments").insert(appointment({ scheduled_at: MONDAY("21:00") }));
    expect(error?.code).toBe("42501");
  });

  it("o bot não apaga atendimentos", async () => {
    const { error } = await clinicServiceClient(clinicA).from("appointments").delete().eq("clinic_id", clinicA);
    expect(error?.code).toBe("42501");
  });
});
