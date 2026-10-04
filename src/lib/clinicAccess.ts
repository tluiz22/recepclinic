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
};

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

/** Tem algum dos papéis na clínica ativa. O Suporte vale por todos, como no banco. */
export function hasRole(context: RoleHolder, ...roles: ClinicRole[]): boolean {
  return context.isPlatformStaff || context.roles.some((role) => roles.includes(role));
}

// Áreas do painel com acesso restrito (D6). O resto (início, agenda,
// pacientes, resumo do dia, trilha) é de todos os papéis.
//   - Configurações: só o Administrador.
//   - Métricas e relatórios: Administrador e Profissional.
export type PanelArea = "settings" | "metrics" | "shared";

const AREA_PREFIXES: [string, PanelArea][] = [
  ["/admin/configuracoes", "settings"],
  ["/api/admin/configuracoes", "settings"],
  ["/admin/metricas", "metrics"],
  ["/admin/relatorios", "metrics"],
];

const AREA_ROLES: Record<PanelArea, ClinicRole[]> = {
  settings: ["admin"],
  metrics: ["admin", "professional"],
  shared: ["admin", "professional", "reception"],
};

export function areaOfPath(pathname: string): PanelArea {
  const match = AREA_PREFIXES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match ? match[1] : "shared";
}

export function canAccessArea(context: RoleHolder, area: PanelArea): boolean {
  return hasRole(context, ...AREA_ROLES[area]);
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
