import { describe, expect, it } from "vitest";
import { DataError } from "./errors";
import { documentPath, validateDocumentInput } from "./patientDocuments";

const base = { kind: "insurance_card", description: null, fileName: "carteirinha.jpg", mimeType: "image/jpeg", sizeBytes: 500_000 };
const fieldsOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as DataError).fields;
  }
  return {};
};

describe("documentos do paciente (P1)", () => {
  it("foto ou PDF até 10 MB, com o tipo do documento (Q23)", () => {
    expect(validateDocumentInput({ ...base, description: "  Unimed 2026 " })).toEqual({ kind: "insurance_card", description: "Unimed 2026", fileName: "carteirinha.jpg", mimeType: "image/jpeg" });
    expect(fieldsOf(() => validateDocumentInput({ ...base, mimeType: "application/msword" }))).toHaveProperty("file");
    expect(fieldsOf(() => validateDocumentInput({ ...base, sizeBytes: 10 * 1024 * 1024 + 1 }))).toHaveProperty("file");
    expect(fieldsOf(() => validateDocumentInput({ ...base, sizeBytes: 0 }))).toHaveProperty("file");
    expect(fieldsOf(() => validateDocumentInput({ ...base, kind: "" }))).toHaveProperty("kind");
  });

  it("o nome do arquivo fica só com o nome (sem pastas)", () => {
    expect(validateDocumentInput({ ...base, fileName: "C:\\Fotos\\pedido.pdf", mimeType: "application/pdf" }).fileName).toBe("pedido.pdf");
  });

  it("caminho por clínica, paciente e documento, com a extensão do tipo", () => {
    expect(documentPath("c", "p", "d", "image/heic")).toBe("c/p/d.heic");
    expect(documentPath("c", "p", "d", "application/pdf")).toBe("c/p/d.pdf");
  });
});
