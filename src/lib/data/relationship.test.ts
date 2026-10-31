import { describe, expect, it } from "vitest";
import type { DbClient } from "./clients";
import type { Incomplete } from "./botFunnel";
import { groupRecall, loadRelationshipLists, menuTotal, pendingReminderKind, relationshipCounts, relationshipTabs, withoutDismissed, type RelationshipTab } from "./relationship";

// Central de Relacionamento (CRM A1): abas por item, regra dos lembretes,
// contadores = tamanho da lista e falha isolada (seção 13.4 do plano).

describe("abas da central", () => {
  it("Retorno, Lembretes da equipe, Aguardando remarcação e Faltosos sempre (sem os itens das Métricas); as outras com o item da lista de origem", () => {
    expect(relationshipTabs(["relationship"])).toEqual(["retorno", "lembretes_equipe", "aguardando_remarcacao", "faltosos"]);
    expect(relationshipTabs(["relationship", "reminders"])).toEqual(["retorno", "lembretes", "lembretes_equipe", "aguardando_remarcacao", "faltosos"]);
    expect(relationshipTabs(["relationship", "whatsapp_bot"])).toEqual(["atendimento", "retomar_contato", "retorno", "lembretes_equipe", "aguardando_remarcacao", "faltosos", "revisar"]);
    expect(relationshipTabs(["relationship", "reminders", "waitlist", "whatsapp_bot"])).toEqual([
      "atendimento",
      "retomar_contato",
      "retorno",
      "lembretes",
      "lembretes_equipe",
      "aguardando_remarcacao",
      "faltosos",
      "lista_espera",
      "revisar",
    ]);
  });
});

describe("lembretes que pedem ação (Q4)", () => {
  it("o sinal do cartão da Agenda: reenviar = não entregue; reenviar sem resposta = sem resposta; o resto não entra", () => {
    expect(pendingReminderKind("resend")).toBe("not_delivered");
    expect(pendingReminderKind("resend_unanswered")).toBe("no_answer");
    expect(pendingReminderKind("send")).toBeNull();
    expect(pendingReminderKind(undefined)).toBeNull();
  });
});

describe("contadores", () => {
  it("contador = linhas da lista; leitura que falhou fica null, nunca 0", () => {
    const counts = relationshipCounts({ aguardando_remarcacao: [{}, {}] as never, lembretes: null, lista_espera: [] });
    expect(counts).toEqual({ aguardando_remarcacao: 2, lembretes: null, lista_espera: 0 });
  });

  it("o menu soma as pendências com saída; Faltosos, Atendimento e Lista de espera não entram; falha não soma (cliente, 27/out)", () => {
    expect(menuTotal({ aguardando_remarcacao: 2, lembretes: 3, lembretes_equipe: 6, retomar_contato: 4, retorno: 5, revisar: 1, faltosos: 9, atendimento: 8, lista_espera: 7 })).toBe(17);
    expect(menuTotal({ aguardando_remarcacao: 2, lembretes: null })).toBe(2);
    expect(menuTotal({})).toBe(0);
  });

  it("no Atendimento, o contador é o das conversas que aguardam a clínica", () => {
    const item = (status: string) => ({ status }) as never;
    expect(relationshipCounts({ atendimento: [item("waiting"), item("in_progress"), item("waiting")] })).toEqual({ atendimento: 2 });
  });
});

describe("Retomar contato agrupado (telefone e fluxo)", () => {
  const attempt = (phone: string, flowLabel: string, day: number, contactId: string | null = null): Incomplete => ({
    sessionId: `${phone}-${flowLabel}-${day}`,
    flowLabel,
    phone,
    contactId,
    startedAt: new Date(Date.UTC(2031, 2, day, 12)),
    lastStage: `etapa ${day}`,
    detail: "",
  });

  it("3 tentativas do mesmo número e fluxo = 1 linha com a mais recente; fluxos diferentes = linhas diferentes", () => {
    const groups = groupRecall([
      attempt("+5584999990001", "Marcar consulta", 3),
      attempt("+5584999990001", "Marcar consulta", 5, "c1"),
      attempt("+5584999990001", "Marcar consulta", 4),
      attempt("+5584999990001", "Remarcar", 2),
      attempt("+5584999990002", "Marcar consulta", 1),
    ]);
    expect(groups.map((g) => [g.phone, g.flowLabel, g.attempts, g.latest.lastStage, g.contactId])).toEqual([
      ["+5584999990001", "Marcar consulta", 3, "etapa 5", "c1"],
      ["+5584999990001", "Remarcar", 1, "etapa 2", null],
      ["+5584999990002", "Marcar consulta", 1, "etapa 1", null],
    ]);
  });

  it("o contato vem de qualquer tentativa do grupo (a mais nova pode não ter cadastro)", () => {
    const [group] = groupRecall([attempt("+5584999990003", "Marcar exame", 1, "c9"), attempt("+5584999990003", "Marcar exame", 2)]);
    expect(group.contactId).toBe("c9");
    expect(group.latest.lastStage).toBe("etapa 2");
  });

  it("retirado da lista: some até a hora em que foi retirado; uma tentativa nova volta (cliente, 31/out/2026)", () => {
    const dismissals = new Map([["+5584999990001:Marcar consulta", new Date(Date.UTC(2031, 2, 4, 18))]]);
    const left = withoutDismissed(
      [
        attempt("+5584999990001", "Marcar consulta", 3),
        attempt("+5584999990001", "Marcar consulta", 4),
        attempt("+5584999990001", "Remarcar", 2),
        attempt("+5584999990002", "Marcar consulta", 1),
      ],
      dismissals,
    );
    expect(left.map((x) => `${x.phone} ${x.flowLabel} ${x.lastStage}`)).toEqual(["+5584999990001 Remarcar etapa 2", "+5584999990002 Marcar consulta etapa 1"]);
    const back = groupRecall(withoutDismissed([attempt("+5584999990001", "Marcar consulta", 3), attempt("+5584999990001", "Marcar consulta", 6)], dismissals));
    expect(back.map((g) => [g.attempts, g.latest.lastStage])).toEqual([[1, "etapa 6"]]);
  });
});

/** Banco falso: toda consulta devolve lista vazia, menos a tabela que falha. */
function fakeDb(failing: string): DbClient {
  const query = (table: string): unknown =>
    new Proxy(
      {},
      {
        get: (_, prop) =>
          prop === "then"
            ? (resolve: (value: unknown) => void) =>
                resolve(table === failing ? { data: null, error: { message: "falhou" } } : { data: [], error: null, count: 0 })
            : () => query(table),
      },
    );
  return { from: (table: string) => query(table), rpc: () => query("rpc") } as unknown as DbClient;
}

describe("falha isolada de uma fonte", () => {
  it("a lista que falha vira null e é avisada; as outras abas continuam", async () => {
    const errors: RelationshipTab[] = [];
    const lists = await loadRelationshipLists(fakeDb("whatsapp_messages"), "c", ["aguardando_remarcacao", "lembretes", "lista_espera", "faltosos"], (tab) => errors.push(tab), {
      timeZone: "America/Fortaleza",
    });
    expect(errors).toEqual(["lembretes"]);
    expect(relationshipCounts(lists)).toEqual({ aguardando_remarcacao: 0, lembretes: null, lista_espera: 0, faltosos: 0 });
  });

  it("só lê as abas pedidas", async () => {
    const lists = await loadRelationshipLists(fakeDb("nenhuma"), "c", ["aguardando_remarcacao"], () => {}, { timeZone: "America/Fortaleza" });
    expect(Object.keys(lists)).toEqual(["aguardando_remarcacao"]);
  });
});
