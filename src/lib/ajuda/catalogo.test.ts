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
const isModule = (value: unknown): value is ModuloDeAjuda =>
  typeof value === "object" && value !== null && ("dicas" in value || "comoFunciona" in value || "vazios" in value);
// O texto conta como usado se o arquivo do módulo é importado e a chave aparece (o import pode ter outro nome).
const catalog = Object.entries(modules).flatMap(([path, exports]) =>
  Object.entries(exports)
    .filter((entry): entry is [string, ModuloDeAjuda] => isModule(entry[1]))
    .map(([name, mod]) => ({ name, mod, file: path.replace(/^\.\//, "").replace(/\.ts$/, "") })),
);
const used = (file: string, ref: string) => code.includes(`lib/ajuda/${file}"`) && code.includes(ref);

describe("catálogo da ajuda contextual", () => {
  it("tem módulos", () => {
    expect(catalog.length).toBeGreaterThan(0);
  });

  for (const { name, mod, file } of catalog) {
    describe(name, () => {
      for (const [key, dica] of Object.entries(mod.dicas ?? {})) {
        it(`dica ${key}: até ${LIMITE_DICA} caracteres e usada numa tela`, () => {
          expect(textoDaDica(dica).length).toBeLessThanOrEqual(LIMITE_DICA);
          expect(used(file, `.dicas.${key}`)).toBe(true);
        });
      }
      for (const [key, topic] of Object.entries(mod.comoFunciona ?? {})) {
        it(`como funciona ${key}: até ${LIMITE_ITENS} itens curtos e usado numa tela`, () => {
          expect(topic.como.length).toBeGreaterThan(0);
          expect(topic.como.length).toBeLessThanOrEqual(LIMITE_ITENS);
          for (const text of [topic.serve, ...topic.como, topic.exemplo ?? "", topic.erro ?? ""]) {
            expect(text.length).toBeLessThanOrEqual(LIMITE_DICA);
          }
          expect(used(file, `.comoFunciona.${key}`)).toBe(true);
        });
      }
      for (const [key, empty] of Object.entries(mod.vazios ?? {})) {
        it(`lista vazia ${key}: título e texto, usada numa tela`, () => {
          expect(empty.titulo.length).toBeGreaterThan(0);
          expect(empty.texto.length).toBeLessThanOrEqual(LIMITE_DICA);
          expect(used(file, `.vazios.${key}`)).toBe(true);
        });
      }
    });
  }
});
