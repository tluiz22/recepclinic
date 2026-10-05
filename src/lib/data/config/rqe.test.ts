import { describe, expect, it } from "vitest";
import { parseOnboardingForm, sectionsFor } from "../../onboardingForm";
import { normalizeRqe, professionalRegistry } from "./professionals";

describe("RQE do profissional", () => {
  it("aceita um ou vários números, com vírgula, barra ou espaço", () => {
    expect(normalizeRqe("6271")).toBe("6271");
    expect(normalizeRqe(" 6271 / 8890;123 ")).toBe("6271, 8890, 123");
    expect(normalizeRqe("RQE 6271")).toBeNull();
    expect(normalizeRqe("")).toBeNull();
  });

  it("registro como aparece para o paciente", () => {
    expect(professionalRegistry({ council: "CRM", councilNumber: "5751", councilState: "RN", rqe: "6271" })).toBe("CRM 5751 RN | RQE 6271");
    expect(professionalRegistry({ council: "CRP", councilNumber: "123", councilState: null, rqe: null })).toBe("CRP 123");
    expect(professionalRegistry({ council: null, councilNumber: null, councilState: null, rqe: "6271, 8890" })).toBe("RQE 6271, 8890");
    expect(professionalRegistry({ council: null, councilNumber: null, councilState: null, rqe: null })).toBe("");
  });

  it("vem também no formulário de informações", () => {
    const form = new FormData();
    form.append("professional_name", "Dra. Ana");
    form.append("professional_rqe", "6271, 8890");
    expect(parseOnboardingForm(form, sectionsFor([])).professionals[0].rqe).toBe("6271, 8890");
  });
});
