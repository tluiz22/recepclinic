import { KB_SOURCE_VARIABLES, type KbSource } from "./lists";

// Modelos de resposta da base (BC 3.2): "{variável}" preenchida pelas fontes
// da clínica. Variável sem fonte não publica; sem dado na clínica, a entrada
// não responde (nunca sai a resposta pela metade).

const VARIABLE = /\{([a-z_]+)\}/g;

export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VARIABLE)].map((m) => m[1]))];
}

/** Variáveis do modelo que nenhuma das fontes da entrada preenche. */
export function variablesWithoutSource(template: string, sources: readonly string[]): string[] {
  const provided = new Set(sources.flatMap((source) => KB_SOURCE_VARIABLES[source as KbSource] ?? []));
  return templateVariables(template).filter((name) => !provided.has(name));
}

/** Preenche o modelo; null quando falta alguma variável (sem dado na clínica). */
export function renderTemplate(template: string, values: Record<string, string | null | undefined>): string | null {
  let missing = false;
  const text = template.replace(VARIABLE, (_, name: string) => {
    const value = values[name];
    if (value == null) {
      missing = true;
      return "";
    }
    return value;
  });
  return missing ? null : text;
}
