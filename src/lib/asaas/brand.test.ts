import { describe, expect, it } from "vitest";
import { ASAAS_SEAL, ASAAS_SITE } from "./brand";

describe("selo do Asaas", () => {
  it("vem do CDN do Asaas, com o id do RecepClinic", () => {
    for (const url of Object.values(ASAAS_SEAL)) {
      expect(url.startsWith("https://baas.asaas.com/selos/")).toBe(true);
      expect(new URL(url).searchParams.get("id")).toBe("77d97322-c59c-4983-bbb1-e0dbe253d4c3");
    }
  });

  it("leva ao site oficial", () => {
    expect(ASAAS_SITE).toBe("https://asaas.com");
  });
});
