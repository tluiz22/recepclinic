import { beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../clients";
import { clearKnowledgeCache, publishedKnowledge } from "./published";

// BC 3.2 — cache da base publicada: confere a versão a cada uso e só relê o
// conteúdo quando ela muda.
type Row = { version: number; content: unknown };

function fakeDb(rows: Row[]) {
  const reads = { version: 0, content: 0 };
  const db = {
    from(table: string) {
      expect(table).toBe("kb_publications");
      let columns = "";
      let version: number | null = null;
      const query = {
        select(cols: string) {
          columns = cols;
          return query;
        },
        order() {
          return query;
        },
        eq(_column: string, value: number) {
          version = value;
          return query;
        },
        limit() {
          if (columns === "version") {
            reads.version += 1;
            const latest = [...rows].sort((a, b) => b.version - a.version)[0];
            return Promise.resolve({ data: latest ? [{ version: latest.version }] : [], error: null });
          }
          reads.content += 1;
          return Promise.resolve({ data: rows.filter((r) => r.version === version), error: null });
        },
      };
      return query;
    },
  };
  return { db: db as unknown as DbClient, reads, rows };
}

const content = (code: string) => ({
  entries: [{ code, category: "general", question: "Oi", keywords: ["oi"], answerType: "fixed", template: "Olá!", sources: [], flow: null, requiredTerm: null, offersReception: false, synonyms: [] }],
  specialties: [],
  clinicalTerms: [],
});

beforeEach(() => clearKnowledgeCache());

describe("base publicada", () => {
  it("nada publicado: null", async () => {
    const { db } = fakeDb([]);
    expect(await publishedKnowledge(db)).toBeNull();
  });

  it("mesma versão: usa o cache e só confere a versão", async () => {
    const { db, reads } = fakeDb([{ version: 1, content: content("G2") }]);
    const first = await publishedKnowledge(db);
    const second = await publishedKnowledge(db);
    expect(second).toBe(first);
    expect(reads).toEqual({ version: 2, content: 1 });
  });

  it("publicação nova: troca o conteúdo na hora", async () => {
    const fake = fakeDb([{ version: 1, content: content("G2") }]);
    expect((await publishedKnowledge(fake.db))!.entries.map((e) => e.entry.code)).toEqual(["G2"]);
    fake.rows.push({ version: 2, content: content("G1") });
    const next = await publishedKnowledge(fake.db);
    expect(next!.version).toBe(2);
    expect(next!.entries.map((e) => e.entry.code)).toEqual(["G1"]);
    expect(fake.reads.content).toBe(2);
  });
});
