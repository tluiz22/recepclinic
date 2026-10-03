/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

// Vitest com o mesmo Vite do Astro (aliases, `import.meta.env`, plugins).
export default getViteConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
