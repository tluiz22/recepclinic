import type { AstroCookies } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { bookingBlock, confirmPortalBooking, setHoldPatient } from "../../src/lib/data/portal/booking";
import { ensureSession, holdSlot, readSession, sendCode, verifyCode, type PortalSession } from "../../src/lib/data/portal/identity";
import { professionalOf } from "../../src/lib/data/portal/page";
import { examProfessional, examSlug, loadPortal, professionalSlots, type PortalClinic, type PortalProfessional } from "../../src/lib/data/portal/portal";
import { addDays, todayIn } from "../../src/lib/clinicTime";
import { adminClient, clinicServiceClient } from "./helpers";
import { setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F2d da recepção digital, parte 2: exames pelo portal. O exame passa pelas telas da consulta como um "profissional"
// (agenda da equipe, todos os convênios ativos, sem idade limite); a turma tem testes próprios (portal-turma.test.ts); o mesmo exame já
// marcado impede outro, como no bot. Datas reais (a reserva vence pelo relógio do banco).

const TZ = "America/Fortaleza";
let fixture: AgendaFixture;
let service: DbClient;
let portal: PortalClinic;
let exam: PortalProfessional;
let planId: string;
const today = todayIn(TZ);
const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
const nextMonday = addDays(today, 7 - ((weekday + 6) % 7));
let phoneSeq = 0;
const newPhone = () => `+55849${String(Date.now() % 1_000_000).padStart(6, "0")}${String(++phoneSeq).padStart(2, "0")}`.slice(0, 14);

function jar(): AstroCookies {
  const values = new Map<string, string>();
  return {
    get: (name: string) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name: string, value: string) => void values.set(name, value),
  } as unknown as AstroCookies;
}

async function verified(phone: string): Promise<PortalSession> {
  const cookies = jar();
  const session = await ensureSession(service, fixture.clinicId, cookies, { ip: "200.9.7", secure: false });
  const sent = await sendCode(service, fixture.clinicId, session, phone, { ip: "200.9.7", sender: null, devMode: true });
  if (sent.status !== "sent" || !sent.devCode) throw new Error(sent.status);
  const result = await verifyCode(service, fixture.clinicId, session, sent.devCode);
  if (result.status !== "ok") throw new Error(result.status);
  return (await readSession(service, fixture.clinicId, cookies))!;
}

/** Sessão comprovada com o primeiro horário livre do exame na próxima segunda reservado. */
async function holdingExam(phone = newPhone()): Promise<{ session: PortalSession; holdId: string; phone: string }> {
  const session = await verified(phone);
  const [slot] = await professionalSlots(service, fixture.clinicId, exam, exam.consultations[0].serviceId, nextMonday, TZ);
  if (!slot) throw new Error("sem horário de exame");
  const hold = await holdSlot(service, fixture.clinicId, session.id, {
    agendaId: exam.agendaId,
    serviceId: exam.consultations[0].serviceId,
    locationId: slot.locationId,
    start: slot.start,
    end: new Date(slot.start.getTime() + exam.consultations[0].durationMinutes * 60_000),
  });
  if (hold.status !== "ok") throw new Error(hold.status);
  return { session, holdId: hold.holdId, phone };
}

const confirm = (session: PortalSession, holdId: string, insurancePlanId: string | null = null) =>
  confirmPortalBooking(service, fixture.clinicId, { sessionId: session.id, holdId, professional: exam, timeZone: TZ, insurancePlanId, entry: "clinic_link", sender: null });

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste dos exames", "849222700");
  service = clinicServiceClient(fixture.clinicId) as unknown as DbClient;
  const { data: plan, error } = await adminClient().from("insurance_plans").insert({ clinic_id: fixture.clinicId, name: "Plano dos Exames" }).select("id").single();
  if (error) throw error;
  planId = plan.id;
  // Preparo do exame (com a formatação do WhatsApp).
  await adminClient().from("services").update({ preparation_instructions: "Jejum de *8 horas*." }).eq("id", fixture.ids.exame);
  const loaded = await loadPortal(service, fixture.clinicId, "x");
  if (loaded.status !== "open") throw new Error("portal indisponível");
  portal = loaded;
  exam = examProfessional(portal, portal.exams[0])!;
});

afterAll(async () => {
  await fixture?.cleanup();
});

