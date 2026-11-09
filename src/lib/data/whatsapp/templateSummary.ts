import type { TemplateSyncLine } from "./templateSync";

// Mensagem do Suporte depois de "Criar na Meta" e "Atualizar situação" (Configurações › WhatsApp).

const STATUS_TEXT = { pending: "em análise", approved: "aprovado", rejected: "recusado", disabled: "desativado" } as const;

const describe = (line: TemplateSyncLine) => `${line.name}: ${line.problem ? `não enviado (a Meta respondeu: ${line.problem})` : line.status ? STATUS_TEXT[line.status] : "?"}`;

/**
 * Resumo para o Suporte (cliente, 09/nov/2026): só os templates pendentes (não enviados, em análise, recusados ou
 * desativados), os não enviados primeiro; os aprovados só contados. Antes a lista trazia todos e o erro se perdia.
 */
export function supportSummary(head: string, lines: TemplateSyncLine[]): string {
  if (!lines.length) return 'Nenhum template cadastrado ainda: use "Criar na Meta".';
  const pending = lines.filter((line) => line.problem || line.status !== "approved").sort((a, b) => Number(!a.problem) - Number(!b.problem));
  const approved = lines.length - pending.length;
  const approvedText = approved === 1 ? " O outro está aprovado." : approved > 1 ? ` Os outros ${approved} estão aprovados.` : "";
  if (!pending.length) return `${head}. Todos aprovados (${approved}).`;
  return `${head}. Pendentes: ${pending.map(describe).join(" · ")}.${approvedText}`;
}
