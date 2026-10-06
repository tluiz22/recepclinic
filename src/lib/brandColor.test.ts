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
