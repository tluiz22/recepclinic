import { describe, expect, it } from "vitest";
import { lastMonths } from "./usage";

describe("meses da tela de uso (F9.5)", () => {
  it("do atual para trás, virando o ano", () => {
    expect(lastMonths("2026-02-15", 4)).toEqual(["2026-02-01", "2026-01-01", "2025-12-01", "2025-11-01"]);
  });
});
