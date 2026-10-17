import { describe, expect, it } from "vitest";
import { clinicInitials, filterClinicsByName, showClinicSearch } from "./clinicSearch";

const clinics = [{ name: "Clínica Exemplo Saúde" }, { name: "Odonto Exemplo" }, { name: "Pediatria Sól" }];

describe("busca de clínica (R10)", () => {
  it("aparece só com mais de 6 clínicas", () => {
    expect(showClinicSearch(6)).toBe(false);
    expect(showClinicSearch(7)).toBe(true);
  });

  it("acha sem acento e sem diferença de maiúsculas", () => {
    expect(filterClinicsByName(clinics, "SAUDE")).toEqual([clinics[0]]);
    expect(filterClinicsByName(clinics, "  pediatria   sol ")).toEqual([clinics[2]]);
    expect(filterClinicsByName(clinics, "exemplo")).toEqual([clinics[0], clinics[1]]);
  });

  it("busca vazia devolve todas; sem resultado, lista vazia", () => {
    expect(filterClinicsByName(clinics, "")).toEqual(clinics);
    expect(filterClinicsByName(clinics, null)).toEqual(clinics);
    expect(filterClinicsByName(clinics, "fisio")).toEqual([]);
  });

  it("iniciais com até 2 letras, sem as palavras de ligação", () => {
    expect(clinicInitials("Clínica Exemplo Saúde")).toBe("CE");
    expect(clinicInitials("Clínica da Criança")).toBe("CC");
    expect(clinicInitials("odonto")).toBe("O");
  });
});
