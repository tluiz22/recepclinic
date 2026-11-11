import type { DbClient } from "./clients";
import { DataError, fromDbError, unwrap } from "./errors";

// Vários responsáveis por paciente (D14; VR1, cliente, 10/nov/2026). A ficha tem uma lista de responsáveis
// (`patient_contacts`); `patients.contact_id` é o principal. Ligar, desligar e tornar principal só pelas funções do
// banco (Administrador, Recepção e Suporte), com registro em `patient_contact_events`.

export type PatientContact = {
  contactId: string;
  fullName: string;
  phone: string;
  /** "Mãe", "Pai"…; opcional. */
  kinship: string | null;
  isPrimary: boolean;
  /** O número é do próprio paciente. */
  isSelf: boolean;
};

type Row = {
  contact_id: string;
  kinship: string | null;
  is_self: boolean;
  created_at: string;
  contacts: { full_name: string; phone: string } | null;
  patients: { contact_id: string } | null;
};

/** Responsáveis do paciente: o principal primeiro, depois pela ordem em que foram ligados. */
export async function listPatientContacts(db: DbClient, clinicId: string, patientId: string): Promise<PatientContact[]> {
  const rows = unwrap(
    await db
      .from("patient_contacts")
      .select("contact_id, kinship, is_self, created_at, contacts ( full_name, phone ), patients ( contact_id )")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .order("created_at"),
    "Responsáveis do paciente",
  ) as unknown as Row[];
  return rows
    .map((row) => ({
      contactId: row.contact_id,
      fullName: row.contacts?.full_name ?? "",
      phone: row.contacts?.phone ?? "",
      kinship: row.kinship,
      isPrimary: row.patients?.contact_id === row.contact_id,
      isSelf: row.is_self,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

/** Pacientes deste número (principal ou não): a função do banco que todo o código usa (D14). */
export async function contactPatientIds(db: DbClient, clinicId: string, contactId: string): Promise<string[]> {
  const rows = unwrap(await db.rpc("contact_patient_ids", { p_clinic_id: clinicId, p_contact_id: contactId }), "Pacientes do contato");
  return (rows as unknown as string[]) ?? [];
}

// O banco responde com P0001 e a dica (o P0002 volta como erro 500 pela API).
const NOT_FOUND = new Set(["contact_not_found", "patient_not_found", "not_linked"]);
const HINTS: Record<string, string> = {
  patient_not_found: "Paciente não encontrado",
  already_linked: "Este responsável já está ligado ao paciente",
  contact_inactive: "Responsável desativado",
  contact_not_found: "Responsável não encontrado",
  not_linked: "Este responsável não está ligado ao paciente",
  is_primary: "O responsável principal não pode ser desligado: torne outro principal antes",
  anonymized: "Paciente anonimizado",
};

function toError(error: { code?: string; hint?: string; message?: string }, context: string): DataError {
  const text = error.hint ? HINTS[error.hint] : undefined;
  if (text) return new DataError(NOT_FOUND.has(error.hint!) ? "not_found" : "invalid", `${context}: ${text}`, {}, { cause: error });
  return fromDbError(error, context);
}

export async function linkPatientContact(db: DbClient, clinicId: string, patientId: string, contactId: string, kinship: string | null = null): Promise<void> {
  const { error } = await db.rpc("link_patient_contact", {
    p_clinic_id: clinicId,
    p_patient_id: patientId,
    p_contact_id: contactId,
    p_kinship: kinship ?? undefined,
  });
  if (error) throw toError(error, "Ligar responsável");
}

/** Devolve quantas consultas futuras marcadas por ele passaram ao principal (avisos e lembretes). */
export async function unlinkPatientContact(db: DbClient, clinicId: string, patientId: string, contactId: string): Promise<number> {
  const { data, error } = await db.rpc("unlink_patient_contact", { p_clinic_id: clinicId, p_patient_id: patientId, p_contact_id: contactId });
  if (error) throw toError(error, "Desligar responsável");
  return (data as number | null) ?? 0;
}

export async function setPrimaryContact(db: DbClient, clinicId: string, patientId: string, contactId: string): Promise<void> {
  const { error } = await db.rpc("set_patient_primary_contact", { p_clinic_id: clinicId, p_patient_id: patientId, p_contact_id: contactId });
  if (error) throw toError(error, "Tornar principal");
}
