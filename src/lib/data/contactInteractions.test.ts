import { describe, expect, it } from "vitest";
import { exitsList, outcomesFor, parseRegisterRequest, pendencyState, registerParams, type ContactInteraction, type InteractionOutcome } from "./contactInteractions";
import { applyContactLog, recallKey } from "./relationship";

const at = (iso: string) => new Date(`${iso}-03:00`);
let seq = 0;
const interaction = (outcome: InteractionOutcome, createdAt: Date, extra: Partial<ContactInteraction> = {}): ContactInteraction => ({
  id: `i${++seq}`,
  phone: "+5584999990001",
  contactId: null,
  patientId: null,
  source: "faltosos",
  appointmentId: null,
  sessionId: null,
  outcome,
  note: null,
  createdAt,
  createdBy: "u1",
  ...extra,
});

describe("opções e saída (Q7, Q8, Q10, Q11)", () => {
  it("7 opções; Lembretes e Aguardando remarcação sem \"Marcou\"", () => {
    expect(outcomesFor("faltosos")).toEqual(["scheduled", "link_sent", "call_back", "no_answer", "not_interested", "wrong_number", "other"]);
    expect(outcomesFor("lembretes")).not.toContain("scheduled");
    expect(outcomesFor("aguardando_remarcacao")).not.toContain("scheduled");
  });

  it("Marcou, Não quer e Número errado tiram; os outros mantêm", () => {
    for (const source of ["retomar_contato", "retorno", "faltosos"] as const) {
      expect((["scheduled", "not_interested", "wrong_number"] as const).every((o) => exitsList(source, o))).toBe(true);
      expect((["link_sent", "call_back", "no_answer", "other"] as const).some((o) => exitsList(source, o))).toBe(false);
    }
    expect(exitsList("lembretes", "wrong_number")).toBe(true);
    expect(exitsList("lembretes", "no_answer")).toBe(false);
    // Aguardando remarcação só sai ao remarcar ou com "Desistiu"; a ficha não é lista.
    expect(exitsList("aguardando_remarcacao", "not_interested")).toBe(false);
    expect(exitsList("ficha_paciente", "scheduled")).toBe(false);
  });

  it("a tentativa mais recente e quantas; sai se algum registro tirar", () => {
    const older = interaction("no_answer", at("2026-10-20T10:00:00"));
    const newer = interaction("call_back", at("2026-10-21T10:00:00"));
    expect(pendencyState("faltosos", [older, newer])).toEqual({ exits: false, log: { last: newer, attempts: 2 } });
    expect(pendencyState("faltosos", [older, interaction("not_interested", at("2026-10-19T10:00:00"))]).exits).toBe(true);
    expect(pendencyState("faltosos", [])).toEqual({ exits: false, log: null });
  });
});

describe("cada pendência e os registros dela", () => {
  it("Retomar contato: só os registros das tentativas do grupo, feitos depois da última; tentativa nova traz de volta", () => {
    const group = { phone: "+5584999990001", flowLabel: "Marcar consulta", sessionIds: ["s1", "s2"], latest: { startedAt: at("2026-10-20T10:00:00") } };
    const exit = interaction("not_interested", at("2026-10-20T11:00:00"), { sessionId: "s2" });
    const otherFlow = interaction("not_interested", at("2026-10-20T11:00:00"), { sessionId: "s9" });
    const belongs = (g: typeof group, i: ContactInteraction) => !!i.sessionId && g.sessionIds.includes(i.sessionId) && i.createdAt > g.latest.startedAt;
    expect(applyContactLog("retomar_contato", [group], recallKey, belongs, [otherFlow]).kept).toHaveLength(1);
    expect(applyContactLog("retomar_contato", [group], recallKey, belongs, [exit]).kept).toHaveLength(0);
    const again = { ...group, sessionIds: ["s1", "s2", "s3"], latest: { startedAt: at("2026-10-22T09:00:00") } };
    const { kept, log } = applyContactLog("retomar_contato", [again], recallKey, belongs, [exit]);
    expect(kept).toHaveLength(1);
    expect(log.size).toBe(0);
  });

  it("a linha que fica guarda a tentativa pela chave", () => {
    const items = [{ id: "a1" }, { id: "a2" }];
    const tries = [interaction("no_answer", at("2026-10-20T10:00:00"), { appointmentId: "a1", source: "lembretes" })];
    const { kept, log } = applyContactLog("lembretes", items, (a) => a.id, (a, i) => i.appointmentId === a.id, tries);
    expect(kept).toEqual(items);
    expect(log.get("a1")?.attempts).toBe(1);
    expect(log.has("a2")).toBe(false);
  });
});

describe("pedido da tela", () => {
  it("ida e volta pelo endereço; origem desconhecida ou ids estranhos ficam de fora", () => {
    const since = at("2026-10-20T10:00:00");
    const params = new URLSearchParams(registerParams({ source: "retorno", patientId: "0a000000-0000-4000-8000-000000000001", appointmentId: "0a000000-0000-4000-8000-000000000002", since }));
    expect(parseRegisterRequest((name) => params.get(name))).toEqual({
      source: "retorno",
      patientId: "0a000000-0000-4000-8000-000000000001",
      phone: null,
      sessionId: null,
      appointmentId: "0a000000-0000-4000-8000-000000000002",
      since,
    });
    expect(parseRegisterRequest((name) => (name === "origem" ? "atendimento" : null))).toBeNull();
    expect(parseRegisterRequest((name) => ({ origem: "faltosos", paciente: "1 or 1=1", desde: "ontem" })[name] ?? null)).toMatchObject({ patientId: null, since: null });
  });
});
