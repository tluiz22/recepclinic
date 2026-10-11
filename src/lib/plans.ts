import { FEATURES, featureLabel, type FeatureKey } from "./features";

// Planos comerciais (cliente, 11/out/2026): Básico, Completo e adicionais
// avulsos, montados com os itens da matriz de acesso (D11). Só o Suporte vê
// (tela Planos e matriz da clínica); nada disso vai para o site público. A
// mensalidade é por clínica, mais um valor por profissional além do primeiro;
// os adicionais têm valor fixo por clínica. As mensagens da Meta ficam à parte
// (cobradas direto da clínica). Séries recorrentes ficam fora da tabela por
// ora (o Suporte ainda pode ligar).

export const PRICES = {
  basicCents: 14_700,
  completeCents: 29_700,
  /** Cada profissional além do primeiro, no Básico e no Completo. */
  extraProfessionalCents: 4_700,
  /** Implantação (valor único); isenta só nos pilotos combinados pelo cliente. */
  setupCents: 29_700,
} as const;

/** Item da matriz como é vendido: um ou mais itens do banco ligados juntos. */
export type PlanItem = { id: string; label: string; features: FeatureKey[]; priceCents: number | null };

const METRICS = FEATURES.filter((feature) => feature.area === "metrics").map((feature) => feature.key);

const single = (key: FeatureKey): PlanItem => ({ id: key, label: featureLabel(key), features: [key], priceCents: null });

/** Incluído no Básico (e no Completo). */
export const BASIC_ITEMS: PlanItem[] = [single("whatsapp_bot"), single("reminders"), single("daily_summary")];

/** Adicionais avulsos, do maior valor ao menor; todos juntos formam o Completo. */
export const ADDONS: PlanItem[] = [
  { ...single("exams"), priceCents: 3_500 },
  { ...single("waitlist"), priceCents: 3_500 },
  // Métricas sempre ligadas juntas (cliente, 11/out/2026).
  { id: "metrics", label: "Métricas (todas as abas e as métricas pessoais)", features: METRICS, priceCents: 4_500 },
  // Textos do bot e templates vendidos juntos (cliente, 11/out/2026).
  { id: "custom_messages", label: "Mensagens personalizadas (bot e templates)", features: ["custom_messages", "custom_templates"], priceCents: 2_900 },
  { ...single("home_visit"), priceCents: 1_900 },
  { ...single("insurance"), priceCents: 1_900 },
  { ...single("team_summary"), priceCents: 1_500 },
];

/** Fora da tabela de preços por ora. */
export const OFF_TABLE: PlanItem[] = [single("series")];

export const ALL_ITEMS: PlanItem[] = [...BASIC_ITEMS, ...ADDONS, ...OFF_TABLE];

const ITEM_BY_FEATURE = new Map(ALL_ITEMS.flatMap((item) => item.features.map((key) => [key, item] as const)));

/** Itens marcados no formulário viram os itens do banco (ids desconhecidos saem). */
export function featuresOfItems(ids: readonly string[]): FeatureKey[] {
  const chosen = new Set(ids);
  const keys = new Set(ALL_ITEMS.filter((item) => chosen.has(item.id)).flatMap((item) => item.features));
  return FEATURES.map((feature) => feature.key).filter((key) => keys.has(key));
}

/** Um item conta como ligado quando algum item do banco dele está ligado. */
export function itemIsOn(item: PlanItem, features: readonly FeatureKey[]): boolean {
  return item.features.some((key) => features.includes(key));
}

/** Itens de que o item depende (ex.: Lista de espera e Métricas dependem do bot). */
export function itemDependsOn(item: PlanItem): string[] {
  const deps = FEATURES.filter((feature) => item.features.includes(feature.key)).flatMap((feature) => feature.dependsOn);
  return [...new Set(deps.map((key) => ITEM_BY_FEATURE.get(key)!.id))].filter((id) => id !== item.id);
}

