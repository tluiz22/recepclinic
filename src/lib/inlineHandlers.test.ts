import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A CSP do site (script-src com hashes) bloqueia eventos escritos no HTML
// (onclick="…"): no local funciona, no staging e na produção o botão não faz
// nada (caso do "Imprimir ou salvar em PDF" do contrato, 07/nov/2026). Os
// eventos ficam em <script>, com addEventListener.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".astro") ? [path] : [];
  });
}

describe("eventos no HTML", () => {
  it("nenhuma página ou componente usa onclick, onchange etc. no HTML", () => {
    const offenders = files("src").filter((path) => /\son[a-z]+=["{]/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
