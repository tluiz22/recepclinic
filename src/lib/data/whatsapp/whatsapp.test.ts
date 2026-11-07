import { describe, expect, it } from "vitest";
import { isPastIdleTimeout } from "./conversations";
import { deliveryRank, echoChange, echoContentType, isReturnToBotKeyword, messageBody, reachedPhone, storedText, toE164, waTimestamp } from "./meta";

const at = (iso: string) => new Date(`${iso}-03:00`);

describe("telefone da Meta", () => {
  it("põe o + e acrescenta o 9 do celular brasileiro quando a Meta o omite", () => {
    expect(toE164("5584981880777")).toBe("+5584981880777");
    expect(toE164("556198645490")).toBe("+5561998645490");
    expect(toE164("14155550123")).toBe("+14155550123");
  });

  it("recusa o que não é número", () => {
    expect(toE164(undefined)).toBeNull();
    expect(toE164("+5584981880777")).toBeNull();
    expect(toE164("123")).toBeNull();
  });
});

describe("texto da mensagem", () => {
  it("usa o texto, a opção tocada ou o botão; senão, o tipo", () => {
    expect(messageBody({ type: "text", text: { body: "Oi" } })).toBe("Oi");
    expect(messageBody({ type: "interactive", interactive: { list_reply: { id: "menu_1", title: "Consultas" } } })).toBe("Consultas");
    expect(messageBody({ type: "interactive", interactive: { button_reply: { id: "sim" } } })).toBe("sim");
    expect(messageBody({ type: "button", button: { text: "Confirmar presença", payload: "x" } })).toBe("Confirmar presença");
    expect(messageBody({ type: "image" })).toBe("[image]");
    expect(messageBody({})).toBeNull();
  });

  it("#bot em qualquer parte, sem diferenciar maiúsculas", () => {
    expect(isReturnToBotKeyword("pode seguir #BOT")).toBe(true);
    expect(isReturnToBotKeyword("bot")).toBe(false);
    expect(isReturnToBotKeyword(null)).toBe(false);
  });
});

describe("situação da entrega", () => {
  it("ordena enviada < entregue < lida, e falha no topo", () => {
    expect(deliveryRank(null)).toBe(0);
    expect(deliveryRank("skipped_no_template")).toBe(0);
    expect(deliveryRank("sent")).toBeLessThan(deliveryRank("delivered"));
    expect(deliveryRank("delivered")).toBeLessThan(deliveryRank("read"));
    expect(deliveryRank("failed")).toBe(deliveryRank("read"));
  });

  it("chega ao celular só na primeira passagem para entregue ou lida", () => {
    expect(reachedPhone("sent", "delivered")).toBe(true);
    expect(reachedPhone("sent", "read")).toBe(true);
    expect(reachedPhone(null, "delivered")).toBe(true);
    expect(reachedPhone("delivered", "read")).toBe(false);
    expect(reachedPhone("sent", "failed")).toBe(false);
    expect(reachedPhone(null, "sent")).toBe(false);
  });
});

describe("conversa parada", () => {
  it("conversa parada 15 minutos recomeça", () => {
    const last = at("2026-10-06T10:00:00");
    expect(isPastIdleTimeout(last, at("2026-10-06T10:14:59"))).toBe(false);
    expect(isPastIdleTimeout(last, at("2026-10-06T10:15:00"))).toBe(true);
  });
});

describe("texto guardado e eco que muda a mensagem (CN2)", () => {
  it("guarda o texto, o toque ou a legenda; sem marcador de tipo", () => {
    expect(storedText({ type: "text", text: { body: "Oi" } })).toBe("Oi");
    expect(storedText({ type: "interactive", interactive: { list_reply: { id: "x", title: "Marcar" } } })).toBe("Marcar");
    expect(storedText({ type: "button", button: { text: "Confirmar" } })).toBe("Confirmar");
    expect(storedText({ type: "image", image: { caption: "pedido do exame" } })).toBe("pedido do exame");
    expect(storedText({ type: "audio" })).toBeNull();
    expect(storedText({ type: "text", text: { body: "   " } })).toBeNull();
  });

  it("EC (cliente, 07/nov/2026): localização, contato e reação em texto; tipo do eco à parte", () => {
    expect(storedText({ type: "location", location: { latitude: -5.8, longitude: -35.2, name: "Clínica", address: "Rua X, 123" } })).toBe(
      "Localização: Clínica, Rua X, 123 (-5.800000, -35.200000)",
    );
    // "Localização atual": só as coordenadas (validação no staging, 07/nov/2026).
    expect(storedText({ type: "location", location: { latitude: -5.8, longitude: -35.2 } })).toBe("Localização: -5.800000, -35.200000");
    expect(storedText({ type: "location", location: {} })).toBeNull();
    expect(storedText({ type: "contacts", contacts: [{ name: { formatted_name: "Maria Souza" } }] })).toBe("Contato: Maria Souza");
    expect(storedText({ type: "contacts", contacts: [{ name: { formatted_name: "A" } }, { name: { first_name: "B" } }] })).toBe("Contatos: A, B");
    expect(storedText({ type: "reaction", reaction: { message_id: "w1", emoji: "👍" } })).toBe("Reagiu com 👍");
    expect(storedText({ type: "reaction", reaction: { message_id: "w1", emoji: "" } })).toBeNull();
    expect(echoContentType({ type: "text", text: { body: "Oi" } })).toBeNull();
    expect(echoContentType({ type: "image" })).toBe("image");
    expect(echoContentType({ type: "location" })).toBe("location");
    expect(echoContentType({ type: "Novo-Tipo!" })).toBe("unknown");
    expect(echoContentType({})).toBeNull();
  });

  it("hora da Meta em segundos, texto ou número", () => {
    expect(waTimestamp({ timestamp: "1739321024" })?.toISOString()).toBe("2025-02-12T00:43:44.000Z");
    expect(waTimestamp({ timestamp: 1739321024 })?.getTime()).toBe(1739321024000);
    expect(waTimestamp({})).toBeNull();
    expect(waTimestamp({ timestamp: "abc" })).toBeNull();
  });

  it("edit e revoke apontam a original", () => {
    expect(echoChange({ type: "edit", edit: { original_message_id: "wamid.1", message: { type: "text", text: { body: "novo" } } } })).toEqual({
      kind: "edit",
      originalId: "wamid.1",
      text: "novo",
    });
    expect(echoChange({ type: "revoke", revoke: { original_message_id: "wamid.2" } })).toEqual({ kind: "revoke", originalId: "wamid.2" });
    expect(echoChange({ type: "text", text: { body: "oi" } })).toBeNull();
    expect(echoChange({ type: "revoke", revoke: {} })).toBeNull();
  });
});
