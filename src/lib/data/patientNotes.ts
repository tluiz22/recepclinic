import type { DbClient } from "./clients";
import { DataError, unwrap } from "./errors";

// Anotações do paciente (CRM P2, cliente, 28/out/2026): uma lista datada, com
// o autor, no lugar do campo único "Observações" (as de antes viraram a 1ª
// anotação de cada paciente). A equipe toda lê; Administrador, Recepção e
// Profissional escrevem; só o autor edita; só o Administrador apaga. O banco
// põe o autor e as horas e confere tudo (20261029130000_anotacoes_do_paciente.sql).

export const NOTE_MAX = 2000;

export type PatientNote = {
  id: string;
  body: string;
  /** Veio das Observações antigas (sem autor). */
  fromObservations: boolean;
  createdAt: Date;
  createdBy: string | null;
  /** "Editada em …". */
  updatedAt: Date | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Texto da anotação: sem espaços nas pontas, de 1 a 2000 caracteres. */
export function cleanNoteBody(raw: string | null | undefined): string {
  const body = (raw ?? "").trim();
  if (!body) throw new DataError("invalid", "Anotação: vazia", { body: "Escreva a anotação." });
  if (body.length > NOTE_MAX) throw new DataError("invalid", "Anotação: longa", { body: `A anotação vai até ${NOTE_MAX} caracteres.` });
  return body;
}

const denied = (code: string | undefined, what: string) =>
  code === "42501" ? new DataError("forbidden", `Anotação: sem permissão para ${what}`) : null;

export async function listPatientNotes(db: DbClient, clinicId: string, patientId: string): Promise<PatientNote[]> {
  const rows = unwrap(
    await db
      .from("patient_notes")
      .select("id, body, from_observations, created_at, created_by, updated_at")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false }),
    "Anotações",
  );
  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    fromObservations: row.from_observations,
    createdAt: new Date(row.created_at),
    createdBy: row.created_by,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  }));
}

export async function addPatientNote(db: DbClient, clinicId: string, patientId: string, raw: string): Promise<string> {
  const body = cleanNoteBody(raw);
  if (!UUID.test(patientId)) throw new DataError("not_found", "Anotação: paciente não encontrado");
  const { data, error } = await db.from("patient_notes").insert({ clinic_id: clinicId, patient_id: patientId, body }).select("id").single();
  if (error) throw denied((error as { code?: string }).code, "escrever") ?? new DataError("unexpected", `Anotação: ${error.message}`, {}, { cause: error });
  return data.id;
}

/** Só o autor edita (o banco confere): sem linha alterada = não é dele ou não existe. */
export async function editPatientNote(db: DbClient, clinicId: string, patientId: string, noteId: string, raw: string): Promise<void> {
  const body = cleanNoteBody(raw);
  if (!UUID.test(noteId)) throw new DataError("not_found", "Anotação: não encontrada");
  const { data, error } = await db.from("patient_notes").update({ body }).eq("clinic_id", clinicId).eq("patient_id", patientId).eq("id", noteId).select("id");
  if (error) throw new DataError("unexpected", `Anotação: ${error.message}`, {}, { cause: error });
  if (!data?.length) throw new DataError("forbidden", "Anotação: só quem escreveu pode editar");
}

/** Só o Administrador apaga (o banco confere). */
export async function deletePatientNote(db: DbClient, clinicId: string, patientId: string, noteId: string): Promise<void> {
  if (!UUID.test(noteId)) throw new DataError("not_found", "Anotação: não encontrada");
  const { data, error } = await db.from("patient_notes").delete().eq("clinic_id", clinicId).eq("patient_id", patientId).eq("id", noteId).select("id");
  if (error) throw new DataError("unexpected", `Anotação: ${error.message}`, {}, { cause: error });
  if (!data?.length) throw new DataError("forbidden", "Anotação: só o Administrador apaga");
}
