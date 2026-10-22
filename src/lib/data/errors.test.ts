import { describe, expect, it } from "vitest";
import { DataError, unwrapAll } from "./errors";

describe("unwrapAll", () => {
  const source = Array.from({ length: 7 }, (_, i) => i);
  const page = (from: number, to: number) => Promise.resolve({ data: source.slice(from, to + 1), error: null });

  it("lê de página em página até a última incompleta", async () => {
    const asked: number[] = [];
    const rows = await unwrapAll((from, to) => (asked.push(from), page(from, to)), "teste", 3);
    expect(rows).toEqual(source);
    expect(asked).toEqual([0, 3, 6]);
  });

  it("página cheia no fim: pede mais uma, vazia", async () => {
    expect(await unwrapAll(page, "teste", 7)).toEqual(source);
  });

  it("erro em qualquer página vira DataError", async () => {
    const failing = (from: number, to: number) => (from === 0 ? page(from, to) : Promise.resolve({ data: null, error: { message: "falhou" } }));
    await expect(unwrapAll(failing, "teste", 3)).rejects.toBeInstanceOf(DataError);
  });
});
