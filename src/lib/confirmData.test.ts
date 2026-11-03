import { describe, expect, it } from "vitest";
import { confirmDetails } from "./confirmData";

describe("conferência dos dados antes de gravar (C19)", () => {
  it("nascimento com a data e a idade; campos vazios ficam de fora", () => {
    expect(
      confirmDetails(
        [
          { label: "Nome", value: " Ana Souza ", kind: "text" },
          { label: "Nascimento", value: "2020-03-12", kind: "date", age: true },
          { label: "Carteirinha", value: "", kind: "text" },
          { label: "Quem fala", value: "new", text: "Responsável", kind: "text" },
        ],
        "2026-11-03",
      ),
    ).toEqual([
      { label: "Nome", value: "Ana Souza" },
      { label: "Nascimento", value: "12/03/2020 · 6 anos" },
      { label: "Quem fala", value: "Responsável" },
    ]);
  });

  it("edição: o que mudou mostra antes → depois", () => {
    expect(
      confirmDetails(
        [
          { label: "Nome", value: "Ana Souza", initial: "Ana Souza", kind: "text" },
          { label: "Nascimento", value: "2021-03-12", initial: "2020-03-12", kind: "date", age: true },
        ],
        "2026-11-03",
      ),
    ).toEqual([
      { label: "Nome", value: "Ana Souza" },
      { label: "Nascimento", value: "12/03/2021 · 5 anos", before: "12/03/2020 · 6 anos" },
    ]);
  });
});
