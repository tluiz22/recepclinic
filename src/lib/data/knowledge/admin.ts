import { KB_ANSWER_TYPES, KB_FLOWS, KB_REQUIRED_TERMS, KB_SOURCES, KB_STATUSES, type KbAnswerType, type KbFlow, type KbRequiredTerm, type KbSource, type KbStatus } from "../../knowledge/lists";
import { compileKnowledge, rankEntries, matchQuestion, type CompiledKb, type KbContent, type KbEntry, type KbMatch } from "../../knowledge/match";
import { variablesWithoutSource } from "../../knowledge/template";
import type { DbClient } from "../clients";
import { DataError, unwrap, unwrapOne, Validation } from "../errors";
import { listPlatformStaffNames } from "../features";
import { clinicTermsOf, composeAnswer, type KbAnswer } from "../whatsapp/bot/knowledge/answers";
import { kbSourceEnv, loadKbClinicData } from "../whatsapp/bot/knowledge/clinicData";

// Administração da Base de Conhecimento (BC 3.3): só o Suporte RecepClinic
// (o middleware barra a rota; o RLS barra no banco). Cadastro das entradas e
// sinônimos, dicionário de especialidades, termos do filtro clínico,
// publicação (com a conferência dos modelos), histórico, perguntas não
// reconhecidas e o testador com os dados de uma clínica.

export type KbCategory = { key: string; label: string };

export type KbEntryRow = {
  id: string;
  code: string;
  categoryKey: string;
  question: string;
  keywords: string[];
  guidance: string;
  answerType: KbAnswerType;
  template: string | null;
  sources: KbSource[];
  flow: KbFlow | null;
  requiredTerm: KbRequiredTerm | null;
  offersReception: boolean;
  status: KbStatus;
  version: number;
  updatedAt: string;
  synonyms: { id: string; text: string }[];
};

const ENTRY_COLUMNS =
  "id, code, category_key, question, keywords, guidance, answer_type, template, sources, flow, required_term, offers_reception, status, version, updated_at, kb_synonyms ( id, text )";

type EntryDbRow = {
  id: string;
  code: string;
  category_key: string;
  question: string;
  keywords: string[];
  guidance: string;
  answer_type: KbAnswerType;
  template: string | null;
  sources: string[];
  flow: string | null;
  required_term: string | null;
  offers_reception: boolean;
  status: KbStatus;
  version: number;
  updated_at: string;
  kb_synonyms: { id: string; text: string }[];
};

const toEntry = (row: EntryDbRow): KbEntryRow => ({
  id: row.id,
  code: row.code,
  categoryKey: row.category_key,
  question: row.question,
  keywords: row.keywords,
  guidance: row.guidance,
  answerType: row.answer_type,
  template: row.template,
  sources: row.sources as KbSource[],
  flow: row.flow as KbFlow | null,
  requiredTerm: row.required_term as KbRequiredTerm | null,
  offersReception: row.offers_reception,
  status: row.status,
  version: row.version,
  updatedAt: row.updated_at,
  synonyms: [...row.kb_synonyms].sort((a, b) => a.text.localeCompare(b.text, "pt-BR")),
});

/** Ordem do catálogo: F1, F2… E1… com o número em ordem numérica. */
const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, "pt-BR", { numeric: true });

export async function listCategories(db: DbClient): Promise<KbCategory[]> {
  return unwrap(await db.from("kb_categories").select("key, label").order("sort_order"), "Categorias");
}

export async function listEntries(db: DbClient): Promise<KbEntryRow[]> {
  return unwrap(await db.from("kb_entries").select(ENTRY_COLUMNS), "Base de conhecimento")
    .map((row) => toEntry(row as unknown as EntryDbRow))
    .sort(byCode);
}

