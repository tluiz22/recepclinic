import { expect, it } from "vitest";
import { frequencyLabel, seriesEndLabel } from "./seriesLabels";

it("frequência e fim da série em palavras (F4.6)", () => {
  expect(frequencyLabel(1)).toBe("Toda semana");
  expect(frequencyLabel(2)).toBe("A cada 2 semanas (quinzenal)");
  expect(frequencyLabel(4)).toBe("A cada 4 semanas");
  expect(seriesEndLabel({ endsOn: "2026-12-20", maxSessions: null })).toBe("até 20/12/2026");
  expect(seriesEndLabel({ endsOn: null, maxSessions: 10 })).toBe("10 sessões");
  expect(seriesEndLabel({ endsOn: null, maxSessions: null })).toBe("sem data para terminar");
});
