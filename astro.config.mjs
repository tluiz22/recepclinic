import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import vercel from "@astrojs/vercel";

const site =
  process.env.SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:4321");

export default defineConfig({
  site,
  output: "server",
  adapter: vercel(),
  // F9.1 (L44, L46). A proteção de origem recusa formulários enviados de outro
  // site. O CSP sai como cabeçalho nas páginas do servidor (não vale no
  // `npm run dev`): scripts e estilos só do próprio domínio, com o hash dos
  // embutidos pelo Astro; estilo em atributo liberado (cor da marca, barras do
  // funil); imagens também de https (logos no Storage do Supabase); conexões ao Supabase (anexo da Central). Os demais
  // cabeçalhos ficam em src/lib/securityHeaders.ts.
  security: {
    checkOrigin: true,
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: https:",
        // Foto e PDF da Central (CN6): o arquivo sobe direto ao Storage do Supabase pelo link de uso único.
        "connect-src 'self' https://*.supabase.co",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ],
      styleDirective: {
        resources: ["'self'", { resource: "'unsafe-inline'", kind: "attribute" }],
      },
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
