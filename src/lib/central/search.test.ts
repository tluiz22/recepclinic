import { describe, expect, it } from "vitest";
import { search } from "./search";
import type { Article, Faq } from "./types";

const base = { module: "x", where: "x", keywords: [], synonyms: [], related: [], order: 1, status: "published" as const, intro: "", category: "agenda" as const };
const cancelar: Article = { ...base, id: "cancelar", title: "Cancelar uma consulta", summary: "Como cancelar.", keywords: ["cancelamento"], intro: "No cartão do atendimento, use Cancelar." };
const bloquear: Article = { ...base, id: "bloquear", title: "Bloquear a agenda", summary: "Folgas e férias.", keywords: ["folga"], intro: "Nenhum horário do período é oferecido." };
const faq: Faq = { id: "f1", question: "Como desmarco um paciente?", answer: "Cancele pelo cartão do atendimento.", article: "cancelar", keywords: [] };

describe("busca da Central de Ajuda", () => {
  it("acha pelo título e pelo plural", () => {
    expect(search("cancelar consultas", [cancelar, bloquear], []).articles[0].item.id).toBe("cancelar");
  });
  it("sinônimo: desmarcar encontra cancelar", () => {
    expect(search("desmarcar consulta", [cancelar, bloquear], [faq]).articles.map((h) => h.item.id)).toContain("cancelar");
  });
  it("pergunta inteira e sem acento", () => {
    expect(search("Como faço para bloquear a agenda nas férias?", [cancelar, bloquear], []).articles[0].item.id).toBe("bloquear");
  });
  it("sem resultado e filtro por categoria", () => {
    expect(search("xyzabc", [cancelar], []).articles).toEqual([]);
    expect(search("cancelar", [cancelar], [], "pacientes").articles).toEqual([]);
  });
  it("devolve o trecho", () => {
    expect(search("cancelar", [cancelar], []).articles[0].snippet.toLowerCase()).toContain("cancelar");
  });
});
