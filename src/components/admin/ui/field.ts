// Ids da ajuda de um campo (Field.astro, ajuda contextual de 23/out/2026). O
// slot do Astro não recebe atributos, então quem escreve o campo liga a
// orientação ou o erro com `aria-describedby={describedBy(...)}`.

export type FieldIds = { label: string; help: string; hint: string; error: string };

export function fieldIds(id: string): FieldIds {
  return { label: `${id}-rotulo`, help: `${id}-ajuda`, hint: `${id}-orientacao`, error: `${id}-erro` };
}

/** O erro aparece no lugar da orientação; sem nenhum dos dois, nada a ligar. */
export function describedBy(id: string, { hint, error }: { hint?: unknown; error?: unknown }): string | undefined {
  if (error) return fieldIds(id).error;
  if (hint) return fieldIds(id).hint;
  return undefined;
}
