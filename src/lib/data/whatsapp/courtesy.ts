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

/** O texto é só agradecimento, confirmação ou despedida. */
export function isCourtesyText(text: string): boolean {
  const clean = normalize(text).trim();
  if (!clean) return false;
  const emojis = [...clean.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0]);
  if (emojis.some((e) => !EMOJIS.has(e))) return false;
  const words = clean
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .split(/[^a-z]+/)
    .filter(Boolean)
    // "okkk", "obrigadaaa", "vlww": letras repetidas no fim contam como uma.
    .map((w) => w.replace(/(.)\1+$/, "$1"));
  if (words.length === 0) return emojis.length > 0;
  if (words.length > MAX_WORDS) return false;
  const known = (w: string) => ANCHORS.has(w) || FILLERS.has(w) || ANCHORS.has(`${w}${w.at(-1)}`);
  return words.every(known) && words.some((w) => ANCHORS.has(w) || ANCHORS.has(`${w}${w.at(-1)}`));
}

/** Mensagem recebida de cortesia: texto de cortesia ou reação (👍 numa mensagem). */
export function isCourtesyMessage(msg: WaMessage): boolean {
  if (msg.type === "reaction") return true;
  return msg.type === "text" && !!msg.text?.body && isCourtesyText(msg.text.body);
}
