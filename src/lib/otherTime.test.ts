import { describe, expect, it } from "vitest";
import { pickOne, readOtherTime } from "./otherTime";

describe("outro horário", () => {
  it("lê dia, hora, local e agenda do endereço", () => {
    const params = new URLSearchParams({ outro_data: "2026-11-03", outro_hora: "08:10", outro_local: "loc", outro_agenda: "ag" });
    expect(readOtherTime(params)).toEqual({ date: "2026-11-03", time: "08:10", locationId: "loc", agendaId: "ag" });
  });

  it("sem dia ou hora válidos, nada", () => {
    expect(readOtherTime(new URLSearchParams({ outro_data: "2026-11-03" }))).toBeNull();
    expect(readOtherTime(new URLSearchParams({ outro_data: "03/11/2026", outro_hora: "08:10" }))).toBeNull();
    expect(readOtherTime(new URLSearchParams({ outro_data: "2026-11-03", outro_hora: "8h" }))).toBeNull();
  });

  it("escolha: a pedida, se existe; com uma opção só, ela", () => {
    expect(pickOne("b", ["a", "b"])).toBe("b");
    expect(pickOne("", ["a"])).toBe("a");
    expect(pickOne("x", ["a", "b"])).toBe("");
  });
});
