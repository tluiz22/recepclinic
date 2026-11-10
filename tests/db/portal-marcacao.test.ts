import type { AstroCookies } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { bookingBlock, confirmPortalBooking, findDuplicate, loadHold, loadHoldById, phonePatients, setHoldPatient } from "../../src/lib/data/portal/booking";
import { ensureSession, holdSlot, readSession, sendCode, verifyCode, type PortalSession } from "../../src/lib/data/portal/identity";
import { loadPortal, type PortalProfessional } from "../../src/lib/data/portal/portal";
import { listOpenBirthdateChecks, resolveBirthdateCheck } from "../../src/lib/data/portalBirthdate";
import { countBotNewPatients } from "../../src/lib/data/whatsapp/botLimits";
import { dispatchNotice, enqueueNotice, runNoticeQueue } from "../../src/lib/data/whatsapp/noticeQueue";
import { registerPatient } from "../../src/lib/data/patients";
import { todayIn } from "../../src/lib/clinicTime";
import { adminClient, clinicServiceClient, createClinic, createUser, addMember, deleteClinics, deleteUsers, type TestUser } from "./helpers";
import { asDb, at, MON1, MON2, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F2c da recepção digital: quem será atendido, a marcação pelo portal (uma vez só), a origem, a data de nascimento a
// conferir e a fila da confirmação.

const TZ = "America/Fortaleza";
let fixture: AgendaFixture;
let service: DbClient;
let otherClinic: string;
let outsider: TestUser;
let dra: PortalProfessional;
const today = todayIn(TZ);
const yearsAgo = (n: number) => `${Number(today.slice(0, 4)) - n}${today.slice(4)}`;
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
  const session = await ensureSession(service, fixture.clinicId, cookies, { ip: "200.9.9", secure: false });
  const sent = await sendCode(service, fixture.clinicId, session, phone, { ip: "200.9.9", sender: null, devMode: true });
  if (sent.status !== "sent" || !sent.devCode) throw new Error(sent.status);
  const result = await verifyCode(service, fixture.clinicId, session, sent.devCode);
  if (result.status !== "ok") throw new Error(result.status);
  return (await readSession(service, fixture.clinicId, cookies))!;
}

/** Sessão comprovada com o horário reservado. */
async function holding(time: string, phone = newPhone(), date = MON1): Promise<{ session: PortalSession; holdId: string; phone: string }> {
  const session = await verified(phone);
  const start = at(date, time);
  const hold = await holdSlot(service, fixture.clinicId, session.id, {
    agendaId: dra.agendaId,
    serviceId: dra.consultations[0].serviceId,
    locationId: dra.locations[0].id,
    start,
    end: new Date(start.getTime() + 30 * 60_000),
  });
  if (hold.status !== "ok") throw new Error(hold.status);
  return { session, holdId: hold.holdId, phone };
}

const confirm = (session: PortalSession, holdId: string, professional = dra) =>
  confirmPortalBooking(service, fixture.clinicId, {
    sessionId: session.id,
    holdId,
    professional,
    timeZone: TZ,
    insurancePlanId: null,
    entry: "professional_link",
    sender: null,
  });

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da marcação", "849222900");
  service = clinicServiceClient(fixture.clinicId) as unknown as DbClient;
  otherClinic = await createClinic("Outra clínica (marcação)");
  outsider = await createUser("marcacao-de-fora");
  await addMember(otherClinic, outsider.id, ["reception"]);
  const portal = await loadPortal(service, fixture.clinicId, "x");
  if (portal.status !== "open") throw new Error("portal indisponível");
  dra = portal.professionals.find((p) => p.name === "Dra. Agenda")!;
});

afterAll(async () => {
  await fixture?.cleanup();
  await deleteClinics([otherClinic]);
  await deleteUsers([outsider]);
});

