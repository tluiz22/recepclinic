import { describe, expect, it } from "vitest";
import { describedBy, fieldIds } from "./field";

describe("ids da ajuda do campo", () => {
  it("rótulo, ajuda, orientação e erro a partir do id do campo", () => {
    expect(fieldIds("category")).toEqual({ label: "category-rotulo", help: "category-ajuda", hint: "category-orientacao", error: "category-erro" });
  });

  it("o erro toma o lugar da orientação", () => {
    expect(describedBy("prazo", { hint: "Vazio = sem prazo." })).toBe("prazo-orientacao");
    expect(describedBy("prazo", { hint: "Vazio = sem prazo.", error: "Use 1 dia ou mais." })).toBe("prazo-erro");
    expect(describedBy("prazo", {})).toBeUndefined();
  });
});
