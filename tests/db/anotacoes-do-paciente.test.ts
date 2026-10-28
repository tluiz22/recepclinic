import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/lib/data/clients";
import { addPatientNote, deletePatientNote, editPatientNote, listPatientNotes } from "../../src/lib/data/patientNotes";
import { anonymizePatient, registerPatient } from "../../src/lib/data/patients";
import { asDb, codeOf, setupAgendaClinic, type AgendaFixture } from "./agendaFixture";
import { addMember, adminClient, clinicServiceClient, createUser, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";

// CRM P2 — anotações do paciente: a equipe toda lê; Administrador, Recepção e
// Profissional escrevem; só o autor edita ("editada em"); só o Administrador
// apaga; autor e horas pelo banco; Suporte com auditoria; bot sem acesso;
// anonimização apaga; o cadastro com "Anotação" cria a 1ª.

let clinic: AgendaFixture;
let other: AgendaFixture;
let professional: TestUser;
let support: TestUser;

const notesOf = (db: DbClient, patientId: string) => listPatientNotes(db, clinic.clinicId, patientId);

beforeAll(async () => {
  clinic = await setupAgendaClinic("Clínica das anotações", "849444900");
  other = await setupAgendaClinic("Outra clínica das anotações", "849445000");
  [professional, support] = await Promise.all([createUser("nota-prof"), createUser("nota-sup")]);
  await addMember(clinic.clinicId, professional.id, ["professional"]);
  await makePlatformStaff(support.id);
});

afterAll(async () => {
  await clinic.cleanup();
  await other.cleanup();
  await deleteUsers([professional, support]);
});

describe("escrever", () => {
  it("Recepção, Profissional e Administrador escrevem; autor e hora pelo banco; a mais nova primeiro", async () => {
    await addPatientNote(asDb(clinic.reception), clinic.clinicId, clinic.ids.p1, "  Plano pediu o laudo  ");
    await addPatientNote(asDb(professional), clinic.clinicId, clinic.ids.p1, "Retorno em 30 dias");
    const notes = await notesOf(asDb(clinic.admin), clinic.ids.p1);
    expect(notes.map((n) => [n.body, n.createdBy, n.fromObservations, n.updatedAt])).toEqual([
      ["Retorno em 30 dias", professional.id, false, null],
      ["Plano pediu o laudo", clinic.reception.id, false, null],
    ]);
  });

  it("autor, hora e origem enviados pela API são trocados pelos do banco", async () => {
    const { data, error } = await asDb(clinic.reception)
      .from("patient_notes")
      .insert({ clinic_id: clinic.clinicId, patient_id: clinic.ids.p2, body: "Forçado", created_by: clinic.admin.id, created_at: "2000-01-01T00:00:00Z", from_observations: true } as never)
      .select("created_by, created_at, from_observations")
      .single();
    expect(error).toBeNull();
    expect(data!.created_by).toBe(clinic.reception.id);
    expect(new Date(data!.created_at).getFullYear()).toBeGreaterThan(2000);
    expect(data!.from_observations).toBe(false);
  });

  it("vazia ou longa é recusada; outra clínica e o bot não escrevem nem leem", async () => {
    expect(await codeOf(() => addPatientNote(asDb(clinic.reception), clinic.clinicId, clinic.ids.p1, "   "))).toBe("invalid");
    expect(await codeOf(() => addPatientNote(asDb(clinic.reception), clinic.clinicId, clinic.ids.p1, "x".repeat(2001)))).toBe("invalid");
    expect(await codeOf(() => addPatientNote(asDb(other.admin), clinic.clinicId, clinic.ids.p1, "Invasão"))).toBe("forbidden");
    expect(await notesOf(asDb(other.admin), clinic.ids.p1)).toEqual([]);
    const bot = clinicServiceClient(clinic.clinicId) as unknown as DbClient;
    expect((await bot.from("patient_notes").insert({ clinic_id: clinic.clinicId, patient_id: clinic.ids.p1, body: "bot" })).error).not.toBeNull();
    expect((await bot.from("patient_notes").select("id").eq("clinic_id", clinic.clinicId)).data ?? []).toEqual([]);
  });

  it("o Suporte escreve, com auditoria", async () => {
    await addPatientNote(asDb(support), clinic.clinicId, clinic.ids.p3, "Anotação do Suporte");
    const { data } = await adminClient().from("platform_audit_log").select("operation").eq("table_name", "patient_notes").eq("actor_user_id", support.id);
    expect(data).toEqual([{ operation: "INSERT" }]);
  });

  it("o cadastro com \"Anotação\" cria a 1ª anotação, com o autor", async () => {
    const result = await registerPatient(
      asDb(clinic.reception),
      clinic.clinicId,
      { fullName: "Paciente Novo", birthdate: "2020-01-01", notes: "Alérgico a dipirona", contact: { mode: "new", fullName: "Resp. Novo", phone: "84944490099" } },
      "2031-03-09",
    );
    if (result.status !== "created") throw new Error(result.status);
    expect((await notesOf(asDb(clinic.reception), result.patient.id)).map((n) => [n.body, n.createdBy])).toEqual([["Alérgico a dipirona", clinic.reception.id]]);
  });
});

describe("editar e apagar", () => {
  it("só o autor edita (fica \"editada em\"); outra pessoa recebe recusa", async () => {
    const [mine] = (await notesOf(asDb(clinic.reception), clinic.ids.p1)).filter((n) => n.createdBy === clinic.reception.id);
    expect(await codeOf(() => editPatientNote(asDb(clinic.admin), clinic.clinicId, clinic.ids.p1, mine.id, "Trocado pelo admin"))).toBe("forbidden");
    await editPatientNote(asDb(clinic.reception), clinic.clinicId, clinic.ids.p1, mine.id, "Plano pediu o laudo do raio-x");
    const edited = (await notesOf(asDb(clinic.reception), clinic.ids.p1)).find((n) => n.id === mine.id)!;
    expect(edited).toMatchObject({ body: "Plano pediu o laudo do raio-x", createdBy: clinic.reception.id });
    expect(edited.updatedAt).not.toBeNull();
    // Na edição, o autor não muda nem pela API.
    await asDb(clinic.reception).from("patient_notes").update({ body: "De novo", created_by: clinic.admin.id } as never).eq("id", mine.id);
    expect((await notesOf(asDb(clinic.reception), clinic.ids.p1)).find((n) => n.id === mine.id)?.createdBy).toBe(clinic.reception.id);
  });

  it("só o Administrador apaga", async () => {
    const [note] = await notesOf(asDb(clinic.reception), clinic.ids.p1);
    expect(await codeOf(() => deletePatientNote(asDb(clinic.reception), clinic.clinicId, clinic.ids.p1, note.id))).toBe("forbidden");
    expect(await codeOf(() => deletePatientNote(asDb(professional), clinic.clinicId, clinic.ids.p1, note.id))).toBe("forbidden");
    await deletePatientNote(asDb(clinic.admin), clinic.clinicId, clinic.ids.p1, note.id);
    expect((await notesOf(asDb(clinic.admin), clinic.ids.p1)).map((n) => n.id)).not.toContain(note.id);
  });
});

describe("anonimização", () => {
  it("apaga as anotações do paciente", async () => {
    await addPatientNote(asDb(clinic.reception), clinic.clinicId, clinic.ids.p2, "Vai sair na anonimização");
    await anonymizePatient(asDb(clinic.admin), clinic.clinicId, clinic.ids.p2);
    const { data } = await adminClient().from("patient_notes").select("id").eq("patient_id", clinic.ids.p2);
    expect(data).toEqual([]);
  });
});
