import { describe, expect, it } from "vitest";
import { MIN_NO_SHOWS, MIN_NO_SHOW_RATE, isFrequentNoShow, noShowLabel } from "./noShow";

const stats = (noShow: number, completed: number) => ({ noShow, completed, lastNoShowAt: null });

describe("isFrequentNoShow", () => {
  it("regra: no mínimo 2 faltas e taxa de falta de 50% ou mais", () => {
    expect(MIN_NO_SHOWS).toBe(2);
    expect(MIN_NO_SHOW_RATE).toBe(0.5);
  });

  it("sem histórico não é faltoso", () => {
    expect(isFrequentNoShow(undefined)).toBe(false);
    expect(isFrequentNoShow(stats(0, 0))).toBe(false);
  });

  it("uma falta só não basta, mesmo com 100%", () => {
    expect(isFrequentNoShow(stats(1, 0))).toBe(false);
  });

  it("2 faltas em 4 (50%) é faltoso", () => {
    expect(isFrequentNoShow(stats(2, 2))).toBe(true);
  });

  it("2 faltas em 5 (40%) não é", () => {
    expect(isFrequentNoShow(stats(2, 3))).toBe(false);
  });

  it("3 faltas em 4 é faltoso", () => {
    expect(isFrequentNoShow(stats(3, 1))).toBe(true);
  });
});

describe("noShowLabel", () => {
  it("faltas sobre o total de atendimentos com presença registrada", () => {
    expect(noShowLabel(stats(2, 3))).toBe("Faltou 2 de 5");
  });
});