export async function getEntry(db: DbClient, code: string): Promise<KbEntryRow | null> {
  const row = unwrap(await db.from("kb_entries").select(ENTRY_COLUMNS).eq("code", code).maybeSingle(), "Base de conhecimento");
  return row ? toEntry(row as unknown as EntryDbRow) : null;
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export type KbEntryInput = {
  code: string;
  categoryKey: string;
  question: string;
  keywords: string[];
  guidance: string;
  answerType: KbAnswerType;
  template: string | null;
  sources: KbSource[];
  flow: KbFlow | null;
  requiredTerm: KbRequiredTerm | null;
  offersReception: boolean;
};

/** "a, b ,c" → ["a", "b", "c"] (sem repetidos nem vazios). */
export function parseList(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item && !seen.has(item.toLowerCase()) && seen.add(item.toLowerCase()));
}

const NEEDS_TEXT: KbAnswerType[] = ["template", "fixed", "reception"];

export function validateEntry(input: KbEntryInput, categories: string[]) {
  const v = new Validation();
  v.check(/^[A-Z]{1,2}[0-9]{1,2}$/.test(input.code), "code", "Código: uma ou duas letras maiúsculas e um número (ex.: F2, PR3)");
  v.check(categories.includes(input.categoryKey), "category", "Escolha a categoria");
  v.check(input.question.trim().length > 0, "question", "Informe a pergunta principal");
  v.check(KB_ANSWER_TYPES.includes(input.answerType), "answer_type", "Escolha o tipo de resposta");
  v.check(input.sources.every((s) => KB_SOURCES.includes(s)), "sources", "Fonte de dados desconhecida");
  const needsText = NEEDS_TEXT.includes(input.answerType);
  v.check(!needsText || !!input.template?.trim(), "template", "Escreva o texto da resposta");
  v.check(input.answerType !== "source" || input.sources.length > 0, "sources", "Marque a fonte que monta a resposta");
  v.check(input.answerType !== "flow" || (!!input.flow && KB_FLOWS.includes(input.flow)), "flow", "Escolha o fluxo do bot");
  v.check(!input.requiredTerm || KB_REQUIRED_TERMS.includes(input.requiredTerm), "required_term", "Termo exigido desconhecido");
  v.check(input.keywords.length > 0 || !!input.requiredTerm, "keywords", "Informe pelo menos uma palavra-chave");
  if (needsText && input.template) {
    const missing = variablesWithoutSource(input.template, input.sources);
    v.check(missing.length === 0, "template", `Variável sem fonte de dados: ${missing.map((m) => `{${m}}`).join(", ")}. Marque a fonte ou tire a variável.`);
  }
  v.throwIfInvalid("Entrada da base");
  return {
    code: input.code,
    category_key: input.categoryKey,
    question: input.question.trim(),
    keywords: input.keywords,
    guidance: input.guidance.trim(),
    answer_type: input.answerType,
    template: needsText ? input.template!.trim() : null,
    sources: input.sources,
    flow: input.answerType === "flow" ? input.flow : null,
    required_term: input.requiredTerm,
    offers_reception: input.offersReception,
  };
}

export async function saveEntry(db: DbClient, input: KbEntryInput, existingCode?: string): Promise<string> {
  const categories = (await listCategories(db)).map((c) => c.key);
  const row = validateEntry(input, categories);
  if (existingCode) {
    const { code: _code, ...changes } = row;
    unwrapOne(await db.from("kb_entries").update(changes).eq("code", existingCode).select("code").maybeSingle(), "Entrada da base");
    return existingCode;
  }
  unwrap(await db.from("kb_entries").insert(row).select("code"), "Entrada da base");
  return row.code;
}

export async function setEntryStatus(db: DbClient, code: string, status: KbStatus): Promise<void> {
  if (!KB_STATUSES.includes(status)) throw new DataError("invalid", "Situação desconhecida", { status: "Situação desconhecida" });
  unwrapOne(await db.from("kb_entries").update({ status }).eq("code", code).select("code").maybeSingle(), "Entrada da base");
}

export async function addSynonym(db: DbClient, code: string, text: string): Promise<void> {
  const clean = text.trim();
  const v = new Validation();
  v.check(clean.length > 0 && clean.length <= 200, "text", "Escreva o sinônimo (até 200 caracteres)");
  v.throwIfInvalid("Sinônimo");
  const entry = unwrapOne(await db.from("kb_entries").select("id").eq("code", code).maybeSingle(), "Entrada da base");
  unwrap(await db.from("kb_synonyms").insert({ entry_id: entry.id, text: clean }).select("id"), "Sinônimo");
}

