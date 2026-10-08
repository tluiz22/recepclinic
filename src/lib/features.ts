// Matriz de acesso por clínica (D11, cliente, 05/out/2026). Regras puras: o
// que cada item libera e qual item cada rota do painel exige. A lista é a
// mesma da tabela `features` do banco (um teste de banco confere); quem
// grava e lê os itens liberados é src/lib/data/features.ts.
//
// Fora da matriz (sempre ligado em toda clínica): agenda (dia, semana, mês),
// bloqueios e trilha; marcar, remarcar e cancelar consulta e retorno;
// pacientes e contatos; a tela do Resumo do dia e o comparecimento;
// configurações básicas.

export type FeatureArea = "agenda" | "whatsapp" | "metrics";

export type FeatureKey =
  | "exams"
  | "home_visit"
  | "series"
  | "insurance"
  | "whatsapp_bot"
  | "reminders"
  | "waitlist"
  | "daily_summary"
  | "custom_messages"
  | "metrics_overview"
  | "metrics_appointments"
  | "metrics_no_shows"
  | "metrics_recall"
  | "metrics_funnel"
  | "metrics_financial"
  | "metrics_personal";

export type Feature = { key: FeatureKey; area: FeatureArea; label: string; dependsOn: FeatureKey[] };

export const FEATURES: readonly Feature[] = [
  { key: "exams", area: "agenda", label: "Exames e procedimentos", dependsOn: [] },
  { key: "home_visit", area: "agenda", label: "Atendimento domiciliar", dependsOn: [] },
  { key: "series", area: "agenda", label: "Séries recorrentes", dependsOn: [] },
  { key: "insurance", area: "agenda", label: "Convênios", dependsOn: [] },
  { key: "whatsapp_bot", area: "whatsapp", label: "Bot de WhatsApp", dependsOn: [] },
  { key: "reminders", area: "whatsapp", label: "Lembrete automático", dependsOn: [] },
  { key: "waitlist", area: "whatsapp", label: "Lista de espera", dependsOn: ["whatsapp_bot"] },
  { key: "daily_summary", area: "whatsapp", label: "Envio do resumo do dia", dependsOn: [] },
  { key: "custom_messages", area: "whatsapp", label: "Mensagens personalizadas", dependsOn: [] },
  { key: "metrics_overview", area: "metrics", label: "Métricas: Visão geral", dependsOn: [] },
  { key: "metrics_appointments", area: "metrics", label: "Métricas: Atendimentos", dependsOn: [] },
  { key: "metrics_no_shows", area: "metrics", label: "Métricas: Faltosos", dependsOn: [] },
  { key: "metrics_recall", area: "metrics", label: "Métricas: Retomar contato", dependsOn: [] },
  { key: "metrics_funnel", area: "metrics", label: "Métricas: Funil do bot", dependsOn: ["whatsapp_bot"] },
  { key: "metrics_financial", area: "metrics", label: "Métricas: Financeiro", dependsOn: [] },
  { key: "metrics_personal", area: "metrics", label: "Métricas pessoais do profissional", dependsOn: [] },
];

const BY_KEY = new Map(FEATURES.map((feature) => [feature.key, feature]));

export const AREA_LABELS: Record<FeatureArea, string> = { agenda: "Agenda", whatsapp: "WhatsApp", metrics: "Métricas" };

export function featureLabel(key: FeatureKey): string {
  return BY_KEY.get(key)?.label ?? key;
}

/** Itens marcados num formulário (valores desconhecidos ou repetidos saem). */
export function parseFeatureSelection(values: readonly string[]): FeatureKey[] {
  return FEATURES.map((feature) => feature.key).filter((key) => values.includes(key));
}

export function isFeatureKey(value: string): value is FeatureKey {
  return BY_KEY.has(value as FeatureKey);
}

/** Itens que dependem de outro ausente na lista (ex.: lista de espera sem o bot). */
export function missingDependencies(keys: readonly FeatureKey[]): { feature: FeatureKey; needs: FeatureKey }[] {
  const chosen = new Set(keys);
  return keys.flatMap((key) =>
    (BY_KEY.get(key)?.dependsOn ?? []).filter((dep) => !chosen.has(dep)).map((needs) => ({ feature: key, needs })),
  );
}

