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

/** Nome comparável: sem acento, sem caixa e sem espaço repetido (ficha parecida, UI-2). */
export const comparableName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export type SimilarRecord = { id: string; fullName: string; birthdate: string; futureAppointments: number };

/**
 * Ficha parecida (UI-2, VR-4): um paciente ativo que o número já cuida, com o mesmo nome e nascimento da ficha em que
 * ele vai ser ligado. A recepção pode desativá-la na mesma ação; nada passa de uma ficha para a outra.
 */
export async function similarRecordsOfContact(
  db: DbClient,
  clinicId: string,
  contactId: string,
  patient: { id: string; fullName: string; birthdate: string },
  now: Date = new Date(),
): Promise<SimilarRecord[]> {
  const ids = (await contactPatientIds(db, clinicId, contactId)).filter((id) => id !== patient.id);
  if (ids.length === 0) return [];
  const rows = unwrap(
    await db.from("patients").select("id, full_name, birthdate").eq("clinic_id", clinicId).eq("is_active", true).in("id", ids),
    "Fichas do responsável",
  );
  const name = comparableName(patient.fullName);
  const similar = rows.filter((row) => row.birthdate === patient.birthdate && comparableName(row.full_name) === name);
  if (similar.length === 0) return [];
  const future = unwrap(
    await db
      .from("appointments")
      .select("patient_id")
      .eq("clinic_id", clinicId)
      .in("patient_id", similar.map((row) => row.id))
      .in("status", ["scheduled", "confirmed"])
      .gt("scheduled_at", now.toISOString()),
    "Consultas futuras da ficha parecida",
  );
  return similar.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    birthdate: row.birthdate,
    futureAppointments: future.filter((a) => a.patient_id === row.id).length,
  }));
}

export type ContactLinkedPatient = { id: string; fullName: string; birthdate: string; isActive: boolean; kinship: string | null; isPrimary: boolean };

/** Pacientes que o número cuida (principal ou não), para a página do contato (VR2). */
export async function listContactLinkedPatients(db: DbClient, clinicId: string, contactId: string): Promise<ContactLinkedPatient[]> {
  const rows = unwrap(
    await db
      .from("patient_contacts")
      .select("kinship, patients ( id, full_name, birthdate, is_active, contact_id )")
      .eq("clinic_id", clinicId)
      .eq("contact_id", contactId),
    "Pacientes do responsável",
  ) as unknown as { kinship: string | null; patients: { id: string; full_name: string; birthdate: string; is_active: boolean; contact_id: string } | null }[];
  return rows
    .filter((row) => row.patients)
    .map((row) => ({
      id: row.patients!.id,
      fullName: row.patients!.full_name,
      birthdate: row.patients!.birthdate,
      isActive: row.patients!.is_active,
      kinship: row.kinship,
      isPrimary: row.patients!.contact_id === contactId,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "pt-BR"));
}

/** Nome do responsável como aparece na tela: "Carlos (pai)"; o próprio paciente, "o próprio paciente". */
export function responsibleLabel(c: Pick<PatientContact, "fullName" | "kinship" | "isSelf">, selfLabel: string): string {
  if (c.isSelf) return selfLabel;
  const first = c.fullName.trim().split(/\s+/)[0] ?? c.fullName;
  return c.kinship ? `${first} (${c.kinship.toLowerCase()})` : first;
}

/**
 * Para quem vão a confirmação e o lembrete quando a recepção marca (UI-6, VR-1): o responsável escolhido no Marcar.
 * Sem escolha (ou o principal), nada muda: o banco já põe o principal. O banco recusa quem não é responsável.
 */
export async function setAppointmentsBooker(db: DbClient, clinicId: string, appointmentIds: string[], contactId: string | null): Promise<void> {
  if (!contactId || appointmentIds.length === 0) return;
  const { error } = await db.from("appointments").update({ booked_by_contact_id: contactId }).eq("clinic_id", clinicId).in("id", appointmentIds);
  if (error) throw error.hint === "booked_by_not_linked" ? new DataError("invalid", "Atendimento: este número não é responsável pelo paciente", { booked_by_contact_id: "Escolha um responsável ligado ao paciente." }) : fromDbError(error, "Quem recebe os avisos");
}
