import type { Article, Faq } from "./types";

// Busca da Central de Ajuda: simples, no servidor e sem serviço externo. Normaliza
// (minúsculas, sem acento), expande sinônimos de quem usa o painel ("desmarcar" =
// "cancelar"), pontua título, palavras-chave, resumo e texto, e devolve o trecho.

export const norm = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const STOP = new Set(["a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas", "um", "uma", "para", "por", "com", "que", "como", "eu", "se", "ao", "ou", "meu", "minha", "pra", "esta", "esse", "isso", "posso", "faco", "fazer", "quero", "preciso", "onde", "qual", "quais", "porque", "por", "nao"]);

// Grupos de palavras que a recepção usa para a mesma coisa.
const GROUPS: string[][] = [
  ["cancelar", "desmarcar", "excluir", "apagar atendimento"],
  ["remarcar", "reagendar", "trocar", "mudar", "alterar", "adiar"],
  ["marcar", "agendar", "agendamento", "marcacao", "consulta nova"],
  ["paciente", "cliente", "pessoa"],
  ["bloquear", "bloqueio", "fechar agenda", "folga", "ferias", "ausencia", "viagem"],
  ["whatsapp", "zap", "whats", "wpp", "mensagem"],
  ["bot", "robo", "assistente virtual", "assistente", "atendimento automatico"],
  ["lembrete", "aviso", "notificacao", "alerta"],
  ["profissional", "medico", "medica", "doutor", "doutora", "dentista", "terapeuta", "psicologa", "especialista"],
  ["cadastrar", "incluir", "adicionar", "criar", "novo", "nova", "registrar"],
  ["convenio", "plano de saude", "plano", "carteirinha"],
  ["falta", "faltou", "faltosos", "nao compareceu", "nao veio"],
  ["senha", "login", "acesso", "entrar", "esqueci"],
  ["horario", "disponibilidade", "vaga", "vagas", "hora"],
  ["usuario", "equipe", "funcionario", "colaborador", "secretaria", "recepcionista", "recepcao"],
  ["permissao", "papel", "perfil de acesso", "administrador", "admin"],
  ["fila", "lista de espera", "encaixe", "antecipar", "adiantar"],
  ["nota fiscal", "nfse", "nota", "recibo"],
  ["pagamento", "pagar", "cobranca", "pago", "receber"],
  ["relatorio", "metricas", "indicadores", "numeros", "grafico", "estatistica"],
  ["transferir", "atendimento humano", "falar com a recepcao", "pausar bot", "devolver ao bot", "finalizar atendimento"],
  ["exame", "procedimento", "preparo"],
  ["feriado", "dia sem atendimento", "recesso"],
  ["local", "consultorio", "endereco", "domiciliar", "visita"],
  ["erro", "problema", "nao funciona", "nao esta", "falha", "travou"],
];

// Radical simples: plural e infinitivo ("consultas" = "consulta", "marcar" = "marca").
const stem = (word: string) => {
  let out = word;
  if (out.length > 4 && out.endsWith("s")) out = out.slice(0, -1);
  if (out.length > 4 && /[aei]r$/.test(out)) out = out.slice(0, -1);
  return out;
};
const same = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));

const groupIndex = new Map<string, number[]>();
GROUPS.forEach((group, index) => {
  for (const term of group) if (!term.includes(" ")) groupIndex.set(stem(term), [...(groupIndex.get(stem(term)) ?? []), index]);
});

const words = (text: string) => norm(text).split(" ").filter((w) => w && !STOP.has(w));

/** Termos da pergunta, cada um com os sinônimos que o grupo dele traz. */
export function expandQuery(query: string): { word: string; synonyms: string[] }[] {
  return words(query).map((word) => {
    const s = stem(word);
    const synonyms = new Set<string>();
    for (const index of groupIndex.get(s) ?? []) for (const term of GROUPS[index]) for (const w of words(term)) if (!same(stem(w), s)) synonyms.add(stem(w));
    return { word: s, synonyms: [...synonyms] };
  });
}

export type Hit<T> = { item: T; score: number; snippet: string };

const has = (haystackWords: string[], needle: string) => haystackWords.some((w) => same(stem(w), needle));