describe("marcar pelo portal", () => {
  it("cadastro novo para si: marca pelo canal do portal, com a origem, e põe a confirmação na fila", async () => {
    const { session, holdId, phone } = await holding("08:00");
    expect(await setHoldPatient(service, fixture.clinicId, session.id, holdId, { newPatient: { for: "self", name: "Paula Nova Silva", birthdate: yearsAgo(30), contactName: null } })).toBe(true);
    const outcome = await confirm(session, holdId);
    expect(outcome.status).toBe("booked");
    const appointmentId = (outcome as { appointmentId: string }).appointmentId;

    const db = adminClient();
    const { data: appointment } = await db.from("appointments").select("booking_channel, portal_entry, patient_id, scheduled_at").eq("id", appointmentId).single();
    expect(appointment).toMatchObject({ booking_channel: "portal", portal_entry: "professional_link" });
    const { data: patient } = await db.from("patients").select("full_name, created_via, is_contact_self, contacts ( phone )").eq("id", appointment!.patient_id).single();
    expect(patient).toMatchObject({ full_name: "Paula Nova Silva", created_via: "portal", is_contact_self: true, contacts: { phone } });
    const { data: queue } = await db.from("notice_queue").select("kind, status").eq("appointment_id", appointmentId);
    // Sem quem envie agora, a linha fica pendente para a rotina.
    expect(queue).toEqual([{ kind: "confirmation", status: "pending" }]);

    // Recarregar a revisão ou a confirmação: o mesmo atendimento, sem marcar de novo.
    expect(await confirm(session, holdId)).toEqual({ status: "booked", appointmentId });
    const hold = await loadHold(service, fixture.clinicId, session.id, holdId);
    expect(hold).toMatchObject({ state: "booked", appointmentId });
    // "Adicionar à agenda" (.ics): no iPhone o Calendário baixa sem o cookie da sessão; vale pelo id da reserva.
    expect(await loadHold(service, fixture.clinicId, "00000000-0000-4000-8000-000000000000", holdId)).toBeNull();
    expect(await loadHoldById(service, fixture.clinicId, holdId)).toMatchObject({ state: "booked", appointmentId });
    expect(await loadHoldById(service, fixture.clinicId, "nao-e-um-id")).toBeNull();
    const { count } = await db.from("appointments").select("id", { count: "exact", head: true }).eq("patient_id", appointment!.patient_id);
    expect(count).toBe(1);
    // Conta no limite de pacientes novos do telefone, como o bot.
    const contact = (await phonePatients(service, fixture.clinicId, phone)).contact!;
    expect(await countBotNewPatients(service, fixture.clinicId, contact.id)).toBe(1);
  });

  it("duplo toque: duas marcações ao mesmo tempo criam um atendimento só", async () => {
    const { session, holdId } = await holding("08:30");
    await setHoldPatient(service, fixture.clinicId, session.id, holdId, { newPatient: { for: "self", name: "Duplo Toque Lima", birthdate: yearsAgo(40), contactName: null } });
    const results = await Promise.all([confirm(session, holdId), confirm(session, holdId)]);
    const booked = results.filter((r) => r.status === "booked");
    expect(booked.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status === "booked" || r.status === "confirming")).toBe(true);
    const { count } = await adminClient().from("appointments").select("id", { count: "exact", head: true }).eq("scheduled_at", at(MON1, "08:30").toISOString()).eq("agenda_id", dra.agendaId).neq("status", "canceled");
    expect(count).toBe(1);
  });

  it("outra pessoa com o celular novo: o responsável é quem tem o celular", async () => {
    const { session, holdId, phone } = await holding("09:00");
    await setHoldPatient(service, fixture.clinicId, session.id, holdId, { newPatient: { for: "other", name: "Bebê Souza Lima", birthdate: yearsAgo(2), contactName: "Mãe Souza Lima" } });
    expect((await confirm(session, holdId)).status).toBe("booked");
    const { contact, patients } = await phonePatients(service, fixture.clinicId, phone);
    expect(contact?.fullName).toBe("Mãe Souza Lima");
    expect(patients.map((p) => [p.fullName, p.isContactSelf])).toEqual([["Bebê Souza Lima", false]]);
  });

  it("horário tomado pela recepção antes de confirmar: volta aos horários", async () => {
    const { session, holdId, phone } = await holding("09:30");
    await setHoldPatient(service, fixture.clinicId, session.id, holdId, { newPatient: { for: "self", name: "Tomado Ramos", birthdate: yearsAgo(33), contactName: null } });
    const other = await registerPatient(asDb(fixture.reception), fixture.clinicId, { fullName: "Outra Pessoa Ramos", birthdate: yearsAgo(50), contact: { mode: "self", phone: newPhone() } }, today);
    if (other.status !== "created") throw new Error(other.status);
    await bookAppointment(asDb(fixture.reception), fixture.clinicId, {
      patientId: other.patient.id,
      serviceId: dra.consultations[0].serviceId,
      agendaId: dra.agendaId,
      start: at(MON1, "09:30"),
      locationId: dra.locations[0].id,
      channel: "admin",
      actorId: fixture.reception.id,
      anyTime: true,
      acceptedWarnings: true,
    });
    expect(await confirm(session, holdId)).toEqual({ status: "taken" });
    // O cadastro novo foi gravado, mas não marcou (o celular volta a escolher o horário).
    expect((await loadHold(service, fixture.clinicId, session.id, holdId))?.state).toBe("gone");
    expect((await phonePatients(service, fixture.clinicId, phone)).patients).toHaveLength(1);
  });

  it("particular sai sem o convênio do cadastro; nova tentativa depois de falha não cadastra de novo", async () => {
    const phone = newPhone();
    const time = "08:00";
    const { session, holdId } = await holding(time, phone, MON2);
    const db = adminClient();
    const { data: plan } = await db.from("insurance_plans").insert({ clinic_id: fixture.clinicId, name: `Plano F2c ${Date.now()}` }).select("id").single();
    await setHoldPatient(service, fixture.clinicId, session.id, holdId, { newPatient: { for: "self", name: "Particular Sem Plano", birthdate: yearsAgo(31), contactName: null } });
    // Primeira tentativa: o horário não existe mais na agenda (falha depois do cadastro).
    await db.from("slot_holds").update({ starts_at: at(MON1, "03:00").toISOString(), ends_at: at(MON1, "03:30").toISOString() }).eq("id", holdId);
    expect((await confirm(session, holdId)).status).not.toBe("booked");
    const after = await loadHold(service, fixture.clinicId, session.id, holdId);
    expect(after?.patientId).not.toBeNull();
    expect(after?.newPatient).toBeNull();
    await db.from("patients").update({ insurance_plan_id: plan!.id }).eq("id", after!.patientId!);
    await db.from("slot_holds").update({ starts_at: at(MON2, time).toISOString(), ends_at: new Date(at(MON2, time).getTime() + 30 * 60_000).toISOString(), released_at: null, confirming_at: null }).eq("id", holdId);
    const outcome = await confirm(session, holdId);
    expect(outcome.status).toBe("booked");
    const { data: appointment } = await db.from("appointments").select("insurance_plan_id").eq("id", (outcome as { appointmentId: string }).appointmentId).single();
    expect(appointment?.insurance_plan_id).toBeNull();
    expect((await phonePatients(service, fixture.clinicId, phone)).patients).toHaveLength(1);
  });

  it("reserva vencida ou de outra sessão não marca", async () => {
    const { session, holdId } = await holding("10:00");
    await setHoldPatient(service, fixture.clinicId, session.id, holdId, { newPatient: { for: "self", name: "Vencida Costa", birthdate: yearsAgo(25), contactName: null } });
    const stranger = await verified(newPhone());
    expect(await confirm(stranger, holdId)).toEqual({ status: "expired" });
    await adminClient().from("slot_holds").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", holdId);
    expect(await confirm(session, holdId)).toEqual({ status: "expired" });
    expect(await setHoldPatient(service, fixture.clinicId, session.id, holdId, { patientId: "00000000-0000-0000-0000-000000000000" })).toBe(false);
  });
});

