// Como a clínica é chamada nos textos genéricos das mensagens e das páginas
// do paciente (cliente, 11/out/2026): "a clínica", "o consultório" ou outro
// nome com o artigo. O nome próprio ("Aqui é da Clínica Sorriso") é outra coisa.

export type NounArticle = "a" | "o";
export const NOUN_ARTICLES: NounArticle[] = ["a", "o"];
export type Designation = { noun: string; article: NounArticle };

export const DEFAULT_DESIGNATION: Designation = { noun: "clínica", article: "a" };
/** As opções prontas da tela; o resto é "Outro". */
export const DESIGNATION_PRESETS: Designation[] = [DEFAULT_DESIGNATION, { noun: "consultório", article: "o" }];
export const DESIGNATION_NOUN_MAX = 40;

/** "a clínica" / "o consultório". */
export const designationText = (d: Designation) => `${d.article} ${d.noun}`;
/** "A clínica" / "O consultório" (começo de frase). */
export const designationTitle = (d: Designation) => `${d.article.toUpperCase()} ${d.noun}`;

/** O nome como a clínica digitou, sem espaços sobrando. */
export function cleanDesignationNoun(noun: string): string {
  return noun.replace(/\s+/g, " ").trim();
}
