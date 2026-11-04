import { describe, expect, it } from "vitest";
import { todayGroup } from "./dashboard";

// C25 (cliente, 04/nov/2026, opção B): cada atendimento de hoje num grupo só.
describe("todayGroup", () => {
  const row = (status: Parameters<typeof todayGroup>[0]["status"], extra: Partial<Parameters<typeof todayGroup>[0]> = {}) =>
    todayGroup({ status, patient_confirmed_at: null, reminder_response: null, ...extra });

  it("já atendida e faltou valem mesmo com presença confirmada", () => {
    expect(row("completed", { patient_confirmed_at: "2026-11-04T10:00:00Z" })).toBe("completed");
    expect(row("no_show", { reminder_response: "confirmed" })).toBe("no_show");
  });

  it("confirmada pelo lembrete, pela recepção ou pelo status", () => {
    expect(row("scheduled", { reminder_response: "confirmed" })).toBe("confirmed");
    expect(row("scheduled", { patient_confirmed_at: "2026-11-04T10:00:00Z" })).toBe("confirmed");
    expect(row("confirmed")).toBe("confirmed");
  });

  it("o resto fica a confirmar (sem resposta ou sem lembrete)", () => {
    expect(row("scheduled")).toBe("to_confirm");
    expect(row("scheduled", { reminder_response: "reschedule" })).toBe("to_confirm");
  });
});
