import { describe, expect, it } from "vitest";
import { parseSearch } from "./patientSearch";

describe("parseSearch", () => {
  it("nome, mesmo com números", () => {
    expect(parseSearch("Paciente 2001")).toEqual({ kind: "name", text: "Paciente 2001" });
    expect(parseSearch("  Júlia ")).toEqual({ kind: "name", text: "Júlia" });
    expect(parseSearch("12")).toEqual({ kind: "name", text: "12" });
  });

  it("telefone: só números, 4 ou mais", () => {
    expect(parseSearch("(84) 98888-0003")).toEqual({ kind: "phone", digits: "84988880003" });
    expect(parseSearch("0003")).toEqual({ kind: "phone", digits: "0003" });
  });

  it("data de nascimento dd/mm/aaaa", () => {
    expect(parseSearch("30/09/1992")).toEqual({ kind: "birthdate", date: "1992-09-30" });
    expect(parseSearch("1/2/2020")).toEqual({ kind: "birthdate", date: "2020-02-01" });
    expect(parseSearch("30-09-1992")).toEqual({ kind: "birthdate", date: "1992-09-30" });
    // Data que não existe: fica como telefone (só números).
    expect(parseSearch("31/02/2020")).toEqual({ kind: "phone", digits: "31022020" });
  });

  it("vazio", () => {
    expect(parseSearch("   ")).toBeNull();
  });
});