export function articleText(a: Article): string {
  return [a.intro, a.whenToUse, ...(a.prerequisites ?? []), ...(a.steps ?? []), ...(a.fields ?? []).flatMap((f) => [f.name, f.text]), a.result, ...(a.notes ?? []), ...(a.problems ?? []).flatMap((p) => [p.problem, p.solution])]
    .filter(Boolean)
    .join(" ");
}

function scoreOf(parts: { title: string; keywords: string; extra: string; body: string }, terms: ReturnType<typeof expandQuery>, weights: number[] = []): number {
  const title = words(parts.title);
  const keywords = words(parts.keywords);
  const extra = words(parts.extra);
  const body = words(parts.body);
  let total = 0;
  for (const [index, { word, synonyms }] of terms.entries()) {
    let best = 0;
    if (has(title, word)) best = Math.max(best, 10);
    if (has(keywords, word)) best = Math.max(best, 7);
    if (has(extra, word)) best = Math.max(best, 4);
    if (has(body, word)) best = Math.max(best, 2);
    for (const synonym of synonyms) {
      if (has(title, synonym)) best = Math.max(best, 5);
      if (has(keywords, synonym)) best = Math.max(best, 4);
      if (has(extra, synonym) || has(body, synonym)) best = Math.max(best, 1);
    }
    total += best * (weights[index] ?? 1);
  }
  return total;
}

/** Trecho do texto em volta do primeiro termo achado (sem HTML: quem mostra escapa e marca). */
export function snippetOf(text: string, terms: ReturnType<typeof expandQuery>, max = 160): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const wanted = terms.flatMap((t) => [t.word, ...t.synonyms]);
  const found = sentences.find((s) => words(s).some((w) => wanted.some((x) => same(stem(w), x)))) ?? sentences[0] ?? "";
  return found.length > max ? `${found.slice(0, max - 1).trimEnd()}…` : found;
}

/** Quebra o trecho em pedaços, marcando os que casam com a busca (para <mark> sem injetar HTML). */
export function highlightParts(snippet: string, terms: ReturnType<typeof expandQuery>): { text: string; mark: boolean }[] {
  const wanted = new Set(terms.map((t) => t.word));
  return snippet
    .split(/(\s+)/)
    .map((piece) => ({ text: piece, mark: !!piece.trim() && [...wanted].some((x) => same(stem(norm(piece)), x)) }))
    .reduce<{ text: string; mark: boolean }[]>((acc, part) => {
      const last = acc[acc.length - 1];
      if (last && (last.mark === part.mark || !part.text.trim())) last.text += part.text;
      else acc.push({ ...part });
      return acc;
    }, []);
}

export type SearchResult = { articles: Hit<Article>[]; faqs: Hit<Faq>[]; terms: ReturnType<typeof expandQuery> };

export function search(query: string, articles: readonly Article[], faqs: readonly Faq[], category?: string): SearchResult {
  const terms = expandQuery(query);
  if (terms.length === 0) return { articles: [], faqs: [], terms };
  // Palavra que está em quase todo artigo ("consulta", "atendimento") pesa pouco: não separa nada.
  const docs = articles.map((a) => words(`${a.title} ${a.summary} ${a.keywords.join(" ")} ${articleText(a)}`));
  const weights = terms.map(({ word }) => (docs.filter((d) => has(d, word)).length / Math.max(docs.length, 1) > 0.35 ? 0.25 : 1));
  const cut = <T,>(hits: Hit<T>[]) => hits.filter((h) => h.score >= (hits[0]?.score ?? 0) * 0.4);
  const articleHits = articles
    .filter((a) => !category || a.category === category)
    .map((item) => ({
      item,
      score: scoreOf({ title: item.title, keywords: [...item.keywords, ...item.synonyms].join(" "), extra: `${item.summary} ${item.module} ${item.where}`, body: articleText(item) }, terms, weights),
      snippet: snippetOf(`${item.summary} ${articleText(item)}`, terms),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.item.order - b.item.order);
  const byId = new Map(articles.map((a) => [a.id, a]));
  const faqHits = faqs
    .filter((f) => !category || byId.get(f.article)?.category === category)
    .map((item) => ({ item, score: scoreOf({ title: item.question, keywords: item.keywords.join(" "), extra: "", body: item.answer }, terms, weights), snippet: snippetOf(item.answer, terms) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);
  return { articles: cut(articleHits), faqs: cut(faqHits), terms };
}
