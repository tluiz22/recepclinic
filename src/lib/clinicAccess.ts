import { FEATURES, metricsScope, requiredFeature, type FeatureKey } from "./features";
import type { Enums } from "./supabase/database.types";

// Clínica ativa, papéis e áreas do painel (D6). Regras puras; quem consulta o
// banco é src/lib/data/clinicContext.ts. O banco (RLS) vale de qualquer jeito:
// estas regras decidem o que a aplicação mostra e em que rota a pessoa entra.

export type ClinicRole = Enums<"clinic_role">;

/** Cookie com a última clínica usada neste navegador. */
export const ACTIVE_CLINIC_COOKIE = "rc_clinica";

export function activeClinicCookieOptions(url: URL) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: url.protocol === "https:",
    maxAge: 365 * 24 * 60 * 60,
  };
}

export type Membership = {
  clinicId: string;
  roles: ClinicRole[];
  /** Quando a pessoa entrou na clínica (desempate quando não há última usada). */
  joinedAt: string;
  /** Cadastra e associa convênios sem ser Administrador (MC, M4; marcado em Equipe). */
  canManageInsurance?: boolean;
};

/** O que cada requisição do painel sabe sobre quem está usando e em qual clínica. */
export type ClinicContext = {
  userId: string;
  clinicId: string;
  clinicName: string;
  clinicStatus: Enums<"clinic_status">;
  clinicProfile: Enums<"clinic_profile">;
  timezone: string;
  /** Papéis na clínica ativa; vazio para o Suporte que não é membro dela. */
  roles: ClinicRole[];
  /** Suporte RecepClinic: vale por todos os papéis, e cada leitura é registrada. */
  isPlatformStaff: boolean;
  /** Agendas da clínica ativa que a pessoa pode ver (D6, acesso por agenda). */
  agendaIds: string[];
  /** Itens da matriz de acesso liberados para a clínica ativa (D11). */
  features: FeatureKey[];
  /** Pode trocar de clínica: membro de mais de uma, ou Suporte (F4.1). */
  canSwitchClinic: boolean;
  /** Cadastra e associa convênios sem ser Administrador (MC, cliente, 07/nov/2026). */
  canManageInsurance: boolean;
  /** O profissional ligado ao login (MS, S1): configura só o que é dele. Null sem cadastro ligado. */
  ownProfessionalId: string | null;
};

/**
 * Pedido de navegação do navegador (página ou envio de formulário), que espera
 * uma página de volta, e não chamada por código (fetch), que espera JSON. Erro
 * de acesso numa rota /api vira redirecionamento com aviso, e não JSON cru na
 * tela (F4.2).
 */
export function expectsPage(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID.test(value);
}

export type ActiveClinicChoice =
  | { kind: "membership"; clinicId: string; remembered: boolean }
  | { kind: "support"; clinicId: string }
  | { kind: "choose" }
  | { kind: "no_access" };

/**
 * Qual clínica abrir: a última usada (cookie), se a pessoa ainda for membro;
 * senão, a clínica em que entrou primeiro. O Suporte abre a clínica do cookie
 * mesmo sem ser membro (a existência dela é conferida no banco) e, sem cookie,
 * precisa escolher. Sem papel em clínica nenhuma e fora do Suporte, sem acesso.
 */
