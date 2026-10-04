import { defineConfig } from "vitest/config";

// Testes de banco (F2): rodam contra o Supabase local (`npm run db:start`),
// entrando como usuários reais de cada clínica. Um arquivo por vez, para os
// dados de um não interferirem nos do outro.
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["tests/db/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
