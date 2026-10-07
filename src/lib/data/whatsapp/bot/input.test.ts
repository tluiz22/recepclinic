import { describe, expect, it } from "vitest";
import { extractSelection, formatBirthdate, isBackToMenu, parseBirthdate, pick, yesNo } from "./input";
import { ageLimit, askBirthdate, confirmPatient, numberedList, otherPatientLabel, row, wordsFor } from "./texts";

const typed = (text: string) => ({ id: null, text });

describe("leitura da resposta (F6.3)", () => {
  it("toque em lista, botão ou texto digitado", () => {
    expect(extractSelection({ type: "interactive", interactive: { list_reply: { id: "a", title: "A" } } })).toEqual({ id: "a", text: "A" });
    expect(extractSelection({ type: "interactive", interactive: { button_reply: { id: "yes", title: "Sim" } } })).toEqual({ id: "yes", text: "Sim" });
    expect(extractSelection({ type: "text", text: { body: "  2 " } })).toEqual({ id: null, text: "2" });
    expect(extractSelection({ type: "image" })).toEqual({ id: null, text: "" });
  });

  it("opção pelo id ou pelo número digitado", () => {
    const items = ["a", "b", "c"];
    expect(pick({ id: "b", text: "" }, items, (i) => i)).toBe("b");
    expect(pick(typed("3"), items, (i) => i)).toBe("c");
    expect(pick(typed("2. Exames"), items, (i) => i)).toBe("b");
    expect(pick(typed("4"), items, (i) => i)).toBeNull();
    expect(pick(typed("12345"), items, (i) => i)).toBeNull();
  });

  it("sim e não, com ou sem acento", () => {
    expect(["sim", "S", "Sim, é isso", "1"].map((t) => yesNo(typed(t)))).toEqual([true, true, true, true]);
    expect(["não", "nao", "N", "2"].map((t) => yesNo(typed(t)))).toEqual([false, false, false, false]);
    expect(["sei lá", "talvez"].map((t) => yesNo(typed(t)))).toEqual([null, null]);
  });

  it("voltar ao menu", () => {
    expect(["0", "menu", "Menu principal"].every((t) => isBackToMenu(typed(t)))).toBe(true);
    expect(isBackToMenu({ id: "back_to_menu", text: "" })).toBe(true);
    expect(isBackToMenu(typed("1"))).toBe(false);
  });

  it("data de nascimento: existe, não é futura nem antes de 1900", () => {
    expect(parseBirthdate("10/03/2020", "2026-10-07")).toBe("2020-03-10");
    expect(parseBirthdate("1-2-2020", "2026-10-07")).toBe("2020-02-01");
    expect(parseBirthdate("31/02/2020", "2026-10-07")).toBeNull();
    expect(parseBirthdate("08/10/2026", "2026-10-07")).toBeNull();
    expect(parseBirthdate("01/01/1899", "2026-10-07")).toBeNull();
    expect(formatBirthdate("2020-03-10")).toBe("10/03/2020");
  });
});

describe("textos pelo perfil (F6.3)", () => {
  it("Pediátrica fala de criança; Adultos e Mista, de paciente", () => {
    const kid = wordsFor("pediatric");
    const adult = wordsFor("adult");
    expect([askBirthdate(kid), askBirthdate(adult)]).toEqual([
      "Qual a data de nascimento da criança? (formato dd/mm/aaaa)",
      "Qual a data de nascimento do paciente? (formato dd/mm/aaaa)",
    ]);
    expect([otherPatientLabel(kid), otherPatientLabel(wordsFor("mixed"))]).toEqual(["Outra criança", "Outro paciente"]);
    expect(confirmPatient(kid, "Ana", "10/03/2020")).toBe("Encontramos *Ana*, nascido(a) em 10/03/2020: é essa a criança? Responda Sim ou Não.");
    expect(ageLimit("Consulta", 14, kid)).toBe("Consulta é para pacientes até 13 anos.\n\nDeseja agendar para outra criança?");
  });

  it("linha da lista no limite da Meta: título cortado, nome inteiro na descrição", () => {
    expect(row(0, "x", "Consulta")).toEqual({ id: "x", title: "1. Consulta" });
    const long = row(1, "y", "FeNO - Fração exalada de óxido nítrico", "R$ 150,00");
    expect(long.title).toHaveLength(24);
    expect(long.description).toBe("FeNO - Fração exalada de óxido nítrico · R$ 150,00");
    const list = numberedList(Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, label: `Serviço ${i}` })));
    expect(list[0].rows).toHaveLength(10);
    expect(list[0].rows.at(-1)).toEqual({ id: "back_to_menu", title: "10. Voltar ao menu" });
  });
});