export function chooseActiveClinic(input: {
  memberships: Membership[];
  isPlatformStaff: boolean;
  preferredClinicId: string | null | undefined;
}): ActiveClinicChoice {
  const preferred = isUuid(input.preferredClinicId) ? input.preferredClinicId.toLowerCase() : null;
  const usable = input.memberships.filter((membership) => membership.roles.length > 0);

  if (preferred && usable.some((membership) => membership.clinicId === preferred)) {
    return { kind: "membership", clinicId: preferred, remembered: true };
  }
  if (preferred && input.isPlatformStaff) return { kind: "support", clinicId: preferred };

  const [first] = [...usable].sort(
    (a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.clinicId.localeCompare(b.clinicId),
  );
  if (first) return { kind: "membership", clinicId: first.clinicId, remembered: false };
  return input.isPlatformStaff ? { kind: "choose" } : { kind: "no_access" };
}

type RoleHolder = Pick<ClinicContext, "roles" | "isPlatformStaff">;
/** Sem `features`, nenhum item da matriz está liberado. */
type AccessHolder = RoleHolder & { features?: readonly FeatureKey[]; canManageInsurance?: boolean; ownProfessionalId?: string | null };

/** Tem algum dos papéis na clínica ativa. O Suporte vale por todos, como no banco. */
export function hasRole(context: RoleHolder, ...roles: ClinicRole[]): boolean {
  return context.isPlatformStaff || context.roles.some((role) => roles.includes(role));
}

// Áreas do painel com acesso restrito (D6). O resto (início, agenda,
// pacientes, resumo do dia, trilha) é de todos os papéis.
//   - Configurações: só o Administrador.
//   - Métricas e relatórios (D11, muda a D6): o Administrador, com alguma aba
//     liberada; o Profissional, só com as "Métricas pessoais do profissional"
//     (e só a própria agenda, `metricsScope`).
//   - Financeiro (F11, cliente, 12/out/2026): o Administrador e a Recepção,
//     com o "Módulo financeiro" liberado; o Profissional não entra.
//   - Relacionamento (CRM A1, cliente, 27/out/2026, Q2): o Administrador e a
//     Recepção, com o item "Relacionamento"; o Profissional não entra. Não
//     abre nenhuma rota das Métricas.
//   - Convênios (MC, cliente, 07/nov/2026, M4): o Administrador e quem ele
//     autoriza em Equipe ("Cadastrar e associar convênios").
//   - Profissionais, Agendas, Horários e Serviços (MS, S1; cliente, 07/nov/2026):
//     o Administrador e o profissional com login, que vê e altera só o que é
//     dele (as telas filtram; o banco confere).
export type PanelArea = "settings" | "own_settings" | "insurance" | "metrics" | "finance" | "relationship" | "shared";

/** As seções de Configurações do profissional com login (MS, S1). */
export const OWN_SETTINGS_SECTIONS = ["profissionais", "agendas", "horarios", "servicos"] as const;

/** Nota fiscal (N2b, N-P2): o profissional com login vê e configura só o emissor dele. */
export const OWN_SETTINGS_EXTRA_ITEMS = ["nota_fiscal"] as const;

// A primeira que casa vale: Convênios antes de Configurações.
const AREA_PREFIXES: [string, PanelArea][] = [
  ["/admin/configuracoes/convenios", "insurance"],
  ["/api/admin/configuracoes/convenios", "insurance"],
  ...[...OWN_SETTINGS_SECTIONS, "nota-fiscal"].flatMap((section): [string, PanelArea][] => [
    [`/admin/configuracoes/${section}`, "own_settings"],
    [`/api/admin/configuracoes/${section}`, "own_settings"],
  ]),
  // F5b: o profissional com login pega o QR e o cartaz do próprio link (as rotas conferem de quem é).
  ["/admin/configuracoes/portal/cartaz", "own_settings"],
  ["/api/admin/configuracoes/portal/qr", "own_settings"],
  ["/admin/configuracoes", "settings"],
  ["/api/admin/configuracoes", "settings"],
  ["/admin/metricas", "metrics"],
  ["/admin/relatorios", "metrics"],
  ["/admin/financeiro", "finance"],
  ["/api/admin/financeiro", "finance"],
  ["/admin/relacionamento", "relationship"],
  // Pacientes › Para contatar (RX4): as mesmas listas, com o mesmo acesso.
  ["/admin/pacientes/para-contatar", "relationship"],
  ["/api/admin/relacionamento", "relationship"],
];

const AREA_ROLES: Record<PanelArea, ClinicRole[]> = {
  settings: ["admin"],
  own_settings: ["admin"],
  insurance: ["admin"],
  metrics: ["admin", "professional"],
  finance: ["admin", "reception"],
  relationship: ["admin", "reception"],
  shared: ["admin", "professional", "reception"],
};

export function areaOfPath(pathname: string): PanelArea {
  const match = AREA_PREFIXES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match ? match[1] : "shared";
}

const METRICS_TABS = FEATURES.filter((feature) => feature.area === "metrics" && feature.key !== "metrics_personal").map((f) => f.key);

export function canAccessArea(context: AccessHolder, area: PanelArea): boolean {
  if (area === "insurance") return hasRole(context, "admin") || !!context.canManageInsurance;
  if (area === "own_settings") return hasRole(context, "admin") || ownSettingsOnly(context);
  if (area === "finance" || area === "relationship") return hasRole(context, ...AREA_ROLES[area]) && (context.features ?? []).includes(area);
  if (area !== "metrics") return hasRole(context, ...AREA_ROLES[area]);
  const features = context.features ?? [];
  return metricsScope({ ...context, features }) !== "none" && METRICS_TABS.some((key) => features.includes(key));
}

/** Profissional com login sem ser Administrador: em Configurações, só o que é dele (MS, S1). */
export function ownSettingsOnly(context: AccessHolder): boolean {
  return !hasRole(context, "admin") && context.roles.includes("professional") && !!context.ownProfessionalId;
}

/** Pode abrir a rota: papel da área (D6) e item da matriz liberado para a clínica (D11). */
export function canAccessPath(context: AccessHolder, pathname: string, searchParams: URLSearchParams): boolean {
  if (!canAccessArea(context, areaOfPath(pathname))) return false;
  const feature = requiredFeature(pathname, searchParams);
  return feature === null || (context.features ?? []).includes(feature);
}

// Clínica suspensa (F12.3, decisões 11.5 e fluxo 8 do planejamento-faturamento-saas.md): fora o Suporte, o
// Administrador fica só na Assinatura (para regularizar) e os outros papéis só na tela de aviso.
export const SUSPENDED_PAGE = "/admin/clinica-suspensa";
export const SUSPENDED_ADMIN_PAGE = "/admin/configuracoes/assinatura";
// F12.2e: o contrato completo (para ler antes de aceitar ou pagar) também abre;
// F12.2f: e o cancelamento; F12.2g: a volta da troca de cartão.
const SUSPENDED_ADMIN_PATHS = [SUSPENDED_ADMIN_PAGE, `${SUSPENDED_ADMIN_PAGE}/contrato`, `${SUSPENDED_ADMIN_PAGE}/cancelar`, "/api/admin/configuracoes/assinatura", "/api/admin/configuracoes/assinatura/cartao", "/api/admin/configuracoes/assinatura/pagamento", "/api/admin/configuracoes/assinatura/cep"];

/** Para onde vai quem abre `pathname` na clínica suspensa; null = pode abrir. */
export function suspendedLanding(context: Pick<ClinicContext, "clinicStatus" | "roles" | "isPlatformStaff">, pathname: string): string | null {
  if (context.clinicStatus !== "suspended" || context.isPlatformStaff || pathname === SUSPENDED_PAGE) return null;
  if (context.roles.includes("admin")) return SUSPENDED_ADMIN_PATHS.includes(pathname) ? null : SUSPENDED_ADMIN_PAGE;
  return SUSPENDED_PAGE;
}

/** Vê o painel restrito da clínica suspensa (não o Suporte). */
export function inSuspendedView(context: Pick<ClinicContext, "clinicStatus" | "isPlatformStaff"> | null | undefined): boolean {
  return !!context && context.clinicStatus === "suspended" && !context.isPlatformStaff;
}

const ROLE_LABELS: Record<ClinicRole, string> = {
  admin: "Administrador",
  professional: "Profissional",
  reception: "Recepção",
};

/** Rótulo do login ativo no painel (ex.: "Administrador + Profissional"). */
export function roleLabel(context: RoleHolder): string {
  if (context.isPlatformStaff && context.roles.length === 0) return "Suporte RecepClinic";
  const ordered = (Object.keys(ROLE_LABELS) as ClinicRole[]).filter((role) => context.roles.includes(role));
  return ordered.map((role) => ROLE_LABELS[role]).join(" + ") || "Sem papel";
}
