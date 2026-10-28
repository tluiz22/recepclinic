import { describe, expect, it } from "vitest";
import { FEATURES, missingDependencies } from "./features";
import { ADDONS, ALL_ITEMS, BASIC_ITEMS, PLAN_ITEM_IDS, TABLE_PRICES, clinicPlan, featuresOfItems, itemDependsOn, simulate } from "./plans";

const BASIC = featuresOfItems(PLAN_ITEM_IDS.basic);
const COMPLETE = featuresOfItems(PLAN_ITEM_IDS.complete);

describe("planos", () => {
  it("cada item da matriz está em um item de plano, uma vez só", () => {
    const keys = ALL_ITEMS.flatMap((item) => item.features);
    expect([...keys].sort()).toEqual(FEATURES.map((f) => f.key).sort());
  });

  it("Básico: bot, lembrete e resumo ao profissional", () => {
    expect(BASIC).toEqual(["whatsapp_bot", "reminders", "daily_summary"]);
    expect(clinicPlan(BASIC, 1)).toMatchObject({ kind: "basic", monthlyCents: 14_700 });
  });

  it("Completo: tudo menos as séries, com as métricas juntas", () => {
    expect(COMPLETE).not.toContain("series");
    expect(COMPLETE).toEqual(expect.arrayContaining(FEATURES.filter((f) => f.area === "metrics").map((f) => f.key)));
    expect(missingDependencies(COMPLETE)).toEqual([]);
    expect(clinicPlan(COMPLETE, 3)).toMatchObject({ kind: "complete", monthlyCents: 29_700 + 2 * 4_700 });
  });

  it("Básico + adicionais soma o valor de cada um", () => {
    const plan = clinicPlan(featuresOfItems([...PLAN_ITEM_IDS.basic, "exams", "waitlist"]), 3);
    expect(plan).toMatchObject({ kind: "custom", monthlyCents: 14_700 + 3_500 + 3_500 + 2 * 4_700, completeIsCheaper: false });
  });

  it("avisa quando o Completo sai mais barato que a soma", () => {
    const allButOne = [...PLAN_ITEM_IDS.basic, ...ADDONS.slice(0, -1).map((a) => a.id)];
    expect(clinicPlan(featuresOfItems(allButOne), 1)).toMatchObject({ kind: "custom", completeIsCheaper: true });
  });

  it("um item das métricas ligado conta o adicional inteiro", () => {
    expect(clinicPlan([...BASIC, "metrics_performance"], 1)).toMatchObject({ kind: "custom", monthlyCents: 14_700 + 4_500 });
  });

  it("séries e o Módulo financeiro ficam fora da tabela, sem valor", () => {
    expect(clinicPlan([...BASIC, "series"], 1)).toMatchObject({ kind: "custom", monthlyCents: 14_700 });
    expect(clinicPlan([...BASIC, "finance"], 1)).toMatchObject({ kind: "custom", monthlyCents: 14_700 });
    expect(COMPLETE).not.toContain("finance");
    expect(COMPLETE).not.toContain("relationship");
    expect(clinicPlan([...BASIC, "relationship"], 1)).toMatchObject({ kind: "custom", monthlyCents: 14_700 });
  });

  it("sem tudo do Básico, fica fora dos planos", () => {
    expect(clinicPlan([], 1)).toEqual({ kind: "none" });
    expect(clinicPlan(["whatsapp_bot", "exams"], 1)).toEqual({ kind: "none" });
  });

  it("formulário: ids desconhecidos saem; dependências por item", () => {
    expect(featuresOfItems(["custom_messages", "inventado"])).toEqual(["custom_messages", "custom_templates"]);
    expect(itemDependsOn(ADDONS.find((a) => a.id === "metrics")!)).toEqual(["whatsapp_bot"]);
    expect(itemDependsOn(ADDONS.find((a) => a.id === "waitlist")!)).toEqual(["whatsapp_bot"]);
    expect(BASIC_ITEMS.flatMap(itemDependsOn)).toEqual([]);
  });
});

describe("simulação da negociação", () => {
  it("pela tabela: Básico + adicionais, profissionais a mais e implantação", () => {
    const result = simulate(TABLE_PRICES, { plan: "basic", addonIds: ["exams", "waitlist"], professionals: 3, setupWaived: false });
    expect(result.monthlyCents).toBe(14_700 + 3_500 + 3_500 + 2 * 4_700);
    expect(result.setupCents).toBe(29_700);
    expect(result.firstPaymentCents).toBe(result.monthlyCents + 29_700);
    expect(result.lines.map((line) => line.label)).toEqual(["Básico (1 profissional)", "Exames e procedimentos", "Lista de espera", "2 profissionais a mais"]);
  });

  it("com valores negociados; o Completo ignora os adicionais marcados", () => {
    const prices = { ...TABLE_PRICES, completeCents: 25_000, extraProfessionalCents: 3_000, addons: { ...TABLE_PRICES.addons, exams: 0 } };
    expect(simulate(prices, { plan: "complete", addonIds: ["exams"], professionals: 2, setupWaived: true })).toMatchObject({
      monthlyCents: 28_000,
      setupCents: 0,
      firstPaymentCents: 28_000,
    });
    expect(simulate(prices, { plan: "basic", addonIds: ["exams"], professionals: 0, setupWaived: true }).monthlyCents).toBe(14_700);
  });
});