export const PLAN_ITEM_IDS = {
  basic: BASIC_ITEMS.map((item) => item.id),
  complete: [...BASIC_ITEMS, ...ADDONS].map((item) => item.id),
};

export type ClinicPlan =
  | { kind: "none" }
  | { kind: "basic" | "complete" | "custom"; addons: PlanItem[]; offTable: PlanItem[]; monthlyCents: number; completeIsCheaper: boolean };

/**
 * Plano que a matriz da clínica corresponde e a mensalidade de referência
 * (profissionais = limite contratado). Sem tudo do Básico, fica fora dos planos.
 */
export function clinicPlan(features: readonly FeatureKey[], professionals: number): ClinicPlan {
  if (!BASIC_ITEMS.every((item) => itemIsOn(item, features))) return { kind: "none" };
  const addons = ADDONS.filter((item) => itemIsOn(item, features));
  const offTable = OFF_TABLE.filter((item) => itemIsOn(item, features));
  const extra = Math.max(0, professionals - 1) * PRICES.extraProfessionalCents;
  const complete = addons.length === ADDONS.length;
  const custom = PRICES.basicCents + addons.reduce((sum, item) => sum + (item.priceCents ?? 0), 0);
  const kind = complete ? "complete" : addons.length || offTable.length ? "custom" : "basic";
  return {
    kind,
    addons,
    offTable,
    monthlyCents: (complete ? PRICES.completeCents : custom) + extra,
    completeIsCheaper: !complete && custom > PRICES.completeCents,
  };
}

export const PLAN_LABELS: Record<ClinicPlan["kind"], string> = {
  none: "Fora dos planos",
  basic: "Básico",
  complete: "Completo",
  custom: "Básico + adicionais",
};

// ---------------------------------------------------------------------------
// Simulação da negociação (cliente, 11/out/2026): o Suporte troca os valores
// na tela Planos e calcula; nada é gravado (a manutenção das clínicas
// contratadas, com o valor negociado, fica para antes da 1ª clínica pagante).
// ---------------------------------------------------------------------------

export type PriceTable = {
  basicCents: number;
  completeCents: number;
  extraProfessionalCents: number;
  setupCents: number;
  addons: Record<string, number>;
};

export const TABLE_PRICES: PriceTable = {
  ...PRICES,
  addons: Object.fromEntries(ADDONS.map((item) => [item.id, item.priceCents ?? 0])),
};

export type Simulation = { plan: "basic" | "complete"; addonIds: string[]; professionals: number; setupWaived: boolean };

export type SimulationResult = {
  /** Plano (Básico ou Completo), adicionais e profissionais a mais, por mês. */
  lines: { label: string; cents: number }[];
  monthlyCents: number;
  setupCents: number;
  /** Primeiro pagamento: mensalidade e implantação. */
  firstPaymentCents: number;
};

/** Mensalidade e implantação com os valores dados (os de tabela ou os negociados). */
export function simulate(prices: PriceTable, simulation: Simulation): SimulationResult {
  const complete = simulation.plan === "complete";
  const professionals = Math.max(1, Math.floor(simulation.professionals) || 1);
  const lines = [
    { label: complete ? "Completo (1 profissional)" : "Básico (1 profissional)", cents: complete ? prices.completeCents : prices.basicCents },
    ...(complete ? [] : ADDONS.filter((item) => simulation.addonIds.includes(item.id)).map((item) => ({ label: item.label, cents: prices.addons[item.id] ?? 0 }))),
    ...(professionals > 1
      ? [{ label: `${professionals - 1} ${professionals === 2 ? "profissional" : "profissionais"} a mais`, cents: (professionals - 1) * prices.extraProfessionalCents }]
      : []),
  ];
  const monthlyCents = lines.reduce((sum, line) => sum + line.cents, 0);
  const setupCents = simulation.setupWaived ? 0 : prices.setupCents;
  return { lines, monthlyCents, setupCents, firstPaymentCents: monthlyCents + setupCents };
}
