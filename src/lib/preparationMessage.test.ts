import { describe, expect, it } from "vitest";
import { PREPARATION_MAX_LENGTH, preparationInstructionsOneLine, preparationMessageText } from "./preparationMessage";

describe("mensagem do preparo (C7.4)", () => {
  it("conversa aberta: linha antes, as instruções como foram escritas e a linha depois", () => {
    expect(preparationMessageText("Espirometria", "*Não usar* broncodilatador.\nVenha de roupa confortável.\n")).toBe(
      "Segue orientações para a realização do exame Espirometria:\n\n*Não usar* broncodilatador.\nVenha de roupa confortável.\n\nEstamos à disposição para qualquer dúvida.",
    );
  });

  it("modelo: as linhas viram ' · ', sem linhas vazias nem espaços repetidos", () => {
    expect(preparationInstructionsOneLine("*Não usar* broncodilatador.\n\n  Venha   de roupa\tconfortável.  \n")).toBe(
      "*Não usar* broncodilatador. · Venha de roupa confortável.",
    );
  });

  it("modelo: texto antigo maior que o limite é cortado com reticências", () => {
    const line = preparationInstructionsOneLine("a".repeat(PREPARATION_MAX_LENGTH + 50));
    expect(line).toHaveLength(PREPARATION_MAX_LENGTH);
    expect(line.endsWith("…")).toBe(true);
  });
});
