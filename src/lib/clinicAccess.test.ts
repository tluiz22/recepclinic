import { describe, expect, it } from "vitest";
import {
  areaOfPath,
  canAccessArea,
  chooseActiveClinic,
  hasRole,
  isUuid,
  roleLabel,
  type ClinicRole,
  type Membership,
} from "./clinicAccess";

const A = "0a000000-0000-4000-8000-000000000001";
const B = "0b000000-0000-4000-8000-000000000001";
const C = "0c000000-0000-4000-8000-000000000001";

const member = (clinicId: string, joinedAt: string, roles: ClinicRole[] = ["reception"]): Membership => ({
  clinicId,
  roles,
  joinedAt,
});

describe("clínica ativa", () => {
  const twoClinics = [member(B, "2026-10-02T00:00:00Z"), member(A, "2026-10-01T00:00:00Z")];

  it("abre a última usada (cookie) se a pessoa ainda for membro", () => {
    expect(chooseActiveClinic({ memberships: twoClinics, isPlatformStaff: false, preferredClinicId: B })).toEqual({
      kind: "membership",
      clinicId: B,
      remembered: true,
    });
  });

  it("sem cookie, abre a clínica em que entrou primeiro", () => {
    expect(chooseActiveClinic({ memberships: twoClinics, isPlatformStaff: false, preferredClinicId: undefined })).toEqual({
      kind: "membership",
      clinicId: A,
      remembered: false,
    });
  });

  it("cookie de clínica em que não é membro (ou inválido) é ignorado", () => {
    for (const preferred of [C, "nao-e-uuid", "", null]) {
      expect(chooseActiveClinic({ memberships: twoClinics, isPlatformStaff: false, preferredClinicId: preferred })).toEqual({
        kind: "membership",
        clinicId: A,
        remembered: false,
      });
    }
  });

  it("cookie em maiúsculas vale como o mesmo id", () => {
    expect(
      chooseActiveClinic({ memberships: twoClinics, isPlatformStaff: false, preferredClinicId: B.toUpperCase() }),
    ).toMatchObject({ clinicId: B, remembered: true });
  });

  it("empate na data de entrada: ordem do id, para não variar", () => {
    const same = "2026-10-01T00:00:00Z";
    expect(
      chooseActiveClinic({ memberships: [member(B, same), member(A, same)], isPlatformStaff: false, preferredClinicId: null }),
    ).toMatchObject({ clinicId: A });
  });

  it("vínculo sem papel não dá acesso (D6)", () => {
    expect(
      chooseActiveClinic({ memberships: [member(A, "2026-10-01", [])], isPlatformStaff: false, preferredClinicId: A }),
    ).toEqual({ kind: "no_access" });
    expect(chooseActiveClinic({ memberships: [], isPlatformStaff: false, preferredClinicId: null })).toEqual({
      kind: "no_access",
    });
  });

  it("Suporte abre a clínica do cookie mesmo sem ser membro; sem cookie, escolhe", () => {
    expect(chooseActiveClinic({ memberships: [], isPlatformStaff: true, preferredClinicId: C })).toEqual({
      kind: "support",
      clinicId: C,
    });
    expect(chooseActiveClinic({ memberships: [], isPlatformStaff: true, preferredClinicId: null })).toEqual({
      kind: "choose",
    });
  });

  it("Suporte que também é membro: cookie de outra clínica vale como Suporte", () => {
    expect(
      chooseActiveClinic({ memberships: [member(A, "2026-10-01")], isPlatformStaff: true, preferredClinicId: C }),
    ).toEqual({ kind: "support", clinicId: C });
    expect(
      chooseActiveClinic({ memberships: [member(A, "2026-10-01")], isPlatformStaff: true, preferredClinicId: null }),
    ).toMatchObject({ kind: "membership", clinicId: A });
  });

  it("reconhece uuid", () => {
    expect(isUuid(A)).toBe(true);
    expect(isUuid("0a000000-0000-4000-8000-00000000000")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("papéis e áreas do painel (D6)", () => {
  const as = (...roles: ClinicRole[]) => ({ roles, isPlatformStaff: false });
  const support = { roles: [] as ClinicRole[], isPlatformStaff: true };

  it("Configurações: só Administrador (e Suporte)", () => {
    expect(areaOfPath("/admin/configuracoes")).toBe("settings");
    expect(areaOfPath("/api/admin/configuracoes/exam-types/1")).toBe("settings");
    expect(canAccessArea(as("admin"), "settings")).toBe(true);
    expect(canAccessArea(as("professional"), "settings")).toBe(false);
    expect(canAccessArea(as("reception"), "settings")).toBe(false);
    expect(canAccessArea(support, "settings")).toBe(true);
  });

  it("Métricas e relatórios: Administrador e Profissional", () => {
    expect(areaOfPath("/admin/metricas")).toBe("metrics");
    expect(areaOfPath("/admin/relatorios/x")).toBe("metrics");
    expect(canAccessArea(as("admin"), "metrics")).toBe(true);
    expect(canAccessArea(as("professional"), "metrics")).toBe(true);
    expect(canAccessArea(as("reception"), "metrics")).toBe(false);
  });

  it("o resto é de todos os papéis; prefixo parecido não conta", () => {
    for (const path of ["/admin/dashboard", "/admin/agenda", "/api/admin/pacientes", "/admin/metricas-extra"]) {
      expect(areaOfPath(path)).toBe("shared");
    }
    expect(canAccessArea(as("reception"), "shared")).toBe(true);
    expect(canAccessArea(as(), "shared")).toBe(false);
  });

  it("papéis somados valem juntos", () => {
    expect(hasRole(as("reception", "professional"), "professional")).toBe(true);
    expect(hasRole(as("reception"), "admin", "professional")).toBe(false);
    expect(hasRole(support, "admin")).toBe(true);
  });

  it("rótulo do login", () => {
    expect(roleLabel(as("professional", "admin"))).toBe("Administrador + Profissional");
    expect(roleLabel(as("reception"))).toBe("Recepção");
    expect(roleLabel(support)).toBe("Suporte RecepClinic");
    expect(roleLabel({ roles: ["admin"], isPlatformStaff: true })).toBe("Administrador");
    expect(roleLabel(as())).toBe("Sem papel");
  });
});
