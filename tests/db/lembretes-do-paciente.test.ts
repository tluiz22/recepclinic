import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import {
  addPatientReminder,
  deletePatientReminder,
  editPatientReminder,
  listDueReminders,
  listPatientReminders,
  setReminderDone,
} from "../../src/lib/data/patientReminders";
import { anonymizePatient } from "../../src/lib/data/patients";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { addMember, adminClient, clinicServiceClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// CRM P3 — lembretes da equipe: a equipe toda lê; Administrador, Recepção e
// Profissional criam e marcam "Feito"; só o autor corrige; só o Administrador
// apaga; autor, horas e quem fez pelo banco; Suporte com auditoria; bot sem
// acesso; os de hoje e os atrasados no Relacionamento; anonimização apaga.

const TODAY = "2031-03-10";

let clinic: AgendaFixture;
let other: AgendaFixture;
let professional: TestUser;
let support: TestUser;

const remindersOf = (db: DbClient, patientId: string) => listPatientReminders(db, clinic.clinicId, patientId);
const add = (db: DbClient, patientId: string, body: string, dueOn: string) => addPatientReminder(db, clinic.clinicId, patientId, { body, dueOn }, TODAY);

beforeAll(async () => {
  clinic = await setupAgendaClinic("Clínica dos lembretes", "849445100");
  other = await setupAgendaClinic("Outra clínica dos lembretes", "849445200");
  [professional, support] = await Promise.all([createUser("lemb-prof"), createUser("lemb-sup")]);
  await addMember(clinic.clinicId, professional.id, ["professional"]);
  await makePlatformStaff(support.id);
});

afterAll(async () => {
  await clinic.cleanup();
  await other.cleanup();
  await deleteUsers([professional, support]);
});

describe("criar", () => {
  it("Recepção, Profissional e Administrador criam; autor pelo banco; abertos pela data", async () => {
    await add(asDb(clinic.reception), clinic.ids.p1, "  Cobrar a guia  ", "2031-03-12");
    await add(asDb(professional), clinic.ids.p1, "Ligar sobre o exame", TODAY);
    await add(asDb(clinic.admin), clinic.ids.p1, "Conferir o pedido", "2031-03-11");
    const list = await remindersOf(asDb(clinic.admin), clinic.ids.p1);
    expect(list.map((r) => [r.body, r.dueOn, r.createdBy, r.doneAt])).toEqual([
      ["Ligar sobre o exame", TODAY, professional.id, null],
      ["Conferir o pedido", "2031-03-11", clinic.admin.id, null],
      ["Cobrar a guia", "2031-03-12", clinic.reception.id, null],
    ]);
  });

  it("autor, horas e \"Feito\" enviados pela API são trocados pelos do banco", async () => {
    const { data, error } = await asDb(clinic.reception)
      .from("patient_reminders")
      .insert({ clinic_id: clinic.clinicId, patient_id: clinic.ids.p2, body: "Forçado", due_on: TODAY, created_by: clinic.admin.id, done_at: "2000-01-01T00:00:00Z", done_by: clinic.admin.id } as never)
      .select("created_by, done_at, done_by")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ created_by: clinic.reception.id, done_at: null, done_by: null });
  });

  it("data no passado, vazio ou longo são recusados; outra clínica e o bot não criam nem leem", async () => {
    expect(await codeOf(() => add(asDb(clinic.reception), clinic.ids.p1, "Atrasado", "2031-03-09"))).toBe("invalid");
    expect(await codeOf(() => add(asDb(clinic.reception), clinic.ids.p1, "  ", TODAY))).toBe("invalid");
    expect(await codeOf(() => add(asDb(clinic.reception), clinic.ids.p1, "x".repeat(501), TODAY))).toBe("invalid");
    expect(await codeOf(() => add(asDb(other.admin), clinic.ids.p1, "Invasão", TODAY))).toBe("forbidden");
    expect(await remindersOf(asDb(other.admin), clinic.ids.p1)).toEqual([]);
    expect(await listDueReminders(asDb(other.admin), clinic.clinicId, TODAY)).toEqual([]);
    const bot = clinicServiceClient(clinic.clinicId) as unknown as DbClient;
    expect((await bot.from("patient_reminders").insert({ clinic_id: clinic.clinicId, patient_id: clinic.ids.p1, body: "bot", due_on: TODAY })).error).not.toBeNull();
    expect((await bot.from("patient_reminders").select("id").eq("clinic_id", clinic.clinicId)).data ?? []).toEqual([]);
  });

  it("o Suporte cria, com auditoria", async () => {
    await add(asDb(support), clinic.ids.p3, "Lembrete do Suporte", TODAY);
    const { data } = await adminClient().from("platform_audit_log").select("operation").eq("table_name", "patient_reminders").eq("actor_user_id", support.id);
    expect(data).toEqual([{ operation: "INSERT" }]);
  });
});

