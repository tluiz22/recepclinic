import { describe, expect, it } from "vitest";
import { ARTICLES, FAQS } from "./index";
import { search } from "./search";

// Buscas que a recepção realmente faz, contra o catálogo real: o primeiro resultado deve ser o artigo certo.
const CASES: [string, string][] = [
  ["Como marcar uma consulta?", "marcar-atendimento"],
  ["Como remarcar um paciente?", "remarcar-atendimento"],
  ["desmarcar consulta", "cancelar-atendimento"],
  ["Como bloquear a agenda?", "bloquear-agenda"],
  ["médico vai viajar", "bloquear-agenda"],
  ["como marcar recesso da clínica", "bloquear-agenda"],
  ["Como cadastrar um médico?", "config-profissionais"],
  ["Como configurar o WhatsApp?", "config-whatsapp"],
  ["Por que o bot não está realizando agendamentos?", "bot-nao-agenda"],
  ["cadastrar paciente novo", "cadastrar-paciente"],
  ["devolver ao bot", "atendimento-humano"],
  ["lembrete não enviado", "lembrete-nao-saiu"],
  ["por onde começo a configurar", "ordem-de-configuracao"],
  ["emitir nota fiscal", "emitir-nota-fiscal"],
  ["dar acesso para a secretária", "equipe-convidar"],
];

describe("busca no catálogo real", () => {
  for (const [query, expected] of CASES) {
    it(`"${query}" acha ${expected} entre os 3 primeiros`, () => {
      const ids = search(query, ARTICLES, FAQS).articles.slice(0, 3).map((h) => h.item.id);
      expect(ids).toContain(expected);
    });
  }
  it("sem resultado para texto sem sentido", () => {
    expect(search("zzqx kwpt", ARTICLES, FAQS).articles).toEqual([]);
  });
});
