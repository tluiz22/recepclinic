import { describe, expect, it } from "vitest";
import { isCourtesyMessage, isCourtesyText, isGreetingText } from "./courtesy";

// C27 (cliente, 04/nov/2026): cortesia depois da resposta da clínica não volta para "Aguardando".
describe("isCourtesyText", () => {
  it.each([
    "ok",
    "Ok!",
    "okkk",
    "Obrigada!!",
    "Muito obrigado, tchau",
    "valeu, até amanhã",
    "Certo, combinado 👍",
    "👍",
    "🙏🏽",
    "Obrigado pela atenção, Deus abençoe 🙏",
    "Beleza, obrigada, boa tarde",
    "ok obg",
    "Tá bom, obrigada",
    "Perfeito, até mais",
  ])("cortesia: %s", (text) => expect(isCourtesyText(text)).toBe(true));

  it.each([
    "",
    "sim",
    "tá bom",
    "bom dia",
    "ok, mas e o exame?",
    "obrigada, qual o valor da consulta?",
    "Pode ser às 10h?",
    "ok, vou levar o pedido médico amanhã",
    "😡",
    "obrigado ".repeat(11),
  ])("não é cortesia: %s", (text) => expect(isCourtesyText(text)).toBe(false));
});

describe("isCourtesyMessage", () => {
  it("reação conta como cortesia; áudio e imagem, não", () => {
    expect(isCourtesyMessage({ type: "reaction" } as never)).toBe(true);
    expect(isCourtesyMessage({ type: "text", text: { body: "obrigada" } } as never)).toBe(true);
    expect(isCourtesyMessage({ type: "audio" } as never)).toBe(false);
    expect(isCourtesyMessage({ type: "image" } as never)).toBe(false);
  });
});

describe("isGreetingText (cliente, 13/nov/2026)", () => {
  it.each(["Bom dia!!", "Oii", "Ooi", "oie", "eae", "Olá, boa tarde", "oi, tudo bem?", "Boa noite 👋", "👋", "e aí", "Opa, bom dia pessoal", "Olá doutora", "Olá Dra", "boa tarde, tudo bem com vc?", "hello", "Bom dia ☀️", "Oi 😄"])("saudação: %s", (text) =>
    expect(isGreetingText(text)).toBe(true),
  );
  it.each(["bom dia, quanto custa a consulta?", "Boa tarde, a doutora está aí?", "😄", "tá bom", "Pneumologista pediátrica", "obrigado", "oi quero marcar", "bom", "", "😡"])(
    "não é saudação: %s",
    (text) => expect(isGreetingText(text)).toBe(false),
  );
});
