import { describe, expect, it } from "vitest";
import { joinBlockReason } from "./entries";

const now = new Date("2031-03-09T15:00:00Z");
const future = new Date("2031-03-10T11:00:00Z");

describe("quem pode entrar na lista de espera", () => {
  it("atendimento marcado ou confirmado, no futuro e fora de série entra", () => {
    expect(joinBlockReason({ status: "scheduled", scheduledAt: future, seriesId: null }, now)).toBeNull();
    expect(joinBlockReason({ status: "confirmed", scheduledAt: future, seriesId: null }, now)).toBeNull();
  });

  it("cancelado, realizado ou falta não entra", () => {
    for (const status of ["canceled", "completed", "no_show"] as const) {
      expect(joinBlockReason({ status, scheduledAt: future, seriesId: null }, now)).toMatch(/marcado ou confirmado/);
    }
  });

  it("atendimento que já passou (ou começa agora) não entra", () => {
    expect(joinBlockReason({ status: "scheduled", scheduledAt: now, seriesId: null }, now)).toMatch(/já passou/);
  });

  it("sessão de série não entra (D9)", () => {
    expect(joinBlockReason({ status: "scheduled", scheduledAt: future, seriesId: "serie" }, now)).toMatch(/série/);
  });
});
