import { describe, expect, it } from "vitest";
import { professionalDayRows, todayGroup } from "./dashboard";

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

// F5b (cliente, 12/nov/2026): tabela "Por profissional" do Meu dia.
describe("professionalDayRows", () => {
  const agendas = [
    { id: "b", name: "Dr. Paulo", specialty: "Cardiologia" },
    { id: "a", name: "Dra. Ana", specialty: null },
  ];
  const appt = (agenda_id: string, status: "scheduled" | "confirmed" | "canceled" | "completed", extra = {}) => ({
    agenda_id,
    status,
    patient_confirmed_at: null,
    reminder_response: null,
    ...extra,
  });

  it("conta atendimentos, a confirmar e cancelados de hoje por agenda", () => {
    const rows = professionalDayRows(agendas, [appt("a", "scheduled"), appt("a", "confirmed"), appt("a", "canceled"), appt("b", "completed")], []);
    expect(rows.find((r) => r.agendaId === "a")).toMatchObject({ today: 2, toConfirm: 1, canceled: 1 });
    expect(rows.find((r) => r.agendaId === "b")).toMatchObject({ today: 1, toConfirm: 0, canceled: 0 });
  });

  it("soma as datas a conferir na agenda da consulta e ignora agenda desconhecida", () => {
    const rows = professionalDayRows(agendas, [appt("zzz", "scheduled")], ["b", "b", "a", "zzz"]);
    expect(rows.map((r) => [r.agendaId, r.toCheck, r.today])).toEqual([["b", 2, 0], ["a", 1, 0]]);
  });

  it("ordena por nome e mantém quem está sem nada com zeros", () => {
    const rows = professionalDayRows(agendas, [], []);
    expect(rows.map((r) => r.name)).toEqual(["Dr. Paulo", "Dra. Ana"].sort((x, y) => x.localeCompare(y, "pt-BR")));
    expect(rows[0]).toMatchObject({ today: 0, toConfirm: 0, canceled: 0, toCheck: 0 });
  });
});
