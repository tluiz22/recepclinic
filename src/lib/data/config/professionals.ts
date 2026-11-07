import { INVALID_PHONE_MESSAGE, normalizePhone } from "../../phone";
import type { DbClient } from "../clients";
import { cleanText, DataError, unwrap, unwrapOne, Validation } from "../errors";

// Profissionais (D4b: genérico — médico, dentista, psicólogo…). Saem por
// desativação, nunca apagados: têm agenda e atendimentos ligados. Com
// telefone e a opção marcada, o profissional recebe o resumo do dia dos
// próprios atendimentos (D2 revista, 05/out/2026; item do resumo do dia, D11).
// Especialidades (ME, cliente, 07/nov/2026): uma ou mais da lista global do
// Suporte (`kb_specialties`), obrigatória para salvar; a primeira é a principal.
// Quem foi cadastrado antes sem nenhuma fica pendente (setup.ts), sem bloquear.

export type SpecialtyRef = { id: string; name: string; isActive: boolean };

export type Professional = {
  id: string;
  /** Login da equipe ligado ao profissional; null = não usa o painel. */
  userId: string | null;
  displayName: string;
  profession: string;
  /** Especialidades na ordem (a primeira é a principal); vazia = pendente. */
  specialties: SpecialtyRef[];
  /** Nomes das especialidades separados por vírgula (para textos); null sem nenhuma. */
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

/**
 * RQE, telefone, resumo e especialidades são opcionais: ausentes, ficam como
 * estão (vazio na criação). Especialidades informadas: ao menos uma.
 */
export type ProfessionalInput = Omit<Professional, "id" | "isActive" | "rqe" | "phone" | "receivesDailySummary" | "specialties" | "specialty"> &
  Partial<Pick<Professional, "rqe" | "phone" | "receivesDailySummary">> & { specialtyIds?: string[] };

const COLUMNS =
  "id, user_id, display_name, profession, council, council_number, council_state, rqe, phone, receives_daily_summary, is_active, professional_specialties(position, kb_specialties(id, name, is_active))";

type Row = {
  id: string;
  user_id: string | null;
  display_name: string;
  profession: string;
  professional_specialties: { position: number; kb_specialties: { id: string; name: string; is_active: boolean } | null }[] | null;
  council: string | null;
  council_number: string | null;
  council_state: string | null;
  rqe: string | null;
  phone: string | null;
  receives_daily_summary: boolean;
  is_active: boolean;
};

const toSpecialties = (row: Row): SpecialtyRef[] =>
  [...(row.professional_specialties ?? [])]
    .sort((a, b) => a.position - b.position)
    .flatMap((ps) => (ps.kb_specialties ? [{ id: ps.kb_specialties.id, name: ps.kb_specialties.name, isActive: ps.kb_specialties.is_active }] : []));

const toProfessional = (row: Row): Professional => {
  const specialties = toSpecialties(row);
  return {
  id: row.id,
  userId: row.user_id,
  displayName: row.display_name,
  profession: row.profession,
  specialties,
  specialty: specialties.length ? specialties.map((s) => s.name).join(", ") : null,
  council: row.council,
  councilNumber: row.council_number,
  councilState: row.council_state,
  rqe: row.rqe,
  phone: row.phone,
  receivesDailySummary: row.receives_daily_summary,
  isActive: row.is_active,
  };
};

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
    council: cleanText(input.council)?.toUpperCase() ?? null,
    council_number: cleanText(input.councilNumber),
    council_state: cleanText(input.councilState)?.toUpperCase() ?? null,
  };
  v.check(row.display_name.length > 0, "displayName", "Informe o nome");
  v.check(row.profession.length > 0, "profession", "Informe a profissão");
  v.check(row.council_state === null || /^[A-Z]{2}$/.test(row.council_state), "councilState", "UF com 2 letras");
  const specialtyIds = input.specialtyIds === undefined ? undefined : [...new Set(input.specialtyIds.filter(Boolean))];
  if (specialtyIds !== undefined) {
    v.check(specialtyIds.length > 0, "specialties", "Escolha ao menos uma especialidade");
    v.check(specialtyIds.length <= 20, "specialties", "No máximo 20 especialidades");
  }
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
    v.check(raw === null || contact.phone !== null, "phone", INVALID_PHONE_MESSAGE);
  }
  if (input.receivesDailySummary !== undefined) {
    contact.receives_daily_summary = input.receivesDailySummary;
    // Sem telefone informado agora, vale o que já está gravado (o banco confere).
    v.check(!input.receivesDailySummary || contact.phone !== null, "phone", "Informe o telefone para receber o resumo do dia");
  }
  v.throwIfInvalid("Profissional");
  return { row: { ...row, ...contact }, specialtyIds };
}

/** Lista global de especialidades (do Suporte), para escolher no cadastro. */
export async function listSpecialtyOptions(db: DbClient): Promise<SpecialtyRef[]> {
  const rows = unwrap(await db.from("kb_specialties").select("id, name, is_active").eq("is_active", true).order("name"), "Especialidades");
  return rows
    .map((r) => ({ id: r.id, name: r.name, isActive: r.is_active }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

async function saveSpecialties(db: DbClient, clinicId: string, professionalId: string, ids: string[]): Promise<void> {
  const { error } = await db.rpc("set_professional_specialties", { p_clinic_id: clinicId, p_professional_id: professionalId, p_specialty_ids: ids });
  if (error) {
    if (error.code === "23514") throw new DataError("invalid", "Profissional: confira as especialidades", { specialties: error.message });
    unwrap({ data: null, error }, "Especialidades");
  }
}

export async function listProfessionals(
  db: DbClient,
  clinicId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<Professional[]> {
  let query = db.from("professionals").select(COLUMNS).eq("clinic_id", clinicId).order("display_name");
  if (!includeInactive) query = query.eq("is_active", true);
  return (unwrap(await query, "Profissionais") as Row[]).map(toProfessional);
}

export async function createProfessional(db: DbClient, clinicId: string, input: ProfessionalInput): Promise<Professional> {
  const { row, specialtyIds } = validateProfessional(input);
  // Confere antes de criar: o profissional não nasce sem especialidade por uma escolha que não vale.
  if (specialtyIds) {
    const active = new Set((await listSpecialtyOptions(db)).map((s) => s.id));
    if (specialtyIds.some((id) => !active.has(id))) {
      throw new DataError("invalid", "Profissional: confira as especialidades", { specialties: "Especialidade inexistente ou desativada" });
    }
  }
  const created = unwrap(await db.from("professionals").insert({ clinic_id: clinicId, ...row }).select("id").single(), "Profissional");
  if (specialtyIds) await saveSpecialties(db, clinicId, created.id, specialtyIds);
  return getProfessional(db, clinicId, created.id);
}

async function getProfessional(db: DbClient, clinicId: string, id: string): Promise<Professional> {
  return toProfessional(
    unwrapOne(await db.from("professionals").select(COLUMNS).eq("clinic_id", clinicId).eq("id", id).maybeSingle(), "Profissional") as Row,
  );
}

export async function updateProfessional(
  db: DbClient,
  clinicId: string,
  id: string,
  input: ProfessionalInput,
): Promise<Professional> {
  const { row, specialtyIds } = validateProfessional(input);
  unwrapOne(await db.from("professionals").update(row).eq("clinic_id", clinicId).eq("id", id).select("id").maybeSingle(), "Profissional");
  if (specialtyIds) await saveSpecialties(db, clinicId, id, specialtyIds);
  return getProfessional(db, clinicId, id);
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
