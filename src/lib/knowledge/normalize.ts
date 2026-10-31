// Texto do paciente para comparar com a base (BC 3.2): minúsculas, sem acento,
// sem pontuação, abreviações comuns do WhatsApp por extenso. O mesmo vale para
// perguntas, sinônimos, palavras-chave e nomes da clínica.

const ABBREVIATIONS: Record<string, string> = {
  vc: "voce",
  vcs: "voces",
  q: "que",
  oq: "o que",
  hj: "hoje",
  amn: "amanha",
  tb: "tambem",
  tbm: "tambem",
  pq: "porque",
  p: "para",
  pra: "para",
  pro: "para o",
  td: "tudo",
  msg: "mensagem",
  dr: "doutor",
  dra: "doutora",
  n: "nao",
  obg: "obrigado",
  obgd: "obrigado",
  obgda: "obrigada",
  vlw: "valeu",
  qto: "quanto",
  qnt: "quanto",
  qdo: "quando",
  qnd: "quando",
  tel: "telefone",
  hr: "hora",
  hrs: "horas",
  sab: "sabado",
  cel: "celular",
  ctz: "certeza",
  agr: "agora",
};

export function normalizeText(text: string): string {
  const plain = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!plain) return "";
  return plain
    .split(" ")
    .map((token) => ABBREVIATIONS[token] ?? token)
    .join(" ");
}

export const tokensOf = (normalized: string): string[] => (normalized ? normalized.split(" ") : []);

/** Palavras que não distinguem uma pergunta de outra (contam fora da cobertura). */
export const STOPWORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas", "um", "uma", "uns", "umas",
  "para", "por", "pelo", "pela", "com", "que", "se", "me", "eu", "meu", "minha", "voce", "voces", "ai", "ae", "aqui",
  "qual", "quais", "como", "ola", "oi", "favor", "gostaria", "queria", "quero", "saber", "sobre", "isso", "esse",
  "essa", "ja", "tambem", "so", "mais", "bom", "dia", "boa", "tarde", "noite", "tudo", "bem", "ate",
]);

/** Mesma palavra com até 2 letras a mais no fim (plural, gênero): "horario" ≈ "horarios". */
export function tokenMatches(token: string, target: string): boolean {
  if (token === target) return true;
  if (target.length < 5) return false;
  return token.startsWith(target) && token.length - target.length <= 2;
}

/** A frase (já normalizada) aparece na mensagem, palavra por palavra (a última pode ter plural). */
export function containsPhrase(messageTokens: string[], phrase: string): boolean {
  const words = tokensOf(phrase);
  if (!words.length || words.length > messageTokens.length) return false;
  for (let i = 0; i + words.length <= messageTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < words.length && ok; j++) ok = tokenMatches(messageTokens[i + j], words[j]);
    if (ok) return true;
  }
  return false;
}
