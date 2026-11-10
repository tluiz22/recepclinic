import { describe, expect, it } from "vitest";
import { assignLanes, buildColumns, filterColumns, gridLines, gridRange, groupRuns, specialtyOptions, DEFAULT_RANGE } from "./agendaGrid";

const agenda = (id: string, name: string, professionalId: string | null = id, kind: "professional" | "resource" = "professional") => ({
  id,
  name,
  isActive: true,
  kind,
  professionalId,
});

describe("buildColumns", () => {
  const specialties = new Map([
    ["p1", ["Pediatria"]],
    ["p2", ["Cardiologia", "Pediatria"]],
    ["p3", ["Cardiologia"]],
  ]);
  const columns = buildColumns([agenda("p1", "Dra. Ana"), agenda("x", "Exames", null, "resource"), agenda("p4", "Igor"), agenda("p3", "Dr. Paulo"), agenda("p2", "Dra. Renata")], specialties);

  it("agrupa pela primeira especialidade, com Outros e Exames no fim", () => {
    expect(columns.map((c) => [c.name, c.group])).toEqual([
      ["Dr. Paulo", "Cardiologia"],
      ["Dra. Renata", "Cardiologia"],
      ["Dra. Ana", "Pediatria"],
      ["Igor", "Outros"],
      ["Exames", "Exames"],
    ]);
  });

  it("lista as especialidades do filtro", () => {
    expect(specialtyOptions(columns)).toEqual(["Cardiologia", "Pediatria", "Outros", "Exames"]);
  });

  it("filtra pela especialidade (qualquer uma do profissional) ou pelo profissional, um de cada vez", () => {
    expect(filterColumns(columns, { specialty: "Pediatria", agendaId: null }).columns.map((c) => c.name)).toEqual(["Dra. Renata", "Dra. Ana"]);
    const both = filterColumns(columns, { specialty: "Pediatria", agendaId: "p3" });
    expect(both.columns.map((c) => c.name)).toEqual(["Dr. Paulo"]);
    expect(both.filter).toEqual({ specialty: null, agendaId: "p3" });
    expect(filterColumns(columns, { specialty: "Exames", agendaId: null }).columns.map((c) => c.name)).toEqual(["Exames"]);
  });

  it("valor desconhecido vira todas", () => {
    const result = filterColumns(columns, { specialty: "Neuro", agendaId: "zz" });
    expect(result.columns).toHaveLength(5);
    expect(result.filter).toEqual({ specialty: null, agendaId: null });
  });

  it("junta os grupos seguidos", () => {
    expect(groupRuns(columns)).toEqual([
      { group: "Cardiologia", span: 2 },
      { group: "Pediatria", span: 1 },
      { group: "Outros", span: 1 },
      { group: "Exames", span: 1 },
    ]);
  });
});

describe("gridRange e gridLines", () => {
  it("arredonda para meias horas inteiras", () => {
    expect(gridRange([{ start: 8 * 60 + 10, end: 9 * 60 + 5 }, { start: 13 * 60, end: 17 * 60 + 45 }])).toEqual({ start: 480, end: 1080 });
  });
  it("sem nada, das 8 às 18", () => {
    expect(gridRange([])).toEqual(DEFAULT_RANGE);
  });
  it("lista as linhas", () => {
    expect(gridLines({ start: 480, end: 600 })).toEqual(["08:00", "08:30", "09:00", "09:30"]);
  });
});

describe("assignLanes", () => {
  it("sem sobreposição, uma faixa", () => {
    expect(assignLanes([{ start: 0, end: 30 }, { start: 30, end: 60 }])).toEqual([
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ]);
  });
  it("dois ao mesmo tempo dividem a largura; o seguinte volta a ter tudo", () => {
    expect(assignLanes([{ start: 0, end: 30 }, { start: 0, end: 60 }, { start: 30, end: 60 }, { start: 90, end: 120 }])).toEqual([
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 1 },
    ]);
  });
});
