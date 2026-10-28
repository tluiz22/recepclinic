import { isCalendarDate } from "../clinicTime";
import type { DbClient } from "./clients";
import { DataError, unwrap } from "./errors";
import { loadPatientContacts, type PatientContact } from "./people";

// Lembretes da equipe (CRM P3, cliente, 28/out/2026): um texto com data na
// ficha do paciente. A equipe toda lê; Administrador, Recepção e Profissional
// criam e marcam "Feito"; só o autor corrige; só o Administrador apaga. Os
// abertos de hoje e os atrasados vão para a aba "Lembretes da equipe" do
// Relacionamento; os feitos ficam no histórico da ficha. O banco põe o autor,
// as horas e quem fez (20261029140000_lembretes_do_paciente.sql).

export const REMINDER_MAX = 500;

export type PatientReminder = {
  id: string;
  patientId: string;
  body: string;
  /** Data do lembrete (aaaa-mm-dd, no calendário da clínica). */
  dueOn: string;
  createdAt: Date;
  createdBy: string | null;
  /** "Editado em …". */
  updatedAt: Date | null;
  doneAt: Date | null;
  doneBy: string | null;
};

export type DueReminder = PatientReminder & { person: PatientContact | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, patient_id, body, due_on, created_at, created_by, updated_at, done_at, done_by";

type Row = {
  id: string;
  patient_id: string;
  body: string;
  due_on: string;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  done_at: string | null;
  done_by: string | null;
};

const toReminder = (row: Row): PatientReminder => ({
  id: row.id,
  patientId: row.patient_id,
  body: row.body,
  dueOn: row.due_on,
  createdAt: new Date(row.created_at),
  createdBy: row.created_by,
  updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  doneAt: row.done_at ? new Date(row.done_at) : null,
  doneBy: row.done_by,
});

/**
 * Texto (1 a 500 caracteres) e data do lembrete. Ao criar, a data não pode
 * ficar no passado (`today` = hoje na clínica); ao corrigir, vale qualquer data.
 */
export function cleanReminder(rawBody: string | null | undefined, rawDue: string | null | undefined, today: string | null): { body: string; dueOn: string } {
  const body = (rawBody ?? "").trim();
  const dueOn = (rawDue ?? "").trim();
  if (!body) throw new DataError("invalid", "Lembrete: vazio", { body: "Escreva o lembrete." });
  if (body.length > REMINDER_MAX) throw new DataError("invalid", "Lembrete: longo", { body: `O lembrete vai até ${REMINDER_MAX} caracteres.` });
  if (!isCalendarDate(dueOn)) throw new DataError("invalid", "Lembrete: data", { due_on: "Escolha a data do lembrete." });
  if (today && dueOn < today) throw new DataError("invalid", "Lembrete: data no passado", { due_on: "A data não pode ser antes de hoje." });
  return { body, dueOn };
}

const failed = (error: { message: string; code?: string }, what: string) =>
  error.code === "42501"
    ? new DataError("forbidden", `Lembrete: sem permissão para ${what}`)
    : new DataError("unexpected", `Lembrete: ${error.message}`, {}, { cause: error });

/** Os do paciente: abertos pela data (o mais antigo primeiro), depois os feitos (o mais recente primeiro). */
export async function listPatientReminders(db: DbClient, clinicId: string, patientId: string): Promise<PatientReminder[]> {
  const rows = unwrap(
    await db.from("patient_reminders").select(COLUMNS).eq("clinic_id", clinicId).eq("patient_id", patientId).order("due_on").order("created_at"),
    "Lembretes",
  ).map(toReminder);
  const open = rows.filter((r) => !r.doneAt);
  const done = rows.filter((r) => r.doneAt).sort((a, b) => b.doneAt!.getTime() - a.doneAt!.getTime());
  return [...open, ...done];
}

/** Abertos com data até hoje (os de hoje e os atrasados), o mais antigo primeiro, com o nome e o contato do paciente. */
export async function listDueReminders(db: DbClient, clinicId: string, today: string): Promise<DueReminder[]> {
  const reminders = unwrap(
    await db
      .from("patient_reminders")
      .select(COLUMNS)
      .eq("clinic_id", clinicId)
      .is("done_at", null)
      .lte("due_on", today)
      .order("due_on")
      .order("created_at"),
    "Lembretes da equipe",
  ).map(toReminder);
  const people = await loadPatientContacts(db, clinicId, reminders.map((r) => r.patientId));
  return reminders.map((r) => ({ ...r, person: people.get(r.patientId) ?? null }));
}

export async function addPatientReminder(db: DbClient, clinicId: string, patientId: string, raw: { body: string; dueOn: string }, today: string): Promise<string> {
  const { body, dueOn } = cleanReminder(raw.body, raw.dueOn, today);
  if (!UUID.test(patientId)) throw new DataError("not_found", "Lembrete: paciente não encontrado");
  const { data, error } = await db.from("patient_reminders").insert({ clinic_id: clinicId, patient_id: patientId, body, due_on: dueOn }).select("id").single();
  if (error) throw failed(error, "criar");
  return data.id;
}

/** Só o autor corrige (o banco confere). */
export async function editPatientReminder(db: DbClient, clinicId: string, patientId: string, reminderId: string, raw: { body: string; dueOn: string }): Promise<void> {
  const { body, dueOn } = cleanReminder(raw.body, raw.dueOn, null);
  if (!UUID.test(reminderId)) throw new DataError("not_found", "Lembrete: não encontrado");
  const { data, error } = await db
    .from("patient_reminders")
    .update({ body, due_on: dueOn })
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .eq("id", reminderId)
    .select("id");
  if (error) throw failed(error, "corrigir");
  if (!data?.length) throw new DataError("forbidden", "Lembrete: sem permissão para corrigir");
}

/** "Feito" (o banco grava quem e quando) ou "Desfazer". */
export async function setReminderDone(db: DbClient, clinicId: string, reminderId: string, done: boolean): Promise<void> {
  if (!UUID.test(reminderId)) throw new DataError("not_found", "Lembrete: não encontrado");
  const { data, error } = await db
    .from("patient_reminders")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("clinic_id", clinicId)
    .eq("id", reminderId)
    .select("id");
  if (error) throw failed(error, "marcar");
  if (!data?.length) throw new DataError("forbidden", "Lembrete: sem permissão para marcar");
}

/** Só o Administrador apaga (o banco confere). */
export async function deletePatientReminder(db: DbClient, clinicId: string, patientId: string, reminderId: string): Promise<void> {
  if (!UUID.test(reminderId)) throw new DataError("not_found", "Lembrete: não encontrado");
  const { data, error } = await db.from("patient_reminders").delete().eq("clinic_id", clinicId).eq("patient_id", patientId).eq("id", reminderId).select("id");
  if (error) throw failed(error, "apagar");
  if (!data?.length) throw new DataError("forbidden", "Lembrete: só o Administrador apaga");
}
