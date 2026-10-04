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

// Clínica A: agendas Dr. João (login restrito), Dra. Ana e Dr. Pedro, todas com
// "Consulta". Há gente esperando nas agendas do Dr. João e da Dra. Ana; ninguém
// na do Dr. Pedro.
let clinicA: string;
let clinicB: string;
let receptionA: TestUser;
let drJoao: TestUser;
let adminB: TestUser;
const a = {} as Record<string, string>;

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await adminClient().from(table).insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}

let minute = 0;
// Horários distintos em março de 2027 (bem mais de 2h no futuro).
const nextSlot = () => {
  const date = new Date(Date.UTC(2027, 2, 1, 11, 0));
  date.setUTCMinutes(date.getUTCMinutes() + 60 * minute++);
  return date.toISOString();
};

const book = (agendaId: string, overrides: Record<string, unknown> = {}) =>
  insert("appointments", {
    clinic_id: clinicA, patient_id: a.patient, service_id: a.consultation, agenda_id: agendaId,
    location_id: a.office, scheduled_at: nextSlot(), duration_minutes: 30, booking_channel: "admin", ...overrides,
  });

const cancel = (id: string, extra: Record<string, unknown> = {}) =>
  adminClient().from("appointments").update({ status: "canceled", canceled_at: new Date().toISOString(), ...extra }).eq("id", id);

const openingsFrom = async (appointmentId: string) => {
  const { data } = await adminClient()
    .from("waitlist_openings")
    .select("reason, agenda_id, service_id, slot_scheduled_at, status")
    .eq("opened_by_appointment_id", appointmentId);
  return data!;
};

beforeAll(async () => {
  clinicA = await createClinic("Clínica A (lista de espera)");
  clinicB = await createClinic("Clínica B (lista de espera)");
  [receptionA, drJoao, adminB] = await Promise.all([createUser("recep-a"), createUser("dr-joao"), createUser("admin-b")]);
  await addMember(clinicA, receptionA.id, ["reception"]);
  await addMember(clinicA, drJoao.id, ["professional"]);
  await addMember(clinicB, adminB.id, ["admin"]);

  a.joao = await insert("professionals", { clinic_id: clinicA, user_id: drJoao.id, display_name: "Dr. João", profession: "Médico" });
  a.ana = await insert("professionals", { clinic_id: clinicA, display_name: "Dra. Ana", profession: "Médica" });
  a.pedro = await insert("professionals", { clinic_id: clinicA, display_name: "Dr. Pedro", profession: "Médico" });
  a.agendaJoao = await insert("agendas", { clinic_id: clinicA, name: "Dr. João", kind: "professional", professional_id: a.joao });
  a.agendaAna = await insert("agendas", { clinic_id: clinicA, name: "Dra. Ana", kind: "professional", professional_id: a.ana });
  a.agendaPedro = await insert("agendas", { clinic_id: clinicA, name: "Dr. Pedro", kind: "professional", professional_id: a.pedro });
  a.office = await insert("locations", { clinic_id: clinicA, name: "Consultório", type: "clinic" });
  a.consultation = await insert("services", { clinic_id: clinicA, name: "Consulta", category: "consultation", duration_minutes: 30, price_cents: 0 });
  a.therapy = await insert("services", { clinic_id: clinicA, name: "Terapia", category: "consultation", duration_minutes: 50, price_cents: 0 });
  for (const agenda of [a.agendaJoao, a.agendaAna, a.agendaPedro]) {
    await adminClient().from("service_agendas").insert({ clinic_id: clinicA, service_id: a.consultation, agenda_id: agenda });
  }
  await adminClient().from("service_agendas").insert({ clinic_id: clinicA, service_id: a.therapy, agenda_id: a.agendaJoao });
  a.contact = await insert("contacts", { clinic_id: clinicA, full_name: "Maria", phone: "+5584977770001" });
  a.patient = await insert("patients", { clinic_id: clinicA, contact_id: a.contact, full_name: "Paciente", birthdate: "2015-01-01" });

  // Quem espera: um atendimento do Dr. João e um da Dra. Ana, ambos de Consulta.
  a.waitingJoao = await book(a.agendaJoao);
  a.waitingAna = await book(a.agendaAna);
  a.entryJoao = await insert("waitlist_entries", { clinic_id: clinicA, appointment_id: a.waitingJoao });
  a.entryAna = await insert("waitlist_entries", { clinic_id: clinicA, appointment_id: a.waitingAna });
});

