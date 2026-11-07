import { describe, expect, it } from "vitest";
import { lookupCep } from "./cep";

const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe("busca do CEP", () => {
  it("preenche rua, bairro, cidade e UF", async () => {
    const result = await lookupCep("01310-100", answer({ cep: "01310-100", logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" }));
    expect(result).toEqual({ postalCode: "01310100", street: "Avenida Paulista", district: "Bela Vista", city: "São Paulo", state: "SP" });
  });

  it("CEP de cidade sem rua: só cidade e UF", async () => {
    expect(await lookupCep("78990000", answer({ logradouro: "", bairro: "", localidade: "Cidade Pequena", uf: "MT" }))).toMatchObject({ street: "", city: "Cidade Pequena", state: "MT" });
  });

  it("CEP inválido, inexistente, erro ou falha de rede: null", async () => {
    let called = false;
    expect(await lookupCep("123", (async () => ((called = true), null)) as unknown as typeof fetch)).toBeNull();
    expect(called).toBe(false);
    expect(await lookupCep("00000000", answer({ erro: true }))).toBeNull();
    expect(await lookupCep("01310100", answer({}, false))).toBeNull();
    expect(await lookupCep("01310100", (async () => { throw new Error("rede"); }) as unknown as typeof fetch)).toBeNull();
  });
});
