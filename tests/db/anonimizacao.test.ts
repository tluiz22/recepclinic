import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { anonymizePatient, getContact, getPatient, previewAnonymization, updateContact, updatePatient } from "../../src/lib/data/patients";
import { createUser, deleteUsers, makePlatformStaff, withDatabase, type TestUser } from "./helpers";
import { asDb, at, codeOf, MON1, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// F9.4 — anonimização a pedido (LGPD): o histórico fica sem identificação; o
// contato vai junto; futuros cancelados sem aviso; registro do Suporte limpo;
// só Administrador e Suporte; irreversível.
let fixture: AgendaFixture;
let clinicId: string;
let support: TestUser;
let p1: string;
let contactId: string;
let phone: string;
let sibling: string;
let future: string;
let past: string;

const sql = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  withDatabase(async (db) => (await db.query(text, params)).rows as T[]);

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste de anonimização", "+55619877");
  clinicId = fixture.clinicId;
  p1 = fixture.ids.p1;
  support = await createUser("suporte-anon");
  await makePlatformStaff(support.id);

  const patient = await getPatient(asDb(fixture.admin), clinicId, p1);
  contactId = patient.contactId;
  phone = (await getContact(asDb(fixture.admin), clinicId, contactId)).phone;

  // Irmão: outro paciente do mesmo contato.
  [{ id: sibling }] = await sql<{ id: string }>(
    "insert into public.patients (clinic_id, contact_id, full_name, birthdate) values ($1, $2, 'Irmão do Um', '2021-02-02') returning id",
    [clinicId, contactId],
  );

  // Futuro, domiciliar (com endereço), e um passado já realizado.
  future = (
    await bookAppointment(
      asDb(fixture.admin),
      clinicId,
      { patientId: p1, serviceId: fixture.ids.consulta, agendaId: fixture.ids.agendaDra, locationId: fixture.ids.home, homeVisitAddress: "Rua Secreta, 10", start: at(MON1, "14:00"), channel: "admin", actorId: fixture.admin.id },
      at("2031-03-09", "12:00"),
    )
  ).appointment.id;
  [{ id: past }] = await sql<{ id: string }>(
    `insert into public.appointments
       select (jsonb_populate_record(null::public.appointments,
         to_jsonb(a) || jsonb_build_object('id', gen_random_uuid(), 'scheduled_at', '2026-01-05T15:00:00Z', 'status', 'completed'))).*
       from public.appointments a where a.id = $1
     returning id`,
    [future],
  );

  // Rastros do WhatsApp e do bot.
  await sql(
    `insert into public.whatsapp_messages (clinic_id, contact_id, contact_phone, appointment_id, direction, message_type, body)
     values ($1, $2, $3, $4, 'inbound', 'text', 'Oi, aqui é a Maria do Um')`,
    [clinicId, contactId, phone, past],
  );
  await sql("insert into public.conversation_state (clinic_id, contact_phone, contact_id) values ($1, $2, $3)", [clinicId, phone, contactId]);
  await sql(
    `insert into public.bot_funnel_events (clinic_id, session_id, flow, step, contact_phone, contact_id, metadata)
     values ($1, gen_random_uuid(), 'booking', 'started', $2, $3, '{"contact_name": "Maria", "service_id": "s1"}')`,
    [clinicId, phone, contactId],
  );

  // O Suporte mexeu no cadastro: cópias no registro.
  const { error } = await support.client.from("patients").update({ notes: "anotação secreta do Um" }).eq("id", p1);
  if (error) throw error;
});

afterAll(async () => {
  await fixture.cleanup();
  await deleteUsers([support]);
});

