import { describe, expect, it } from "vitest";
import { appointmentSituation } from "./situationStyle";

const base = { status: "scheduled" as const, patientConfirmedAt: null, reminderResponse: null };

describe("appointmentSituation", () => {
  it("marcado sem confirmação é pendente", () => {
    expect(appointmentSituation(base)).toBe("pending");
    expect(appointmentSituation({ ...base, reminderResponse: "reschedule" })).toBe("pending");
  });
  it("presença confirmada ou confirmada pelo lembrete é confirmado", () => {
    expect(appointmentSituation({ ...base, patientConfirmedAt: new Date() })).toBe("confirmed");
    expect(appointmentSituation({ ...base, reminderResponse: "confirm" })).toBe("confirmed");
  });
  it("cancelado, compareceu e faltou vêm da situação do atendimento", () => {
    expect(appointmentSituation({ ...base, status: "canceled", patientConfirmedAt: new Date() })).toBe("canceled");
    expect(appointmentSituation({ ...base, status: "completed" })).toBe("attended");
    expect(appointmentSituation({ ...base, status: "no_show" })).toBe("no_show");
  });
});