describe("quem será atendido", () => {
  it("paciente do celular: duplicado pelo nome parecido, data a conferir e a correção pela recepção", async () => {
    const phone = newPhone();
    const created = await registerPatient(asDb(fixture.reception), fixture.clinicId, { fullName: "João Souza Lima", birthdate: yearsAgo(7), contact: { mode: "new", fullName: "Maria Souza", phone } }, today);
    if (created.status !== "created") throw new Error(created.status);
    const { session, holdId } = await holding("10:30", phone);
    const { contact, patients } = await phonePatients(service, fixture.clinicId, phone);
    expect(patients.map((p) => p.fullName)).toEqual(["João Souza Lima"]);

    const typed = yearsAgo(8);
    const match = await findDuplicate(service, fixture.clinicId, contact!.id, { name: "Joao Souza Lima", birthdate: typed }, patients);
    expect(match).toMatchObject({ id: created.patient.id, sameBirthdate: false });
    const same = await findDuplicate(service, fixture.clinicId, contact!.id, { name: "João Souza Lima", birthdate: yearsAgo(7) }, patients);
    expect(same?.sameBirthdate).toBe(true);
    expect(await findDuplicate(service, fixture.clinicId, contact!.id, { name: "Pedro Alves", birthdate: typed }, patients)).toBeNull();

    // "É a mesma, mas a data certa é…": marca no cadastro existente e a recepção confere a data.
    await setHoldPatient(service, fixture.clinicId, session.id, holdId, { patientId: created.patient.id, informedBirthdate: typed });
    const outcome = await confirm(session, holdId);
    expect(outcome.status).toBe("booked");
    const checks = await listOpenBirthdateChecks(asDb(fixture.reception), fixture.clinicId, [created.patient.id]);
    const check = checks.get(created.patient.id)!;
    expect(check).toMatchObject({ registered: yearsAgo(7), informed: typed });

    // Outra clínica não resolve; a recepção corrige e o aviso some.
    await expect(resolveBirthdateCheck(asDb(outsider), check.id, "corrected")).rejects.toThrow();
    await resolveBirthdateCheck(asDb(fixture.reception), check.id, "corrected");
    const { data: patient } = await adminClient().from("patients").select("birthdate").eq("id", created.patient.id).single();
    expect(patient?.birthdate).toBe(typed);
    expect((await listOpenBirthdateChecks(asDb(fixture.reception), fixture.clinicId, [created.patient.id])).size).toBe(0);
  });

  it("consulta já marcada com o mesmo médico e a idade limite impedem marcar", async () => {
    const phone = newPhone();
    const created = await registerPatient(asDb(fixture.reception), fixture.clinicId, { fullName: "Carla Marcada Reis", birthdate: yearsAgo(20), contact: { mode: "self", phone } }, today);
    if (created.status !== "created") throw new Error(created.status);
    const input = { professional: dra, phone, patient: { id: created.patient.id, birthdate: yearsAgo(20) }, isNew: false, timeZone: TZ };
    expect(await bookingBlock(service, fixture.clinicId, input)).toBeNull();
    await bookAppointment(asDb(fixture.reception), fixture.clinicId, {
      patientId: created.patient.id,
      serviceId: dra.consultations[0].serviceId,
      agendaId: dra.agendaId,
      start: at(MON1, "14:00"),
      locationId: dra.locations[0].id,
      channel: "admin",
      actorId: fixture.reception.id,
      anyTime: true,
      acceptedWarnings: true,
    });
    expect((await bookingBlock(service, fixture.clinicId, input))?.kind).toBe("already");
    expect(await bookingBlock(service, fixture.clinicId, { ...input, professional: { ...dra, ageLimitYears: 14 }, patient: { id: null, birthdate: yearsAgo(20) }, isNew: true })).toEqual({ kind: "age", limit: 14 });
  });
});