describe("exames pelo portal", () => {
  it("lista os exames da agenda da equipe, com preparo, e os resolve pelo endereço", () => {
    // A turma entra desde a F3e-2 (portal-turma.test.ts).
    expect(portal.exams.map((e) => e.name)).toEqual(["Exame", "Turma"]);
    expect(portal.exams[0]).toMatchObject({ serviceId: fixture.ids.exame, slug: examSlug(fixture.ids.exame), preparation: "Jejum de *8 horas*.", hasPreparationFile: false, isGroup: false });
    expect(exam).toMatchObject({ agendaId: fixture.ids.agendaExams, acceptsPrivate: true, ageLimitYears: null, privatePriceCents: 15000, name: "Exame" });
    // Todos os convênios ativos (agenda sem profissional, como o bot).
    expect(exam.plans.map((p) => p.id)).toContain(planId);
    expect(professionalOf(portal, examSlug(fixture.ids.exame).toUpperCase())?.exam?.serviceId).toBe(fixture.ids.exame);
    expect(professionalOf(portal, "exame-00000000")).toBeNull();
  });

  it("sem o item Exames e procedimentos, o portal não mostra exames", async () => {
    const { data: keys } = await adminClient().from("features").select("key");
    const all = (keys ?? []).map((r) => r.key as string);
    await adminClient().rpc("set_clinic_features", { p_clinic_id: fixture.clinicId, p_features: all.filter((k) => k !== "exams") });
    try {
      const off = await loadPortal(service, fixture.clinicId, "x");
      expect(off.status === "open" && off.exams).toEqual([]);
    } finally {
      await adminClient().rpc("set_clinic_features", { p_clinic_id: fixture.clinicId, p_features: all });
    }
  });

  it("marca o exame pelo convênio, para um cadastro novo, e o mesmo exame não se marca de novo", async () => {
    const { session, holdId, phone } = await holdingExam();
    expect(await setHoldPatient(service, fixture.clinicId, session.id, holdId, { newPatient: { for: "self", name: "Exame Novo Souza", birthdate: "1980-01-01", contactName: null } })).toBe(true);
    const outcome = await confirm(session, holdId, planId);
    expect(outcome.status).toBe("booked");
    const appointmentId = (outcome as { appointmentId: string }).appointmentId;
    const { data: appointment } = await adminClient()
      .from("appointments")
      .select("agenda_id, service_id, booking_channel, insurance_plan_id, patient_id, services ( category )")
      .eq("id", appointmentId)
      .single();
    expect(appointment).toMatchObject({ agenda_id: fixture.ids.agendaExams, service_id: fixture.ids.exame, booking_channel: "portal", insurance_plan_id: planId, services: { category: "exam" } });

    // Outro dia, o mesmo exame para o mesmo paciente: "já tem o exame marcado".
    const block = await bookingBlock(service, fixture.clinicId, { professional: exam, phone, patient: { id: appointment!.patient_id, birthdate: "1980-01-01" }, isNew: false, timeZone: TZ });
    expect(block?.kind).toBe("already");
  });

  it("a reserva de um exame não se marca na tela de outro exame (mesma agenda da equipe)", async () => {
    const { data: other, error } = await adminClient()
      .from("services")
      .insert({ clinic_id: fixture.clinicId, name: "Outro Exame", category: "exam", duration_minutes: 20, price_cents: 9000, scheduling_mode: "individual", is_team: true })
      .select("id")
      .single();
    if (error) throw error;
    await adminClient().from("service_locations").upsert({ clinic_id: fixture.clinicId, service_id: other.id, location_id: fixture.ids.office });
    const window = await adminClient()
      .from("availability_windows")
      .insert({ clinic_id: fixture.clinicId, agenda_id: fixture.ids.agendaExams, location_id: fixture.ids.office, service_id: other.id, weekday: 2, start_time: "08:00", end_time: "09:00" });
    if (window.error) throw window.error;
    const reloaded = await loadPortal(service, fixture.clinicId, "x");
    if (reloaded.status !== "open") throw new Error("portal indisponível");
    const otherExam = examProfessional(reloaded, reloaded.exams.find((e) => e.serviceId === other.id)!)!;
    expect(otherExam.locations.map((l) => l.id)).toEqual([fixture.ids.office]);

    const { session, holdId } = await holdingExam();
    await setHoldPatient(service, fixture.clinicId, session.id, holdId, { newPatient: { for: "self", name: "Troca Exame Lima", birthdate: "1985-01-01", contactName: null } });
    const outcome = await confirmPortalBooking(service, fixture.clinicId, { sessionId: session.id, holdId, professional: otherExam, timeZone: TZ, insurancePlanId: null, entry: "clinic_link", sender: null });
    expect(outcome.status).toBe("expired");
  });

  it("idade não limita o exame (a agenda da equipe não tem idade limite)", async () => {
    const block = await bookingBlock(service, fixture.clinicId, { professional: exam, phone: newPhone(), patient: { id: null, birthdate: "1930-01-01" }, isNew: true, timeZone: TZ });
    expect(block).toBeNull();
  });
});
