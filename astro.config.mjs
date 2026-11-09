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
  // funil); imagens também de https (logos no Storage do Supabase); conexões e áudio do Supabase (anexo da Central). Os demais
  // cabeçalhos ficam em src/lib/securityHeaders.ts.
  security: {
    checkOrigin: true,
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: https:",
        // Foto e PDF da Central (CN6): o arquivo sobe direto ao Storage do Supabase pelo link de uso único.
        "connect-src 'self' https://*.supabase.co",
        // Áudio da Central: o player vai para a URL assinada do Storage (sem isto, vale o default-src e o áudio não toca).
        "media-src 'self' https://*.supabase.co",
        "object-src 'none'",
        "base-uri 'self'",
        // Assinatura (F12.2i/g): "Informar o cartão no Asaas" e "Trocar o cartão" são formulários que o servidor
        // redireciona para a fatura ou o Checkout do Asaas; o navegador aplica o form-action também ao redirecionamento.
        "form-action 'self' https://asaas.com https://*.asaas.com",
        "frame-ancestors 'none'",
        // Portal de agendamento (F2b): o CAPTCHA (Cloudflare Turnstile) abre numa moldura da Cloudflare.
        "frame-src https://challenges.cloudflare.com",
      ],
      // O script do Turnstile vem da Cloudflare (portal, F2b); os demais, do próprio domínio, com o hash dos embutidos.
      scriptDirective: {
        resources: ["'self'", "https://challenges.cloudflare.com"],
      },
      styleDirective: {
        resources: ["'self'", { resource: "'unsafe-inline'", kind: "attribute" }],
      },
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
