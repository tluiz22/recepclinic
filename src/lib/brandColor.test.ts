import { describe, expect, it } from "vitest";
import { DARK_TEXT, LIGHT_TEXT, readableTextColor } from "./brandColor";

describe("readableTextColor", () => {
  it("branco nas cores escuras", () => {
    expect(readableTextColor("#0369A1")).toBe(LIGHT_TEXT);
    expect(readableTextColor("#000000")).toBe(LIGHT_TEXT);
    expect(readableTextColor("#7C3AED")).toBe(LIGHT_TEXT);
  });

  it("escuro nas cores claras", () => {
    expect(readableTextColor("#FFFFFF")).toBe(DARK_TEXT);
    expect(readableTextColor("#FDE047")).toBe(DARK_TEXT);
    expect(readableTextColor("#A7F3D0")).toBe(DARK_TEXT);
  });
});

describe("cores prontas da clínica", () => {
  it("todas no formato #RRGGBB, sem repetir, e com texto branco no topo", async () => {
    const { BRAND_COLOR_OPTIONS } = await import("./data/config/brand");
    const values = BRAND_COLOR_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value).toMatch(/^#[0-9A-F]{6}$/);
      expect(readableTextColor(value)).toBe(LIGHT_TEXT);
    }
  });
});
