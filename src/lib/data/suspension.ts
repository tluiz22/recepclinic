import type { DbClient } from "./clients";
import { cleanText, DataError, fromDbError, unwrap } from "./errors";

// Suspensão da clínica por motivos (F12.3, faturamento do SaaS; decisão 11.1
// do planejamento-faturamento-saas.md). Só o Suporte suspende e libera, pelas
// funções do banco (trava, trilha e a situação anterior guardada). A clínica
// fica suspensa enquanto houver algum motivo ativo. Inadimplência só a partir
// da F12.4 (cliente, 02/nov/2026); o pagamento é que a libera (F12.6).

export const SUSPENSION_REASONS = {
  non_payment: "Inadimplência",
  administrative: "Administrativo",
  contract_ended: "Fim do contrato",
} as const;

export type SuspensionReason = keyof typeof SUSPENSION_REASONS;

/** Motivos que o Suporte escolhe na F12.3 (inadimplência entra com as cobranças). */
export const MANUAL_SUSPENSION_REASONS: SuspensionReason[] = ["administrative", "contract_ended"];

export const SUSPENSION_MESSAGES = {
  reason: "Escolha o motivo da suspensão.",
  note: "Escreva o motivo, de 3 a 1.000 caracteres.",
  noApp: "Confirme que, suspensa, ninguém vai receber as mensagens dos pacientes.",
} as const;

export type ClinicSuspension = {
  id: string;
  reason: SuspensionReason;
  note: string;
  createdBy: string | null;
  createdAt: Date;
  releasedAt: Date | null;
  releasedBy: string | null;
  releaseNote: string | null;
};

/** Suporte: os motivos da clínica, o mais novo primeiro (ativos e liberados). */
export async function listClinicSuspensions(db: DbClient, clinicId: string): Promise<ClinicSuspension[]> {
  const rows = unwrap(
    await db
      .from("clinic_suspensions")
      .select("id, reason, note, created_by, created_at, released_at, released_by, release_note")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false }),
    "Suspensão",
  );
  return rows.map((row) => ({
    id: row.id,
    reason: row.reason as SuspensionReason,
    note: row.note,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    releasedAt: row.released_at ? new Date(row.released_at) : null,
    releasedBy: row.released_by,
    releaseNote: row.release_note,
  }));
}

/** Quem é da clínica (e o Suporte): só os motivos ativos, sem o texto do Suporte. */
export async function activeSuspensionReasons(db: DbClient, clinicId: string): Promise<SuspensionReason[]> {
  const { data, error } = await db.rpc("clinic_suspension_reasons", { p_clinic_id: clinicId });
  if (error) throw fromDbError(error, "Suspensão");
  return ((data ?? []) as unknown as string[]).filter((reason): reason is SuspensionReason => reason in SUSPENSION_REASONS);
}

function checkNote(note: string | null | undefined, field: string): string {
  const text = cleanText(note);
  if (!text || text.length < 3 || text.length > 1000) throw new DataError("invalid", `Suspensão: ${SUSPENSION_MESSAGES.note}`, { [field]: SUSPENSION_MESSAGES.note });
  return text;
}

/** Suporte: suspende a clínica por um motivo, com texto. Sem o app WhatsApp Business, exige a confirmação a mais. */
export async function suspendClinic(
  db: DbClient,
  clinicId: string,
  input: { reason: string; note: string; noAppConfirmed?: boolean },
): Promise<void> {
  if (!MANUAL_SUSPENSION_REASONS.includes(input.reason as SuspensionReason)) {
    throw new DataError("invalid", `Suspensão: ${SUSPENSION_MESSAGES.reason}`, { suspension_reason: SUSPENSION_MESSAGES.reason });
  }
  const note = checkNote(input.note, "suspension_note");
  const { error } = await db.rpc("suspend_clinic", {
    p_clinic_id: clinicId,
    p_reason: input.reason,
    p_note: note,
    p_no_app_confirmed: input.noAppConfirmed ?? false,
  });
  if (error) {
    if (error.hint === "suspension_no_app_confirm") throw new DataError("invalid", `Suspensão: ${SUSPENSION_MESSAGES.noApp}`, { no_app_confirmed: SUSPENSION_MESSAGES.noApp });
    throw fromDbError(error, "Suspensão");
  }
}

/** Suporte: libera um motivo; sem outro ativo, a clínica volta à situação de antes. */
export async function releaseClinicSuspension(db: DbClient, suspensionId: string, note: string): Promise<void> {
  const text = checkNote(note, "release_note");
  const { error } = await db.rpc("release_clinic_suspension", { p_suspension_id: suspensionId, p_note: text });
  if (error) throw fromDbError(error, "Suspensão");
}

/** "Administrativo e Fim do contrato". */
export function describeReasons(reasons: SuspensionReason[]): string {
  const labels = reasons.map((reason) => SUSPENSION_REASONS[reason]);
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} e ${labels.at(-1)}`;
}