/** Desligar um item desliga os que dependem dele (ex.: sem bot, sai a lista de espera e o Funil). */
export function withoutDependents(keys: readonly FeatureKey[], removed: FeatureKey): FeatureKey[] {
  let result = keys.filter((key) => key !== removed);
  for (;;) {
    const broken = new Set(missingDependencies(result).map((item) => item.feature));
    if (!broken.size) return result;
    result = result.filter((key) => !broken.has(key));
  }
}

// ---------------------------------------------------------------------------
// Rotas do painel
// ---------------------------------------------------------------------------

/** Rota (prefixo) e, opcionalmente, a aba (`?tab=`) que exigem um item. */
type PathRule = { prefix: string; tab?: string | null; feature: FeatureKey };

// `tab: null` = a rota sem `?tab=` (aba padrão da tela).
const PATH_RULES: PathRule[] = [
  // Métricas, aba a aba. Sem aba, a tela abre na primeira aba liberada (basta
  // ter alguma, conferido pela área; achado na validação da F6.7, 07/out).
  { prefix: "/admin/metricas", tab: "visao_geral", feature: "metrics_overview" },
  { prefix: "/admin/metricas", tab: "funil", feature: "metrics_funnel" },
  { prefix: "/admin/metricas", tab: "atendimentos", feature: "metrics_appointments" },
  { prefix: "/admin/metricas", tab: "retomar_contato", feature: "metrics_recall" },
  // Aba desconhecida: a tela cai na primeira liberada; nenhuma regra própria.
  { prefix: "/admin/metricas", tab: "faltosos", feature: "metrics_no_shows" },
  { prefix: "/admin/metricas", tab: "financeiro", feature: "metrics_financial" },
  // Resumo do Dia: abas do lembrete e da lista de espera.
  { prefix: "/admin/consultas", tab: "lembretes", feature: "reminders" },
  { prefix: "/admin/consultas", tab: "lista_espera", feature: "waitlist" },
  // Exames: na Agenda (F4.5), o serviço de exame só aparece com o item, e o
  // banco recusa marcar sem ele (o cadastro do serviço é travado desde a F4.3).
  // Configurações (F4.4b): convênios, contatos do resumo do dia e hora do lembrete.
  { prefix: "/admin/configuracoes/convenios", feature: "insurance" },
  { prefix: "/api/admin/configuracoes/convenios", feature: "insurance" },
  { prefix: "/admin/configuracoes/contatos", feature: "daily_summary" },
  { prefix: "/api/admin/configuracoes/contatos", feature: "daily_summary" },
  { prefix: "/api/admin/configuracoes/lembrete", feature: "reminders" },
];

const matchesPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Item que a rota exige (null = básico, sempre ligado). */
export function requiredFeature(pathname: string, searchParams: URLSearchParams): FeatureKey | null {
  const tab = searchParams.get("tab");
  const rule = PATH_RULES.find(
    (r) => matchesPrefix(pathname, r.prefix) && (r.tab === undefined || r.tab === tab || (r.tab === null && !tab)),
  );
  return rule?.feature ?? null;
}

// ---------------------------------------------------------------------------
// Métricas e relatórios (D11, muda a D6)
// ---------------------------------------------------------------------------

export type MetricsScope = "clinic" | "own_agenda" | "none";

/**
 * O que a pessoa vê nas métricas e relatórios liberados: o Administrador da
 * clínica (e o Suporte) vê a clínica toda; o Profissional, só com as
 * "Métricas pessoais do profissional" e só a própria agenda; a Recepção, nada.
 */
export function metricsScope(context: { roles: string[]; isPlatformStaff: boolean; features: readonly FeatureKey[] }): MetricsScope {
  if (context.isPlatformStaff || context.roles.includes("admin")) return "clinic";
  if (context.roles.includes("professional") && context.features.includes("metrics_personal")) return "own_agenda";
  return "none";
}
