import { describe, expect, it } from "vitest";
import { CALCULATOR_DEFAULTS, calculateMetaCost } from "./metaCostCalculator";

const base = { ...CALCULATOR_DEFAULTS, priceBrl: 0.035, freeServicePerMonth: 1000, usdBrl: 5.15 };

describe("calculadora do custo da Meta (CU3)", () => {
  it("reproduz o exemplo aprovado na T11 (3 profissionais, 5 dias, 12 por dia)", () => {
    expect(calculateMetaCost(base)).toEqual({
      appointmentsPerMonth: 780,
      todayBrl: 128.8,
      centralBrl: 40.95,
      totalBrl: 169.75,
      otherAiBrl: 732.83,
      metaAiBrl: 2223.78,
    });
  });

  it("clínica pequena: a franquia cobre o assistente e sobra para a Central", () => {
    // 1 × 2 × 5 ≈ 43 atendimentos: 172 do assistente e 65 respostas, tudo dentro das 1.000 grátis.
    const result = calculateMetaCost({ ...base, professionals: 1, daysPerWeek: 2, appointmentsPerDay: 5 });
    expect(result.appointmentsPerMonth).toBe(43);
    expect(result.todayBrl).toBe(3.01);
    expect(result.centralBrl).toBe(0);
  });

  it("campo vazio ou negativo conta como zero", () => {
    expect(calculateMetaCost({ ...base, professionals: Number.NaN }).totalBrl).toBe(0);
    expect(calculateMetaCost({ ...base, receptionPercent: -10 }).centralBrl).toBe(0);
  });
});
