import { describe, expect, it } from "vitest";
import { filterConversations, type ConversationSummary } from "./central";

const item = (phone: string, over: Partial<ConversationSummary>) =>
  ({ phone, open: true, status: "in_progress", statusAt: null, lastMessageAt: null, assignedTo: null, ...over }) as ConversationSummary;

describe("filterConversations (F5b)", () => {
  const a = item("a", { status: "waiting_clinic", statusAt: new Date("2026-11-12T10:00:00Z") });
  const b = item("b", { status: "waiting_clinic", statusAt: new Date("2026-11-12T09:00:00Z") });
  const c = item("c", { lastMessageAt: new Date("2026-11-12T11:00:00Z"), assignedTo: "u1" });
  const d = item("d", { lastMessageAt: new Date("2026-11-12T12:00:00Z") });
  it("aguardando primeiro (a mais antiga), depois pela última mensagem", () => {
    expect(filterConversations([c, d, a, b], "todas", "u1").map((i) => i.phone)).toEqual(["b", "a", "d", "c"]);
  });
  it("Aguardando mostra só as que esperam; Minhas só as da pessoa", () => {
    expect(filterConversations([c, d, a, b], "aguardando", "u1").map((i) => i.phone)).toEqual(["b", "a"]);
    expect(filterConversations([c, d, a, b], "minhas", "u1").map((i) => i.phone)).toEqual(["c"]);
  });
});

import { usualFromRows } from "./centralPanel";
describe("usualFromRows (F5b)", () => {
  const row = (agendaId: string, day: number, category = "consultation") => ({ agendaId, agendaName: agendaId, serviceId: "s", serviceName: "S", category, at: new Date(2026, 9, day) });
  it("uma linha por agenda, da mais recente, sem exames, até 3", () => {
    const r = usualFromRows([row("a", 1), row("b", 5), row("a", 9), row("c", 3, "exam"), row("d", 2), row("e", 1)]);
    expect(r.map((x) => x.agendaId)).toEqual(["a", "b", "d"]);
  });
});
