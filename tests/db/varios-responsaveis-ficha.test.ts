import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookAppointment } from "../../src/lib/data/agenda/appointments";
import { contactForResponsible, getPatient, listPatientsPage, registerPatient, searchPatients } from "../../src/lib/data/patients";
import {
  linkPatientContact,
  listContactLinkedPatients,
  setAppointmentsBooker,
  similarRecordsOfContact,
} from "../../src/lib/data/patientContacts";
import { withDatabase } from "./helpers";
import { asDb, at, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";

// VR2 — ficha e recepção com vários responsáveis (D14; UI-1, UI-2 e UI-6, cliente, 10/nov/2026).
let fixture: AgendaFixture;
let clinicId: string;
let child: string; // Paciente Um (mãe = principal)
let mom: string;
let dad: string; // contato novo pelo "Adicionar responsável"
let duplicate: string; // ficha repetida da criança, cadastrada pelo pai

const DAD_PHONE = "+5561987730077";
const sql = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  withDatabase(async (db) => (await db.query(text, params)).rows as T[]);

beforeAll(async () => {
  fixture = await setupAgendaClinic("Clínica do teste da ficha com responsáveis", "+55619877300");
  clinicId = fixture.clinicId;
  child = fixture.ids.p1;
  mom = (await getPatient(asDb(fixture.admin), clinicId, child)).contactId;
  // O pai cadastrou a mesma criança pelo número dele (a ficha repetida que a VR-4 desativa).
  const result = await registerPatient(
    asDb(fixture.admin),
    clinicId,
    { fullName: "Paciente  Úm", birthdate: "2020-01-01", contact: { mode: "new", fullName: "Pai do Um", phone: DAD_PHONE }, otherResponsible: { action: "new" } },
    "2031-03-09",
  );
  if (result.status !== "created") throw new Error(result.status);
  duplicate = result.patient.id;
  dad = result.contact.id;
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("Adicionar responsável (UI-2)", () => {
  it("número novo pede o nome; número já cadastrado reaproveita o contato", async () => {
    const db = asDb(fixture.admin);
    await expect(contactForResponsible(db, clinicId, { phone: "61 98773-0099" })).rejects.toMatchObject({ code: "invalid", fields: { fullName: expect.any(String) } });
    await expect(contactForResponsible(db, clinicId, { phone: "123" })).rejects.toMatchObject({ code: "invalid", fields: { phone: expect.any(String) } });
    expect((await contactForResponsible(db, clinicId, { phone: DAD_PHONE })).id).toBe(dad);
    const created = await contactForResponsible(db, clinicId, { phone: "61 98773-0099", fullName: " Avó do Um " });
    expect(created).toMatchObject({ fullName: "Avó do Um", phone: "+5561987730099" });
  });

  it("acha a ficha parecida do número (mesmo nome sem acento e nascimento), com as consultas futuras", async () => {
    await bookAppointment(
      asDb(fixture.admin),
      clinicId,
      { patientId: duplicate, serviceId: fixture.ids.consulta, agendaId: fixture.ids.agendaDra, locationId: fixture.ids.office, start: at(MON1, "09:00"), channel: "admin", actorId: fixture.admin.id },
      NOW,
    );
    const patient = await getPatient(asDb(fixture.admin), clinicId, child);
    expect(await similarRecordsOfContact(asDb(fixture.admin), clinicId, dad, patient, NOW)).toEqual([
      { id: duplicate, fullName: "Paciente  Úm", birthdate: "2020-01-01", futureAppointments: 1 },
    ]);
    // Outro nascimento não é parecido.
    expect(await similarRecordsOfContact(asDb(fixture.admin), clinicId, dad, { ...patient, birthdate: "2019-01-01" }, NOW)).toEqual([]);
  });

  it("depois de ligado, a página do pai lista a criança como outro responsável", async () => {
    await linkPatientContact(asDb(fixture.reception), clinicId, child, dad, "Pai");
    const linked = await listContactLinkedPatients(asDb(fixture.admin), clinicId, dad);
    expect(linked.map((p) => [p.id, p.isPrimary, p.kinship])).toEqual(
      expect.arrayContaining([
        [child, false, "Pai"],
        [duplicate, true, null],
      ]),
    );
  });
});

describe("busca pelo celular de qualquer responsável", () => {
  it("o celular do pai acha a ficha da criança (busca do Marcar e lista de pacientes)", async () => {
    const found = await searchPatients(asDb(fixture.reception), clinicId, "987730077");
    expect(found.map((p) => p.id)).toEqual(expect.arrayContaining([child, duplicate]));
    // O cartão segue mostrando o principal.
    expect(found.find((p) => p.id === child)?.contact.id).toBe(mom);
    const page = await listPatientsPage(asDb(fixture.reception), clinicId, { query: "987730077" });
    expect(page.items.map((p) => p.id)).toEqual(expect.arrayContaining([child, duplicate]));
    expect(page.total).toBe(2);
  });

  it("muitas fichas desativadas com o mesmo pedaço do número não escondem a ativa", async () => {
    // 160 fichas desativadas cujo celular termina em "0077" (como o do pai, e só ele na clínica).
    await sql(
      `with c as (
         insert into public.contacts (clinic_id, full_name, phone)
         select $1, 'Antigo ' || i, '+55619' || lpad(i::text, 4, '0') || '0077' from generate_series(1, 160) i
         returning id, full_name
       )
       insert into public.patients (clinic_id, contact_id, full_name, birthdate, is_active)
       select $1, id, 'Ficha antiga ' || full_name, '2000-01-01', false from c`,
      [clinicId],
    );
    try {
      const found = await searchPatients(asDb(fixture.reception), clinicId, "0077");
      expect(found.map((p) => p.id)).toEqual(expect.arrayContaining([child]));
      const page = await listPatientsPage(asDb(fixture.reception), clinicId, { query: "0077" });
      expect(page.items.map((p) => p.id)).toEqual(expect.arrayContaining([child]));
    } finally {
      await sql("delete from public.patients where clinic_id = $1 and full_name like 'Ficha antiga %'", [clinicId]);
      await sql("delete from public.contacts where clinic_id = $1 and full_name like 'Antigo %'", [clinicId]);
    }
  });
});

describe("Marcar: confirmação e lembrete para (UI-6)", () => {
  it("a escolha da recepção fica como quem marcou; quem não é responsável é recusado", async () => {
    const { appointment } = await bookAppointment(
      asDb(fixture.reception),
      clinicId,
      { patientId: child, serviceId: fixture.ids.consulta, agendaId: fixture.ids.agendaDra, locationId: fixture.ids.office, start: at(MON1, "10:00"), channel: "admin", actorId: fixture.reception.id },
      NOW,
    );
    const bookedBy = async () => (await sql<{ b: string }>("select booked_by_contact_id b from appointments where id = $1", [appointment.id]))[0].b;
    expect(await bookedBy()).toBe(mom);
    await setAppointmentsBooker(asDb(fixture.reception), clinicId, [appointment.id], dad);
    expect(await bookedBy()).toBe(dad);
    const stranger = (await getPatient(asDb(fixture.admin), clinicId, fixture.ids.p2)).contactId;
    await expect(setAppointmentsBooker(asDb(fixture.reception), clinicId, [appointment.id], stranger)).rejects.toMatchObject({ code: "invalid" });
    expect(await bookedBy()).toBe(dad);
  });
});

describe("cadastro pelo número que não é o principal (/code-review; migração 20270116120000)", () => {
  it("o pai cadastra a criança de novo: alerta de ficha parecida pelo nascimento e pelo nome", async () => {
    const original = await getPatient(asDb(fixture.reception), clinicId, child);
    const sameBirth = await registerPatient(
      asDb(fixture.reception),
      clinicId,
      { fullName: "Outro Nome Qualquer", birthdate: original.birthdate, contact: { mode: "existing", contactId: dad } },
      "2031-03-09",
    );
    expect(sameBirth.status).toBe("possible_duplicate");
    if (sameBirth.status === "possible_duplicate") expect(sameBirth.existing.map((e) => e.id)).toContain(child);

    const sameName = await registerPatient(
      asDb(fixture.reception),
      clinicId,
      { fullName: original.fullName, birthdate: "2020-01-01", contact: { mode: "existing", contactId: dad } },
      "2031-03-09",
    );
    expect(sameName.status).toBe("possible_duplicate");
    if (sameName.status === "possible_duplicate") expect(sameName.existing.map((e) => e.id)).toContain(child);
  });
});

describe("cadastro de paciente que já tem ficha com outro responsável (cliente, 11/nov/2026)", () => {
  const AUNT_PHONE = "+5561987730055";
  const register = (extra: Record<string, unknown> = {}) =>
    registerPatient(
      asDb(fixture.reception),
      clinicId,
      { fullName: "paciente um", birthdate: "2020-01-01", contact: { mode: "new", fullName: "Tia do Um", phone: AUNT_PHONE }, ...extra },
      "2031-03-09",
    );

  it("número novo: avisa a ficha com o principal, sem criar o contato", async () => {
    const result = await register();
    expect(result.status).toBe("other_responsible");
    if (result.status !== "other_responsible") return;
    expect(result.twins.map((t) => t.id)).toContain(child);
    expect(result.twins.find((t) => t.id === child)?.primary?.fullName).toBeTruthy();
    expect(await sql("select id from contacts where clinic_id = $1 and phone = $2", [clinicId, AUNT_PHONE])).toEqual([]);
  });

  it("outro nascimento ou o número já ligado não avisam", async () => {
    const other = await registerPatient(
      asDb(fixture.reception),
      clinicId,
      { fullName: "Paciente Um", birthdate: "2019-05-05", contact: { mode: "new", fullName: "Tia do Um", phone: "+5561987730056" }, confirmDuplicate: true },
      "2031-03-09",
    );
    expect(other.status).toBe("created");
  });

  it("ligar: o número vira outro responsável da ficha, com o parentesco, e nenhuma ficha nova", async () => {
    const before = await sql<{ n: string }>("select count(*)::text n from patients where clinic_id = $1", [clinicId]);
    const result = await register({ otherResponsible: { action: "link", patientId: child, kinship: " Tia " } });
    expect(result.status).toBe("linked");
    if (result.status !== "linked") return;
    expect(result.patientId).toBe(child);
    const after = await sql<{ n: string }>("select count(*)::text n from patients where clinic_id = $1", [clinicId]);
    expect(after[0].n).toBe(before[0].n);
    const link = await sql<{ kinship: string }>("select kinship from patient_contacts where patient_id = $1 and contact_id = $2", [child, result.contact.id]);
    expect(link).toEqual([{ kinship: "Tia" }]);
    // Já ligado: a ficha não aparece mais para este número.
    const again = await register();
    expect(again.status === "other_responsible" ? again.twins.map((t) => t.id) : []).not.toContain(child);
  });

  it("ficha que não é parecida não se liga pelo cadastro", async () => {
    await expect(
      registerPatient(
        asDb(fixture.reception),
        clinicId,
        { fullName: "Outro Nome", birthdate: "2020-01-01", contact: { mode: "new", fullName: "X", phone: "+5561987730057" }, otherResponsible: { action: "link", patientId: child } },
        "2031-03-09",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});
