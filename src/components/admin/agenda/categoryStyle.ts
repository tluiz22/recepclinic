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

/** Cor de um serviço: faixa (fundo e linha), tipo, serviço e contorno do bloco em Horários. */
export type ServiceTint = Pick<CategoryStyle, "band" | "text" | "detail"> & { border: string };

const tint = (name: string): ServiceTint => ({
  band: `border-sv-${name}-200 bg-sv-${name}-50`,
  text: `text-sv-${name}-700`,
  detail: `text-sv-${name}-700`,
  border: `border-sv-${name}-200`,
});

// As classes por extenso, para o Tailwind gerar (ele não lê nomes montados):
// border-sv-oliva-200 bg-sv-oliva-50 text-sv-oliva-700 border-sv-rosa-200 bg-sv-rosa-50 text-sv-rosa-700
// border-sv-sepia-200 bg-sv-sepia-50 text-sv-sepia-700 border-sv-indigo-200 bg-sv-indigo-50 text-sv-indigo-700
// border-sv-ciano-200 bg-sv-ciano-50 text-sv-ciano-700
export const SERVICE_TINTS: ServiceTint[] = ["oliva", "rosa", "sepia", "indigo", "ciano"].map(tint);

const RETURN_TINT: ServiceTint = {
  band: CATEGORY_STYLES.return_visit.band,
  text: CATEGORY_STYLES.return_visit.text,
  detail: CATEGORY_STYLES.return_visit.detail,
  border: "border-ret-200",
};

export type ServiceRef = { id: string; category: ServiceCategory; createdAt: string };

/**
 * Cor de cada serviço (cliente, 19/out/2026): automática, sem escolha. O Retorno
 * fica sempre roxo; Consultas e Exames recebem as cores da paleta pela ordem de
 * criação (inclusive os desativados), então serviço novo pega a próxima cor e as
 * dos outros não mudam. Com mais serviços que cores, a paleta recomeça.
 */
export function serviceTints(services: ServiceRef[]): Map<string, ServiceTint> {
  const tints = new Map<string, ServiceTint>();
  const others = services
    .filter((s) => s.category !== "return_visit")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  others.forEach((s, i) => tints.set(s.id, SERVICE_TINTS[i % SERVICE_TINTS.length]));
  for (const s of services) if (s.category === "return_visit") tints.set(s.id, RETURN_TINT);
  return tints;
}

/** Tipo (rótulo e ícone) com a cor do serviço; sem a cor, a do tipo. */
export function serviceLook(category: ServiceCategory, tint?: ServiceTint): CategoryStyle & { border: string } {
  return { ...CATEGORY_STYLES[category], border: "border-line-strong", ...tint };
}

/** Tipo e cor de cada serviço, para a etiqueta do tipo (Resumo do Dia, 19/out/2026). */
export function serviceTags(services: ServiceRef[]): Map<string, { category: ServiceCategory; tint?: ServiceTint }> {
  const tints = serviceTints(services);
  return new Map(services.map((s) => [s.id, { category: s.category, tint: tints.get(s.id) }]));
}
