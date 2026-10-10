import { describe, expect, it } from "vitest";
import { blockedNoticeDue } from "./contactBlock";

describe("número bloqueado: resposta neutra uma vez por dia (F9.6b)", () => {
  const TZ = "America/Fortaleza";
  const at = (iso: string) => new Date(`${iso}-03:00`);

  it("primeira vez e dia novo da clínica respondem; o mesmo dia, não", () => {
    expect(blockedNoticeDue(null, at("2031-03-10T08:00:00"), TZ)).toBe(true);
    expect(blockedNoticeDue(at("2031-03-10T08:00:00"), at("2031-03-10T23:59:00"), TZ)).toBe(false);
    expect(blockedNoticeDue(at("2031-03-10T23:59:00"), at("2031-03-11T00:01:00"), TZ)).toBe(true);
  });
});
