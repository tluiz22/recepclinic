import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildDanfse, formatDoc, formatMoney, readNfse } from "./danfse";
import { templateCreationPayload, defaultTemplate, fillTemplate } from "../data/whatsapp/templates";
import { uploadMedia, uploadTemplateExample } from "../data/whatsapp/graph";

// DANFSe (F11.5, NT 008): os campos lidos do XML da NFS-e e o PDF de uma
// página; o template da nota com o PDF no topo; o envio do arquivo à Meta.
const xml = readFileSync(new URL("./fixtures/nfse-exemplo.xml", import.meta.url), "utf8");

describe("DANFSe", () => {
  it("lê do XML da nota o que o DANFSe mostra", () => {
    const data = readNfse(xml);
    expect(data).toMatchObject({
      accessKey: "24080032211222333000181000000000000126100000000123",
      number: "123",
      competence: "12/10/2026",
      issuedAt: "12/10/2026 12:00:05",
      dpsNumber: "7",
      dpsSeries: "1",
      emitter: "Prestador",
      status: "NFS-e Gerada",
      municipality: "Mossoró / RN",
      environment: "2",
    });
    expect(data.prest).toMatchObject({ doc: "11.222.333/0001-81", name: "Clínica Exemplo Saúde Ltda", ibgeCep: "2408003 / 59.600-000", address: "Rua A, 10, Nova Betânia" });
    expect(data.prest.simples).toBe("Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)");
    expect(data.toma).toMatchObject({ doc: "529.982.247-25", name: "Maria Souza" });
    expect(data.service).toMatchObject({ code: "04.01.01", place: "Mossoró / BR", codeDescription: "Medicina.", description: "Consulta. Paciente: João Souza. Atendimento em 05/10/2026." });
    expect(data.issqn).toMatchObject({ kind: "Operação Tributável", base: "R$ 300,50", rate: "2,00%", retention: "Não Retido", tax: "R$ 6,01" });
    expect(data.totals).toMatchObject({ service: "R$ 300,50", net: "R$ 300,50", ibsCbs: "-" });
    expect(data.complementary).toBe("Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Simples Nacional: 6,00%");
  });

  it("formatos: CNPJ, CPF e dinheiro (vazio vira traço)", () => {
    expect(formatDoc("", "52998224725")).toBe("529.982.247-25");
    expect(formatMoney("")).toBe("-");
    expect(formatMoney("1234.5")).toBe("R$ 1.234,50");
  });

  it("PDF A4 de uma página só; a cancelada também", async () => {
    for (const canceled of [false, true]) {
      const bytes = await buildDanfse(xml, { canceled });
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
      const { width, height } = doc.getPage(0).getSize();
      expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
    }
  });

  it("XML que não é de NFS-e: erro", () => {
    expect(() => readNfse("<x/>")).toThrow();
  });
});

describe("template da nota (rc_nota_fiscal_v1)", () => {
  it("documento no topo, com o PDF de exemplo; texto aprovado", () => {
    const template = defaultTemplate("nfse_document")!;
    expect(templateCreationPayload(template, "4::aGFuZGxl").components).toEqual([
      { type: "HEADER", format: "DOCUMENT", example: { header_handle: ["4::aGFuZGxl"] } },
      { type: "BODY", text: template.body, example: { body_text: [template.examples] } },
    ]);
    expect(fillTemplate(template.body, template.examples)).toBe(
      "Olá, Maria! Aqui é da Clínica Sorriso.\nSegue a nota fiscal nº 123, de R$ 300,00, referente ao atendimento de João Souza em 05/10/2026.\n\nQualquer dúvida, é só responder esta mensagem.",
    );
  });

  it("sobe o PDF para o número (id da mídia) e o exemplo pelo envio retomável (handle)", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = url.includes("/media") ? { id: "MID" } : url.includes("/uploads") ? { id: "upload:SESS" } : { h: "HANDLE" };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const file = { bytes: new Uint8Array([37, 80, 68, 70]), filename: "n.pdf", mimeType: "application/pdf" };
    expect(await uploadMedia("PHONE", "TOKEN", file, fetcher)).toBe("MID");
    expect(calls[0].url).toContain("/PHONE/media");
    expect(await uploadTemplateExample("123456", "TOKEN", file, fetcher)).toBe("HANDLE");
    expect(calls[1].url).toContain("/123456/uploads?file_name=n.pdf&file_length=4&file_type=application%2Fpdf");
    expect(calls[2].url).toContain("/upload:SESS");
    expect((calls[2].init?.headers as Record<string, string>).Authorization).toBe("OAuth TOKEN");
  });
});