describe("Relacionamento, Feito e Desfazer", () => {
  it("os de hoje e os atrasados, o mais antigo primeiro, com o nome do paciente; os futuros não entram", async () => {
    // Um atrasado: a data muda direto no banco (pela tela, só hoje ou depois).
    const { data } = await adminClient()
      .from("patient_reminders")
      .insert({ clinic_id: clinic.clinicId, patient_id: clinic.ids.p2, body: "Atrasado", due_on: "2031-03-01" })
      .select("id")
      .single();
    const due = await listDueReminders(asDb(clinic.reception), clinic.clinicId, TODAY);
    expect(due.map((r) => r.body)).toEqual(["Atrasado", "Ligar sobre o exame", "Forçado", "Lembrete do Suporte"]);
    expect(due[0].id).toBe(data!.id);
    expect(due[0].person?.fullName).toBeTruthy();
  });

  it("\"Feito\" grava quem e quando e tira do Relacionamento; \"Desfazer\" reabre", async () => {
    const [first] = await listDueReminders(asDb(clinic.reception), clinic.clinicId, TODAY);
    await setReminderDone(asDb(professional), clinic.clinicId, first.id, true);
    const done = (await remindersOf(asDb(clinic.reception), first.patientId)).find((r) => r.id === first.id)!;
    expect(done.doneBy).toBe(professional.id);
    expect(done.doneAt).not.toBeNull();
    expect((await listDueReminders(asDb(clinic.reception), clinic.clinicId, TODAY)).map((r) => r.id)).not.toContain(first.id);
    // Marcar de novo não troca quem fez.
    await setReminderDone(asDb(clinic.reception), clinic.clinicId, first.id, true);
    expect((await remindersOf(asDb(clinic.reception), first.patientId)).find((r) => r.id === first.id)?.doneBy).toBe(professional.id);
    await setReminderDone(asDb(clinic.reception), clinic.clinicId, first.id, false);
    const reopened = (await remindersOf(asDb(clinic.reception), first.patientId)).find((r) => r.id === first.id)!;
    expect([reopened.doneAt, reopened.doneBy]).toEqual([null, null]);
  });

  it("na ficha, os feitos vêm depois dos abertos", async () => {
    const [open] = await remindersOf(asDb(clinic.reception), clinic.ids.p1);
    await setReminderDone(asDb(clinic.reception), clinic.clinicId, open.id, true);
    const list = await remindersOf(asDb(clinic.reception), clinic.ids.p1);
    expect(list.at(-1)?.id).toBe(open.id);
    expect(list.slice(0, -1).every((r) => !r.doneAt)).toBe(true);
  });

  it("outra clínica não marca", async () => {
    const [r] = await remindersOf(asDb(clinic.reception), clinic.ids.p1);
    expect(await codeOf(() => setReminderDone(asDb(other.admin), clinic.clinicId, r.id, true))).toBe("forbidden");
  });
});

describe("corrigir e apagar", () => {
  it("só o autor corrige texto e data (fica \"editado em\"); outra pessoa recebe recusa", async () => {
    const mine = (await remindersOf(asDb(clinic.reception), clinic.ids.p1)).find((r) => r.createdBy === clinic.reception.id)!;
    expect(await codeOf(() => editPatientReminder(asDb(clinic.admin), clinic.clinicId, clinic.ids.p1, mine.id, { body: "Trocado", dueOn: TODAY }))).toBe("forbidden");
    await editPatientReminder(asDb(clinic.reception), clinic.clinicId, clinic.ids.p1, mine.id, { body: "Cobrar a guia do raio-x", dueOn: "2031-03-15" });
    const edited = (await remindersOf(asDb(clinic.reception), clinic.ids.p1)).find((r) => r.id === mine.id)!;
    expect(edited).toMatchObject({ body: "Cobrar a guia do raio-x", dueOn: "2031-03-15", createdBy: clinic.reception.id });
    expect(edited.updatedAt).not.toBeNull();
    // O autor não muda nem pela API.
    await asDb(clinic.reception).from("patient_reminders").update({ created_by: clinic.admin.id } as never).eq("id", mine.id);
    expect((await remindersOf(asDb(clinic.reception), clinic.ids.p1)).find((r) => r.id === mine.id)?.createdBy).toBe(clinic.reception.id);
  });

  it("só o Administrador apaga", async () => {
    const [r] = await remindersOf(asDb(clinic.reception), clinic.ids.p1);
    expect(await codeOf(() => deletePatientReminder(asDb(clinic.reception), clinic.clinicId, clinic.ids.p1, r.id))).toBe("forbidden");
    expect(await codeOf(() => deletePatientReminder(asDb(professional), clinic.clinicId, clinic.ids.p1, r.id))).toBe("forbidden");
    await deletePatientReminder(asDb(clinic.admin), clinic.clinicId, clinic.ids.p1, r.id);
    expect((await remindersOf(asDb(clinic.admin), clinic.ids.p1)).map((x) => x.id)).not.toContain(r.id);
  });
});

describe("anonimização", () => {
  it("apaga os lembretes do paciente", async () => {
    await anonymizePatient(asDb(clinic.admin), clinic.clinicId, clinic.ids.p2);
    const { data } = await adminClient().from("patient_reminders").select("id").eq("patient_id", clinic.ids.p2);
    expect(data).toEqual([]);
  });
});
