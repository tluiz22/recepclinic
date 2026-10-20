import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appointmentField, patientField, type ImportPatient } from "../../src/lib/agendaImport";
import {
  authorizeAgendaImport,
  getAgendaImport,
  getAgendaImportByToken,
  getLatestAgendaImport,
  loadImportCatalog,
  loadImportReview,
  requestAgendaImport,
  returnAgendaImport,
  saveAgendaImport,
  undoAgendaImport,
} from "../../src/lib/data/agendaImport";
import type { DbClient } from "../../src/lib/data/clients";
import { hashToken } from "../../src/lib/data/onboarding";
import { resolveClinicByAgendaImportToken } from "../../src/lib/data/platform";
import type { Email } from "../../src/lib/email";
import { at, codeOf, MON1, MON2, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { adminClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// F10.1a — agenda atual para a importação: o Suporte pede (e-mail com o link
// de 15 dias, ou link novo com o rascunho mantido), a clínica preenche pelo
// link sem login (credencial da clínica) e envia; só sem erro.

const env = { supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!, supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY! };
const TZ = "America/Fortaleza";
const sent: Email[] = [];
const deps = { sendEmail: async (email: Email) => void sent.push(email), baseUrl: "http://localhost:4321" };
const asDb = (client: unknown) => client as DbClient;
const tokenOf = (link: string) => link.split("/importar/")[1];

let fx: AgendaFixture;
let support: TestUser;
let otherClinic: string;
let clinic: { id: string; name: string; timezone: string };

const patient = (over: Partial<ImportPatient> = {}): ImportPatient => ({
  key: "p1",
  name: "Maria Importada",
  birthdate: "1980-05-10",
  phone: "(84) 98188-0777",
  guardianName: "",
  insurancePlanId: "",
  cardNumber: "",
  appointments: [],
  ...over,
});

beforeAll(async () => {
  fx = await setupAgendaClinic("Clínica da importação", "849666600");
  support = await createUser("imp-suporte");
  await makePlatformStaff(support.id);
  otherClinic = await createClinic("Outra clínica (importação)");
  clinic = { id: fx.clinicId, name: "Clínica da importação", timezone: TZ };
  // Horário já ocupado na agenda da Dra.: segunda, 9h às 9h30.
  const { error } = await adminClient().from("appointments").insert({
    clinic_id: fx.clinicId,
    patient_id: fx.ids.p1,
    service_id: fx.ids.consulta,
    agenda_id: fx.ids.agendaDra,
    location_id: fx.ids.office,
    scheduled_at: at(MON1, "09:00").toISOString(),
    duration_minutes: 30,
    booking_channel: "admin",
  });
  expect(error).toBeNull();
});

afterAll(async () => {
  await fx.cleanup();
  await deleteClinics([otherClinic]);
  await deleteUsers([support]);
});

describe("agenda atual", () => {
  let token: string;

  it("o Suporte pede: e-mail com o link, que leva à clínica", async () => {
    const result = await requestAgendaImport(asDb(support.client), support.id, clinic, " Admin@Clinica.com ", deps, NOW);
    expect(result).toMatchObject({ email: { sent: true }, renewed: false });
    token = tokenOf(result.link);
    const email = sent.at(-1)!;
    expect(email.to).toBe("admin@clinica.com");
    expect(email.subject).toBe("Agenda atual da Clínica da importação para o RecepClinic");
    expect(email.text).toContain(result.link);
    expect(email.text).toContain("O link vale até 24/03/2031");
    expect(await resolveClinicByAgendaImportToken(hashToken(token), env)).toBe(fx.clinicId);
    expect(await getLatestAgendaImport(asDb(support.client), fx.clinicId)).toMatchObject({ status: "sent", email: "admin@clinica.com" });
  });

  it("a página vê os serviços, agendas e locais ativos da clínica (sem convênio fora da matriz)", async () => {
    const catalog = await loadImportCatalog(asDb(clinicServiceClient(fx.clinicId)), fx.clinicId);
    expect(catalog.services.map((s) => s.name)).toEqual(["Consulta", "Exame", "Retorno", "Turma"]);
    expect(catalog.services.find((s) => s.name === "Turma")!.group).toBe(true);
    expect(catalog.agendas.map((a) => a.name).sort()).toEqual(["Dr. Segundo", "Dra. Agenda", "Exames"]);
    expect(catalog.serviceAgendas).toContainEqual({ serviceId: fx.ids.exame, agendaId: fx.ids.agendaExams });
    expect(catalog.locations).toContainEqual({ id: fx.ids.home, name: "Domiciliar", homeVisit: true });
    expect(catalog.insurancePlans).toEqual([]);
  });

  it("rascunho com erro fica salvo; o envio só sai sem erro; depois não muda mais", async () => {
    const page = asDb(clinicServiceClient(fx.clinicId));
    const consulta = { key: "a1", date: MON1, time: "09:15", serviceId: fx.ids.consulta, agendaId: fx.ids.agendaDra, locationId: fx.ids.office, homeAddress: "" };
    const draft = [patient({ appointments: [consulta] }), patient({ key: "p2", name: "", birthdate: "" })];

    const saved = await saveAgendaImport(page, fx.clinicId, token, draft, false, TZ, NOW);
    expect(saved.submitted).toBe(false);
    expect(saved.issues[appointmentField("p1", "a1", "time")]).toBe("Esse horário já está ocupado nessa agenda.");
    expect(saved.issues[patientField("p2", "name")]).toBe("Informe o nome do paciente.");
    expect(await getAgendaImportByToken(page, token)).toMatchObject({ status: "draft", entries: draft });

    expect((await saveAgendaImport(page, fx.clinicId, token, draft, true, TZ, NOW)).submitted).toBe(false);
    expect((await getAgendaImportByToken(page, token))!.status).toBe("draft");

    const fixed = [patient({ appointments: [{ ...consulta, time: "09:30" }] })];
    const done = await saveAgendaImport(page, fx.clinicId, token, fixed, true, TZ, NOW);
    expect(done).toEqual({ issues: {}, submitted: true });
    expect(await getAgendaImportByToken(page, token)).toMatchObject({ status: "submitted", submittedAt: expect.any(Date), entries: fixed });

    expect(await codeOf(() => saveAgendaImport(page, fx.clinicId, token, draft, false, TZ, NOW))).toBe("invalid");
    // Enviada: o Suporte confere antes de pedir de novo.
    expect(await codeOf(() => requestAgendaImport(asDb(support.client), support.id, clinic, "admin@clinica.com", deps, NOW))).toBe("invalid");
  });

  it("link novo: o anterior para de funcionar e o rascunho continua", async () => {
    await adminClient().from("agenda_import_requests").update({ status: "loaded" }).eq("clinic_id", fx.clinicId);
    const first = await requestAgendaImport(asDb(support.client), support.id, clinic, "admin@clinica.com", deps, NOW);
    expect(first.renewed).toBe(false);
    const page = asDb(clinicServiceClient(fx.clinicId));
    await saveAgendaImport(page, fx.clinicId, tokenOf(first.link), [patient()], false, TZ, NOW);

    const second = await requestAgendaImport(asDb(support.client), support.id, clinic, "recepcao@clinica.com", deps, NOW);
    expect(second.renewed).toBe(true);
    expect(await resolveClinicByAgendaImportToken(hashToken(tokenOf(first.link)), env)).toBeNull();
    expect(await getAgendaImportByToken(page, tokenOf(second.link))).toMatchObject({ status: "draft", email: "recepcao@clinica.com", entries: [patient()] });
    const { count } = await adminClient().from("agenda_import_requests").select("id", { count: "exact", head: true }).eq("clinic_id", fx.clinicId);
    expect(count).toBe(2);
  });

  it("a página não mexe em outra coisa, nem em pedido de outra clínica, nem depois do prazo", async () => {
    const latest = (await getLatestAgendaImport(asDb(support.client), fx.clinicId))!;
    const renewed = await requestAgendaImport(asDb(support.client), support.id, clinic, latest.email, deps, NOW);
    const current = tokenOf(renewed.link);
    const page = asDb(clinicServiceClient(fx.clinicId));

    for (const change of [{ expires_at: new Date(Date.now() + 9e10).toISOString() }, { email: "outro@x.com" }, { status: "loaded" }, { return_comment: "x" }]) {
      const { error } = await page.from("agenda_import_requests").update(change).eq("token_hash", hashToken(current));
      expect(error?.code).toBe("42501");
    }
    const { error: insertError } = await page.from("agenda_import_requests").insert({ clinic_id: fx.clinicId, token_hash: "0".repeat(64), email: "x@x.com", expires_at: NOW.toISOString() });
    expect(insertError).not.toBeNull();

    const other = asDb(clinicServiceClient(otherClinic));
    expect(await getAgendaImportByToken(other, current)).toBeNull();
    expect(await codeOf(() => saveAgendaImport(other, otherClinic, current, [], false, TZ, NOW))).toBe("not_found");

    // A equipe da clínica não vê o pedido (é do Suporte).
    const { data: seen } = await fx.admin.client.from("agenda_import_requests").select("id").eq("clinic_id", fx.clinicId);
    expect(seen).toEqual([]);

    await adminClient().from("agenda_import_requests").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("token_hash", hashToken(current));
    expect(await codeOf(() => saveAgendaImport(page, fx.clinicId, current, [patient()], false, TZ, NOW))).toBe("invalid");
  });
});

describe("conferência e devolução (F10.1b)", () => {
  let token: string;
  let requestId: string;

  beforeAll(async () => {
    // Pedido anterior encerrado: um novo, enviado com um paciente já cadastrado e um novo.
    await adminClient().from("agenda_import_requests").update({ status: "loaded" }).eq("clinic_id", fx.clinicId);
    const result = await requestAgendaImport(asDb(support.client), support.id, clinic, "admin@clinica.com", deps, NOW);
    token = tokenOf(result.link);
    const page = asDb(clinicServiceClient(fx.clinicId));
    const entries = [
      // Paciente Um do fixture: contato "Resp. Paciente Um", nascido em 2020-01-01.
      patient({
        key: "p1",
        name: "Paciente Um",
        birthdate: "2020-01-01",
        phone: "(84) 96666-0001",
        guardianName: "Outro Nome",
        appointments: [
          { key: "a1", date: MON1, time: "11:45", serviceId: fx.ids.consulta, agendaId: fx.ids.agendaDra, locationId: fx.ids.office, homeAddress: "" },
          { key: "a2", date: MON1, time: "10:00", serviceId: fx.ids.retorno, agendaId: fx.ids.agendaDra, locationId: fx.ids.office, homeAddress: "" },
        ],
      }),
      patient({ key: "p2" }),
    ];
    expect((await saveAgendaImport(page, fx.clinicId, token, entries, true, TZ, NOW)).submitted).toBe(true);
    requestId = (await getLatestAgendaImport(asDb(support.client), fx.clinicId))!.id;
  });

  it("a conferência do Suporte acha o já cadastrado, a diferença, a grade e o retorno", async () => {
    const request = (await getLatestAgendaImport(asDb(support.client), fx.clinicId))!;
    const { review } = await loadImportReview(asDb(support.client), fx.clinicId, request.entries, NOW);
    expect(review.errorCount).toBe(0);
    expect(review.totals).toEqual({ newPatients: 1, existingPatients: 1, appointmentsIn: 2, appointmentsSkipped: 0 });
    const [um, novo] = review.patients;
    expect(um).toMatchObject({ kind: "existing_patient", patientId: fx.ids.p1 });
    expect(um.warnings).toEqual(["WhatsApp já cadastrado em nome de Resp. Paciente Um (no link: Outro Nome). Fica o cadastro."]);
    // 11h45 + 30 min passa das 12h, fim da janela da segunda.
    expect(um.appointments[0].warnings).toEqual(["Fora da grade: fora dos Horários dessa agenda e local."]);
    expect(um.appointments[1].warnings).toEqual(["Retorno: entra sem a Consulta de origem e sem conferir o prazo."]);
    expect(novo.kind).toBe("new");

    // Depois do envio, o horário foi ocupado: vira erro na conferência.
    await adminClient().from("appointments").insert({
      clinic_id: fx.clinicId,
      patient_id: fx.ids.p2,
      service_id: fx.ids.retorno,
      agenda_id: fx.ids.agendaDra,
      location_id: fx.ids.office,
      scheduled_at: at(MON1, "10:00").toISOString(),
      duration_minutes: 20,
      booking_channel: "whatsapp_bot",
    });
    const again = await loadImportReview(asDb(support.client), fx.clinicId, request.entries, NOW);
    expect(again.review.patients[0].appointments[1].errors).toEqual(["Esse horário já está ocupado nessa agenda."]);
    // Uma semana depois, as consultas já passaram: ficam de fora, sem erro.
    const later = await loadImportReview(asDb(support.client), fx.clinicId, request.entries, at("2031-03-17", "08:00"));
    expect(later.review).toMatchObject({ errorCount: 0, totals: { appointmentsIn: 0, appointmentsSkipped: 2 } });
  });

  it("devolver: comentário obrigatório, link novo por e-mail e a clínica volta a editar", async () => {
    expect(await codeOf(() => returnAgendaImport(asDb(support.client), support.id, clinic, requestId, "  ", deps, NOW))).toBe("invalid");
    const result = await returnAgendaImport(asDb(support.client), support.id, clinic, requestId, "Paciente 2: confira o telefone.", deps, NOW);
    expect(result.email).toEqual({ sent: true });
    const email = sent.at(-1)!;
    expect(email.subject).toBe("Agenda atual da Clínica da importação: falta corrigir");
    expect(email.text).toContain("Paciente 2: confira o telefone.");
    expect(email.text).toContain(result.link);
    expect(await resolveClinicByAgendaImportToken(hashToken(token), env)).toBeNull();

    const page = asDb(clinicServiceClient(fx.clinicId));
    const returned = await getAgendaImportByToken(page, tokenOf(result.link));
    expect(returned).toMatchObject({ status: "returned", returnComment: "Paciente 2: confira o telefone." });
    await saveAgendaImport(page, fx.clinicId, tokenOf(result.link), returned!.entries, false, TZ, NOW);
    expect(await getAgendaImportByToken(page, tokenOf(result.link))).toMatchObject({ status: "draft", returnComment: "Paciente 2: confira o telefone." });
    // Só a enviada pode ser devolvida; a clínica não devolve.
    expect(await codeOf(() => returnAgendaImport(asDb(support.client), support.id, clinic, requestId, "de novo", deps, NOW))).toBe("invalid");
    expect(await codeOf(() => returnAgendaImport(asDb(fx.admin.client), fx.admin.id, clinic, requestId, "x", deps, NOW))).toBe("not_found");
  });
});

describe("carga (F10.1c)", () => {
  let requestId: string;
  const usage = async () => {
    const { data } = await adminClient().from("clinic_usage_monthly").select("appointments_created").eq("clinic_id", fx.clinicId);
    return (data ?? []).reduce((n, r) => n + r.appointments_created, 0);
  };
  const consulta = (key: string, date: string, time: string) => ({
    key,
    date,
    time,
    serviceId: fx.ids.consulta,
    agendaId: fx.ids.agendaDra,
    locationId: fx.ids.office,
    homeAddress: "",
  });

  beforeAll(async () => {
    await adminClient().from("agenda_import_requests").update({ status: "loaded" }).eq("clinic_id", fx.clinicId).neq("status", "loaded");
    // Paciente Dois inativo: volta a ficar ativo com a consulta da carga.
    await adminClient().from("patients").update({ is_active: false }).eq("id", fx.ids.p2);
    const result = await requestAgendaImport(asDb(support.client), support.id, clinic, "admin@clinica.com", deps, NOW);
    const page = asDb(clinicServiceClient(fx.clinicId));
    const entries = [
      patient({ key: "p1", name: "Paciente Dois", birthdate: "2020-01-01", phone: "(84) 96666-0002", guardianName: "Resp. Paciente Dois", appointments: [consulta("a1", MON2, "08:00")] }),
      patient({ key: "p2", name: "Carla Nova", birthdate: "1985-02-02", phone: "(84) 98222-1100", appointments: [consulta("a2", MON2, "08:30")] }),
      patient({ key: "p3", name: "Davi Novo", birthdate: "2019-03-03", phone: "(84) 98222-1100", guardianName: "Carla Nova", appointments: [consulta("a3", MON2, "09:00")] }),
      patient({ key: "p4", name: "Sem Consulta", birthdate: "1970-04-04", phone: "(84) 98222-3300" }),
    ];
    expect((await saveAgendaImport(page, fx.clinicId, tokenOf(result.link), entries, true, TZ, NOW)).submitted).toBe(true);
    requestId = (await getLatestAgendaImport(asDb(support.client), fx.clinicId))!.id;
  });

  it("só o Suporte autoriza; a equipe da clínica não chama a carga", async () => {
    const { error } = await fx.admin.client.rpc("load_agenda_import", { p_request_id: requestId, p_plan: [] });
    expect(error?.code).toBe("42501");
  });

  it("grava tudo, sem aviso de marcação, fora do Uso e com a trilha de importado", async () => {
    const usageBefore = await usage();
    const loaded = await authorizeAgendaImport(asDb(support.client), fx.clinicId, requestId, NOW);
    expect(loaded).toEqual({ contacts: 2, patients: 3, appointments: 3, reactivated: 1 });

    const { data: appointments } = await adminClient()
      .from("appointments")
      .select("id, patient_id, booking_channel, created_by, agenda_import_id, status, price_cents")
      .eq("agenda_import_id", requestId);
    expect(appointments).toHaveLength(3);
    for (const a of appointments!) expect(a).toMatchObject({ booking_channel: "admin", created_by: support.id, status: "scheduled", price_cents: 30000 });
    expect(appointments!.some((a) => a.patient_id === fx.ids.p2)).toBe(true);

    const ids = appointments!.map((a) => a.id);
    const { data: events } = await adminClient().from("appointment_events").select("event_type, details, actor_id").in("appointment_id", ids);
    expect(events).toHaveLength(3);
    for (const e of events!) expect(e).toEqual({ event_type: "created", details: { imported: true }, actor_id: support.id });
    const { count: messages } = await adminClient().from("whatsapp_messages").select("id", { count: "exact", head: true }).in("appointment_id", ids);
    expect(messages).toBe(0);
    expect(await usage()).toBe(usageBefore);

    // Já cadastrado: fica como está (nome do contato) e volta a ficar ativo.
    const { data: dois } = await adminClient().from("patients").select("is_active, agenda_import_id, contacts ( full_name )").eq("id", fx.ids.p2).single();
    expect(dois).toMatchObject({ is_active: true, agenda_import_id: null, contacts: { full_name: "Resp. Paciente Dois" } });

    // Mesmo WhatsApp: um contato só; a mãe é o próprio contato e o filho é dependente.
    const { data: carla } = await adminClient()
      .from("contacts")
      .select("full_name, agenda_import_id, patients ( full_name, is_contact_self, agenda_import_id )")
      .eq("clinic_id", fx.clinicId)
      .eq("phone", "+5584982221100")
      .single();
    expect(carla!.full_name).toBe("Carla Nova");
    expect(carla!.agenda_import_id).toBe(requestId);
    expect(carla!.patients.map((p) => [p.full_name, p.is_contact_self, p.agenda_import_id]).sort()).toEqual([
      ["Carla Nova", true, requestId],
      ["Davi Novo", false, requestId],
    ]);
    const { data: semConsulta } = await adminClient().from("contacts").select("id").eq("clinic_id", fx.clinicId).eq("phone", "+5584982223300");
    expect(semConsulta).toHaveLength(1);

    expect(await getAgendaImport(asDb(support.client), fx.clinicId, requestId)).toMatchObject({ status: "loaded", loadedAt: expect.any(Date) });
    expect(await codeOf(() => authorizeAgendaImport(asDb(support.client), fx.clinicId, requestId, NOW))).toBe("invalid");
  });

  it("com erro na conferência da hora, não grava nada", async () => {
    const result = await requestAgendaImport(asDb(support.client), support.id, clinic, "admin@clinica.com", deps, NOW);
    const page = asDb(clinicServiceClient(fx.clinicId));
    const entries = [patient({ key: "p1", name: "Erro Depois", phone: "(84) 98222-4400", appointments: [consulta("a1", MON2, "10:00")] })];
    expect((await saveAgendaImport(page, fx.clinicId, tokenOf(result.link), entries, true, TZ, NOW)).submitted).toBe(true);
    const id = (await getLatestAgendaImport(asDb(support.client), fx.clinicId))!.id;
    // O horário é ocupado depois do envio.
    await adminClient().from("appointments").insert({
      clinic_id: fx.clinicId,
      patient_id: fx.ids.p3,
      service_id: fx.ids.consulta,
      agenda_id: fx.ids.agendaDra,
      location_id: fx.ids.office,
      scheduled_at: at(MON2, "10:00").toISOString(),
      duration_minutes: 30,
      booking_channel: "whatsapp_bot",
    });
    expect(await codeOf(() => authorizeAgendaImport(asDb(support.client), fx.clinicId, id, NOW))).toBe("invalid");
    const { count } = await adminClient().from("contacts").select("id", { count: "exact", head: true }).eq("phone", "+5584982224400");
    expect(count).toBe(0);
    expect((await getLatestAgendaImport(asDb(support.client), fx.clinicId))!.status).toBe("submitted");
  });
});

describe("desfazer a carga (F10.1d)", () => {
  let requestId: string;
  const consulta = (key: string, time: string) => ({
    key,
    date: "2031-03-24",
    time,
    serviceId: fx.ids.consulta,
    agendaId: fx.ids.agendaDra,
    locationId: fx.ids.office,
    homeAddress: "",
  });
  const importedIds = async () => {
    const { data } = await adminClient().from("appointments").select("id, scheduled_at").eq("agenda_import_id", requestId).order("scheduled_at");
    return data!.map((a) => a.id);
  };

  beforeAll(async () => {
    await adminClient().from("agenda_import_requests").update({ status: "loaded" }).eq("clinic_id", fx.clinicId).neq("status", "loaded").neq("status", "undone");
    const result = await requestAgendaImport(asDb(support.client), support.id, clinic, "admin@clinica.com", deps, NOW);
    const page = asDb(clinicServiceClient(fx.clinicId));
    const entries = [
      // Já cadastrado (Paciente Três): só ganha a consulta.
      patient({ key: "p1", name: "Paciente Três", birthdate: "2020-01-01", phone: "(84) 96666-0003", guardianName: "Resp. Paciente Três", appointments: [consulta("a1", "08:00")] }),
      patient({ key: "p2", name: "Rita Desfazer", birthdate: "1980-01-01", phone: "(84) 98333-1100", appointments: [consulta("a2", "08:30"), consulta("a3", "09:00")] }),
      patient({ key: "p3", name: "Tito Desfazer", birthdate: "1981-01-01", phone: "(84) 98333-2200", appointments: [consulta("a4", "09:30")] }),
    ];
    expect((await saveAgendaImport(page, fx.clinicId, tokenOf(result.link), entries, true, TZ, NOW)).submitted).toBe(true);
    requestId = (await getLatestAgendaImport(asDb(support.client), fx.clinicId))!.id;
    await authorizeAgendaImport(asDb(support.client), fx.clinicId, requestId, NOW);
    // A consulta das 9h da Rita foi remarcada pela clínica depois da carga.
    const [, , rita9] = await importedIds();
    await adminClient().from("appointments").update({ rescheduled_at: new Date().toISOString() }).eq("id", rita9);
  });

  it("a prévia mostra o que sai e o que fica, sem mudar nada", async () => {
    const before = await importedIds();
    const preview = await undoAgendaImport(asDb(support.client), fx.clinicId, requestId, false);
    expect(preview).toMatchObject({ applied: false, appointmentsRemoved: 3, patientsRemoved: 1, contactsRemoved: 1 });
    expect(preview.appointmentsKept).toEqual([{ patientName: "Rita Desfazer", serviceName: "Consulta", scheduledAt: at("2031-03-24", "09:00"), reasons: ["remarcada"] }]);
    expect(preview.patientsKept).toEqual([{ name: "Rita Desfazer", reason: "tem consulta" }]);
    expect(preview.contactsKept).toEqual([{ name: "Rita Desfazer", reason: "tem paciente" }]);
    expect(await importedIds()).toEqual(before);
    expect((await getAgendaImport(asDb(support.client), fx.clinicId, requestId))!.status).toBe("loaded");
  });

  it("só o Suporte desfaz", async () => {
    const { error } = await fx.admin.client.rpc("undo_agenda_import", { p_request_id: requestId, p_apply: true });
    expect(error?.code).toBe("42501");
  });

  it("desfaz: saem as não mexidas e os cadastros sem uso; ficam o resto e quem já existia", async () => {
    const undone = await undoAgendaImport(asDb(support.client), fx.clinicId, requestId, true);
    expect(undone).toMatchObject({ applied: true, appointmentsRemoved: 3, patientsRemoved: 1, contactsRemoved: 1 });
    expect(await importedIds()).toHaveLength(1);
    const { count: tito } = await adminClient().from("contacts").select("id", { count: "exact", head: true }).eq("phone", "+5584983332200");
    expect(tito).toBe(0);
    const { count: tres } = await adminClient().from("patients").select("id", { count: "exact", head: true }).eq("id", fx.ids.p3);
    expect(tres).toBe(1);
    expect(await getAgendaImport(asDb(support.client), fx.clinicId, requestId)).toMatchObject({ status: "undone" });
    expect(await codeOf(() => undoAgendaImport(asDb(support.client), fx.clinicId, requestId, true))).toBe("invalid");
  });
});