describe("anonimizar paciente", () => {
  it("a Recepção não pode", async () => {
    expect(await codeOf(() => anonymizePatient(asDb(fixture.reception), clinicId, p1))).toBe("forbidden");
  });

  it("a prévia mostra o futuro a cancelar e o irmão que fica sem telefone", async () => {
    const preview = await previewAnonymization(asDb(fixture.admin), clinicId, p1, at("2026-10-09", "12:00"));
    expect(preview.futureAppointments).toBe(1);
    expect(preview.otherPatients.map((p) => p.fullName)).toEqual(["Irmão do Um"]);
  });

  it("o Administrador anonimiza: paciente, contato, futuro, histórico, mensagens, bot e registro do Suporte", async () => {
    expect(await anonymizePatient(asDb(fixture.admin), clinicId, p1)).toEqual({ canceled: 1, otherPatients: 1 });

    const [patient] = await sql("select full_name, birthdate::text, notes, is_active, anonymized_at from public.patients where id = $1", [p1]);
    expect(patient).toMatchObject({ full_name: "Paciente anonimizado", birthdate: "1900-01-01", notes: null, is_active: false });
    expect(patient.anonymized_at).not.toBeNull();

    const [contact] = await sql<{ full_name: string; phone: string; is_active: boolean }>("select full_name, phone, is_active from public.contacts where id = $1", [contactId]);
    expect(contact.full_name).toBe("Contato anonimizado");
    expect(contact.phone).toMatch(/^\+00\d{13}$/);
    expect(contact.is_active).toBe(false);

    const appointments = await sql<{ id: string; status: string; home_visit_address: string | null }>(
      "select id, status, home_visit_address from public.appointments where id = any($1)",
      [[future, past]],
    );
    expect(appointments.find((a) => a.id === future)).toMatchObject({ status: "canceled", home_visit_address: null });
    expect(appointments.find((a) => a.id === past)).toMatchObject({ status: "completed", home_visit_address: null });
    const [trail] = await sql("select details from public.appointment_events where appointment_id = $1 and event_type = 'canceled'", [future]);
    expect(trail.details).toEqual({ reason: "anonymized" });

    const messages = await sql<{ body: string | null; contact_phone: string }>("select body, contact_phone from public.whatsapp_messages where clinic_id = $1", [clinicId]);
    expect(messages).toEqual([{ body: null, contact_phone: contact.phone }]);
    expect(await sql("select 1 from public.conversation_state where clinic_id = $1", [clinicId])).toEqual([]);
    const [funnel] = await sql<{ contact_phone: string; metadata: Record<string, string> }>("select contact_phone, metadata from public.bot_funnel_events where clinic_id = $1", [clinicId]);
    expect(funnel).toEqual({ contact_phone: contact.phone, metadata: { contact_name: "anonimizado", service_id: "s1" } });

    const audit = JSON.stringify(await sql("select old_row, new_row from public.platform_audit_log where clinic_id = $1", [clinicId]));
    expect(audit).not.toContain("anotação secreta");
    expect(audit).not.toContain("Paciente Um");
    expect(audit).not.toContain(phone);

    // O irmão continua, ligado ao contato (agora sem telefone).
    const [brother] = await sql("select full_name, is_active, contact_id from public.patients where id = $1", [sibling]);
    expect(brother).toEqual({ full_name: "Irmão do Um", is_active: true, contact_id: contactId });
  });

  it("não volta: anonimizar de novo, editar ou reativar é recusado", async () => {
    expect(await codeOf(() => anonymizePatient(asDb(fixture.admin), clinicId, p1))).toBe("invalid");
    expect(await codeOf(() => updatePatient(asDb(fixture.admin), clinicId, p1, { fullName: "Paciente Um", birthdate: "2020-01-01" }, "2026-10-09"))).toBe("invalid");
    const { error } = await fixture.admin.client.from("patients").update({ is_active: true }).eq("id", p1);
    expect(error).not.toBeNull();
  });

  it("o contato recebe um telefone novo e volta a valer para o irmão; o número anonimizado não serve", async () => {
    const [{ phone: fake }] = await sql<{ phone: string }>("select phone from public.contacts where id = $1", [contactId]);
    expect(await codeOf(() => updateContact(asDb(fixture.admin), clinicId, contactId, { fullName: "Mãe", phone: fake }))).toBe("invalid");

    const updated = await updateContact(asDb(fixture.admin), clinicId, contactId, { fullName: "Mãe do Irmão", phone: "+5561987700099" });
    expect(updated).toMatchObject({ fullName: "Mãe do Irmão", phone: "+5561987700099", isActive: true, anonymizedAt: null });
  });

  it("o Suporte também anonimiza", async () => {
    const result = await anonymizePatient(asDb(support), clinicId, fixture.ids.p2);
    expect(result.canceled).toBe(0);
    expect((await getPatient(asDb(fixture.admin), clinicId, fixture.ids.p2)).anonymizedAt).not.toBeNull();
  });
});
