import { describe, expect, it } from "vitest";
import { canAccessPath, type ClinicRole } from "./clinicAccess";
import { FEATURES, metricsScope, missingDependencies, requiredFeature, withoutDependents, type FeatureKey } from "./features";

const route = (url: string) => {
  const parsed = new URL(url, "https://app.recepclinic.com.br");
  return requiredFeature(parsed.pathname, parsed.searchParams);
};

describe("itens da matriz e dependências (D11)", () => {
  it("chaves únicas e dependências dentro da lista", () => {
    const keys = FEATURES.map((feature) => feature.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const feature of FEATURES) for (const dep of feature.dependsOn) expect(keys).toContain(dep);
  });

  it("lista de espera e Funil dependem do bot", () => {
    expect(missingDependencies(["waitlist", "metrics_funnel", "exams"])).toEqual([
      { feature: "waitlist", needs: "whatsapp_bot" },
      { feature: "metrics_funnel", needs: "whatsapp_bot" },
    ]);
    expect(missingDependencies(["whatsapp_bot", "waitlist"])).toEqual([]);
  });

  it("desligar o bot desliga quem depende dele", () => {
    expect(withoutDependents(["whatsapp_bot", "waitlist", "metrics_funnel", "reminders"], "whatsapp_bot")).toEqual(["reminders"]);
    expect(withoutDependents(["whatsapp_bot", "waitlist"], "waitlist")).toEqual(["whatsapp_bot"]);
  });
});

describe("item que cada rota exige", () => {
  it("o básico do consultório não exige item", () => {
    for (const url of [
      "/admin/agenda",
      "/admin/agenda/marcar",
      "/admin/agenda/bloquear",
      "/admin/pacientes/1",
      "/admin/consultas",
      "/admin/consultas?tab=resumo",
      "/admin/consultas?tab=pendentes",
      "/admin/trilha/1",
      "/admin/agenda/marcar",
      "/api/admin/agenda/atendimentos/1",
      "/api/admin/consultas/cancelar-em-massa",
      "/admin/configuracoes/servicos",
      "/admin/configuracoes/locais/novo",
    ]) {
      expect(route(url), url).toBeNull();
    }
  });

  it("Métricas aba a aba; sem aba é a Visão geral; Relatórios", () => {
    expect(route("/admin/metricas")).toBe("metrics_overview");
    expect(route("/admin/metricas?tab=visao_geral")).toBe("metrics_overview");
    expect(route("/admin/metricas?tab=financeiro&periodo=mes")).toBe("metrics_financial");
    expect(route("/admin/metricas?tab=funil")).toBe("metrics_funnel");
    expect(route("/admin/metricas?tab=envios")).toBe("metrics_sends");
    expect(route("/admin/relatorios")).toBe("reports");
  });

  it("abas do Resumo do Dia e Configurações pelos itens", () => {
    expect(route("/admin/consultas?tab=lembretes")).toBe("reminders");
    expect(route("/admin/consultas?tab=lista_espera")).toBe("waitlist");
    expect(route("/admin/configuracoes/contatos")).toBe("daily_summary");
    expect(route("/api/admin/configuracoes/lembrete")).toBe("reminders");
    expect(route("/api/admin/configuracoes/contatos/novo")).toBe("daily_summary");
    expect(route("/admin/configuracoes/convenios/novo")).toBe("insurance");
    expect(route("/api/admin/configuracoes/convenios/opcoes")).toBe("insurance");
    expect(route("/admin/configuracoes/equipe")).toBe(null);
    expect(route("/admin/configuracoes/horarios")).toBe(null);
  });

  it("prefixo parecido não conta", () => {
    expect(route("/admin/configuracoes/convenios-x")).toBeNull();
    expect(route("/admin/relatorios-x")).toBeNull();
  });
});

describe("acesso à rota: papel (D6) e item liberado (D11)", () => {
  const ctx = (roles: ClinicRole[], features: FeatureKey[]) => ({ roles, isPlatformStaff: false, features });
  const can = (context: ReturnType<typeof ctx>, url: string) => {
    const parsed = new URL(url, "https://app.recepclinic.com.br");
    return canAccessPath(context, parsed.pathname, parsed.searchParams);
  };

  it("item desligado barra a rota até para o Administrador", () => {
    expect(can(ctx(["admin"], []), "/admin/configuracoes/convenios")).toBe(false);
    expect(can(ctx(["admin"], ["insurance"]), "/admin/configuracoes/convenios")).toBe(true);
    expect(can(ctx(["reception"], ["waitlist", "whatsapp_bot"]), "/admin/consultas?tab=lista_espera")).toBe(true);
    expect(can(ctx(["reception"], []), "/admin/consultas?tab=lista_espera")).toBe(false);
  });

  it("item liberado não passa por cima do papel", () => {
    expect(can(ctx(["reception"], ["exams"]), "/admin/configuracoes/servicos")).toBe(false);
    expect(can(ctx(["reception"], ["metrics_financial"]), "/admin/metricas?tab=financeiro")).toBe(false);
  });

  it("métricas: aba liberada e escopo do papel", () => {
    expect(can(ctx(["admin"], ["metrics_overview"]), "/admin/metricas?tab=financeiro")).toBe(false);
    expect(can(ctx(["admin"], ["metrics_financial"]), "/admin/metricas?tab=financeiro")).toBe(true);
    expect(can(ctx(["professional"], ["metrics_financial"]), "/admin/metricas?tab=financeiro")).toBe(false);
    expect(can(ctx(["professional"], ["metrics_financial", "metrics_personal"]), "/admin/metricas?tab=financeiro")).toBe(true);
  });

  it("o básico vale com a matriz vazia", () => {
    expect(can(ctx(["reception"], []), "/admin/agenda/marcar")).toBe(true);
    expect(can(ctx(["reception"], []), "/admin/pacientes")).toBe(true);
  });
});

describe("escopo das métricas (D11)", () => {
  it("Administrador e Suporte: clínica; Profissional: própria agenda com o item; Recepção: nada", () => {
    expect(metricsScope({ roles: ["admin"], isPlatformStaff: false, features: [] })).toBe("clinic");
    expect(metricsScope({ roles: [], isPlatformStaff: true, features: [] })).toBe("clinic");
    expect(metricsScope({ roles: ["admin", "professional"], isPlatformStaff: false, features: [] })).toBe("clinic");
    expect(metricsScope({ roles: ["professional"], isPlatformStaff: false, features: ["metrics_personal"] })).toBe("own_agenda");
    expect(metricsScope({ roles: ["professional"], isPlatformStaff: false, features: [] })).toBe("none");
    expect(metricsScope({ roles: ["reception"], isPlatformStaff: false, features: ["metrics_personal"] })).toBe("none");
  });
});
