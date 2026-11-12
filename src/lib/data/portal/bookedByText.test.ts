import { describe, expect, it } from "vitest";
import { bookedByText } from "./myAppointments";

// "Marcada por …" em Minhas consultas (UI-4, D14): o número do próprio paciente vira "pelo próprio paciente".
const bookers = {
  sessionContactId: "mae",
  labels: new Map([["joao", new Map([["mae", "Ana (mãe)"], ["joao-cel", "o próprio paciente"]])]]),
};

describe("bookedByText", () => {
  it("marcada pelo número do próprio paciente: 'pelo próprio paciente'", () => {
    expect(bookedByText({ patient_id: "joao", booked_by_contact_id: "joao-cel", booking_channel: "portal" }, bookers)).toBe(
      "Marcada pelo próprio paciente, que recebe os avisos",
    );
  });

  it("pela recepção com avisos para o próprio paciente", () => {
    expect(bookedByText({ patient_id: "joao", booked_by_contact_id: "joao-cel", booking_channel: "admin" }, bookers)).toBe(
      "Marcada pela recepção, com avisos para o próprio paciente",
    );
  });

  it("pela sessão: 'Marcada por você'", () => {
    expect(bookedByText({ patient_id: "joao", booked_by_contact_id: "mae", booking_channel: "portal" }, bookers)).toBe("Marcada por você");
  });
});
