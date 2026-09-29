import type { SupabaseClient } from "@supabase/supabase-js";

// Autoria de marcar/remarcar/cancelar (Fase 17): canal (tela x WhatsApp) +
// login de quem fez pela tela, exibido como WhatsApp / Secretária / Médica.

// Colunas de `appointments` necessárias pra montar os rótulos — somar ao
// `select` de quem exibe.
export const AUTHORSHIP_COLUMNS =
  "booking_channel, created_by, created_at, rescheduled_via, rescheduled_by, rescheduled_at, canceled_via, canceled_by, canceled_at";

export interface AuthorshipRow {
  booking_channel?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  rescheduled_via?: string | null;
  rescheduled_by?: string | null;
  rescheduled_at?: string | null;
  canceled_via?: string | null;
  canceled_by?: string | null;
  canceled_at?: string | null;
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

// "27/09/2026 às 14h30", no fuso de Fortaleza.
function formatDateTime(iso: string): string {
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(":", "h");
  return `${date} às ${time}`;
}

function actionLine(verb: string, author: string | null, at: string | null | undefined): string | null {
  if (!author) return null;
  return at ? `${verb} por ${author} no dia ${formatDateTime(at)}` : `${verb} por ${author}`;
}

/**
 * ["Marcado por Secretária no dia 27/09/2026 às 14h30", "Remarcado por
 * WhatsApp no dia …"] — remarcação só se houve.
 */
export function formatBookedByLines(row: AuthorshipRow, staff: Map<string, string>): string[] {
  const { createdBy, rescheduledBy } = describeAuthorship(row, staff);
  return [actionLine("Marcado", createdBy, row.created_at), actionLine("Remarcado", rescheduledBy, row.rescheduled_at)].filter(
    (line): line is string => line !== null
  );
}

/** "Cancelado por Secretária no dia 27/09/2026 às 14h30" (null se não cancelado). */
export function formatCanceledByLine(row: AuthorshipRow, staff: Map<string, string>): string | null {
  return actionLine("Cancelado", describeAuthorship(row, staff).canceledBy, row.canceled_at);
}

// Presença confirmada (Fase 19): `patient_confirmed_by` nulo = WhatsApp
// (botão do lembrete); preenchido = login que marcou pela tela.
export const PRESENCE_COLUMNS = "patient_confirmed_at, patient_confirmed_by";

export interface PresenceRow {
  patient_confirmed_at?: string | null;
  patient_confirmed_by?: string | null;
}

/** "Confirmada por WhatsApp no dia 27/09/2026 às 14h30" (null se não confirmada). */
export function formatPresenceLine(row: PresenceRow, staff: Map<string, string>): string | null {
  if (!row.patient_confirmed_at) return null;
  const author = row.patient_confirmed_by ? authorLabel("admin", row.patient_confirmed_by, staff) : "WhatsApp";
  return actionLine("Confirmada", author, row.patient_confirmed_at);
}
