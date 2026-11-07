import { describe, expect, it } from "vitest";
import { describeHandoffEvent, finishedText, type HandoffEvent } from "./centralPanel";

const event = (over: Partial<HandoffEvent>): HandoffEvent => ({
  kind: "status",
  from: "bot",
  to: "waiting_clinic",
  origin: "bot",
  actorId: null,
  assignedFrom: null,
  assignedTo: null,
  handoffId: null,
  at: new Date("2026-11-05T12:00:00Z"),
  ...over,
});
const names = new Map([
  ["u1", "Ana"],
  ["u2", "Paulo"],
]);

describe("eventos do atendimento na conversa (CN3b)", () => {
  it("encaminhada, assumiu, transferida, liberada; o vaivém da situação não aparece", () => {
    expect(describeHandoffEvent(event({}), names)).toBe("Encaminhada à recepção");
    expect(describeHandoffEvent(event({ from: "in_progress" }), names)).toBeNull();
    expect(describeHandoffEvent(event({ kind: "assigned", assignedTo: "u1" }), names)).toBe("Ana assumiu a conversa");
    expect(describeHandoffEvent(event({ kind: "transferred", assignedFrom: "u1", assignedTo: "u2" }), names)).toBe("Transferida de Ana para Paulo");
    expect(describeHandoffEvent(event({ kind: "released" }), names)).toContain("30 min");
  });

  it("finalizado por alguém, em 12 h ou pelo app", () => {
    expect(finishedText(event({ kind: "finished", origin: "reception", actorId: "u1" }), names)).toBe("Atendimento finalizado por Ana");
    expect(finishedText(event({ kind: "finished", origin: "system" }), names)).toBe("Atendimento encerrado: 12 h sem mensagem");
    expect(finishedText(event({ kind: "finished", origin: "reception" }), names)).toBe("Atendimento finalizado pelo app do WhatsApp");
  });
});
