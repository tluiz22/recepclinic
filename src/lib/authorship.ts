import type { SupabaseClient } from "@supabase/supabase-js";

// Autoria de marcar/remarcar/cancelar (Fase 17): canal (tela x WhatsApp) +
// login de quem fez pela tela, exibido como WhatsApp / Secretária / Médica.

// Colunas de `appointments` necessárias pra montar os rótulos — somar ao
// `select` de quem exibe.
export const AUTHORSHIP_COLUMNS = "booking_channel, created_by, rescheduled_via, rescheduled_by, canceled_via, canceled_by";

export interface AuthorshipRow {
  booking_channel?: string | null;
  created_by?: string | null;
  rescheduled_via?: string | null;
  rescheduled_by?: string | null;
  canceled_via?: string | null;
  canceled_by?: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  secretaria: "Secretária",
  medica: "Médica",
};

/** Login → "Secretária"/"Médica", a partir de `staff_profiles`. */
export async function fetchStaffLabels(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data } = await supabase.from("staff_profiles").select("user_id, role");
  return new Map((data ?? []).map((row) => [row.user_id as string, ROLE_LABELS[row.role] ?? row.role]));
}

// Canal 'admin' sem login conhecido = registro anterior à Fase 17, ou login
// ainda sem perfil em `staff_profiles`.
function authorLabel(via: string | null | undefined, userId: string | null | undefined, staff: Map<string, string>) {
  if (!via) return null;
  if (via === "whatsapp_bot") return "WhatsApp";
  return (userId && staff.get(userId)) || "Tela (usuário não registrado)";
}

export function describeAuthorship(row: AuthorshipRow, staff: Map<string, string>) {
  return {
    createdBy: authorLabel(row.booking_channel, row.created_by, staff),
    rescheduledBy: authorLabel(row.rescheduled_via, row.rescheduled_by, staff),
    canceledBy: authorLabel(row.canceled_via, row.canceled_by, staff),
  };
}

/** "Marcado por: Secretária · Remarcado por: WhatsApp" (remarcação só se houve). */
export function formatBookedByLine(row: AuthorshipRow, staff: Map<string, string>): string | null {
  const { createdBy, rescheduledBy } = describeAuthorship(row, staff);
  const parts = [createdBy && `Marcado por: ${createdBy}`, rescheduledBy && `Remarcado por: ${rescheduledBy}`];
  const line = parts.filter(Boolean).join(" · ");
  return line || null;
}
