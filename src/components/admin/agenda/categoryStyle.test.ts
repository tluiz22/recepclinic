import { describe, expect, it } from "vitest";
import { CATEGORY_STYLES, serviceBesideCategory } from "./categoryStyle";

describe("tipo do atendimento na Agenda", () => {
  it("mostra o serviço quando ele não repete o tipo", () => {
    expect(serviceBesideCategory("Consulta pediátrica", "consultation")).toBe("Consulta pediátrica");
    expect(serviceBesideCategory("Espirometria", "exam")).toBe("Espirometria");
  });

  it("omite o serviço com o mesmo nome do tipo, sem diferença de maiúsculas ou espaços", () => {
    expect(serviceBesideCategory("Retorno", "return_visit")).toBeNull();
    expect(serviceBesideCategory(" retorno ", "return_visit")).toBeNull();
    expect(serviceBesideCategory("CONSULTA", "consultation")).toBeNull();
  });

  it("dá ao Retorno uma cor própria e aos outros tipos o tom do texto", () => {
    expect(CATEGORY_STYLES.return_visit.text).toBe("text-ret-700");
    expect(CATEGORY_STYLES.consultation.text).toBe("text-ink");
    expect(CATEGORY_STYLES.exam.label).toBe("Exame");
  });
});
