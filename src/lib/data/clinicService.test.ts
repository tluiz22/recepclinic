import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CLINIC_TOKEN_TTL_SECONDS, mintClinicServiceToken } from "./clinicService";

const CLINIC = "0a000000-0000-4000-8000-000000000001";
const SECRET = "s".repeat(40);
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

function decode(token: string) {
  const [header, payload, signature] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload, "base64url").toString()),
    signatureOk: createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url") === signature,
  };
}

describe("credencial limitada à clínica", () => {
  it("token HS256 com o papel clinic_service e a clínica", () => {
    const { header, payload, signatureOk } = decode(mintClinicServiceToken(CLINIC, SECRET, { now: NOW }));
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(payload).toEqual({
      iss: "recepclinic",
      role: "clinic_service",
      clinic_id: CLINIC,
      iat: NOW / 1000,
      exp: NOW / 1000 + CLINIC_TOKEN_TTL_SECONDS,
    });
    expect(signatureOk).toBe(true);
  });

  it("vale 15 minutos por padrão, ou o prazo pedido", () => {
    expect(CLINIC_TOKEN_TTL_SECONDS).toBe(900);
    const { payload } = decode(mintClinicServiceToken(CLINIC, SECRET, { now: NOW, ttlSeconds: 60 }));
    expect(payload.exp - payload.iat).toBe(60);
  });

  it("id da clínica sempre em minúsculas", () => {
    const { payload } = decode(mintClinicServiceToken(CLINIC.toUpperCase(), SECRET, { now: NOW }));
    expect(payload.clinic_id).toBe(CLINIC);
  });

  it("recusa clínica inválida e segredo vazio, em vez de gerar um token sem clínica", () => {
    expect(() => mintClinicServiceToken("", SECRET)).toThrow(RangeError);
    expect(() => mintClinicServiceToken("clinica-a", SECRET)).toThrow(RangeError);
    expect(() => mintClinicServiceToken(CLINIC, "")).toThrow(RangeError);
  });

  it("outro segredo dá outra assinatura", () => {
    const token = mintClinicServiceToken(CLINIC, "o".repeat(40), { now: NOW });
    expect(decode(token).signatureOk).toBe(false);
  });
});
