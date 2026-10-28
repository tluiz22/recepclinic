import { describe, expect, it } from "vitest";
import { cleanNoteBody, NOTE_MAX } from "./patientNotes";

describe("anotações do paciente (P2)", () => {
  it("sem espaços nas pontas; vazia ou acima de 2000 caracteres é recusada", () => {
    expect(cleanNoteBody("  Plano pediu o laudo \n")).toBe("Plano pediu o laudo");
    expect(() => cleanNoteBody("   ")).toThrow();
    expect(() => cleanNoteBody(null)).toThrow();
    expect(cleanNoteBody("x".repeat(NOTE_MAX))).toHaveLength(NOTE_MAX);
    expect(() => cleanNoteBody("x".repeat(NOTE_MAX + 1))).toThrow();
  });
});
