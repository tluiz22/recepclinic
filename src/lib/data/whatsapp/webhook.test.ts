import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { accountDisconnections, accountReconnections, historyChanges, isValidMetaSignature, webhookChanges } from "./webhook";

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

// CN8 — histórico do app na conexão (exemplos da referência do webhook history da Meta, lida em 05/nov/2026).
describe("histórico do app (CN8)", () => {
  const chunk = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "history",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
              history: [
                {
                  metadata: { phase: 0, chunk_order: 1, progress: 55 },
                  threads: [{ id: "16505551234", messages: [{ from: "16505551234", id: "wamid.A", timestamp: "1739230970", type: "text", text: { body: "Thanks!" } }] }],
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const media = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "history",
            value: {
              metadata: { phone_number_id: "106540352242922" },
              messages: [{ from: "16505551234", id: "wamid.B", timestamp: "1738796547", type: "image", image: { id: "24230790383178626", mime_type: "image/jpeg" } }],
            },
          },
        ],
      },
    ],
  };

  it("bloco com fase, ordem e progresso; anexos que chegam depois; recusa com ou sem envelope", () => {
    expect(historyChanges(chunk)).toEqual([
      {
        phoneNumberId: "106540352242922",
        events: [{ kind: "chunk", phase: 0, chunkOrder: 1, progress: 55, payload: { threads: chunk.entry[0].changes[0].value.history![0].threads } }],
      },
    ]);
    expect(historyChanges(media)[0].events).toEqual([{ kind: "media", payload: { messages: media.entry[0].changes[0].value.messages } }]);
    const declined = {
      messaging_product: "whatsapp",
      metadata: { phone_number_id: "106540352242922" },
      history: [{ errors: [{ code: 2593109, title: "History sync is turned off by the business from the WhatsApp Business App" }] }],
    };
    expect(historyChanges(declined)[0].events[0].kind).toBe("declined");
    expect(historyChanges({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "history", value: declined }] }] })[0].events[0].kind).toBe("declined");
  });

  it("os anexos do histórico não entram como mensagens novas (nem chamam o bot)", () => {
    expect(webhookChanges(media)).toEqual([]);
    expect(webhookChanges(chunk)).toEqual([]);
  });

  it("ACCOUNT_RECONNECTED: a conta da entrada", () => {
    const payload = { object: "whatsapp_business_account", entry: [{ id: "862475293675413", time: 1768477203, changes: [{ field: "account_update", value: { event: "ACCOUNT_RECONNECTED" } }] }] };
    expect(accountReconnections(payload)).toEqual(["862475293675413"]);
    expect(accountDisconnections(payload)).toEqual([]);
  });
});
