import { describe, expect, it } from "vitest";
import { parseKnownIssueLinks } from "./knownIssues";

describe("links dos problemas conhecidos (IS5, 03/nov/2026)", () => {
  it("um por linha, com rótulo ou só o endereço; caminho do sistema vale; o resto sai", () => {
    expect(
      parseKnownIssueLinks("Guia do pagamento | /guia/pagamento-meta\nhttps://business.facebook.com/wa/manage/home/\n\nsem endereço\nRuim | javascript:alert(1)"),
    ).toEqual([
      { label: "Guia do pagamento", href: "/guia/pagamento-meta" },
      { label: "https://business.facebook.com/wa/manage/home/", href: "https://business.facebook.com/wa/manage/home/" },
    ]);
  });
});
