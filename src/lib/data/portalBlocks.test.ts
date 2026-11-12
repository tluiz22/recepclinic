import { describe, expect, it } from "vitest";
import { blockActionLabel, parseBlockKey } from "./portalBlocks";

describe("parseBlockKey", () => {
  it("celular, endereço e sessão em texto legível", () => {
    expect(parseBlockKey("phone:+5584999998888")).toEqual({ kind: "phone", target: "(84) 99999-8888" });
    expect(parseBlockKey("ip:200.1.2")).toEqual({ kind: "ip", target: "200.1.2" });
    expect(parseBlockKey("session:0a1b2c3d-1111-2222-3333-444455556666")).toEqual({ kind: "session", target: "0a1b2c3d" });
  });

  it("formato desconhecido ou vazio fica de fora", () => {
    expect(parseBlockKey("outra:coisa")).toBeNull();
    expect(parseBlockKey("phone:")).toBeNull();
    expect(parseBlockKey("semdoispontos")).toBeNull();
  });
});

describe("blockActionLabel", () => {
  it("rótulo em português e o próprio nome para ação nova", () => {
    expect(blockActionLabel("code")).toBe("Pediu o código demais");
    expect(blockActionLabel("nova")).toBe("nova");
  });
});