afterAll(async () => {
  await deleteClinics([clinicA, clinicB]);
  await deleteUsers([receptionA, drJoao, adminB]);
});

describe("abertura de vaga (gatilho)", () => {
  it("cancelar na agenda com gente esperando abre a vaga com serviço, agenda e horário", async () => {
    const id = await book(a.agendaJoao);
    const { data: before } = await adminClient().from("appointments").select("scheduled_at").eq("id", id).single();
    await cancel(id);
    const openings = await openingsFrom(id);
    expect(openings).toHaveLength(1);
    expect(openings[0]).toMatchObject({ reason: "canceled", agenda_id: a.agendaJoao, service_id: a.consultation, status: "open" });
    expect(new Date(openings[0].slot_scheduled_at).getTime()).toBe(new Date(before!.scheduled_at).getTime());
  });

  it("agenda sem ninguém esperando não abre vaga, mesmo com fila em outra agenda (D2 revista)", async () => {
    const id = await book(a.agendaPedro);
    await cancel(id);
    expect(await openingsFrom(id)).toEqual([]);
  });

  it("outro serviço na mesma agenda não abre vaga para quem espera Consulta", async () => {
    const id = await book(a.agendaJoao, { service_id: a.therapy, duration_minutes: 50 });
    await cancel(id);
    expect(await openingsFrom(id)).toEqual([]);
  });

  it("remarcar abre a vaga do horário antigo", async () => {
    const id = await book(a.agendaAna);
    await adminClient().from("appointments").update({ scheduled_at: nextSlot() }).eq("id", id);
    const openings = await openingsFrom(id);
    expect(openings).toHaveLength(1);
    expect(openings[0]).toMatchObject({ reason: "rescheduled", agenda_id: a.agendaAna });
  });

  it("cancelamento em massa não abre vaga", async () => {
    const id = await book(a.agendaJoao);
    await cancel(id, { mass_canceled: true });
    expect(await openingsFrom(id)).toEqual([]);
  });

  it("com menos de 2h de antecedência não abre vaga", async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const id = await book(a.agendaJoao, { scheduled_at: soon });
    await cancel(id);
    expect(await openingsFrom(id)).toEqual([]);
  });
});

describe("fim do atendimento de quem espera", () => {
  it("encerra a inscrição, retira a oferta pendente e a vaga volta a abrir", async () => {
    const source = await book(a.agendaAna);
    await cancel(source);
    const [opening] = (await adminClient().from("waitlist_openings").select("id").eq("opened_by_appointment_id", source)).data!;
    await adminClient().from("waitlist_openings").update({ status: "offering" }).eq("id", opening.id);
    const offer = await insert("waitlist_offers", {
      clinic_id: clinicA, entry_id: a.entryAna, appointment_id: a.waitingAna, opening_id: opening.id,
      slot_scheduled_at: nextSlot(), slot_location_id: a.office, slot_duration_minutes: 30,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });

    await adminClient().from("appointments").update({ status: "completed" }).eq("id", a.waitingAna);

    const { data: entry } = await adminClient().from("waitlist_entries").select("status, ended_reason").eq("id", a.entryAna).single();
    expect(entry).toEqual({ status: "closed", ended_reason: "completed" });
    const { data: offerRow } = await adminClient().from("waitlist_offers").select("status, details").eq("id", offer).single();
    expect(offerRow!.status).toBe("withdrawn");
    expect(offerRow!.details).toEqual({ reason: "appointment_completed" });
    const { data: openingRow } = await adminClient().from("waitlist_openings").select("status").eq("id", opening.id).single();
    expect(openingRow!.status).toBe("open");
  });
});