export async function removeSynonym(db: DbClient, id: string): Promise<void> {
  unwrap(await db.from("kb_synonyms").delete().eq("id", id).select("id"), "Sinônimo");
}

// ---------------------------------------------------------------------------
// Dicionário de especialidades e filtro clínico
// ---------------------------------------------------------------------------

export type KbSpecialty = { id: string; name: string; terms: string[]; isActive: boolean };
export type KbClinicalTerm = { id: string; group: "symptom" | "medicine" | "result" | "exception"; term: string; isActive: boolean };

export const CLINICAL_GROUP_LABELS: Record<KbClinicalTerm["group"], string> = {
  symptom: "Sintomas",
  medicine: "Remédios",
  result: "Resultado e diagnóstico",
  exception: "Não acionam o filtro",
};

export async function listSpecialties(db: DbClient): Promise<KbSpecialty[]> {
  return unwrap(await db.from("kb_specialties").select("id, name, terms, is_active").order("name"), "Especialidades").map((r) => ({
    id: r.id,
    name: r.name,
    terms: r.terms,
    isActive: r.is_active,
  }));
}

export async function saveSpecialty(db: DbClient, input: { id?: string; name: string; terms: string[]; isActive: boolean }): Promise<void> {
  const v = new Validation();
  v.check(input.name.trim().length > 0, "name", "Informe o nome da especialidade");
  v.throwIfInvalid("Especialidade");
  const row = { name: input.name.trim(), terms: input.terms, is_active: input.isActive };
  if (input.id) unwrapOne(await db.from("kb_specialties").update(row).eq("id", input.id).select("id").maybeSingle(), "Especialidade");
  else unwrap(await db.from("kb_specialties").insert(row).select("id"), "Especialidade");
}

export async function listClinicalTerms(db: DbClient): Promise<KbClinicalTerm[]> {
  return unwrap(await db.from("kb_clinical_terms").select("id, term_group, term, is_active").order("term"), "Filtro clínico").map((r) => ({
    id: r.id,
    group: r.term_group as KbClinicalTerm["group"],
    term: r.term,
    isActive: r.is_active,
  }));
}

export async function addClinicalTerm(db: DbClient, group: string, term: string): Promise<void> {
  const v = new Validation();
  v.check(group in CLINICAL_GROUP_LABELS, "group", "Escolha o grupo");
  v.check(term.trim().length > 0, "term", "Escreva o termo");
  v.throwIfInvalid("Termo do filtro clínico");
  unwrap(await db.from("kb_clinical_terms").insert({ term_group: group, term: term.trim() }).select("id"), "Termo do filtro clínico");
}

export async function setClinicalTermActive(db: DbClient, id: string, isActive: boolean): Promise<void> {
  unwrapOne(await db.from("kb_clinical_terms").update({ is_active: isActive }).eq("id", id).select("id").maybeSingle(), "Termo do filtro clínico");
}

// ---------------------------------------------------------------------------
// Publicação
// ---------------------------------------------------------------------------

export type KbPublicationInfo = {
  version: number;
  publishedAt: string;
  publishedBy: string | null;
  entries: number;
} | null;

export async function latestPublication(db: DbClient): Promise<KbPublicationInfo> {
  const [row] = unwrap(
    await db.from("kb_publications").select("version, published_at, published_by, content").order("version", { ascending: false }).limit(1),
    "Publicação",
  );
  if (!row) return null;
  const names = row.published_by ? await listPlatformStaffNames(db) : new Map<string, string>();
  return {
    version: row.version,
    publishedAt: row.published_at,
    publishedBy: row.published_by ? (names.get(row.published_by) ?? null) : null,
    entries: ((row.content as { entries?: unknown[] }).entries ?? []).length,
  };
}

/** Alterações depois da última publicação (o que "Publicar" levaria ao bot). */
export async function changesSincePublication(db: DbClient, publication: KbPublicationInfo): Promise<number> {
  let query = db.from("kb_revisions").select("id", { count: "exact", head: true });
  if (publication) query = query.gt("occurred_at", publication.publishedAt);
  const { count, error } = await query;
  if (error) throw new DataError("unexpected", error.message);
  return count ?? 0;
}

