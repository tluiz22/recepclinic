import { normalizePhone } from "../../phone";
import type { DbClient } from "../clients";
import { cleanText, unwrap, unwrapOne, Validation } from "../errors";

// Contatos que recebem o resumo do dia pelo WhatsApp (como no piloto: saem
// por desativação, e cada um escolhe consultas e/ou exames).

export type NotificationRecipient = {
  id: string;
  label: string;
  /** E.164 (+55…). */
  phone: string;
  receivesConsultations: boolean;
  receivesExams: boolean;
  isActive: boolean;
};

export type NotificationRecipientInput = Omit<NotificationRecipient, "id" | "isActive">;

const COLUMNS = "id, label, phone, receives_consultations, receives_exams, is_active";

type Row = {
  id: string;
  label: string;
  phone: string;
  receives_consultations: boolean;
  receives_exams: boolean;
  is_active: boolean;
};

const toRecipient = (row: Row): NotificationRecipient => ({
  id: row.id,
  label: row.label,
  phone: row.phone,
  receivesConsultations: row.receives_consultations,
  receivesExams: row.receives_exams,
  isActive: row.is_active,
});

export function validateNotificationRecipient(input: NotificationRecipientInput) {
  const v = new Validation();
  const row = {
    label: cleanText(input.label) ?? "",
    phone: normalizePhone(input.phone ?? ""),
    receives_consultations: !!input.receivesConsultations,
    receives_exams: !!input.receivesExams,
  };
  v.check(row.label.length > 0, "label", "Informe o nome do contato");
  v.check(row.phone !== null, "phone", "Telefone inválido");
  v.throwIfInvalid("Contato do resumo do dia");
  return { ...row, phone: row.phone! };
}

export async function listNotificationRecipients(
  db: DbClient,
  clinicId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<NotificationRecipient[]> {
  let query = db.from("notification_recipients").select(COLUMNS).eq("clinic_id", clinicId).order("label");
  if (!includeInactive) query = query.eq("is_active", true);
  return unwrap(await query, "Contatos do resumo do dia").map(toRecipient);
}

export async function createNotificationRecipient(
  db: DbClient,
  clinicId: string,
  input: NotificationRecipientInput,
): Promise<NotificationRecipient> {
  const row = validateNotificationRecipient(input);
  return toRecipient(
    unwrap(await db.from("notification_recipients").insert({ clinic_id: clinicId, ...row }).select(COLUMNS).single(), "Contato do resumo do dia"),
  );
}

export async function updateNotificationRecipient(
  db: DbClient,
  clinicId: string,
  id: string,
  input: NotificationRecipientInput,
): Promise<NotificationRecipient> {
  const row = validateNotificationRecipient(input);
  return toRecipient(
    unwrapOne(
      await db.from("notification_recipients").update(row).eq("clinic_id", clinicId).eq("id", id).select(COLUMNS).maybeSingle(),
      "Contato do resumo do dia",
    ),
  );
}

export async function setNotificationRecipientActive(db: DbClient, clinicId: string, id: string, isActive: boolean): Promise<void> {
  unwrapOne(
    await db
      .from("notification_recipients")
      .update({ is_active: isActive })
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .select("id")
      .maybeSingle(),
    "Contato do resumo do dia",
  );
}
