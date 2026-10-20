import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appointmentField, patientField, type ImportPatient } from "../../src/lib/agendaImport";
import {
  getAgendaImportByToken,
  getLatestAgendaImport,
  loadImportCatalog,
  requestAgendaImport,
  saveAgendaImport,
} from "../../src/lib/data/agendaImport";
import type { DbClient } from "../../src/lib/data/clients";
import { hashToken } from "../../src/lib/data/onboarding";
import { resolveClinicByAgendaImportToken } from "../../src/lib/data/platform";
import type { Email } from "../../src/lib/email";
import { at, codeOf, MON1, NOW, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
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