/** Entradas ativas que não podem ir ao bot (modelo com variável sem fonte). */
export function publicationProblems(entries: KbEntryRow[]): string[] {
  return entries
    .filter((e) => e.status === "active" && e.template && NEEDS_TEXT.includes(e.answerType))
    .flatMap((e) => {
      const missing = variablesWithoutSource(e.template!, e.sources);
      return missing.length ? [`${e.code}: ${missing.map((m) => `{${m}}`).join(", ")} sem fonte de dados`] : [];
    });
}

export async function publish(db: DbClient): Promise<number> {
  const problems = publicationProblems(await listEntries(db));
  if (problems.length) throw new DataError("invalid", `Publicação: ${problems.join("; ")}`, { publish: `Não publicamos: ${problems.join("; ")}.` });
  const { data, error } = await db.rpc("publish_knowledge_base");
  if (error) throw new DataError("forbidden", error.message);
  return data as number;
}

// ---------------------------------------------------------------------------
// Histórico e perguntas não reconhecidas
// ---------------------------------------------------------------------------

export type KbRevision = {
  id: number;
  occurredAt: string;
  actor: string | null;
  tableName: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  /** O que mudou, em poucas palavras (código da entrada, sinônimo, termo…). */
  subject: string;
  changed: string[];
};

const TABLE_LABELS: Record<string, string> = {
  kb_entries: "Entrada",
  kb_synonyms: "Sinônimo",
  kb_specialties: "Especialidade",
  kb_clinical_terms: "Filtro clínico",
};

const FIELD_LABELS: Record<string, string> = {
  question: "pergunta",
  keywords: "palavras-chave",
  guidance: "orientação",
  answer_type: "tipo",
  template: "texto",
  sources: "fontes",
  flow: "fluxo",
  required_term: "termo exigido",
  offers_reception: "oferece a recepção",
  status: "situação",
  category_key: "categoria",
  terms: "termos",
  is_active: "ativo",
  name: "nome",
};

const IGNORED = new Set(["version", "updated_at", "updated_by", "created_at"]);

function describeRevision(table: string, oldRow: Record<string, unknown> | null, newRow: Record<string, unknown> | null): { subject: string; changed: string[] } {
  const row = newRow ?? oldRow ?? {};
  const subject =
    table === "kb_entries" ? String(row.code ?? "") : table === "kb_synonyms" ? `"${row.text}"` : table === "kb_specialties" ? String(row.name ?? "") : String(row.term ?? "");
  if (!oldRow || !newRow) return { subject, changed: [] };
  const changed = Object.keys(newRow)
    .filter((key) => !IGNORED.has(key) && JSON.stringify(oldRow[key]) !== JSON.stringify(newRow[key]))
    .map((key) => {
      if (key === "status") return `situação: ${oldRow.status} → ${newRow.status}`;
      return FIELD_LABELS[key] ?? key;
    });
  return { subject, changed };
}

export async function listRevisions(db: DbClient, { entryId, limit = 100 }: { entryId?: string; limit?: number } = {}): Promise<KbRevision[]> {
  let query = db.from("kb_revisions").select("id, occurred_at, actor_user_id, table_name, operation, old_row, new_row").order("id", { ascending: false }).limit(limit);
  if (entryId) query = query.eq("entry_id", entryId);
  const [rows, names] = await Promise.all([query.then((r) => unwrap(r, "Histórico")), listPlatformStaffNames(db)]);
  return rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurred_at,
    actor: r.actor_user_id ? (names.get(r.actor_user_id) ?? null) : null,
    tableName: TABLE_LABELS[r.table_name] ?? r.table_name,
    operation: r.operation as KbRevision["operation"],
    ...describeRevision(r.table_name, r.old_row as Record<string, unknown> | null, r.new_row as Record<string, unknown> | null),
  }));
}

export type KbUnmatched = { id: number; clinicName: string; text: string; state: string | null; occurredAt: string };

