// Mensagem de cortesia no atendimento humano (C27, cliente, 04/nov/2026, opção 1): depois da resposta da clínica,
// "ok", "obrigado", "tchau", 👍 e parecidos não fazem a conversa voltar para "Aguardando a clínica"; ela segue
// "Em atendimento" e volta ao bot nas 12 h (handoffReturn.ts). Reconhecida na chegada: o banco guarda só o tipo
// `courtesy`, nunca o texto (D12). Em dúvida, não é cortesia (volta para Aguardando, como antes).
import type { WaMessage } from "./meta";

export const COURTESY_MESSAGE_TYPE = "courtesy";

/** Ao menos uma destas: o que faz da mensagem um agradecimento, uma confirmação ou uma despedida. */
const ANCHORS = new Set([
  "ok", "okay", "oki", "okk", "okey", "blz", "beleza", "obrigado", "obrigada", "obrigadao", "obrigadinho", "obrigadinha",
  "obg", "obgd", "obgda", "brigado", "brigada", "grato", "grata", "agradeco", "agradecemos", "vlw", "valeu", "tchau",
  "tchauzinho", "xau", "certo", "certinho", "combinado", "perfeito", "otimo", "show", "entendi", "entendido", "joia",
  "top", "maravilha", "fechado", "legal", "bjs", "beijo", "beijos", "abs", "abraco", "abracos",
]);

/** Palavras que podem acompanhar (sozinhas, não bastam). */
const FILLERS = new Set([
  "ta", "bom", "boa", "dia", "tarde", "noite", "muito", "muita", "mt", "mto", "mta", "de", "nada", "ate", "mais", "logo",
  "amanha", "breve", "deus", "abencoe", "amem", "tudo", "bem", "entao", "ah", "a", "e", "eu", "nos", "voce", "vc",
  "voces", "vcs", "por", "isso", "enquanto", "pela", "pelo", "atencao", "ajuda", "retorno", "k", "kk", "kkk", "rs",
  "rsrs", "hehe", "haha", "um", "uma", "grande", "sua", "seu", "o", "os", "as", "ai", "aí", "tmj", "demais", "mesmo",
]);

/** Emojis de cortesia (com tom de pele e variações tirados antes). */
const EMOJIS = new Set(["👍", "🙏", "😊", "🙂", "😉", "❤", "♥", "👏", "🤝", "😘", "🥰", "😀", "😁", "😃", "✅", "👌", "💙", "💚", "💜", "🌹", "😍", "🤗"]);

const MAX_WORDS = 10;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\u{1F3FB}-\u{1F3FF}️‍]/gu, "");
}

/**
 * Palavras do texto (sem acento, em minúsculas) e se os emojis estão entre os aceitos; null = algum emoji de fora.
 * Letras repetidas no fim contam como uma ("okkk", "obrigadaaa"); com `collapseAll`, em qualquer ponto ("ooi").
 */
function wordsOf(text: string, emojis: Set<string> | "any", { collapseAll = false } = {}): { words: string[]; emojiCount: number } | null {
  const clean = normalize(text).trim();
  const found = [...clean.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0]);
  if (emojis !== "any" && found.some((e) => !emojis.has(e))) return null;
  const words = clean
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((w) => w.replace(collapseAll ? /(.)\1+/g : /(.)\1+$/, "$1"));
  return { words, emojiCount: found.length };
}

/** O texto é só agradecimento, confirmação ou despedida. */
export function isCourtesyText(text: string): boolean {
  const read = wordsOf(text, EMOJIS);
  if (!read) return false;
  const { words } = read;
  if (words.length === 0) return read.emojiCount > 0;
  if (words.length > MAX_WORDS) return false;
  const known = (w: string) => ANCHORS.has(w) || FILLERS.has(w) || ANCHORS.has(`${w}${w.at(-1)}`);
  return words.every(known) && words.some((w) => ANCHORS.has(w) || ANCHORS.has(`${w}${w.at(-1)}`));
}

/** Mensagem recebida de cortesia: texto de cortesia ou reação (👍 numa mensagem). */
export function isCourtesyMessage(msg: WaMessage): boolean {
  if (msg.type === "reaction") return true;
  return msg.type === "text" && !!msg.text?.body && isCourtesyText(msg.text.body);
}

/** Abre uma saudação: "oi", "oie", "olá", "opa", "e aí", "eae" (e "bom dia" e parecidos, conferidos à parte). */
const GREETING_ANCHORS = new Set(["oi", "oie", "ola", "opa", "eai", "eae", "helo"]);
/**
 * Podem acompanhar a saudação (sozinhas, não bastam). Já sem letras repetidas ("pessoal" → "pesoal", "hello" → "helo").
 * Sem "a", "o", "está", "tá": "boa tarde, a doutora está aí?" é pergunta e segue para a base.
 */
const GREETING_FILLERS = new Set([
  "e", "tudo", "bem", "td", "bom", "boa", "dia", "tarde", "noite", "como", "vai", "pesoal", "gente", "com", "voce", "vc",
  "voces", "vcs", "doutora", "doutor", "dra", "dr", "querida", "querido",
]);
const MAX_GREETING_WORDS = 8;

/**
 * O texto é só uma saudação: "Bom dia!!", "Oii", "Olá, boa tarde", "oi, tudo bem?", "Olá doutora", 👋 (cliente,
 * 13/nov/2026). Com pedido ou pergunta junto ("bom dia, quanto custa?") não é: segue para a base de conhecimento.
 */
export function isGreetingText(text: string): boolean {
  // Qualquer emoji acompanha ("Bom dia ☀️"); sozinho, só o 👋.
  const read = wordsOf(text, "any", { collapseAll: true });
  if (!read) return false;
  const { words } = read;
  if (words.length === 0) return normalize(text).includes("👋");
  if (words.length > MAX_GREETING_WORDS) return false;
  // "aí" só no "e aí".
  const known = (w: string, i: number) => GREETING_ANCHORS.has(w) || GREETING_FILLERS.has(w) || (w === "ai" && words[i - 1] === "e");
  if (!words.every(known)) return false;
  return words.some((w) => GREETING_ANCHORS.has(w)) || / (?:bom dia|boa tarde|boa noite|e ai) /.test(` ${words.join(" ")} `);
}
