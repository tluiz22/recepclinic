import type { KbAnswerType, KbFlow, KbRequiredTerm, KbSource } from "./lists";
import { containsPhrase, normalizeText, STOPWORDS, tokenMatches, tokensOf } from "./normalize";

// Reconhecimento da pergunta (BC 3.2, decisão 1: sem IA). Compara a mensagem
// com a pergunta e os sinônimos de cada entrada publicada; a entrada só vale
// com uma palavra-chave dela na mensagem (ou o termo da clínica que ela exige).
// Acima do limiar, responde; perto do limiar ou empatada, "Você quis dizer…?"
// (decisão 3); abaixo, não reconhece. O filtro clínico (decisão 9) vem antes,
// menos para pedido de marcação (Q1). Função pura: os nomes da clínica chegam
// prontos e nada daqui consulta o banco.

/** Entrada como sai da publicação (kb_publications.content). */
export type KbEntry = {
  code: string;
  category: string;
  question: string;
  keywords: string[];
  answerType: KbAnswerType;
  template: string | null;
  sources: KbSource[];
  flow: KbFlow | null;
  requiredTerm: KbRequiredTerm | null;
  offersReception: boolean;
  synonyms: string[];
};

export type KbContent = {
  entries: KbEntry[];
  specialties: { name: string; terms: string[] }[];
  clinicalTerms: { group: "symptom" | "medicine" | "result" | "exception"; term: string }[];
};

type Candidate = { tokens: string[]; content: string[] };

type CompiledEntry = { entry: KbEntry; candidates: Candidate[]; keywords: string[] };

export type CompiledKb = {
  version: number;
  entries: CompiledEntry[];
  /** Peso de cada palavra: menor quanto mais entradas a usam ("consulta" pesa menos que "remarcar"). */
  weights: Map<string, number>;
  specialties: { name: string; phrases: string[] }[];
  clinical: string[];
  exceptions: string[];
};

/** Nomes da clínica que a mensagem pode citar (serviços, profissionais e planos ativos). */
export type ClinicTerms = {
  services: { id: string; name: string }[];
  professionals: { id: string; name: string }[];
  plans: { id: string; names: string[] }[];
};

export type DetectedTerms = {
  serviceIds: string[];
  professionalIds: string[];
  planIds: string[];
  /** Especialidades do dicionário citadas (nome canônico), estejam ou não na clínica. */
  specialties: string[];
};

export type KbMatch =
  | { kind: "answer"; entry: KbEntry; score: number; terms: DetectedTerms }
  | { kind: "ambiguous"; options: KbEntry[]; terms: DetectedTerms }
  | { kind: "clinical"; terms: DetectedTerms }
  | { kind: "none"; terms: DetectedTerms };

/** Responde a partir daqui. */
export const ACCEPT_SCORE = 0.6;
/** Entre este e o de cima, pergunta "Você quis dizer…?". */
export const SUGGEST_SCORE = 0.45;
/** Entradas a até esta distância da primeira contam como empate. */
export const TIE_MARGIN = 0.08;
export const MAX_OPTIONS = 3;

const contentOf = (tokens: string[]) => tokens.filter((token) => !STOPWORDS.has(token));

function candidate(text: string): Candidate {
  const tokens = tokensOf(normalizeText(text));
  return { tokens, content: contentOf(tokens) };
}

