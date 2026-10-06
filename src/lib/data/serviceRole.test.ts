import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A service role ignora o RLS (D1). No código novo ela só aparece em
// src/lib/data/platform.ts; o código herdado do piloto sai da lista conforme
// cada caminho passa para a credencial limitada. Arquivo novo usando a
// service role faz este teste falhar.

const ROOT = join(import.meta.dirname, "../../..");
const SERVICE_ROLE = /SUPABASE_SERVICE_ROLE_KEY|supabaseServiceRoleKey|supabase\/service["']/;

const ALLOWED = new Set([
  "src/env.d.ts",
  "src/lib/env.ts",
  "src/lib/env.test.ts",
  "src/lib/data/platform.ts",
  "src/lib/data/serviceRole.test.ts",
]);

// Herdado do piloto, com a etapa em que sai.
const LEGACY = new Map([
  ["src/lib/supabase/service.ts", "sai com o último caminho abaixo"],
  ["src/pages/api/cron/appointment-reminders.ts", "F7 (envios automáticos)"],
  ["src/pages/api/cron/daily-summary.ts", "F7 (envios automáticos)"],
  ["src/pages/api/cron/waitlist-offers.ts", "F7 (envios automáticos)"],
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|astro|tsx|js|mjs)$/.test(entry.name) ? [relative(ROOT, path)] : [];
  });
}

describe("service role só onde é permitido (D1)", () => {
  const using = sourceFiles(join(ROOT, "src")).filter((file) => SERVICE_ROLE.test(readFileSync(join(ROOT, file), "utf8")));

  it("nenhum arquivo novo usa a service role", () => {
    expect(using.filter((file) => !ALLOWED.has(file) && !LEGACY.has(file))).toEqual([]);
  });

  it("a lista do código herdado só diminui: quem já saiu é tirado dela", () => {
    expect([...LEGACY.keys()].filter((file) => !using.includes(file))).toEqual([]);
  });
});
