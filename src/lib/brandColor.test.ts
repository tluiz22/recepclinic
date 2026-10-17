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

describe("cor da clínica sobre o branco (R11)", () => {
  it("mantém a cor que já tem contraste e escurece a clara até 4,5:1", async () => {
    const { inkOnWhite } = await import("./brandColor");
    expect(inkOnWhite("#0B7A62")).toBe("#0B7A62");
    expect(inkOnWhite("#7C3AED")).toBe("#7C3AED");
    const dark = inkOnWhite("#FDE047");
    expect(dark).not.toBe("#FDE047");
    const lum = (hex: string) =>
      [1, 3, 5]
        .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    expect(1.05 / (lum(dark) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it("o texto do horário escolhido tem 4,5:1 sobre o fundo claro (QA-01)", async () => {
    const { clinicColorStyle } = await import("./brandColor");
    const lum = (hex: string) =>
      [1, 3, 5]
        .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    for (const hex of ["#0B7A62", "#0F766E", "#DC2626", "#F97316", "#FACC15", "#22C55E", "#1E3A8A", "#FFFFFF"]) {
      const vars = Object.fromEntries(clinicColorStyle(hex).split("; ").map((pair) => pair.split(": ")));
      const [a, b] = [lum(vars["--clinic-ink"]), lum(vars["--clinic-tint"])].sort((x, y) => y - x);
      expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("monta as 4 variáveis das páginas do paciente", async () => {
    const { clinicColorStyle } = await import("./brandColor");
    const style = clinicColorStyle("#FDE047");
    expect(style).toContain("--clinic: #FDE047");
    expect(style).toContain(`--clinic-text: ${DARK_TEXT}`);
    expect(style).toMatch(/--clinic-ink: #[0-9A-F]{6}/);
    expect(style).toMatch(/--clinic-tint: #[0-9A-F]{6}/);
  });
});
