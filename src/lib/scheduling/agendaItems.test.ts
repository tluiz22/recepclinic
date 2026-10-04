import { describe, expect, it } from "vitest";
import { groupSessionTitle } from "./agendaItems";

const session = (booked: number, capacity: number | null) => ({
  kind: "group_session" as const,
  start: new Date("2026-10-14T12:00:00Z"),
  end: new Date("2026-10-14T13:00:00Z"),
  canceled: false,
  examName: "Espirometria",
  booked,
  capacity,
  cancelableIds: [],
});

describe("groupSessionTitle", () => {
  it("com capacidade: ocupadas/total", () => {
    expect(groupSessionTitle(session(3, 5))).toBe("Espirometria — turma (3/5 vagas)");
  });

  it("sem capacidade: só as ocupadas, no singular e no plural", () => {
    expect(groupSessionTitle(session(1, null))).toBe("Espirometria — turma (1 vaga ocupada)");
    expect(groupSessionTitle(session(4, null))).toBe("Espirometria — turma (4 vagas ocupadas)");
    expect(groupSessionTitle(session(0, null))).toBe("Espirometria — turma (0 vagas ocupadas)");
  });
});
