import { describe, expect, it } from "vitest";
import { estimateMonth, parseDecimal, priceForMonth, validateMetaPrice, type MetaPriceVersion } from "./metaPricing";

const version = (validFrom: string, price: number, free = 1000): MetaPriceVersion => ({
  id: validFrom,
  validFrom,
  utilityBrl: price,
  authenticationBrl: price,
  serviceBrl: price,
  freeServicePerMonth: free,
  usdBrl: 5.15,
  source: "teste",
  createdAt: new Date(),
  createdBy: null,
});
const input = { validFrom: "2026-12", utilityBrl: "0,0350", authenticationBrl: "0.035", serviceBrl: "0,035", freeServicePerMonth: "1000", usdBrl: "5,15", source: "Meta" };

describe("preços da Meta (CU2)", () => {
  it("lê número com vírgula ou ponto", () => {
    expect(parseDecimal("0,0350")).toBe(0.035);
    expect(parseDecimal("5.15")).toBe(5.15);
    expect(parseDecimal("1.234,5")).toBeNaN();
    expect(parseDecimal("")).toBeNaN();
  });

  it("usa a vigência que começou até o mês; antes da primeira, nenhuma", () => {
    const versions = [version("2026-10-01", 0.035), version("2027-01-01", 0.04)];
    expect(priceForMonth(versions, "2026-09-01")).toBeNull();
    expect(priceForMonth(versions, "2026-10-01")?.utilityBrl).toBe(0.035);
    expect(priceForMonth(versions, "2026-12-01")?.utilityBrl).toBe(0.035);
    expect(priceForMonth(versions, "2027-02-01")?.utilityBrl).toBe(0.04);
  });

  it("estima: todos os modelos e o serviço acima da franquia", () => {
    expect(estimateMonth({ templates: 410, service: 1380 }, version("2026-10-01", 0.035))).toEqual({ chargedService: 380, totalBrl: 27.65 });
    expect(estimateMonth({ templates: 70, service: 240 }, version("2026-10-01", 0.035))).toEqual({ chargedService: 0, totalBrl: 2.45 });
    expect(estimateMonth({ templates: 5, service: 5 }, null)).toEqual({ chargedService: 0, totalBrl: null });
  });

  it("vigência nova: mês atual em diante, no dia 1º, com preços e fonte", () => {
    expect(validateMetaPrice(input, "2026-11-05")).toMatchObject({ validFrom: "2026-12-01", utilityBrl: 0.035, freeServicePerMonth: 1000, usdBrl: 5.15 });
    expect(validateMetaPrice({ ...input, validFrom: "2026-11" }, "2026-11-05").validFrom).toBe("2026-11-01");
    const fieldsOf = (changes: Partial<typeof input>) => {
      try {
        validateMetaPrice({ ...input, ...changes }, "2026-11-05");
        return {};
      } catch (error) {
        return (error as { fields: Record<string, string> }).fields;
      }
    };
    expect(Object.keys(fieldsOf({ validFrom: "2026-10" }))).toEqual(["valid_from"]);
    expect(Object.keys(fieldsOf({ validFrom: "2026-12-15" }))).toEqual(["valid_from"]);
    expect(Object.keys(fieldsOf({ utilityBrl: "abc", freeServicePerMonth: "1,5", usdBrl: "0", source: " " }))).toEqual([
      "utility_brl",
      "free_service_per_month",
      "usd_brl",
      "source",
    ]);
  });
});
