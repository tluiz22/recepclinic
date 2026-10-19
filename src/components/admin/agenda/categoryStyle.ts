// Tipo do atendimento na Agenda (redesign de 19/out/2026, proposta 1C aprovada
// pelo cliente): faixa no alto do cartão do Dia e primeira linha na Semana. As
// cores do cartão seguem sendo da situação; o tipo se destaca pela posição e
// pela letra de título, e o Retorno pelo roxo, que nenhuma situação usa.
import type { IconName } from "../Icon.astro";
import { CATEGORY_LABELS } from "../../../lib/serviceLabels";
import type { Enums } from "../../../lib/supabase/database.types";

export type ServiceCategory = Enums<"service_category">;

type CategoryStyle = {
  label: string;
  icon: IconName;
  /** Faixa do cartão: fundo e linha de baixo. */
  band: string;
  /** Tipo (e ícone), na faixa e na Semana. */
  text: string;
  /** Serviço e origem do Retorno, ao lado do tipo na faixa. */
  detail: string;
};

export const CATEGORY_STYLES: Record<ServiceCategory, CategoryStyle> = {
  consultation: {
    label: CATEGORY_LABELS.consultation,
    icon: "clipboard",
    band: "border-ink/10 bg-white",
    text: "text-ink",
    detail: "text-ink-soft",
  },
  return_visit: {
    label: CATEGORY_LABELS.return_visit,
    icon: "arrow-uturn-left",
    band: "border-ret-200 bg-ret-50",
    text: "text-ret-700",
    detail: "text-ret-800",
  },
  exam: {
    label: CATEGORY_LABELS.exam,
    icon: "beaker",
    band: "border-ink/10 bg-white",
    text: "text-ink-mid",
    detail: "text-ink-soft",
  },
};

/** O nome do serviço ao lado do tipo; nada quando repete o tipo (serviço "Retorno"). */
export function serviceBesideCategory(
  serviceName: string,
  category: ServiceCategory,
): string | null {
  const same = (x: string) => x.trim().toLocaleLowerCase("pt-BR");
  return same(serviceName) === same(CATEGORY_LABELS[category])
    ? null
    : serviceName;
}

const CATEGORY_ORDER: ServiceCategory[] = [
  "consultation",
  "return_visit",
  "exam",
];

/**
 * Título do horário que vale para todos os serviços da agenda (Configurações ›
 * Horários, cliente, 19/out/2026): os tipos que a agenda atende, na ordem
 * Consulta, Retorno, Exame ("Consulta e Retorno"). Sem serviço: "Todos os serviços".
 */
export function agendaCategoriesTitle(
  categories: Iterable<ServiceCategory>,
): string {
  const present = new Set(categories);
  const labels = CATEGORY_ORDER.filter((c) => present.has(c)).map(
    (c) => CATEGORY_LABELS[c],
  );
  if (labels.length === 0) return "Todos os serviços";
  return labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}
