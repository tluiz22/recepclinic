import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { anonymizePatient, getPatient, previewAnonymization, registerPatient } from "../../src/lib/data/patients";
import {
  contactPatientIds,
  linkPatientContact,
  listPatientContacts,
  setPrimaryContact,
  unlinkPatientContact,
} from "../../src/lib/data/patientContacts";
import { countFutureAppointments, countNoShows } from "../../src/lib/data/whatsapp/botLimits";
import { addMember, clinicServiceClient, createUser, deleteUsers, withDatabase, type TestUser } from "./helpers";
import { asDb, at, codeOf, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// VR1 — vários responsáveis por paciente (D14; VR-1, VR-3, VR-5 e VR-6, cliente, 10/nov/2026).
let fixture: AgendaFixture;
let other: AgendaFixture;
let professional: TestUser;
let clinicId: string;
let child: string; // p1: filho de Maria (principal)
let mom: string; // contato principal de p1
let dad: string; // contato novo, 2º responsável de p1
let dadOwn: string; // ficha do próprio pai (dad é o "próprio paciente")

const sql = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  withDatabase(async (db) => (await db.query(text, params)).rows as T[]);

// Uma consulta futura por profissional: a 2ª com o Dr. Segundo.
const book = async (patientId: string, date: string, time: string, second = false) =>
  (
    await bookAppointment(
      asDb(fixture.admin),
      clinicId,
      {
        patientId,
        serviceId: second ? fixture.ids.consulta2 : fixture.ids.consulta,
        agendaId: second ? fixture.ids.agendaDra2 : fixture.ids.agendaDra, locationId: fixture.ids.office, start: at(date, time), channel: "admin", actorId: fixture.admin.id },
      NOW,
    )
  ).appointment.id;

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste de vários responsáveis", "+55619877100");
  other = await setupAgendaClinic("Outra clínica (vários responsáveis)", "+55619877200");
  clinicId = fixture.clinicId;
  child = fixture.ids.p1;
  mom = (await getPatient(asDb(fixture.admin), clinicId, child)).contactId;
  professional = await createUser("vr-profissional");
  await addMember(clinicId, professional.id, ["professional"]);

  const result = await registerPatient(
    asDb(fixture.admin),
    clinicId,
    { fullName: "Pai do Um", birthdate: "1985-05-05", contact: { mode: "self", phone: "+5561987710050" } } as never,
    "2031-03-09",
  );
  if (result.status !== "created") throw new Error(result.status);
  dadOwn = result.patient.id;
  dad = result.patient.contactId;
});

afterAll(async () => {
  await fixture.cleanup();
  await other.cleanup();
  await deleteUsers([professional]);
});

describe("responsáveis do paciente", () => {
  it("o cadastro já liga o principal (e o próprio paciente)", async () => {
    expect(await listPatientContacts(asDb(fixture.admin), clinicId, child)).toEqual([
      { contactId: mom, fullName: "Resp. Paciente Um", phone: "+5561987710001", kinship: null, isPrimary: true, isSelf: false },
    ]);
    const [own] = await listPatientContacts(asDb(fixture.admin), clinicId, dadOwn);
    expect(own).toMatchObject({ contactId: dad, isPrimary: true, isSelf: true });
  });

  it("o Profissional e o bot não ligam; ninguém grava direto na tabela", async () => {
    expect(await codeOf(() => linkPatientContact(asDb(professional), clinicId, child, dad))).toBe("forbidden");
    const bot = clinicServiceClient(clinicId);
    const { error: rpc } = await bot.rpc("link_patient_contact", { p_clinic_id: clinicId, p_patient_id: child, p_contact_id: dad });
    expect(rpc).not.toBeNull();
    const { error: insert } = await fixture.admin.client
      .from("patient_contacts")
      .insert({ clinic_id: clinicId, patient_id: child, contact_id: dad });
    expect(insert).not.toBeNull();
  });

  it("a Recepção liga o pai, com parentesco e registro; ligar de novo é recusado", async () => {
    await linkPatientContact(asDb(fixture.reception), clinicId, child, dad, " Pai ");
    const list = await listPatientContacts(asDb(fixture.admin), clinicId, child);
    expect(list.map((c) => [c.contactId, c.kinship, c.isPrimary])).toEqual([
      [mom, null, true],
      [dad, "Pai", false],
    ]);
    expect(await codeOf(() => linkPatientContact(asDb(fixture.reception), clinicId, child, dad))).toBe("invalid");
    const [event] = await sql("select event, kinship, actor_id from public.patient_contact_events where patient_id = $1 and contact_id = $2", [child, dad]);
    expect(event).toEqual({ event: "linked", kinship: "Pai", actor_id: fixture.reception.id });
  });

  it("contato de outra clínica não liga", async () => {
    const otherContact = (await getPatient(asDb(other.admin), other.clinicId, other.ids.p1)).contactId;
    expect(await codeOf(() => linkPatientContact(asDb(fixture.admin), clinicId, child, otherContact))).toBe("not_found");
  });

  it("pacientes deste número: o pai vê a própria ficha e a do filho; o bot da outra clínica não vê", async () => {
    expect((await contactPatientIds(asDb(fixture.reception), clinicId, dad)).sort()).toEqual([child, dadOwn].sort());
    const bot = clinicServiceClient(clinicId);
    const { data } = await bot.rpc("contact_patient_ids", { p_clinic_id: clinicId, p_contact_id: dad });
    expect((data as string[]).sort()).toEqual([child, dadOwn].sort());
    const { data: leak } = await clinicServiceClient(other.clinicId).rpc("contact_patient_ids", { p_clinic_id: clinicId, p_contact_id: dad });
    expect(leak).toEqual([]);
  });
});

