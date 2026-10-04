import { describe, expect, it } from "vitest";
import { MAX_PREPARATION_LENGTH, normalizeMultilineText, whatsAppTextSummary, whatsAppTextToHtml } from "./whatsappFormat";

describe("whatsAppTextToHtml", () => {
  it("converte negrito, itálico e riscado", () => {
    expect(whatsAppTextToHtml("*jejum* de _8 horas_, ~sem~ água")).toBe(
      "<strong>jejum</strong> de <em>8 horas</em>, <s>sem</s> água",
    );
  });

  it("marcador separado do texto não formata", () => {
    expect(whatsAppTextToHtml("* negrito *")).toBe("* negrito *");
  });

  it("marcador no meio da palavra não formata (ex.: links)", () => {
    expect(whatsAppTextToHtml("https://site/a_b_c")).toBe("https://site/a_b_c");
  });

  it("não atravessa a quebra de linha", () => {
    expect(whatsAppTextToHtml("*começo\nfim*")).toBe("*começo\nfim*");
  });

  it("formata em várias linhas, cada uma por si", () => {
    expect(whatsAppTextToHtml("*Antes*\n_Depois_")).toBe("<strong>Antes</strong>\n<em>Depois</em>");
  });

  it("aceita pontuação colada ao marcador", () => {
    expect(whatsAppTextToHtml("Atenção: *importante*!")).toBe("Atenção: <strong>importante</strong>!");
  });

  it("escapa HTML digitado no texto", () => {
    expect(whatsAppTextToHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
  });

  it("formatação aninhada: negrito com itálico dentro", () => {
    expect(whatsAppTextToHtml("*muito _importante_*")).toBe("<strong>muito <em>importante</em></strong>");
  });
});

describe("whatsAppTextSummary", () => {
  it("primeira linha com texto, sem marcadores", () => {
    expect(whatsAppTextSummary("\n  \n*Jejum* de 8 horas\nSegunda linha")).toBe("Jejum de 8 horas");
  });

  it("corta no limite com reticências", () => {
    expect(whatsAppTextSummary("abcdefghij", 6)).toBe("abcde…");
  });

  it("limite padrão de 60 caracteres", () => {
    const summary = whatsAppTextSummary("x".repeat(80));
    expect(summary).toHaveLength(60);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("não deixa espaço antes das reticências", () => {
    expect(whatsAppTextSummary("abcd efgh", 6)).toBe("abcd…");
  });

  it("texto vazio vira resumo vazio", () => {
    expect(whatsAppTextSummary("")).toBe("");
  });
});

describe("normalizeMultilineText", () => {
  it("troca \\r\\n por \\n, tira espaços das pontas e mantém linhas em branco do meio", () => {
    expect(normalizeMultilineText("  Linha 1\r\n\r\nLinha 2\r\n  ")).toBe("Linha 1\n\nLinha 2");
  });

  it("limite do preparo: 3800 caracteres", () => {
    expect(MAX_PREPARATION_LENGTH).toBe(3800);
  });
});
