import { describe, expect, it } from "vitest";
import { parseSlot, slotValue } from "../../agendaSlot";
import { buildDayItems, isFrequentNoShow, itemAgendaId, monthGrid, weekStart, type AgendaAppointment } from "./view";

const at = (time: string) => new Date(`2031-03-10T${time}:00-03:00`);
const appointment = (overrides: Partial<AgendaAppointment>): AgendaAppointment => ({
  id: crypto.randomUUID(),
  agendaId: "agenda",
  agendaName: "Agenda",
  serviceId: "servico",
  serviceName: "Consulta",
  category: "consultation",
  locationName: "Consultório",
  isHomeVisit: false,
  homeVisitAddress: null,
  scheduledAt: at("08:00"),
  endsAt: at("08:30"),
  status: "scheduled",
  isGroupSession: false,
  seriesId: null,
  patientId: crypto.randomUUID(),
  patientName: "Paciente",
  contactName: "Contato",
  contactPhone: "+5584999990000",
  isContactSelf: false,
  patientConfirmedAt: null,
  reminderResponse: null,
  ...overrides,
});

describe("dia da agenda (F4.5)", () => {
  it("turma vira um item só por agenda, serviço e horário; tudo em ordem de horário", () => {
    const turma = { isGroupSession: true, serviceId: "turma", scheduledAt: at("07:00"), endsAt: at("08:00") };
    const items = buildDayItems(
      [appointment({ scheduledAt: at("09:00") }), appointment(turma), appointment(turma), appointment({ ...turma, agendaId: "outra" })],
      [{ id: "b", agendaId: "agenda", agendaName: "Agenda", startsAt: at("08:00"), endsAt: at("08:30"), reason: "Reunião", removedAt: null }],
    );
    expect(items.map((i) => i.kind)).toEqual(["group", "group", "block", "appointment"]);
    expect(items[0].kind === "group" && items[0].appointments).toHaveLength(2);
    // Colunas por agenda (cliente, 05/out): cada item sabe a sua agenda.
    expect(items.map(itemAgendaId)).toEqual(["agenda", "outra", "agenda", "agenda"]);
  });
});

describe("semana e mês", () => {
  it("a semana começa na segunda", () => {
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
    expect(weekStart("2026-10-07")).toBe("2026-10-05");
  });

  it("a grade do mês vai de segunda a domingo, cobrindo o mês todo", () => {
    const grid = monthGrid("2026-10-15");
    expect(grid).toMatchObject({ first: "2026-10-01", last: "2026-10-31" });
    expect(grid.days[0]).toBe("2026-09-28");
    expect(grid.days.at(-1)).toBe("2026-11-01");
    expect(grid.days.length % 7).toBe(0);
  });
});

it("faltoso: 2 ou mais faltas e em pelo menos metade dos registrados (regra do piloto)", () => {
  expect(isFrequentNoShow({ noShows: 1, total: 1 })).toBe(false);
  expect(isFrequentNoShow({ noShows: 2, total: 4 })).toBe(true);
  expect(isFrequentNoShow({ noShows: 2, total: 5 })).toBe(false);
});

it("horário escolhido: agenda, início e local num valor só", () => {
  const slot = { agendaId: crypto.randomUUID(), start: at("08:00"), locationId: crypto.randomUUID() };
  expect(parseSlot(slotValue(slot))).toEqual(slot);
  expect(parseSlot("x|2031-03-10T11:00:00.000Z|y")).toBeNull();
  expect(parseSlot(`${slot.agendaId}|amanhã|${slot.locationId}`)).toBeNull();
});
