import { describe, expect, it } from "vitest";
import { checkOutboundFile, outboundPath, sniffMimeType } from "./media";
import { outboundFileName } from "../centralSend";

// CN6 — enviar foto e PDF pela Central (decisão 8b, cliente, 05/nov/2026).
const MB = 1024 * 1024;

describe("arquivo enviado pela Central (CN6)", () => {
  it("aceita foto JPG/PNG até 5 MB e PDF até 10 MB", () => {
    expect(checkOutboundFile("image/jpeg", 5 * MB)).toEqual({ ok: true, mimeType: "image/jpeg" });
    expect(checkOutboundFile("image/png", 1)).toEqual({ ok: true, mimeType: "image/png" });
    expect(checkOutboundFile("application/pdf", 10 * MB)).toEqual({ ok: true, mimeType: "application/pdf" });
    expect(checkOutboundFile("image/jpeg", 5 * MB + 1)).toEqual({ ok: false, message: "A foto vai até 5 MB." });
    expect(checkOutboundFile("application/pdf", 10 * MB + 1)).toEqual({ ok: false, message: "O PDF vai até 10 MB." });
    expect(checkOutboundFile("image/webp", 100).ok).toBe(false);
    expect(checkOutboundFile("video/mp4", 100).ok).toBe(false);
    expect(checkOutboundFile("application/pdf", 0)).toEqual({ ok: false, message: "O arquivo está vazio." });
  });

  it("confere o tipo pelo conteúdo, não pelo nome", () => {
    expect(sniffMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(sniffMimeType(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMimeType(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });

  it("guarda na pasta da conversa, com a chave da tela", () => {
    expect(outboundPath("c1", "+5584999990000", "k1", "application/pdf")).toBe("c1/5584999990000/env-k1.pdf");
    expect(outboundPath("c1", "+5584999990000", "k1", "image/png")).toBe("c1/5584999990000/env-k1.png");
  });

  it("nome do arquivo sem pastas; PDF sempre com .pdf", () => {
    expect(outboundFileName("C:\\fotos\\exame.jpg", "image/jpeg")).toBe("exame.jpg");
    expect(outboundFileName("guia", "application/pdf")).toBe("guia.pdf");
    expect(outboundFileName("", "application/pdf")).toBe("documento.pdf");
    expect(outboundFileName("Pedido.PDF", "application/pdf")).toBe("Pedido.PDF");
  });
});
