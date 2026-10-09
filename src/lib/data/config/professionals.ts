import { normalizePhone } from "../../phone";
import type { DbClient } from "../clients";
import { cleanText, DataError, unwrap, unwrapOne, Validation } from "../errors";

// Profissionais (D4b: genérico — médico, dentista, psicólogo…). Saem por
// desativação, nunca apagados: têm agenda e atendimentos ligados. Com
// telefone e a opção marcada, o profissional recebe o resumo do dia dos
// próprios atendimentos (D2 revista, 05/out/2026; item do resumo do dia, D11).

export type Professional = {
  id: string;
  /** Login da equipe ligado ao profissional; null = não usa o painel. */
  userId: string | null;
  displayName: string;
  profession: string;
  specialty: string | null;
  council: string | null;
  councilNumber: string | null;
  councilState: string | null;
  /** RQE (Registro de Qualificação de Especialista); vários separados por vírgula. */
  rqe: string | null;
  /** WhatsApp do profissional (E.164), para o resumo do dia. */
  phone: string | null;
  receivesDailySummary: boolean;
  isActive: boolean;
};

/** RQE, telefone e resumo são opcionais: ausentes, ficam como estão (vazio na criação). */
export type ProfessionalInput = Omit<Professional, "id" | "isActive" | "rqe" | "phone" | "receivesDailySummary"> &
  Partial<Pick<Professional, "rqe" | "phone" | "receivesDailySummary">>;

const COLUMNS =
  "id, user_id, display_name, profession, specialty, council, council_number, council_state, rqe, phone, receives_daily_summary, is_active";

type Row = {
  id: string;
  user_id: string | null;
  display_name: string;
  profession: string;
  specialty: string | null;
  council: string | null;
  council_number: string | null;
  council_state: string | null;
  rqe: string | null;
  phone: string | null;
  receives_daily_summary: boolean;
  is_active: boolean;
};

const toProfessional = (row: Row): Professional => ({
  id: row.id,
  userId: row.user_id,
  displayName: row.display_name,
  profession: row.profession,
  specialty: row.specialty,
  council: row.council,
  councilNumber: row.council_number,
  councilState: row.council_state,
  rqe: row.rqe,
  phone: row.phone,
  receivesDailySummary: row.receives_daily_summary,
  isActive: row.is_active,
});

/** "6271 / 8890" → "6271, 8890"; null se tiver algo além de números. */
export function normalizeRqe(raw: string): string | null {
  const parts = raw.split(/[\s,;/]+/).filter(Boolean);
  if (!parts.length || parts.some((part) => !/^\d{1,10}$/.test(part))) return null;
  return parts.join(", ");
}

/** Registro do profissional como aparece para o paciente: "CRM 5751 RN | RQE 6271". */
export function professionalRegistry(p: Pick<Professional, "council" | "councilNumber" | "councilState" | "rqe">): string {
  const council = [p.council, p.councilNumber, p.councilState].filter(Boolean).join(" ");
  return [council, p.rqe ? `RQE ${p.rqe}` : ""].filter(Boolean).join(" | ");
}

export function validateProfessional(input: ProfessionalInput) {
  const v = new Validation();
  const row = {
    user_id: input.userId ?? null,
    display_name: cleanText(input.displayName) ?? "",
    profession: cleanText(input.profession) ?? "",
    specialty: cleanText(input.specialty),
    council: cleanText(input.council)?.toUpperCase() ?? null,
    council_number: cleanText(input.councilNumber),
    council_state: cleanText(input.councilState)?.toUpperCase() ?? null,
  };
  v.check(row.display_name.length > 0, "displayName", "Informe o nome");
  v.check(row.profession.length > 0, "profession", "Informe a profissão");
  v.check(row.council_state === null || /^[A-Z]{2}$/.test(row.council_state), "councilState", "UF com 2 letras");
  const contact: { rqe?: string | null; phone?: string | null; receives_daily_summary?: boolean } = {};
  if (input.rqe !== undefined) {
    const raw = cleanText(input.rqe);
    contact.rqe = raw === null ? null : normalizeRqe(raw);
    v.check(raw === null || contact.rqe !== null, "rqe", "RQE: só números, separados por vírgula");
  }
  if (input.phone !== undefined) {
    // Obrigatório no cadastro (cliente, 09/out/2026).
    const raw = cleanText(input.phone);
    contact.phone = raw === null ? null : normalizePhone(raw);
    v.check(raw !== null, "phone", "Informe o WhatsApp");
    v.check(raw === null || contact.phone !== null, "phone", "Telefone inválido");
  }
  if (input.receivesDailySummary !== undefined) {
    contact.receives_daily_summary = input.receivesDailySummary;
    // Sem telefone informado agora, vale o que já está gravado (o banco confere).
    v.check(!input.receivesDailySummary || contact.phone !== null, "phone", "Informe o telefone para receber o resumo do dia");
  }
  v.throwIfInvalid("Profissional");
  return { ...row, ...contact };
}

export async function listProfessionals(
  db: DbClient,
  clinicId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<Professional[]> {
  let query = db.from("professionals").select(COLUMNS).eq("clinic_id", clinicId).order("display_name");
  if (!includeInactive) query = query.eq("is_active", true);
  return unwrap(await query, "Profissionais").map(toProfessional);
}

export async function createProfessional(db: DbClient, clinicId: string, input: ProfessionalInput): Promise<Professional> {
  const row = validateProfessional(input);
  return toProfessional(
    unwrap(await db.from("professionals").insert({ clinic_id: clinicId, ...row }).select(COLUMNS).single(), "Profissional"),
  );
}

export async function updateProfessional(
  db: DbClient,
  clinicId: string,
  id: string,
  input: ProfessionalInput,
): Promise<Professional> {
  const row = validateProfessional(input);
  return toProfessional(
    unwrapOne(
      await db.from("professionals").update(row).eq("clinic_id", clinicId).eq("id", id).select(COLUMNS).maybeSingle(),
      "Profissional",
    ),
  );
}

/**
 * Quem recebe o resumo do dia (Configurações › Lembretes, cliente, 09/out/2026):
 * os marcados passam a receber, os outros deixam. Só profissional com WhatsApp.
 */
export async function setSummaryProfessionals(db: DbClient, clinicId: string, ids: string[]): Promise<void> {
  const professionals = await listProfessionals(db, clinicId, { includeInactive: true });
  const chosen = new Set(ids);
  const withoutPhone = professionals.filter((p) => chosen.has(p.id) && !p.phone);
  if (withoutPhone.length) {
    throw new DataError("invalid", "Profissional: informe o WhatsApp antes de marcar para receber o resumo", {
      phone: `Sem WhatsApp no cadastro: ${withoutPhone.map((p) => p.displayName).join(", ")}.`,
    });
  }
  for (const p of professionals) {
    const receives = chosen.has(p.id);
    if (p.receivesDailySummary === receives) continue;
    unwrapOne(
      await db.from("professionals").update({ receives_daily_summary: receives }).eq("clinic_id", clinicId).eq("id", p.id).select("id").maybeSingle(),
      "Profissional",
    );
  }
}

export async function setProfessionalActive(db: DbClient, clinicId: string, id: string, isActive: boolean): Promise<void> {
  unwrapOne(
    await db.from("professionals").update({ is_active: isActive }).eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(),
    "Profissional",
  );
}