describe("fila da confirmação", () => {
  it("o mesmo atendimento e tipo entram uma vez e saem uma vez", async () => {
    const { session, holdId } = await holding("11:00");
    await setHoldPatient(service, fixture.clinicId, session.id, holdId, { newPatient: { for: "self", name: "Fila Única Melo", birthdate: yearsAgo(45), contactName: null } });
    const { appointmentId } = (await confirm(session, holdId)) as { appointmentId: string };
    await enqueueNotice(service, fixture.clinicId, appointmentId, "confirmation");
    const { data: rows } = await adminClient().from("notice_queue").select("id, status").eq("appointment_id", appointmentId);
    expect(rows).toHaveLength(1);
    // A linha ficou pendente (sem quem envie): o primeiro envio toma, o segundo não.
    expect(await dispatchNotice(service, fixture.clinicId, appointmentId, "confirmation", null)).toBe(true);
    expect(await dispatchNotice(service, fixture.clinicId, appointmentId, "confirmation", null)).toBe(false);
  });

  it("a rotina manda o pendente e deixa de lado o que travou no envio", async () => {
    const { session, holdId } = await holding("11:30");
    await setHoldPatient(service, fixture.clinicId, session.id, holdId, { newPatient: { for: "self", name: "Rotina Pendente Dias", birthdate: yearsAgo(52), contactName: null } });
    const { appointmentId } = (await confirm(session, holdId)) as { appointmentId: string };
    const db = adminClient();
    await db.from("notice_queue").update({ status: "pending", claimed_at: null, finished_at: null, created_at: new Date(Date.now() - 60_000).toISOString() }).eq("appointment_id", appointmentId);
    expect((await runNoticeQueue(service, fixture.clinicId, null)).sent).toBeGreaterThanOrEqual(1);
    const { data: sent } = await db.from("notice_queue").select("status").eq("appointment_id", appointmentId).single();
    expect(sent?.status).toBe("not_connected");

    await db.from("notice_queue").update({ status: "sending", claimed_at: new Date(Date.now() - 11 * 60_000).toISOString(), finished_at: null }).eq("appointment_id", appointmentId);
    expect((await runNoticeQueue(service, fixture.clinicId, null)).abandoned).toBe(1);
    const { data: stuck } = await db.from("notice_queue").select("status").eq("appointment_id", appointmentId).single();
    expect(stuck?.status).toBe("abandoned");
  });

  it("a equipe não grava na fila nem nas datas a conferir; outra clínica não lê", async () => {
    const reception = asDb(fixture.reception);
    const { error } = await reception.from("notice_queue").insert({ clinic_id: fixture.clinicId, appointment_id: "00000000-0000-0000-0000-000000000000", kind: "confirmation" });
    expect(error).not.toBeNull();
    const { data } = await asDb(outsider).from("portal_birthdate_checks").select("id").eq("clinic_id", fixture.clinicId);
    expect(data).toEqual([]);
  });
});
