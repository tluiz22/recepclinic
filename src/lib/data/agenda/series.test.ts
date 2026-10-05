import { describe, expect, it } from "vitest";
import { DataError } from "../errors";
import { linkState } from "./links";
import { addMonthsToDate, firstCandidateDate, generationLimit, validateSeriesInput, type SeriesInput } from "./series";

describe("horizonte de 3 meses (decisão de 04/out)", () => {
  it("mesma data 3 meses depois; fim do mês ajusta", () => {
    expect(addMonthsToDate("2031-03-10", 3)).toBe("2031-06-10");
    expect(addMonthsToDate("2031-11-30", 3)).toBe("2032-02-29");
    expect(addMonthsToDate("2031-01-31", 1)).toBe("2031-02-28");
  });

  it("limite: o horizonte ou o fim da série, o que vier antes", () => {
    expect(generationLimit("2031-03-10", null)).toBe("2031-06-10");
    expect(generationLimit("2031-03-10", "2031-04-01")).toBe("2031-04-01");
    expect(generationLimit("2031-03-10", "2031-12-01")).toBe("2031-06-10");
  });
});

describe("próxima data da série", () => {
  const weekly = { startsOn: "2031-03-10", intervalWeeks: 1 };
  it("começa no início; depois, a seguinte à última considerada", () => {
    expect(firstCandidateDate(weekly, null, "2031-03-09")).toBe("2031-03-10");
    expect(firstCandidateDate(weekly, "2031-03-17", "2031-03-09")).toBe("2031-03-24");
    expect(firstCandidateDate({ ...weekly, intervalWeeks: 2 }, "2031-03-10", "2031-03-09")).toBe("2031-03-24");
  });

  it("nunca no passado: pula para a primeira data a partir de hoje", () => {
    expect(firstCandidateDate(weekly, "2031-03-10", "2031-04-02")).toBe("2031-04-07");
    expect(firstCandidateDate(weekly, "2031-03-10", "2031-04-07")).toBe("2031-04-07");
  });
});

describe("validação da série", () => {
  const base: SeriesInput = {
    patientId: "p",
    serviceId: "s",
    agendaId: "a",
    locationId: "l",
    intervalWeeks: 1,
    startsOn: "2031-03-10",
    startTime: "08:00",
    actorId: null,
  };
  const fields = (input: Partial<SeriesInput>) => {
    try {
      validateSeriesInput({ ...base, ...input }, "2031-03-09");
    } catch (error) {
      return (error as DataError).fields;
    }
    return {};
  };

  it("série válida sem fim, por data ou por número", () => {
    expect(fields({})).toEqual({});
    expect(fields({ endsOn: "2031-06-30" })).toEqual({});
    expect(fields({ maxSessions: 10 })).toEqual({});
  });

  it("recusa frequência fora de 1–12, início no passado, fim duplo, horário inválido", () => {
    expect(fields({ intervalWeeks: 13 })).toHaveProperty("intervalWeeks");
    expect(fields({ intervalWeeks: 0 })).toHaveProperty("intervalWeeks");
    expect(fields({ startsOn: "2031-03-08" })).toHaveProperty("startsOn");
    expect(fields({ endsOn: "2031-06-30", maxSessions: 5 })).toHaveProperty("endsOn");
    expect(fields({ endsOn: "2031-03-01" })).toHaveProperty("endsOn");
    expect(fields({ maxSessions: 0 })).toHaveProperty("maxSessions");
    expect(fields({ startTime: "8h" })).toHaveProperty("startTime");
  });
});

describe("estado do link de agendamento", () => {
  const now = new Date("2031-03-09T15:00:00Z");
  it("válido, vencido (no instante do fim também) ou usado", () => {
    expect(linkState({ usedAt: null, expiresAt: new Date("2031-03-09T15:30:00Z") }, now)).toBe("valid");
    expect(linkState({ usedAt: null, expiresAt: now }, now)).toBe("expired");
    expect(linkState({ usedAt: now, expiresAt: new Date("2031-03-10T00:00:00Z") }, now)).toBe("used");
  });
});
