import { describe, expect, it } from "vitest";
import { portalSteps } from "./portalMetrics";

describe("portalSteps", () => {
  it("sem visitas: sem percentual", () => {
    const s = portalSteps({ visits: 0, fromBotLink: 0, verified: 0, held: 0, booked: 0, blocks: 0 });
    expect(s.map((x) => x.share)).toEqual([null, null, null]);
  });

  it("percentual sobre as visitas e o que se perdeu em cada passo", () => {
    const s = portalSteps({ visits: 20, fromBotLink: 8, verified: 15, held: 9, booked: 7, blocks: 0 });
    expect(s.map((x) => x.count)).toEqual([20, 15, 9]);
    expect(s.map((x) => x.share)).toEqual([1, 0.75, 0.45]);
    expect(s.map((x) => x.lostAfter)).toEqual([5, 6, null]);
  });
});
