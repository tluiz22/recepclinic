import { describe, expect, it } from "vitest";
import type { DbClient } from "./clients";
import { loadRelationshipLists, menuTotal, pendingReminderKind, relationshipCounts, relationshipTabs, type RelationshipTab } from "./relationship";

// Central de Relacionamento (CRM A1): abas por item, regra dos lembretes,
// contadores = tamanho da lista e falha isolada (seção 13.4 do plano).

describe("abas da central", () => {
  it("Aguardando remarcação sempre; Lembretes e Lista de espera com o item da lista de origem", () => {
    expect(relationshipTabs(["relationship"])).toEqual(["aguardando_remarcacao"]);
    expect(relationshipTabs(["relationship", "reminders"])).toEqual(["aguardando_remarcacao", "lembretes"]);
    expect(relationshipTabs(["relationship", "reminders", "waitlist", "whatsapp_bot"])).toEqual(["aguardando_remarcacao", "lembretes", "lista_espera"]);
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

  it("o menu soma Aguardando remarcação e Lembretes; a Lista de espera não entra; falha não soma", () => {
    expect(menuTotal({ aguardando_remarcacao: 2, lembretes: 3, lista_espera: 7 })).toBe(5);
    expect(menuTotal({ aguardando_remarcacao: 2, lembretes: null })).toBe(2);
    expect(menuTotal({})).toBe(0);
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
    const lists = await loadRelationshipLists(fakeDb("whatsapp_messages"), "c", ["aguardando_remarcacao", "lembretes", "lista_espera"], (tab) => errors.push(tab));
    expect(errors).toEqual(["lembretes"]);
    expect(relationshipCounts(lists)).toEqual({ aguardando_remarcacao: 0, lembretes: null, lista_espera: 0 });
  });

  it("só lê as abas pedidas", async () => {
    const lists = await loadRelationshipLists(fakeDb("nenhuma"), "c", ["aguardando_remarcacao"], () => {});
    expect(Object.keys(lists)).toEqual(["aguardando_remarcacao"]);
  });
});
