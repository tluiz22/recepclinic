import { isUuid } from "./clinicAccess";

// Horário escolhido no Marcar e no Remarcar (F4.5): a agenda, o início e o
// local num valor só ("agendaId|2026-10-06T11:00:00.000Z|locationId"), porque
// no "primeiro horário disponível" cada horário pode ser de uma agenda.

export type SlotChoice = { agendaId: string; start: Date; locationId: string };

export function slotValue(slot: SlotChoice): string {
  return `${slot.agendaId}|${slot.start.toISOString()}|${slot.locationId}`;
}

export function parseSlot(value: string): SlotChoice | null {
  const [agendaId, iso, locationId] = value.split("|");
  const start = new Date(iso ?? "");
  if (!isUuid(agendaId) || !isUuid(locationId) || Number.isNaN(start.getTime())) return null;
  return { agendaId, start, locationId };
}
