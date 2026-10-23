// Catálogo da ajuda contextual (23/out/2026; padrão em docs/ajuda-contextual.md).
// Um arquivo por módulo, com os textos do "i" (tipos A e D), do "Como
// funciona?" (C) e das listas vazias (E). A orientação visível (B) continua
// escrita na própria tela. Cada texto de regra anota o arquivo que calcula ou
// decide; regra que não está no código não entra.

/** Parte de uma dica com o termo em negrito ("Consulta:" + o que é). */
export type Termo = { termo: string; texto: string };

/** Texto do "i": frase simples ou termos explicados um a um. Até ~280 caracteres. */
export type Dica = string | Termo[];

/** "Como funciona?" de uma funcionalidade: no máximo 5 itens em "Como funciona". */
export type ComoFunciona = {
  /** Para que serve, numa frase. */
  serve: string;
  como: string[];
  exemplo?: string;
  /** "Se algo der errado": o que conferir. */
  erro?: string;
};

/** Lista vazia: o que é a lista e como ela se enche. */
export type Vazio = { titulo: string; texto: string };

export type ModuloDeAjuda = {
  dicas?: Record<string, Dica>;
  comoFunciona?: Record<string, ComoFunciona>;
  vazios?: Record<string, Vazio>;
};

export const LIMITE_DICA = 280;
export const LIMITE_ITENS = 5;

/** O texto corrido de uma dica (para o limite e para quem precisa de texto puro). */
export function textoDaDica(dica: Dica): string {
  return typeof dica === "string" ? dica : dica.map((t) => `${t.termo}: ${t.texto}`).join(" ");
}