describe("regras da fila", () => {
  it("um atendimento fica na fila uma vez só", async () => {
    const { error } = await receptionA.client.from("waitlist_entries").insert({ clinic_id: clinicA, appointment_id: a.waitingJoao });
    expect(error?.code).toBe("23505");
  });

  it("uma oferta pendente por vaga e por pessoa", async () => {
    const source = await book(a.agendaJoao);
    await cancel(source);
    const [opening] = (await adminClient().from("waitlist_openings").select("id").eq("opened_by_appointment_id", source)).data!;
    const offer = {
      clinic_id: clinicA, entry_id: a.entryJoao, appointment_id: a.waitingJoao, opening_id: opening.id,
      slot_scheduled_at: nextSlot(), slot_location_id: a.office, slot_duration_minutes: 30,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    const service = clinicServiceClient(clinicA);
    const { error: first } = await service.from("waitlist_offers").insert(offer);
    expect(first).toBeNull();
    const { error: second } = await service.from("waitlist_offers").insert(offer);
    expect(second?.code).toBe("23505");
  });

  it("sessão de série não entra na fila (D9)", async () => {
    const series = await insert("appointment_series", {
      clinic_id: clinicA, patient_id: a.patient, service_id: a.consultation, agenda_id: a.agendaJoao, location_id: a.office,
      weekday: 1, start_time: "09:00", duration_minutes: 30, starts_on: "2027-03-01",
    });
    const session = await book(a.agendaJoao, { series_id: series });
    const { error } = await receptionA.client.from("waitlist_entries").insert({ clinic_id: clinicA, appointment_id: session });
    expect(error?.message).toContain("Sessão de série não entra na lista de espera");
  });

  it("a tela não grava vagas nem ofertas e não apaga a fila", async () => {
    const { error: opening } = await receptionA.client.from("waitlist_openings").insert({
      clinic_id: clinicA, reason: "canceled", service_id: a.consultation, agenda_id: a.agendaJoao,
      slot_scheduled_at: nextSlot(), slot_location_id: a.office, slot_duration_minutes: 30,
    });
    expect(opening?.code).toBe("42501");
    const { error: remove } = await receptionA.client.from("waitlist_entries").delete().eq("id", a.entryJoao);
    expect(remove?.code).toBe("42501");
  });
});

describe("acesso", () => {
  it("o Profissional restrito vê só a fila, as vagas e as ofertas da própria agenda", async () => {
    const { data: entries } = await drJoao.client.from("waitlist_entries").select("id");
    expect(entries!.map((row) => row.id)).toEqual([a.entryJoao]);
    const { data: openings } = await drJoao.client.from("waitlist_openings").select("agenda_id");
    expect(openings!.length).toBeGreaterThan(0);
    expect(new Set(openings!.map((row) => row.agenda_id))).toEqual(new Set([a.agendaJoao]));
    const { data: offers } = await drJoao.client.from("waitlist_offers").select("appointment_id");
    expect(new Set(offers!.map((row) => row.appointment_id))).toEqual(new Set([a.waitingJoao]));
  });

  it("a Recepção vê a fila de todas as agendas", async () => {
    const { data } = await receptionA.client.from("waitlist_entries").select("id");
    expect(data!.map((row) => row.id).sort()).toEqual([a.entryJoao, a.entryAna].sort());
  });

  it("outra clínica não vê nada", async () => {
    for (const table of ["waitlist_entries", "waitlist_openings", "waitlist_offers"]) {
      const { data } = await adminB.client.from(table).select("id");
      expect(data, table).toEqual([]);
      const { data: fromBot } = await clinicServiceClient(clinicB).from(table).select("id");
      expect(fromBot, table).toEqual([]);
    }
  });

  it("o bot/agendador atualiza a vaga e a oferta da própria clínica", async () => {
    const service = clinicServiceClient(clinicA);
    const { data: offers } = await service.from("waitlist_offers").update({ status: "declined", responded_at: new Date().toISOString() }).eq("status", "pending").select("id");
    expect(offers!.length).toBeGreaterThan(0);
    const { data: openings } = await service.from("waitlist_openings").update({ status: "closed", closed_reason: "teste" }).eq("status", "open").select("id");
    expect(openings!.length).toBeGreaterThan(0);
  });

  it("a trilha aceita os eventos da lista de espera", async () => {
    // Insert de várias linhas manda null nas colunas ausentes de alguma linha: `details` vai em todas.
    const { error } = await clinicServiceClient(clinicA).from("appointment_events").insert([
      { clinic_id: clinicA, appointment_id: a.waitingJoao, event_type: "waitlist_joined", channel: "whatsapp_bot", details: {} },
      { clinic_id: clinicA, appointment_id: a.waitingJoao, event_type: "waitlist_advanced", channel: "whatsapp_bot", details: { from: "a", to: "b" } },
      { clinic_id: clinicA, appointment_id: a.waitingJoao, event_type: "waitlist_left", channel: "admin", details: { reason: "removed" } },
    ]);
    expect(error).toBeNull();
  });
});
