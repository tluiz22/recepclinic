import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ImportPatient } from "../../src/lib/agendaImport";
import { authorizeAgendaImport, getLatestAgendaImport, loadImportReview, requestAgendaImport, saveAgendaImport, undoAgendaImport } from "../../src/lib/data/agendaImport";
import type { DbClient } from "../../src/lib/data/clients";
import type { Email } from "../../src/lib/email";
import { at, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient, clinicServiceClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// VR-7 (D14; migração 20270114120000): a agenda atual com o 2º responsável. A carga liga o 2º responsável (contato já
// cadastrado, criado antes na mesma carga ou novo) com o registro; o Desfazer desliga o que a carga ligou, menos quem
// marcou consulta do paciente, e não apaga o contato que ainda cuida de alguém.

const TZ = "America/Fortaleza";
const sent: Email[] = [];
const deps = { sendEmail: async (email: Email) => void sent.push(email), baseUrl: "http://localhost:4321" };
const asDb = (client: unknown) => client as DbClient;
const tokenOf = (link: string) => link.split("/importar/")[1];
const PREFIX = "849778810";
const PAI = "+5584984441102";
const AVO = "+5584984441199";

let fx: AgendaFixture;
let support: TestUser;
let requestId: string;

const patient = (over: Partial<ImportPatient>): ImportPatient => ({
  key: "p1",
  name: "",
  birthdate: "2019-01-01",
  phone: "",
  guardianName: "",
  secondName: "",
  secondPhone: "",
  insurancePlanId: "",
  cardNumber: "",
  appointments: [],
  ...over,
});

const contactId = async (phone: string) => (await adminClient().from("contacts").select("id").eq("clinic_id", fx.clinicId).eq("phone", phone).maybeSingle()).data?.id ?? null;
const patientId = async (name: string) => (await adminClient().from("patients").select("id").eq("clinic_id", fx.clinicId).eq("full_name", name).maybeSingle()).data?.id ?? null;
const links = async (phone: string) => {
  const id = await contactId(phone);
  if (!id) return [];
  const { data } = await adminClient().from("patient_contacts").select("patient_id, agenda_import_id, patients ( full_name )").eq("contact_id", id);
  return (data ?? []).map((r) => (r.patients as unknown as { full_name: string }).full_name).sort();
};

beforeAll(async () => {
  fx = await setupAgendaClinic("Clínica da importação com 2º responsável", PREFIX);
  support = await createUser("imp2-suporte");
  await makePlatformStaff(support.id);
  const clinic = { id: fx.clinicId, name: "Clínica da importação com 2º responsável", timezone: TZ };
  const result = await requestAgendaImport(asDb(support.client), support.id, clinic, "admin@clinica.com", deps, NOW);
  const page = asDb(clinicServiceClient(fx.clinicId));
  const entries = [
    // Já cadastrado (Paciente Três): ganha a avó, contato novo.
    patient({ key: "p1", name: "Paciente Três", birthdate: "2020-01-01", phone: `${PREFIX}03`, guardianName: "Resp. Paciente Três", secondName: "Avó Três", secondPhone: AVO }),
    // Novo, com o pai novo.
    patient({ key: "p2", name: "Bia Importada", phone: "(84) 98444-1101", guardianName: "Mãe Bia", secondName: "Pai Bia", secondPhone: "(84) 98444-1102" }),
    // Novo, com o 2º responsável já cadastrado (o responsável da Paciente Dois): fica o cadastro.
    patient({ key: "p3", name: "Caio Importado", phone: "(84) 98444-1103", guardianName: "Mãe Caio", secondName: "Outro Nome", secondPhone: `${PREFIX}02` }),
    // Irmã da Bia, com o mesmo pai (criado antes na mesma carga).
    patient({ key: "p4", name: "Duda Importada", birthdate: "2020-06-01", phone: "(84) 98444-1101", guardianName: "Mãe Bia", secondName: "Pai Bia", secondPhone: "84984441102" }),
  ];
  expect((await saveAgendaImport(page, fx.clinicId, tokenOf(result.link), entries, true, TZ, NOW)).submitted).toBe(true);
  requestId = (await getLatestAgendaImport(asDb(support.client), fx.clinicId))!.id;
});

afterAll(async () => {
  await fx.cleanup();
  await deleteUsers([support]);
});

describe("agenda atual com o 2º responsável (VR-7)", () => {
  it("a revisão avisa o número já cadastrado e não acha erro", async () => {
    const { review } = await loadImportReview(asDb(support.client), fx.clinicId, (await getLatestAgendaImport(asDb(support.client), fx.clinicId))!.entries, NOW);
    expect(review.errorCount).toBe(0);
    const caio = review.patients.find((p) => p.key === "p3")!;
    expect(caio.secondContactId).not.toBeNull();
    expect(caio.warnings[0]).toMatch(/^2º responsável: WhatsApp já cadastrado em nome de Resp\. Paciente Dois \(no link: Outro Nome\)/);
  });

  it("a carga liga o 2º responsável (novo, da mesma carga ou já cadastrado), com o registro", async () => {
    const loaded = await authorizeAgendaImport(asDb(support.client), fx.clinicId, requestId, NOW);
    expect(loaded).toMatchObject({ links: 4, patients: 3 });
    expect(await links(PAI)).toEqual(["Bia Importada", "Duda Importada"]);
    expect(await links(AVO)).toEqual(["Paciente Três"]);
    expect(await links(`+55${PREFIX}02`)).toEqual(["Caio Importado", "Paciente Dois"]);
    // O principal segue o 1º telefone.
    const bia = (await adminClient().from("patients").select("contact_id").eq("id", (await patientId("Bia Importada"))!).single()).data!;
    expect(bia.contact_id).toBe(await contactId("+5584984441101"));
    const { count } = await adminClient().from("patient_contact_events").select("id", { count: "exact", head: true }).eq("contact_id", (await contactId(PAI))!).eq("event", "linked");
    expect(count).toBe(2);
  });

  it("o Desfazer desliga o que a carga ligou, menos quem marcou consulta do paciente", async () => {
    // Depois da carga, o pai marcou uma consulta da Bia.
    const bia = (await patientId("Bia Importada"))!;
    const { error } = await adminClient().from("appointments").insert({
      clinic_id: fx.clinicId,
      patient_id: bia,
      service_id: fx.ids.consulta,
      agenda_id: fx.ids.agendaDra,
      location_id: fx.ids.office,
      scheduled_at: at("2031-03-26", "10:00").toISOString(),
      duration_minutes: 30,
      booking_channel: "portal",
      booked_by_contact_id: await contactId(PAI),
    });
    expect(error).toBeNull();

    const undone = await undoAgendaImport(asDb(support.client), fx.clinicId, requestId, true);
    expect(undone).toMatchObject({ applied: true, linksRemoved: 3 });
    expect(undone.contactsKept).toEqual(expect.arrayContaining([{ name: "Pai Bia", reason: "marcou consulta do paciente" }]));
    expect(undone.contactsKept.filter((c) => c.name === "Pai Bia")).toHaveLength(1);
    expect(await links(PAI)).toEqual(["Bia Importada"]);
    // A avó só cuidava do Paciente Três: sai o contato; o Paciente Três (já cadastrado) fica.
    expect(await contactId(AVO)).toBeNull();
    expect(await patientId("Paciente Três")).not.toBeNull();
    // O responsável da Paciente Dois (já cadastrado) fica, sem o Caio.
    expect(await links(`+55${PREFIX}02`)).toEqual(["Paciente Dois"]);
  });
});
