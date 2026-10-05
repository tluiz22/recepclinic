import { describe, expect, it } from "vitest";
import { checkOpeningSlot, pickCandidate, type QueueEntry } from "./offers";

const t = (hhmm: string) => new Date(`2031-03-10T${hhmm}:00-03:00`);
const office = "office";
const office2 = "office2";
const home = "home";
const isHome = (id: string) => id === home;
const clinicLike = (id: string) => !isHome(id);

describe("a vaga ainda vale?", () => {
  const slot = { start: t("10:00"), locationId: office };
  const earliestUseful = t("08:00");

  it("horário ainda livre e nada útil antes: oferece", () => {
    expect(checkOpeningSlot([{ start: t("10:00"), locationId: office }, { start: t("10:30"), locationId: office }], slot, earliestUseful, clinicLike)).toBe("ok");
  });

  it("horário livre antes da vaga, em consultório: encerra (oferecer não ajudaria)", () => {
    const free = [{ start: t("09:00"), locationId: office2 }, { start: t("10:00"), locationId: office }];
    expect(checkOpeningSlot(free, slot, earliestUseful, clinicLike)).toBe("earlier_free");
  });

  it("livre antes, mas só no domiciliar ou antes do mínimo de 2h, não conta", () => {
    const free = [
      { start: t("08:00"), locationId: office },
      { start: t("09:00"), locationId: home },
      { start: t("10:00"), locationId: office },
    ];
    expect(checkOpeningSlot(free, slot, earliestUseful, clinicLike)).toBe("ok");
  });

  it("o horário já foi ocupado, ou está livre só em outro local: encerra", () => {
    expect(checkOpeningSlot([{ start: t("10:30"), locationId: office }], slot, earliestUseful, clinicLike)).toBe("slot_unavailable");
    expect(checkOpeningSlot([{ start: t("10:00"), locationId: office2 }], slot, earliestUseful, clinicLike)).toBe("slot_unavailable");
  });
});

describe("próximo da fila", () => {
  const entry = (id: string, extra: Partial<QueueEntry> = {}): QueueEntry => ({
    entryId: id,
    appointmentId: `a-${id}`,
    appointmentStatus: "scheduled",
    scheduledAt: t("15:00"),
    agendaId: "agenda",
    serviceId: "consulta",
    isHomeVisit: false,
    ...extra,
  });
  const opening = { openedByAppointmentId: "a-source", agendaId: "agenda", serviceId: "consulta", slotStart: t("10:00"), slotIsHomeVisit: false };

  it("o primeiro a entrar recebe", () => {
    expect(pickCandidate([entry("1"), entry("2")], opening, new Set())?.entryId).toBe("1");
  });

  it("pula quem já recebeu esta vaga, quem abriu a vaga e atendimento que não está ativo", () => {
    const queue = [entry("1"), entry("source", { appointmentId: "a-source" }), entry("3", { appointmentStatus: "canceled" }), entry("4")];
    expect(pickCandidate(queue, opening, new Set(["1"]))?.entryId).toBe("4");
  });

  it("só mesma agenda e mesmo serviço (D2)", () => {
    const queue = [entry("1", { agendaId: "outra" }), entry("2", { serviceId: "retorno" }), entry("3")];
    expect(pickCandidate(queue, opening, new Set())?.entryId).toBe("3");
  });

  it("só quem está marcado depois da vaga e no mesmo tipo de local", () => {
    const queue = [entry("1", { scheduledAt: t("10:00") }), entry("2", { isHomeVisit: true }), entry("3")];
    expect(pickCandidate(queue, opening, new Set())?.entryId).toBe("3");
    expect(pickCandidate(queue, { ...opening, slotIsHomeVisit: true }, new Set())?.entryId).toBe("2");
  });

  it("ninguém serve: null", () => {
    expect(pickCandidate([entry("1", { scheduledAt: t("09:00") })], opening, new Set())).toBeNull();
  });
});