describe("quem marcou (VR-1) e limites (VR-5)", () => {
  let byMom: string;
  let byDad: string;

  it("sem escolha, a consulta fica com o principal; a escolha precisa ser um responsável ligado", async () => {
    byMom = await book(child, MON1, "08:00");
    byDad = await book(child, MON1, "08:00", true);
    const [row] = await sql<{ booked_by_contact_id: string }>("select booked_by_contact_id from public.appointments where id = $1", [byMom]);
    expect(row.booked_by_contact_id).toBe(mom);

    await sql("update public.appointments set booked_by_contact_id = $2 where id = $1", [byDad, dad]);
    const outsider = (await getPatient(asDb(fixture.admin), clinicId, fixture.ids.p2)).contactId;
    await expect(sql("update public.appointments set booked_by_contact_id = $2 where id = $1", [byMom, outsider])).rejects.toThrow(/Quem marcou/);
  });

  it("consultas futuras e faltas contam no número que marcou", async () => {
    expect(await countFutureAppointments(asDb(fixture.admin), clinicId, mom, NOW)).toBe(1);
    expect(await countFutureAppointments(asDb(fixture.admin), clinicId, dad, NOW)).toBe(1);
    await sql("update public.appointments set status = 'no_show' where id = $1", [byDad]);
    expect(await countNoShows(asDb(fixture.admin), clinicId, dad, at(MON2, "12:00"))).toBe(1);
    expect(await countNoShows(asDb(fixture.admin), clinicId, mom, at(MON2, "12:00"))).toBe(0);
    await sql("update public.appointments set status = 'scheduled' where id = $1", [byDad]);
  });

  it("tornar principal: o pai passa a principal (Recepção, com registro); a mãe continua ligada", async () => {
    expect(await codeOf(() => setPrimaryContact(asDb(professional), clinicId, child, dad))).toBe("forbidden");
    await setPrimaryContact(asDb(fixture.reception), clinicId, child, dad);
    const patient = await getPatient(asDb(fixture.admin), clinicId, child);
    expect(patient).toMatchObject({ contactId: dad, isContactSelf: false });
    expect((await listPatientContacts(asDb(fixture.admin), clinicId, child)).map((c) => [c.contactId, c.isPrimary])).toEqual([
      [dad, true],
      [mom, false],
    ]);
    // Quem marcou não muda com o principal.
    const [row] = await sql<{ booked_by_contact_id: string }>("select booked_by_contact_id from public.appointments where id = $1", [byMom]);
    expect(row.booked_by_contact_id).toBe(mom);
  });

  it("o principal não se desliga; desligar a mãe devolve as consultas futuras dela ao principal", async () => {
    expect(await codeOf(() => unlinkPatientContact(asDb(fixture.reception), clinicId, child, dad))).toBe("invalid");
    expect(await unlinkPatientContact(asDb(fixture.reception), clinicId, child, mom)).toBe(1);
    const [row] = await sql<{ booked_by_contact_id: string }>("select booked_by_contact_id from public.appointments where id = $1", [byMom]);
    expect(row.booked_by_contact_id).toBe(dad);
    expect(await codeOf(() => unlinkPatientContact(asDb(fixture.reception), clinicId, child, mom))).toBe("not_found");
    const events = await sql<{ event: string }>("select event from public.patient_contact_events where patient_id = $1 order by created_at", [child]);
    expect(events.map((e) => e.event)).toEqual(["linked", "made_primary", "unlinked"]);
  });

  it("voltar a mãe a principal devolve o 'próprio paciente' de quem é", async () => {
    await linkPatientContact(asDb(fixture.admin), clinicId, child, mom, "Mãe");
    await setPrimaryContact(asDb(fixture.admin), clinicId, child, mom);
    expect(await getPatient(asDb(fixture.admin), clinicId, child)).toMatchObject({ contactId: mom, isContactSelf: false });
    await setPrimaryContact(asDb(fixture.admin), clinicId, dadOwn, dad);
    expect(await getPatient(asDb(fixture.admin), clinicId, dadOwn)).toMatchObject({ contactId: dad, isContactSelf: true });
  });
});

