import { describe, expect, it } from "vitest";
import { wasRebooked } from "./daily";

const canceled = { id: "x", patientId: "p", serviceId: "consulta", agendaId: "dra", category: "consultation" as const, canceledAt: new Date("2026-10-09T01:30:00Z") };
const later = (changes: Record<string, unknown> = {}) => ({
  id: "y",
  patientId: "p",
  serviceId: "consulta",
  agendaId: "dra",
  category: "consultation" as const,
  createdAt: new Date("2026-10-09T01:32:00Z"),
  ...changes,
});

describe("wasRebooked (Aguardando remarcação)", () => {
  it("marcado de novo depois do cancelamento, na mesma agenda (consulta ou retorno), sai", () => {
    expect(wasRebooked(canceled, [later()])).toBe(true);
    expect(wasRebooked(canceled, [later({ serviceId: "retorno", category: "return_visit" })])).toBe(true);
  });
  it("antes do cancelamento, outra agenda, outro paciente, exame ou o próprio não contam", () => {
    expect(wasRebooked(canceled, [later({ createdAt: new Date("2026-10-08T23:00:00Z") })])).toBe(false);
    expect(wasRebooked(canceled, [later({ agendaId: "outra" })])).toBe(false);
    expect(wasRebooked(canceled, [later({ patientId: "outro" })])).toBe(false);
    expect(wasRebooked(canceled, [later({ serviceId: "espiro", category: "exam" })])).toBe(false);
    expect(wasRebooked(canceled, [later({ id: "x" })])).toBe(false);
  });
  it("exame: só o mesmo exame", () => {
    const exam = { ...canceled, serviceId: "espiro", category: "exam" as const };
    expect(wasRebooked(exam, [later({ serviceId: "espiro", category: "exam", agendaId: "outra" })])).toBe(true);
    expect(wasRebooked(exam, [later({ serviceId: "outro", category: "exam" })])).toBe(false);
  });
});
