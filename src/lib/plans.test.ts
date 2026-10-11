import { describe, expect, it } from "vitest";
import { FEATURES, missingDependencies } from "./features";
import { ADDONS, ALL_ITEMS, BASIC_ITEMS, PLAN_ITEM_IDS, clinicPlan, featuresOfItems, itemDependsOn } from "./plans";

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
    expect(clinicPlan([...BASIC, "metrics_overview"], 1)).toMatchObject({ kind: "custom", monthlyCents: 14_700 + 4_500 });
  });

  it("séries ficam fora da tabela, sem valor", () => {
    const plan = clinicPlan([...BASIC, "series"], 1);
    expect(plan).toMatchObject({ kind: "custom", monthlyCents: 14_700 });
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