export function compileKnowledge(version: number, content: KbContent): CompiledKb {
  const entries = content.entries.map((entry) => ({
    entry,
    candidates: [entry.question, ...entry.synonyms]
      .map((text) => candidate(text.replace(/\{[^}]*\}/g, " ")))
      .filter((c) => c.tokens.length),
    keywords: entry.keywords.map(normalizeText).filter(Boolean),
  }));
  const df = new Map<string, number>();
  for (const e of entries) {
    const words = new Set([...e.candidates.flatMap((c) => c.content), ...e.keywords.flatMap(tokensOf)]);
    for (const word of words) df.set(word, (df.get(word) ?? 0) + 1);
  }
  return {
    version,
    entries,
    weights: new Map([...df].map(([word, count]) => [word, 1 / (1 + Math.log(count))])),
    specialties: content.specialties.map((s) => ({ name: s.name, phrases: [s.name, ...s.terms].map(normalizeText).filter(Boolean) })),
    clinical: content.clinicalTerms.filter((t) => t.group !== "exception").map((t) => normalizeText(t.term)).filter(Boolean),
    exceptions: content.clinicalTerms.filter((t) => t.group === "exception").map((t) => normalizeText(t.term)).filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Nomes da clínica na mensagem
// ---------------------------------------------------------------------------

/** Palavras que todo serviço tem: sozinhas não identificam um serviço. */
const GENERIC_SERVICE_WORDS = new Set(["consulta", "consultas", "exame", "exames", "retorno", "sessao", "procedimento", "atendimento", "avaliacao"]);
const TITLES = new Set(["doutor", "doutora", "dr", "dra", "prof", "professor", "professora"]);

/** Mesma raiz (pediatrica ≈ pediatrico ≈ pediatria): as 6 primeiras letras, em palavras longas. */
const sameStem = (a: string, b: string) => tokenMatches(a, b) || tokenMatches(b, a) || (a.length >= 7 && b.length >= 7 && a.slice(0, 6) === b.slice(0, 6));

const hasToken = (tokens: string[], target: string) => tokens.some((token) => sameStem(token, target));

function mentionsService(tokens: string[], name: string): boolean {
  const nameTokens = contentOf(tokensOf(normalizeText(name)));
  const distinctive = nameTokens.filter((token) => !GENERIC_SERVICE_WORDS.has(token));
  if (distinctive.length) return distinctive.every((token) => hasToken(tokens, token));
  return nameTokens.length > 0 && containsPhrase(tokens, nameTokens.join(" "));
}

function mentionsProfessional(tokens: string[], name: string): boolean {
  const nameTokens = tokensOf(normalizeText(name)).filter((token) => !TITLES.has(token) && !STOPWORDS.has(token) && token.length >= 3);
  const present = nameTokens.filter((token) => tokens.includes(token));
  if (present.length >= 2) return true;
  // Um nome só vale com "doutor(a)" na mensagem e pelo menos 4 letras ("Dra. Karina").
  return present.some((token) => token.length >= 4) && tokens.some((token) => TITLES.has(token));
}

function mentionsPlan(tokens: string[], names: string[]): boolean {
  return names.some((name) => {
    const nameTokens = tokensOf(normalizeText(name));
    if (!nameTokens.length) return false;
    if (containsPhrase(tokens, nameTokens.join(" "))) return true;
    // "Bradesco" por "Bradesco Saúde".
    return nameTokens.length > 1 && nameTokens[0].length >= 4 && tokens.includes(nameTokens[0]);
  });
}

export function detectTerms(kb: CompiledKb, tokens: string[], clinic: ClinicTerms): DetectedTerms {
  return {
    serviceIds: clinic.services.filter((s) => mentionsService(tokens, s.name)).map((s) => s.id),
    professionalIds: clinic.professionals.filter((p) => mentionsProfessional(tokens, p.name)).map((p) => p.id),
    planIds: clinic.plans.filter((p) => mentionsPlan(tokens, p.names)).map((p) => p.id),
    // Sem "de/do/da": "médico de pulmão" = "médico do pulmão".
    specialties: kb.specialties
      .filter((s) => s.phrases.some((phrase) => containsPhrase(contentOf(tokens), contentOf(tokensOf(phrase)).join(" "))))
      .map((s) => s.name),
  };
}

/** Palavras da mensagem que são nomes citados (o objeto da pergunta, não a intenção). */
function nameTokens(kb: CompiledKb, tokens: string[], clinic: ClinicTerms, terms: DetectedTerms): Set<string> {
  const names = [
    ...clinic.services.filter((s) => terms.serviceIds.includes(s.id)).map((s) => s.name),
    ...clinic.professionals.filter((p) => terms.professionalIds.includes(p.id)).map((p) => p.name),
    ...clinic.plans.filter((p) => terms.planIds.includes(p.id)).flatMap((p) => p.names),
  ];
  const words = names.flatMap((name) => contentOf(tokensOf(normalizeText(name)))).filter((word) => !GENERIC_SERVICE_WORDS.has(word));
  return new Set(tokens.filter((token) => words.some((word) => sameStem(token, word))));
}

// ---------------------------------------------------------------------------
// Pontuação
// ---------------------------------------------------------------------------

/**
 * Quanto um texto da entrada explica a mensagem (0 a 1). Frase inteira na
 * mensagem pesa mais; senão, as palavras da entrada que aparecem (cobertura) e
 * as da mensagem que a entrada explica (precisão), com o peso de cada palavra.
 * Texto só de cortesia ("bom dia") não vale para mensagem que pergunta outra coisa.
 */
function candidateScore(kb: CompiledKb, c: Candidate, keywordWords: string[], tokens: string[], content: string[]): number {
  const weight = (word: string) => kb.weights.get(word) ?? 1;
  const sum = (words: string[]) => words.reduce((total, word) => total + weight(word), 0);
  // A palavra-chave da entrada também explica a mensagem ("aceitam amil": "amil" é dos convênios).
  const explained = content.filter((token) => c.content.some((word) => sameStem(token, word)) || keywordWords.some((word) => tokenMatches(token, word) || tokenMatches(word, token)));
  const precision = content.length ? sum(explained) / sum(content) : 1;
  if (containsPhrase(tokens, c.tokens.join(" "))) {
    if (!c.content.length && content.length) return 0.4;
    return 0.55 + 0.45 * precision;
  }
  if (!c.content.length) return 0;
  const covered = sum(c.content.filter((word) => hasToken(tokens, word))) / sum(c.content);
  return 0.6 * covered + 0.4 * precision;
}

/** Sinônimo igual à mensagem (sem as palavras de cortesia e os nomes) vale como palavra-chave. */
const EXACT_SCORE = 0.99;

function passesGate(e: CompiledEntry, tokens: string[], terms: DetectedTerms, best: number): boolean {
  if (e.entry.requiredTerm === "service" && !terms.serviceIds.length) return false;
  if (e.entry.requiredTerm === "professional" && !terms.professionalIds.length) return false;
  if (e.entry.requiredTerm === "specialty" && !terms.specialties.length) return false;
  // Nome de um plano da clínica vale como palavra-chave dos convênios ("Unimed?").
  if (e.entry.sources.includes("insurance") && terms.planIds.length) return true;
  return best >= EXACT_SCORE || e.keywords.some((keyword) => containsPhrase(tokens, keyword));
}

function entryScore(kb: CompiledKb, e: CompiledEntry, tokens: string[], content: string[], terms: DetectedTerms): number {
  const keywordWords = e.keywords.flatMap(tokensOf).filter((word) => !STOPWORDS.has(word));
  let score = Math.max(0, ...e.candidates.map((c) => candidateScore(kb, c, keywordWords, tokens, content)));
  // Mensagem só com palavras-chave da entrada ("horário?", "convênio?"): a intenção é a dela.
  if (content.length && content.every((token) => keywordWords.some((word) => tokenMatches(token, word) || tokenMatches(word, token)))) score = Math.max(score, 0.65);
  // Termo exigido na mensagem (serviço, profissional, especialidade): a intenção está clara.
  if (e.entry.requiredTerm) score = Math.max(score + 0.15, 0.7);
  // Plano da clínica citado: é pergunta de convênio, mesmo com o profissional junto ("o dr João atende Unimed?").
  if (e.entry.sources.includes("insurance") && terms.planIds.length) score = Math.max(score + 0.3, 0.75);
  return score;
}

const BOOKING_FLOWS = new Set<KbFlow>(["book_consultation", "book_exam", "book_return"]);

function withoutPhrases(tokens: string[], phrases: string[]): string[] {
  let rest = ` ${tokens.join(" ")} `;
  for (const phrase of phrases) rest = rest.split(` ${phrase} `).join(" ");
  return tokensOf(rest.trim());
}

const isClinical = (kb: CompiledKb, tokens: string[]) => {
  const rest = withoutPhrases(tokens, kb.exceptions);
  return kb.clinical.some((term) => containsPhrase(rest, term));
};

export type KbRanking = {
  terms: DetectedTerms;
  clinical: boolean;
  /** Entradas que passaram pela palavra-chave, da maior pontuação para a menor. */
  ranked: { entry: KbEntry; score: number }[];
};

/** Pontuação de cada entrada (o testador do Suporte mostra as alternativas). */
export function rankEntries(kb: CompiledKb, text: string, clinic: ClinicTerms): KbRanking {
  const tokens = tokensOf(normalizeText(text));
  const terms = detectTerms(kb, tokens, clinic);
  if (!tokens.length || tokens.every((token) => /^\d+$/.test(token))) return { terms, clinical: false, ranked: [] };
  const names = nameTokens(kb, tokens, clinic, terms);
  const content = contentOf(tokens).filter((token) => !names.has(token));
  const ranked = kb.entries
    .map((e) => ({ e, score: entryScore(kb, e, tokens, content, terms) }))
    .filter(({ e, score }) => passesGate(e, tokens, terms, score))
    .map(({ e, score }) => ({ entry: e.entry, score }))
    .sort((a, b) => b.score - a.score || a.entry.code.localeCompare(b.entry.code));
  return { terms, clinical: isClinical(kb, tokens), ranked };
}

export function matchQuestion(kb: CompiledKb, text: string, clinic: ClinicTerms): KbMatch {
  const { terms, clinical, ranked: scored } = rankEntries(kb, text, clinic);
  // Cortesia (texto fixo) só quando nenhuma outra entrada serve.
  const main = scored.filter((s) => s.entry.answerType !== "fixed");
  const pool = main.some((s) => s.score >= SUGGEST_SCORE) ? main : scored;
  const best = pool[0];

  if (clinical) {
    // Sintoma com pedido de marcação: abre a marcação, sem orientar (Q1).
    if (best && best.score >= ACCEPT_SCORE && best.entry.flow && BOOKING_FLOWS.has(best.entry.flow)) return { kind: "answer", ...best, terms };
    return { kind: "clinical", terms };
  }
  if (!best || best.score < SUGGEST_SCORE) return { kind: "none", terms };

  const tied = pool.filter((s) => s.score >= SUGGEST_SCORE && best.score - s.score <= TIE_MARGIN);
  if (best.score >= ACCEPT_SCORE && tied.length === 1) return { kind: "answer", ...best, terms };
  const options = (best.score >= ACCEPT_SCORE ? tied : pool.filter((s) => s.score >= SUGGEST_SCORE)).slice(0, MAX_OPTIONS).map((s) => s.entry);
  if (options.length === 1) return best.score >= ACCEPT_SCORE ? { kind: "answer", ...best, terms } : { kind: "ambiguous", options, terms };
  return { kind: "ambiguous", options, terms };
}
