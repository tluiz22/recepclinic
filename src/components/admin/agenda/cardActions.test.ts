import { describe, expect, it } from "vitest";
import { cardActions, type CardAction, type CardActionInput } from "./cardActions";
import { countSituations } from "./situationStyle";

const now = new Date("2026-10-23T15:00:00Z");
const future = new Date("2026-10-23T17:00:00Z");
const past = new Date("2026-10-23T12:00:00Z");

const input = (over: Partial<CardActionInput> = {}, appointment: Partial<CardActionInput["appointment"]> = {}): CardActionInput => ({
  appointment: { id: "a1", status: "scheduled", scheduledAt: future, patientConfirmedAt: null, reminderResponse: null, seriesId: null, ...appointment },
  now,
  who: "Ana Souza, 23/10 às 14:00",
  contact: "responsável",
  returnTo: "/admin/agenda?date=2026-10-23",
  preparationResendable: false,
  guidanceResendable: false,
  waitlistOn: true,
  onWaitlist: false,
  payment: "none",
  ...over,
});

const names = (list: CardAction[]) => list.map((x) => x.label);
const layout = (i: CardActionInput) => {
  const r = cardActions(i);
  return { primary: r.primary?.label, visible: names(r.visible), more: names(r.more), aside: r.aside?.label };
};

// Tabela "Quais ações ficam à vista, por situação" do canvas aprovado (15/out/2026).
describe("cardActions", () => {
  it("futuro, não confirmado: Confirmar presença cheia; Pagamento no Mais; Cancelar à parte", () => {
    expect(layout(input())).toEqual({
      primary: "Confirmar presença",
      visible: ["Remarcar"],
      more: ["Pagamento", "Pôr na lista de espera", "Trilha"],
      aside: "Cancelar",
    });
  });

  it("um sinal traz a ação que o resolve para a vista", () => {
    const r = layout(input({ reminderAction: "resend_unanswered", preparationResendable: true, guidanceResendable: true }));
    expect(r.visible).toEqual(["Reenviar lembrete", "Reenviar preparo", "Reenviar orientações", "Remarcar"]);
    expect(layout(input({ reminderAction: "send" })).visible).toEqual(["Enviar lembrete", "Remarcar"]);
  });

  it("futuro, presença confirmada: nada cheio; Remarcar e Pagamento à vista; Desfazer no Mais", () => {
    expect(layout(input({}, { patientConfirmedAt: past }))).toEqual({
      primary: undefined,
      visible: ["Remarcar", "Pagamento"],
      more: ["Desfazer presença", "Pôr na lista de espera", "Trilha"],
      aside: "Cancelar",
    });
  });

  it("confirmado pelo lembrete: Confirmar presença continua, mas no Mais", () => {
    const r = layout(input({}, { reminderResponse: "confirm" }));
    expect(r.primary).toBeUndefined();
    expect(r.more).toContain("Confirmar presença");
    expect(r.visible).toEqual(["Remarcar", "Pagamento"]);
  });

  it("já passou, sem registro: Compareceu cheio; Faltou e Pagamento à vista; sem Cancelar", () => {
    expect(layout(input({}, { scheduledAt: past }))).toEqual({
      primary: "Compareceu",
      visible: ["Faltou", "Pagamento"],
      more: ["Trilha"],
      aside: undefined,
    });
  });

  it("compareceu: Pagamento à vista; Corrigir: faltou no Mais", () => {
    expect(layout(input({}, { scheduledAt: past, status: "completed" }))).toEqual({
      primary: undefined,
      visible: ["Pagamento"],
      more: ["Corrigir: faltou", "Trilha"],
      aside: undefined,
    });
  });

  it("faltou: nada à vista; Corrigir: compareceu no Mais", () => {
    expect(layout(input({}, { scheduledAt: past, status: "no_show" }))).toEqual({
      primary: undefined,
      visible: [],
      more: ["Corrigir: compareceu", "Trilha"],
      aside: undefined,
    });
  });

  it("cancelado: só a Trilha, à vista", () => {
    expect(layout(input({}, { status: "canceled" }))).toEqual({ primary: undefined, visible: ["Trilha"], more: [], aside: undefined });
  });

  it("sessão de série futura: Ver série e Encerrar no Mais; Cancelar só esta à parte; sem lista de espera", () => {
    const r = layout(input({}, { seriesId: "s1" }));
    expect(r.more).toEqual(["Pagamento", "Ver série", "Trilha", "Encerrar a série"]);
    expect(r.aside).toBe("Cancelar só esta");
  });

  it("sem o módulo financeiro, nunca há Pagamento", () => {
    for (const appointment of [{}, { patientConfirmedAt: past }, { scheduledAt: past }, { scheduledAt: past, status: "completed" as const }]) {
      const r = layout(input({ payment: undefined }, appointment));
      expect([...r.visible, ...r.more]).not.toContain("Pagamento");
    }
  });

  it("na lista de espera: Tirar da lista, em vermelho, no Mais", () => {
    const r = cardActions(input({ onWaitlist: true }));
    const out = r.more.find((x) => x.label === "Tirar da lista de espera");
    expect(out).toMatchObject({ kind: "form", acao: "sair_lista_espera", danger: true });
  });

  it("toda ação de formulário leva o texto da confirmação e a ação de antes", () => {
    const all = [input(), input({}, { scheduledAt: past }), input({}, { seriesId: "s1" }), input({ reminderAction: "resend" })].flatMap((i) => {
      const r = cardActions(i);
      return [r.primary, ...r.visible, ...r.more, r.aside].filter((x): x is CardAction => x !== undefined);
    });
    const forms = all.filter((x) => x.kind === "form");
    expect(new Set(forms.map((x) => x.acao))).toEqual(
      new Set(["confirmar_presenca", "entrar_lista_espera", "cancelar", "compareceu", "faltou", "encerrar_serie", "lembrete"]),
    );
    for (const f of forms) {
      expect(f.title).toBeTruthy();
      expect(f.message).toContain("Ana Souza");
      expect(f.confirm).toBeTruthy();
    }
  });

  it("os links voltam para a tela de onde saíram", () => {
    const r = cardActions(input({}, { seriesId: "s1" }));
    const links = [...r.visible, ...r.more].filter((x) => x.kind === "link");
    for (const link of links) expect(decodeURIComponent(link.href)).toContain("/admin/agenda?date=2026-10-23");
  });
});

describe("countSituations", () => {
  it("conta cada situação do dia e os bloqueios", () => {
    const base = { status: "scheduled" as const, patientConfirmedAt: null, reminderResponse: null };
    const counts = countSituations(
      [base, base, { ...base, reminderResponse: "confirm" }, { ...base, status: "completed" }, { ...base, status: "no_show" }, { ...base, status: "canceled" }],
      2,
    );
    expect(counts).toEqual({ pending: 2, confirmed: 1, attended: 1, no_show: 1, canceled: 1, block: 2 });
  });
});
