import { describe, expect, it } from "vitest";
import { bookingPath, guidancePath, parsePublicId, preparationPath, shortId } from "./publicId";

const UUID = "f1f92b6b-5809-41e1-ad34-0a0a327d33d7";
const PIX_KEY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("ids nos links do paciente", () => {
  it("o link não leva o UUID, que o WhatsApp lê como chave Pix (cliente, 18/out)", () => {
    expect(shortId(UUID)).toHaveLength(22);
    for (const path of [bookingPath(UUID), preparationPath(UUID), guidancePath(UUID)]) expect(path).not.toMatch(PIX_KEY);
    expect(bookingPath(UUID)).toBe(`/agendar/${shortId(UUID)}`);
  });

  it("o id curto volta ao UUID, e o UUID dos links antigos continua valendo", () => {
    expect(parsePublicId(shortId(UUID))).toBe(UUID);
    expect(parsePublicId(UUID)).toBe(UUID);
    expect(parsePublicId(UUID.toUpperCase())).toBe(UUID);
    const random = crypto.randomUUID();
    expect(parsePublicId(shortId(random))).toBe(random);
  });

  it("endereço que não é nenhum dos dois não vira id", () => {
    for (const value of [undefined, "", "exemplo", "a".repeat(21), "a".repeat(23), "!".repeat(22), `${UUID}x`]) expect(parsePublicId(value)).toBeNull();
    // Último caractere com bits que sobram: outro texto para os mesmos bytes.
    const last = shortId(UUID).slice(-1);
    expect(parsePublicId(shortId(UUID).slice(0, 21) + (last === "B" ? "C" : "B"))).not.toBe(UUID);
  });
});
