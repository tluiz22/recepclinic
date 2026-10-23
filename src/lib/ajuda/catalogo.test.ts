import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITE_DICA, LIMITE_ITENS, textoDaDica, type ModuloDeAjuda } from "./tipos";

// Catálogo da ajuda contextual (23/out/2026): textos curtos, "Como funciona?"
// com no máximo 5 itens e nenhum texto esquecido (todo texto é usado em alguma tela).

const modules = import.meta.glob<Record<string, ModuloDeAjuda>>(["./*.ts", "!./*.test.ts", "!./tipos.ts"], { eager: true });

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return path.endsWith(join("lib", "ajuda")) ? [] : sources(path);
    return /\.(astro|ts)$/.test(name) && !name.endsWith(".test.ts") ? [readFileSync(path, "utf8")] : [];
  });
}

const code = sources(join(process.cwd(), "src")).join("\n");
const catalog = Object.values(modules).flatMap((exports) => Object.entries(exports));

describe("catálogo da ajuda contextual", () => {
  it("tem módulos", () => {
    expect(catalog.length).toBeGreaterThan(0);
  });

  for (const [name, mod] of catalog) {
    describe(name, () => {
      for (const [key, dica] of Object.entries(mod.dicas ?? {})) {
        it(`dica ${key}: até ${LIMITE_DICA} caracteres e usada numa tela`, () => {
          expect(textoDaDica(dica).length).toBeLessThanOrEqual(LIMITE_DICA);
          expect(code).toContain(`${name}.dicas.${key}`);
        });
      }
      for (const [key, topic] of Object.entries(mod.comoFunciona ?? {})) {
        it(`como funciona ${key}: até ${LIMITE_ITENS} itens curtos e usado numa tela`, () => {
          expect(topic.como.length).toBeGreaterThan(0);
          expect(topic.como.length).toBeLessThanOrEqual(LIMITE_ITENS);
          for (const text of [topic.serve, ...topic.como, topic.exemplo ?? "", topic.erro ?? ""]) {
            expect(text.length).toBeLessThanOrEqual(LIMITE_DICA);
          }
          expect(code).toContain(`${name}.comoFunciona.${key}`);
        });
      }
      for (const [key, empty] of Object.entries(mod.vazios ?? {})) {
        it(`lista vazia ${key}: título e texto, usada numa tela`, () => {
          expect(empty.titulo.length).toBeGreaterThan(0);
          expect(empty.texto.length).toBeLessThanOrEqual(LIMITE_DICA);
          expect(code).toContain(`${name}.vazios.${key}`);
        });
      }
    });
  }
});
