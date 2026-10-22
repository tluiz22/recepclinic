import { describe, expect, it } from "vitest";
import { DataError, unwrapAll, unwrapAllIn } from "./errors";

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

describe("unwrapAllIn", () => {
  it("manda os ids em lotes e lê cada lote em páginas", async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `id${i}`);
    const calls: string[] = [];
    const rows = await unwrapAllIn(
      ids,
      (chunk, from, to) => {
        calls.push(`${chunk.join(",")}@${from}`);
        const all = chunk.flatMap((id) => [`${id}-a`, `${id}-b`]);
        return Promise.resolve({ data: all.slice(from, to + 1), error: null });
      },
      "teste",
      2,
    );
    expect(rows).toEqual(ids.flatMap((id) => [`${id}-a`, `${id}-b`]));
    expect(calls[0]).toBe("id0,id1@0");
    expect(calls.filter((c) => c.endsWith("@0")).map((c) => c.split("@")[0])).toEqual(["id0,id1", "id2,id3", "id4"]);
  });

  it("lista vazia: nenhuma leitura", async () => {
    let called = false;
    expect(await unwrapAllIn([], () => ((called = true), Promise.resolve({ data: [], error: null })), "teste")).toEqual([]);
    expect(called).toBe(false);
  });
});
