import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidMetaSignature, webhookChanges } from "./webhook";

describe("assinatura do webhook da Meta (F6.1)", () => {
  const body = JSON.stringify({ entry: [] });
  const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("aceita só a assinatura feita com o App Secret, sobre o corpo exato", () => {
    expect(isValidMetaSignature("segredo", body, sign("segredo"))).toBe(true);
    expect(isValidMetaSignature("segredo", body, sign("outro"))).toBe(false);
    expect(isValidMetaSignature("segredo", `${body} `, sign("segredo"))).toBe(false);
  });

  it("sem cabeçalho, sem prefixo ou com lixo: recusa", () => {
    expect(isValidMetaSignature("segredo", body, null)).toBe(false);
    expect(isValidMetaSignature("segredo", body, sign("segredo").slice("sha256=".length))).toBe(false);
    expect(isValidMetaSignature("segredo", body, "sha256=zz")).toBe(false);
  });
});

describe("mudanças do corpo do webhook", () => {
  it("junta as mudanças de todas as entradas, em ordem; corpo estranho vira lista vazia", () => {
    const a = { metadata: { phone_number_id: "1" }, messages: [] };
    const b = { metadata: { phone_number_id: "2" }, statuses: [] };
    expect(webhookChanges({ entry: [{ changes: [{ value: a }] }, { changes: [{ value: b }, {}] }] })).toEqual([a, b]);
    expect(webhookChanges(null)).toEqual([]);
    expect(webhookChanges({ entry: "x" })).toEqual([]);
    expect(webhookChanges({ entry: [{ changes: null }] })).toEqual([]);
  });
});