describe("anonimização (VR-6): só quem fica sem paciente", () => {
  it("a prévia diz quem continua e quem vai junto", async () => {
    // p3 tem a mãe dele (só ele) e o pai (que cuida de outros).
    const p3Contact = (await getPatient(asDb(fixture.admin), clinicId, fixture.ids.p3)).contactId;
    await linkPatientContact(asDb(fixture.admin), clinicId, fixture.ids.p3, dad, "Pai");
    const preview = await previewAnonymization(asDb(fixture.admin), clinicId, fixture.ids.p3, NOW);
    expect(preview.contacts).toEqual([
      { id: p3Contact, fullName: "Resp. Paciente Três", anonymized: true, otherPatients: [] },
      { id: dad, fullName: "Pai do Um", anonymized: false, otherPatients: expect.arrayContaining(["Paciente Um", "Pai do Um"]) },
    ]);
  });

  it("anonimiza o paciente e o contato só dele; o pai continua, com as outras fichas", async () => {
    const p3 = fixture.ids.p3;
    const p3Contact = (await getPatient(asDb(fixture.admin), clinicId, p3)).contactId;
    await sql(
      `insert into public.whatsapp_messages (clinic_id, contact_id, contact_phone, direction, message_type, body)
       values ($1, $2, '+5561987710050', 'outbound', 'text', 'Mensagem ao pai')`,
      [clinicId, dad],
    );

    expect(await anonymizePatient(asDb(fixture.admin), clinicId, p3)).toEqual({
      canceled: 0,
      otherPatients: 2,
      contactsAnonymized: 1,
      contactsKept: 1,
    });
    const contacts = await sql<{ id: string; full_name: string; is_active: boolean }>(
      "select id, full_name, is_active from public.contacts where id = any($1) order by full_name",
      [[p3Contact, dad]],
    );
    expect(contacts).toEqual([
      { id: p3Contact, full_name: "Contato anonimizado", is_active: false },
      { id: dad, full_name: "Pai do Um", is_active: true },
    ]);
    expect(await sql("select 1 from public.patient_contacts where patient_id = $1", [p3])).toEqual([]);
    expect((await contactPatientIds(asDb(fixture.admin), clinicId, dad)).sort()).toEqual([child, dadOwn].sort());
    const [message] = await sql("select body, contact_phone from public.whatsapp_messages where contact_id = $1", [dad]);
    expect(message).toEqual({ body: "Mensagem ao pai", contact_phone: "+5561987710050" });
  });

  it("irmão do mesmo contato: o contato continua (antes da D14 ia junto)", async () => {
    const [{ id: sibling }] = await sql<{ id: string }>(
      "insert into public.patients (clinic_id, contact_id, full_name, birthdate) values ($1, $2, 'Irmão do Dois', '2021-02-02') returning id",
      [clinicId, (await getPatient(asDb(fixture.admin), clinicId, fixture.ids.p2)).contactId],
    );
    const result = await anonymizePatient(asDb(fixture.admin), clinicId, fixture.ids.p2);
    expect(result).toMatchObject({ otherPatients: 1, contactsAnonymized: 0, contactsKept: 1 });
    const [brother] = await sql<{ full_name: string; is_active: boolean }>("select full_name, is_active from public.patients where id = $1", [sibling]);
    expect(brother).toEqual({ full_name: "Irmão do Dois", is_active: true });
  });
});
