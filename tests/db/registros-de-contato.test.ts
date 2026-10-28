import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import type { DbClient } from "../../src/lib/data/clients";
import { listInteractions, registerContact, resolveRegisterTarget, type RegisterRequest } from "../../src/lib/data/contactInteractions";
import { anonymizePatient, getPatient, updatePatient } from "../../src/lib/data/patients";
import { loadRelationshipLists, type ContactLogs } from "../../src/lib/data/relationship";
import { asDb, at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { addMember, adminClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// CRM C2 — registro do resultado do contato: quem grava (Administrador e
// Recepção, com o item "Relacionamento"), autor e hora pelo banco, só
// acrescentar (Q9), paciente do contato, "Marcou" só com atendimento ativo
// (Q10), saída das listas (Q8), anonimização e o "Atualizado em … por …" das
// Observações (Q6, Q12). O banco grava a hora de verdade: as datas que se
// comparam com ela (faltas) são de verdade, não as de 2031 da agenda.

const tz = "America/Fortaleza";
let clinic: AgendaFixture;
let other: AgendaFixture;
let noFeature: string;
let professional: TestUser;
let support: TestUser;
let noFeatureAdmin: TestUser;
let noFeatureContact: string;
let futureAppointment: string;
let reminderAppointment: string;
let contactOfP1: string;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000);
const row = (overrides: Record<string, unknown> = {}) => ({
  clinic_id: clinic.clinicId,
  contact_phone: "+5584944470001",
  source: "faltosos",
  outcome: "no_answer",
  ...overrides,
});
const insertAs = (db: DbClient, values: Record<string, unknown>) => db.from("contact_interactions").insert(values as never).select("*").single();
const register = async (db: DbClient, req: Partial<RegisterRequest> & Pick<RegisterRequest, "source">, outcome: string, note: string | null = null) => {
  const target = await resolveRegisterTarget(db, clinic.clinicId, { patientId: null, phone: null, sessionId: null, appointmentId: null, since: null, ...req });
  return registerContact(db, clinic.clinicId, target, { outcome, note });
};

beforeAll(async () => {
  clinic = await setupAgendaClinic("Clínica dos registros de contato", "849444700");
  other = await setupAgendaClinic("Outra clínica dos registros", "849444800");
  noFeature = await createClinic("Clínica sem o Relacionamento", ["reminders"]);
  [professional, support, noFeatureAdmin] = await Promise.all([createUser("rc-prof"), createUser("rc-sup"), createUser("rc-semitem")]);
  await addMember(clinic.clinicId, professional.id, ["professional"]);
  await addMember(noFeature, noFeatureAdmin.id, ["admin"]);
  await makePlatformStaff(support.id);
  const { data: c } = await adminClient().from("contacts").insert({ clinic_id: noFeature, full_name: "Fulano", phone: "+5584944470099" }).select("id").single();
  noFeatureContact = c!.id;
  const { data: p1 } = await adminClient().from("patients").select("contact_id").eq("id", clinic.ids.p1).single();
  contactOfP1 = p1!.contact_id;

  const book = async (patientId: string, time: string) =>
    (
      await bookAppointment(
        asDb(clinic.reception),
        clinic.clinicId,
        { patientId, serviceId: clinic.ids.consulta, agendaId: clinic.ids.agendaDra, start: at(MON1, time), locationId: clinic.ids.office, channel: "admin", actorId: clinic.reception.id },
        NOW,
      )
    ).appointment.id;
  futureAppointment = await book(clinic.ids.p1, "08:00");
  // Lembrete não entregue do Paciente Três (aba Lembretes).
  reminderAppointment = await book(clinic.ids.p3, "09:00");
  await adminClient()
    .from("whatsapp_messages")
    .insert({ clinic_id: clinic.clinicId, appointment_id: reminderAppointment, direction: "outbound", message_type: "appointment_reminder", status: "failed", created_at: new Date(NOW.getTime() - 60 * 60_000).toISOString() });

  // Paciente Dois: duas faltas de verdade (há 20 e 10 dias).
  const noShow = (when: Date) =>
    adminClient().from("appointments").insert({
      clinic_id: clinic.clinicId,
      patient_id: clinic.ids.p2,
      service_id: clinic.ids.consulta,
      agenda_id: clinic.ids.agendaDra2,
      location_id: clinic.ids.office,
      scheduled_at: when.toISOString(),
      duration_minutes: 30,
      booking_channel: "admin",
      status: "no_show",
    });
  expect((await noShow(daysAgo(20))).error).toBeNull();
  expect((await noShow(daysAgo(10))).error).toBeNull();
});

afterAll(async () => {
  await clinic.cleanup();
  await other.cleanup();
  await deleteClinics([noFeature]);
  await deleteUsers([professional, support, noFeatureAdmin]);
});

describe("quem grava", () => {
  it("Administrador e Recepção gravam; o autor e a hora são sempre de quem grava", async () => {
    const before = Date.now();
    const { data, error } = await insertAs(asDb(clinic.reception), row({ created_by: clinic.admin.id, created_at: "2000-01-01T00:00:00Z" }));
    expect(error).toBeNull();
    expect(data!.created_by).toBe(clinic.reception.id);
    expect(new Date(data!.created_at).getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect((await insertAs(asDb(clinic.admin), row())).error).toBeNull();
  });

  it("Profissional, outra clínica e clínica sem o item não gravam", async () => {
    expect((await insertAs(asDb(professional), row())).error).toMatchObject({ code: "42501" });
    expect((await insertAs(asDb(other.admin), row())).error).toMatchObject({ code: "42501" });
    const { error } = await insertAs(asDb(noFeatureAdmin), { clinic_id: noFeature, contact_phone: "+5584944470099", contact_id: noFeatureContact, source: "ficha_paciente", outcome: "no_answer" });
    expect(error).toMatchObject({ code: "42501" });
  });

  it("todos da clínica leem; outra clínica não", async () => {
    const { data: mine } = await asDb(professional).from("contact_interactions").select("id").eq("clinic_id", clinic.clinicId);
    expect(mine!.length).toBeGreaterThan(0);
    const { data: theirs } = await asDb(other.admin).from("contact_interactions").select("id").eq("clinic_id", clinic.clinicId);
    expect(theirs).toEqual([]);
  });

  it("o Suporte grava, com auditoria", async () => {
    const { data, error } = await insertAs(asDb(support), row());
    expect(error).toBeNull();
    const { data: audit } = await adminClient().from("platform_audit_log").select("operation").eq("table_name", "contact_interactions").eq("actor_user_id", support.id);
    expect(audit).toEqual([{ operation: "INSERT" }]);
    expect(data!.created_by).toBe(support.id);
  });

  it("ninguém altera nem apaga (Q9)", async () => {
    const { data } = await insertAs(asDb(clinic.admin), row());
    const db = asDb(clinic.admin);
    expect((await db.from("contact_interactions").update({ outcome: "other" }).eq("id", data!.id)).error).toMatchObject({ code: "42501" });
    expect((await db.from("contact_interactions").delete().eq("id", data!.id)).error).toMatchObject({ code: "42501" });
  });
});

describe("regras do registro", () => {
  it("paciente de outro contato, \"Marcou\" sem atendimento ativo e \"Outro\" sem observação são recusados", async () => {
    const db = asDb(clinic.reception);
    expect((await insertAs(db, row({ patient_id: clinic.ids.p2, contact_id: contactOfP1 }))).error).toMatchObject({ code: "23514" });
    expect((await insertAs(db, row({ patient_id: clinic.ids.p1 }))).error).toMatchObject({ code: "23514" });
    expect((await insertAs(db, row({ outcome: "scheduled" }))).error).toMatchObject({ code: "23514" });
    expect((await insertAs(db, row({ outcome: "scheduled", contact_id: contactOfP1, appointment_id: futureAppointment }))).error).toBeNull();
    expect((await insertAs(db, row({ outcome: "other" }))).error).toMatchObject({ code: "23514" });
    expect((await insertAs(db, row({ outcome: "other", note: "Pediu o valor" }))).error).toBeNull();
  });

  it("sem cadastro, pelo telefone; com o contato, o telefone é o dele", async () => {
    const db = asDb(clinic.reception);
    const { data: loose } = await insertAs(db, row({ source: "retomar_contato", contact_phone: "+5584944479999" }));
    expect(loose).toMatchObject({ contact_id: null, contact_phone: "+5584944479999" });
    const { data: linked } = await insertAs(db, row({ contact_id: contactOfP1, contact_phone: "+5584944479999" }));
    expect(linked!.contact_phone).toBe("+5584944470001");
  });

  it("tela: o pedido de outra clínica ou com o atendimento de outro paciente não abre", async () => {
    expect(await codeOf(() => resolveRegisterTarget(asDb(other.reception), clinic.clinicId, { source: "faltosos", patientId: clinic.ids.p2, phone: null, sessionId: null, appointmentId: null, since: daysAgo(10) }))).toBe("not_found");
    expect(await codeOf(() => resolveRegisterTarget(asDb(clinic.reception), clinic.clinicId, { source: "lembretes", patientId: clinic.ids.p2, phone: null, sessionId: null, appointmentId: reminderAppointment, since: null }))).toBe("not_found");
  });

  it("\"Marcou\" pela ficha só com um atendimento por vir; Lembretes não tem \"Marcou\"", async () => {
    const db = asDb(clinic.reception);
    const target = await resolveRegisterTarget(db, clinic.clinicId, { source: "ficha_paciente", patientId: clinic.ids.p1, phone: null, sessionId: null, appointmentId: null, since: null });
    expect(target.booked?.id).toBe(futureAppointment);
    expect(await register(db, { source: "ficha_paciente", patientId: clinic.ids.p1 }, "scheduled")).toEqual({ outcome: "scheduled", exits: false });
    const none = await resolveRegisterTarget(db, clinic.clinicId, { source: "ficha_paciente", patientId: clinic.ids.p2, phone: null, sessionId: null, appointmentId: null, since: null });
    expect(none.booked).toBeNull();
    expect(await codeOf(() => register(db, { source: "ficha_paciente", patientId: clinic.ids.p2 }, "scheduled"))).toBe("invalid");
    expect(await codeOf(() => register(db, { source: "lembretes", patientId: clinic.ids.p3, appointmentId: reminderAppointment }, "scheduled"))).toBe("invalid");
  });

  it("Retomar contato sem cadastro registra pelo telefone", async () => {
    const db = asDb(clinic.reception);
    const req = { source: "retomar_contato" as const, phone: "+5584944478888", sessionId: crypto.randomUUID(), since: daysAgo(1) };
    expect(await register(db, req, "no_answer")).toEqual({ outcome: "no_answer", exits: false });
    const [saved] = await listInteractions(db, clinic.clinicId, "retomar_contato", "contact_phone", ["+5584944478888"]);
    expect(saved).toMatchObject({ contactId: null, sessionId: req.sessionId, outcome: "no_answer" });
  });
});

describe("saída das listas (Q8)", () => {
  const faltosos = async () => {
    const logs: ContactLogs = {};
    const lists = await loadRelationshipLists(asDb(clinic.reception), clinic.clinicId, ["faltosos"], () => {}, { timeZone: tz, logs });
    return { list: lists.faltosos!.map((f) => f.patientId), log: logs.faltosos!.get(clinic.ids.p2) };
  };

  it("Faltosos: \"Não respondeu\" mantém com a tentativa; \"Não quer\" tira; uma falta nova traz de volta", async () => {
    const db = asDb(clinic.reception);
    const since = daysAgo(10);
    expect((await faltosos()).list).toContain(clinic.ids.p2);
    await register(db, { source: "faltosos", patientId: clinic.ids.p2, since }, "no_answer");
    const kept = await faltosos();
    expect(kept.list).toContain(clinic.ids.p2);
    expect(kept.log).toMatchObject({ attempts: 1, last: { outcome: "no_answer", createdBy: clinic.reception.id } });
    await register(db, { source: "faltosos", patientId: clinic.ids.p2, since }, "not_interested");
    expect((await faltosos()).list).not.toContain(clinic.ids.p2);
    // Falta nova depois do registro.
    const { error } = await adminClient().from("appointments").insert({
      clinic_id: clinic.clinicId,
      patient_id: clinic.ids.p2,
      service_id: clinic.ids.consulta,
      agenda_id: clinic.ids.agendaDra2,
      location_id: clinic.ids.office,
      scheduled_at: new Date(Date.now() + 60_000).toISOString(),
      duration_minutes: 30,
      booking_channel: "admin",
      status: "no_show",
    });
    expect(error).toBeNull();
    expect((await faltosos()).list).toContain(clinic.ids.p2);
  });

  it("Lembretes: \"Não respondeu\" mantém; \"Número errado\" tira", async () => {
    const db = asDb(clinic.reception);
    const read = async () => {
      const logs: ContactLogs = {};
      const lists = await loadRelationshipLists(db, clinic.clinicId, ["lembretes"], () => {}, { timeZone: tz, now: NOW, logs });
      return { ids: lists.lembretes!.map((r) => r.appointment.id), log: logs.lembretes!.get(reminderAppointment) };
    };
    expect((await read()).ids).toContain(reminderAppointment);
    await register(db, { source: "lembretes", patientId: clinic.ids.p3, appointmentId: reminderAppointment }, "no_answer");
    expect((await read()).log?.attempts).toBe(1);
    await register(db, { source: "lembretes", patientId: clinic.ids.p3, appointmentId: reminderAppointment }, "wrong_number");
    expect((await read()).ids).not.toContain(reminderAppointment);
  });
});

describe("Observações e anonimização", () => {
  it("\"Atualizado em … por …\" só quando as observações mudam; o valor enviado é ignorado; a anonimização zera tudo", async () => {
    const db = asDb(clinic.reception);
    const id = clinic.ids.p1;
    await updatePatient(db, clinic.clinicId, id, { fullName: "Paciente Um", birthdate: "2020-01-01", notes: "Prefere a tarde" }, "2031-03-09");
    const first = await getPatient(db, clinic.clinicId, id);
    expect(first.notesUpdatedBy).toBe(clinic.reception.id);
    expect(first.notesUpdatedAt).not.toBeNull();
    // Mudou só o nome: o "atualizado" fica.
    await updatePatient(asDb(clinic.admin), clinic.clinicId, id, { fullName: "Paciente Um Silva", birthdate: "2020-01-01", notes: "Prefere a tarde" }, "2031-03-09");
    expect((await getPatient(db, clinic.clinicId, id)).notesUpdatedBy).toBe(clinic.reception.id);
    // Autor forçado pela API: trocado pelo de quem grava.
    await db.from("patients").update({ notes: "Prefere a manhã", notes_updated_by: clinic.admin.id } as never).eq("id", id);
    expect((await getPatient(db, clinic.clinicId, id)).notesUpdatedBy).toBe(clinic.reception.id);

    // Registro com observação, um pelo contato e um pelo telefone antes do cadastro.
    const { data: phone } = await adminClient().from("contacts").select("phone").eq("id", contactOfP1).single();
    await insertAs(db, row({ source: "ficha_paciente", contact_id: contactOfP1, patient_id: id, note: "Ligar depois das 18h" }));
    await insertAs(db, row({ source: "retomar_contato", contact_phone: phone!.phone, note: "Antes do cadastro" }));
    await anonymizePatient(asDb(clinic.admin), clinic.clinicId, id);
    const after = await adminClient().from("patients").select("notes, notes_updated_at, notes_updated_by").eq("id", id).single();
    expect(after.data).toEqual({ notes: null, notes_updated_at: null, notes_updated_by: null });
    const { data: left } = await adminClient().from("contact_interactions").select("note, contact_phone").eq("clinic_id", clinic.clinicId).in("note", ["Ligar depois das 18h", "Antes do cadastro"]);
    expect(left).toEqual([]);
    const { data: oldPhone } = await adminClient().from("contact_interactions").select("id").eq("clinic_id", clinic.clinicId).eq("contact_phone", phone!.phone);
    expect(oldPhone).toEqual([]);
  });
});
