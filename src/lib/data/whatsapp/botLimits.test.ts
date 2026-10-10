import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_LIMITS, describeBotLimitHit, evaluateBookingLimits, evaluateNewPatientLimit } from "./botLimits";

describe("limites do bot por contato (F9.6a)", () => {
  it("atendimentos futuros: barra ao chegar no limite", () => {
    expect(evaluateBookingLimits(DEFAULT_BOT_LIMITS, { futureAppointments: 2, noShows: 0 })).toBeNull();
    expect(evaluateBookingLimits(DEFAULT_BOT_LIMITS, { futureAppointments: 3, noShows: 0 })).toEqual({ reason: "future_appointments", limit: 3, current: 3 });
  });

  it("faltas: depois dos atendimentos; 0 desliga", () => {
    expect(evaluateBookingLimits(DEFAULT_BOT_LIMITS, { futureAppointments: 0, noShows: 2 })).toEqual({ reason: "no_shows", limit: 2, current: 2 });
    expect(evaluateBookingLimits(DEFAULT_BOT_LIMITS, { futureAppointments: 3, noShows: 5 })?.reason).toBe("future_appointments");
    expect(evaluateBookingLimits({ ...DEFAULT_BOT_LIMITS, maxNoShows: 0 }, { futureAppointments: 0, noShows: 9 })).toBeNull();
  });

  it("cadastros pelo bot", () => {
    expect(evaluateNewPatientLimit(DEFAULT_BOT_LIMITS, 2)).toBeNull();
    expect(evaluateNewPatientLimit(DEFAULT_BOT_LIMITS, 3)).toEqual({ reason: "new_patients", limit: 3, current: 3 });
  });

  it("texto para a equipe", () => {
    expect(describeBotLimitHit({ reason: "future_appointments", limit: 3, current: 3 })).toBe("3 atendimentos futuros (limite 3)");
    expect(describeBotLimitHit({ reason: "new_patients", limit: 1, current: 1 })).toBe("1 cadastro pelo bot em 30 dias (limite 1)");
    expect(describeBotLimitHit({ reason: "no_shows", limit: 2, current: 2 })).toBe("2 faltas em 90 dias (limite 2)");
  });
});
