import { describe, expect, it } from "vitest";
import { rankSignals, signalShare, SIGNALS, type SignalCount } from "./usabilitySignals";

describe("sinais de usabilidade", () => {
  const counts: SignalCount[] = [
    { signal: "code_wrong", affected: 3, base: 12 },
    { signal: "resched_1h", affected: 7, base: 70 },
    { signal: "hold_expired", affected: 0, base: 0 },
  ];
  it("ordena pelos casos, sem caso por último", () => {
    const r = rankSignals(counts);
    expect(r.map((x) => x.signal.id).slice(0, 2)).toEqual(["resched_1h", "code_wrong"]);
    expect(r).toHaveLength(SIGNALS.length);
    expect(r.at(-1)?.count?.affected ?? 0).toBe(0);
  });
  it("proporção e sem base", () => {
    expect(signalShare(counts[0])).toBe(0.25);
    expect(signalShare(counts[2])).toBeNull();
    expect(signalShare(undefined)).toBeNull();
  });
});