export async function listUnmatched(db: DbClient, limit = 200): Promise<KbUnmatched[]> {
  const rows = unwrap(
    await db.from("kb_unmatched").select("id, text, conversation_state, occurred_at, clinics ( name )").order("occurred_at", { ascending: false }).limit(limit),
    "Perguntas não reconhecidas",
  );
  return rows.map((r) => ({
    id: r.id,
    clinicName: (r.clinics as unknown as { name: string } | null)?.name ?? "",
    text: r.text,
    state: r.conversation_state,
    occurredAt: r.occurred_at,
  }));
}

// ---------------------------------------------------------------------------
// Testador
// ---------------------------------------------------------------------------

export type KbTestMode = "editing" | "published";

export type KbTestResult = {
  mode: KbTestMode;
  version: number | null;
  match: KbMatch;
  ranked: { code: string; question: string; score: number }[];
  clinical: boolean;
  terms: { services: string[]; professionals: string[]; plans: string[]; specialties: string[] };
  answer: KbAnswer | null;
};

/** Base em edição: as entradas que não estão inativas, como se fossem publicadas agora. */
async function editingKnowledge(db: DbClient): Promise<CompiledKb> {
  const [entries, specialties, terms] = await Promise.all([listEntries(db), listSpecialties(db), listClinicalTerms(db)]);
  const content: KbContent = {
    entries: entries
      .filter((e) => e.status !== "inactive")
      .map(
        (e): KbEntry => ({
          code: e.code,
          category: e.categoryKey,
          question: e.question,
          keywords: e.keywords,
          answerType: e.answerType,
          template: e.template,
          sources: e.sources,
          flow: e.flow,
          requiredTerm: e.requiredTerm,
          offersReception: e.offersReception,
          synonyms: e.synonyms.map((s) => s.text),
        }),
      ),
    specialties: specialties.filter((s) => s.isActive).map((s) => ({ name: s.name, terms: s.terms })),
    clinicalTerms: terms.filter((t) => t.isActive).map((t) => ({ group: t.group, term: t.term })),
  };
  return compileKnowledge(0, content);
}

async function publishedContent(db: DbClient): Promise<CompiledKb | null> {
  const [row] = unwrap(await db.from("kb_publications").select("version, content").order("version", { ascending: false }).limit(1), "Publicação");
  return row ? compileKnowledge(row.version, row.content as unknown as KbContent) : null;
}

/** Frase de teste com os dados de uma clínica (o Suporte lê a clínica: fica no registro de leituras). Nada é enviado. */
export async function testQuestion(db: DbClient, clinicId: string, text: string, mode: KbTestMode, now: Date): Promise<KbTestResult | null> {
  const kb = mode === "published" ? await publishedContent(db) : await editingKnowledge(db);
  if (!kb) return null;
  const { error } = await db.rpc("log_platform_access", { p_clinic_id: clinicId, p_method: "GET", p_path: "/admin/sistema/conhecimento/testar" });
  if (error) throw new DataError("forbidden", error.message);
  const data = await loadKbClinicData(await kbSourceEnv(db, clinicId, now));
  const clinic = clinicTermsOf(data);
  const ranking = rankEntries(kb, text, clinic);
  const match = matchQuestion(kb, text, clinic);
  const nameOf = <T extends { id: string }>(list: T[], label: (item: T) => string, ids: string[]) => list.filter((i) => ids.includes(i.id)).map(label);
  return {
    mode,
    version: mode === "published" ? kb.version : null,
    match,
    ranked: ranking.ranked.slice(0, 5).map((r) => ({ code: r.entry.code, question: r.entry.question, score: r.score })),
    clinical: ranking.clinical,
    terms: {
      services: nameOf(data.catalog.services, (s) => s.name, ranking.terms.serviceIds),
      professionals: nameOf(data.professionals, (p) => p.displayName, ranking.terms.professionalIds),
      plans: nameOf(data.insurance.plans, (p) => p.name, ranking.terms.planIds),
      specialties: ranking.terms.specialties,
    },
    answer: match.kind === "answer" ? composeAnswer(kb, match.entry, match.terms, text, data) : null,
  };
}

