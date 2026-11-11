import type { DbClient } from "../clients";
import { unwrap } from "../errors";

// Para quem vão as mensagens de um atendimento (D14, VR3; cliente, 10/nov/2026): para quem marcou
// (`appointments.booked_by_contact_id`), não para o principal da ficha. Confirmação, lembrete, avisos da clínica,
// preparo, orientações e lista de espera. As consultas de antes da D14 ficaram com o principal (VR1); sem quem marcou
// (ou com o número apagado), vai para o principal, como antes.

export type RecipientContact = { id: string; full_name: string; phone: string };

/** Pedaço do `select` do atendimento com quem marcou. */
export const BOOKER_COLUMNS = "booker:contacts!appointments_booked_by_contact_fkey ( id, full_name, phone )";

export function appointmentRecipient(row: { booker?: RecipientContact | null; patients: { contacts: RecipientContact } }): RecipientContact {
  return row.booker?.phone ? row.booker : row.patients.contacts;
}

/** O mesmo, no formato das telas (`fullName`). */
export function appointmentRecipientContact(row: Parameters<typeof appointmentRecipient>[0]): { id: string; fullName: string; phone: string } {
  const { id, full_name: fullName, phone } = appointmentRecipient(row);
  return { id, fullName, phone };
}

/**
 * O celular é de um responsável ligado ao paciente (principal ou não)? Vale para o toque "Confirmar" do lembrete
 * (UI-5: qualquer responsável ligado confirma).
 */
export async function phoneCaresForPatient(db: DbClient, clinicId: string, patientId: string, phone: string): Promise<boolean> {
  const rows = unwrap(
    await db
      .from("patient_contacts")
      .select("contact_id, contacts!inner ( phone )")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .eq("contacts.phone", phone)
      .limit(1),
    "Responsáveis do paciente",
  );
  return rows.length > 0;
}

/** Quem recebe as mensagens deste atendimento (quem marcou; senão o principal); null = sem celular. */
export async function recipientOfAppointment(db: DbClient, clinicId: string, appointmentId: string): Promise<RecipientContact | null> {
  const row = unwrap(
    await db
      .from("appointments")
      .select(`patients ( contacts ( id, full_name, phone ) ), ${BOOKER_COLUMNS}`)
      .eq("clinic_id", clinicId)
      .eq("id", appointmentId)
      .maybeSingle(),
    "Atendimento",
  ) as unknown as { booker: RecipientContact | null; patients: { contacts: RecipientContact | null } | null } | null;
  if (!row) return null;
  const contact = row.booker?.phone ? row.booker : row.patients?.contacts;
  return contact?.phone ? contact : null;
}
