import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { accountDisconnections, isValidMetaSignature, webhookChanges } from "./webhook";

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

describe("desconexão avisada pela Meta (F8.3)", () => {
  const payload = (value: Record<string, unknown>, field = "account_update") => ({
    object: "whatsapp_business_account",
    entry: [{ id: "2949482758682047", changes: [{ field, value }] }],
  });

  it("PARTNER_REMOVED traz a conta em waba_info (o entry.id é outra coisa)", () => {
    expect(accountDisconnections(payload({ event: "PARTNER_REMOVED", waba_info: { waba_id: "980198427658004", owner_business_id: "1" } }))).toEqual([
      { wabaId: "980198427658004", event: "PARTNER_REMOVED" },
    ]);
  });

  it("conta saiu ou foi apagada: a conta é o entry.id", () => {
    expect(accountDisconnections(payload({ event: "ACCOUNT_OFFBOARDED" }))).toEqual([{ wabaId: "2949482758682047", event: "ACCOUNT_OFFBOARDED" }]);
    expect(accountDisconnections(payload({ event: "ACCOUNT_DELETED" }))).toHaveLength(1);
  });

  it("outros avisos da conta e outros campos não desconectam", () => {
    expect(accountDisconnections(payload({ event: "PARTNER_ADDED", waba_info: { waba_id: "1" } }))).toEqual([]);
    expect(accountDisconnections(payload({ event: "VOLUME_BASED_PRICING_TIER_UPDATE" }))).toEqual([]);
    expect(accountDisconnections(payload({ event: "PARTNER_REMOVED" }, "message_template_status_update"))).toEqual([]);
    expect(accountDisconnections(null)).toEqual([]);
  });
});
