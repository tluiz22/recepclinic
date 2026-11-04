import { formatAge } from "./age";

// Conferência dos dados antes de cadastrar ou alterar (C19; cliente,
// 03/nov/2026: a secretária cadastrou uma criança com o nascimento errado).
// O diálogo de confirmação (src/scripts/confirmDelete.ts) mostra a lista; o
// script src/scripts/confirmFormData.ts lê os campos na hora do clique e usa
// esta função para montar as linhas. Data: dd/mm/aaaa e a idade de hoje.

export type ConfirmDetail = { label: string; value: string; before?: string };

export type FieldReading = {
  label: string;
  /** Valor atual do campo (data em aaaa-mm-dd). */
  value: string;
  /** Valor ao abrir o formulário (edição): diferente do atual, a linha mostra "antes → depois". */
  initial?: string;
  kind: "text" | "date";
  /** Data de nascimento: mostra a idade junto. */
  age?: boolean;
  /** Texto pronto (opção escolhida de uma lista ou de um grupo de opções). */
  text?: string;
  initialText?: string;
};

function show(kind: FieldReading["kind"], value: string, today: string, age: boolean): string {
  if (kind !== "date" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value.split("-").reverse().join("/");
  return age ? `${date} · ${formatAge(value, today)}` : date;
}

export function confirmDetails(fields: FieldReading[], today: string): ConfirmDetail[] {
  return fields
    .map((field) => {
      const value = (field.text ?? show(field.kind, field.value.trim(), today, !!field.age)).trim();
      const changed = field.initial !== undefined && field.initial.trim() !== field.value.trim();
      const before = changed ? (field.initialText ?? show(field.kind, field.initial!.trim(), today, !!field.age)).trim() : undefined;
      return { label: field.label, value: value || "(em branco)", ...(changed ? { before: before || "(em branco)" } : {}) };
    })
    .filter((detail) => detail.value !== "(em branco)" || detail.before !== undefined);
}
