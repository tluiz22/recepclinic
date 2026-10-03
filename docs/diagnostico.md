# Diagnóstico da arquitetura atual

> Etapa 1 do RecepClinic: descrição do que existe **na base da cópia** (`aad94dd`, tag `piloto-base`),
> feita só lendo o código. Aqui não há julgamento nem proposta: limites e problemas ficam na
> etapa 2, a arquitetura alvo na etapa 3. Onde algo não pôde ser confirmado pelo código, isso está
> indicado.
>
> Partes: **1.1 Estrutura e operação** · 1.2 Dados e acesso · 1.3 Domínio e integrações ·
> 1.4 Uma clínica só + temas transversais.

---

## 1.1 Estrutura e operação

### Visão geral

Um único projeto **Astro 7** em modo servidor (`output: "server"`, adaptador `@astrojs/vercel`)
reúne duas coisas:

1. **Site institucional** da Dra. Ana Karina: home, sobre, contato, blog e guias em MDX, política
   de privacidade, termos de uso, sitemap e RSS.
2. **Sistema do consultório**: painel `/admin`, bot de WhatsApp (webhook), páginas públicas de
   agendamento (`/agendar/[token]`) e de preparo de exame (`/preparo/[id]`), e rotas chamadas pelo
   agendador (`/api/cron/*`).

Tamanho aproximado, em linhas de `.ts`/`.astro`:

| Área | Linhas | Observação |
|---|---:|---|
| `src/lib` (regras, bot, agenda, métricas) | 11.287 | dos quais WhatsApp 6.352, agendamento 1.430, métricas 1.071 |
| `src/pages/admin` (telas do painel) | 6.531 | 31 páginas |
| `src/pages/api` (rotas) | 3.554 | 52 rotas: 46 do admin, 2 de agendar, 3 de cron, 1 webhook |
| `src/components/admin` | 2.173 | inclui as abas de Métricas |
| `src/scripts` (JS do navegador no admin) | 710 | seletores de horário, busca, formulários |
| `/agendar` e `/preparo` | 600 | páginas públicas do sistema |
| **Site institucional** (páginas, componentes, `src/data`, layouts) | **1.354** | ~5% do código |
| `supabase/migrations` | 1.784 | 38 migrações SQL |

Histórico: 151 commits, de 11/ago/2026 (site) a 03/out/2026.

### Dependências

Só dependências de produção, nenhuma de desenvolvimento:

- `astro` 7, `@astrojs/vercel`, `@astrojs/mdx`, `@astrojs/sitemap`, `@astrojs/rss`, `@astrojs/check`
- `tailwindcss` 4 + `@tailwindcss/vite`
- `@supabase/supabase-js` 2 e `@supabase/ssr` (sessão por cookie)
- `typescript` 6

Não há biblioteca de WhatsApp (chamadas `fetch` diretas à Graph API da Meta), nem ORM, nem
framework de testes, nem biblioteca de datas (fuso de São Paulo tratado à mão em `lib/dates.ts`). O
`package.json` ainda tem nome (`site-ana-karina`) e descrição herdados de um modelo de
"Agent Skills do Copilot".

### Organização do código

```text
src/
  pages/            rotas (site + admin + api + agendar + preparo)
  layouts/          BaseLayout/GuideLayout (site) · AdminLayout (painel)
  components/       componentes do site · admin/ (painel) · admin/metricas/
  lib/              regras de negócio do sistema
    supabase/       client.ts (não usado) · server.ts (sessão) · service.ts (service role)
    whatsapp/       bot/ (roteador e fluxos), envio, templates, webhook, funil
    scheduling/     cálculo de datas e horários livres
    metrics/        leituras das métricas
  scripts/          JS do navegador usado pelas telas do admin
  data/             doctor.ts, faq.ts, navigation.ts, specialties.ts (dados do site)
  content/          blog/ e guias/ (MDX)
  middleware.ts     login e perfil do /admin
supabase/migrations 0001 … 0038
scripts/            reset-test-data.mjs, simulate-agent-echo.mjs, simulate-reminder-tap.mjs
```

Padrão das rotas: as telas do admin são páginas Astro que leem o banco no servidor. As ações são
formulários que fazem `POST` em `/api/admin/...` e voltam para a tela com um aviso na URL. Pouco
JavaScript no navegador. Acesso ao banco com o cliente do Supabase direto nas páginas e nas libs:
309 chamadas `.from(...)` em 111 arquivos, sem camada de repositório. O cliente com sessão (RLS) é
usado em 83 arquivos e o de service role (ignora RLS) em 10: webhook, bot, rotas de cron e páginas
públicas.

### Separação site × aplicação

Hoje são **um só deploy, um só domínio e um só build**. Pontos de ligação:

| Ligação | Onde |
|---|---|
| O sistema usa o **rodapé do site** (`Footer.astro`, que lê `src/data/doctor.ts`: nome, CRM, clínicas, telefone, e-mail, Instagram) | `/agendar/[token]` e `/preparo/[id]` |
| O sistema usa o **CSS global** do site (`styles/global.css`) | `/agendar`, `/preparo` e o painel |
| O site **não** lê o banco | nenhuma página institucional importa `lib/` ou Supabase |
| O **domínio** de produção está fixo em `astro.config.mjs` (`draanakarinapneumo.com.br`) e é a base dos links enviados por WhatsApp | `site` do Astro e `SITE_URL` |
| `/politica-de-privacidade` é do site e serve de política de privacidade do app na Meta | página do site |
| O PWA do painel (`public/manifest.json`) se chama "Painel do consultório — Dra. Ana Karina" | `public/` compartilhado |
| `robots.txt` libera tudo (`Allow: /`); o admin é protegido só pelo login | `public/robots.txt` |

Na prática, o site institucional é pequeno e quase independente: a ligação forte é a **identidade
da Dra.** (rodapé, domínio, nome no PWA) usada dentro do sistema.

### Ambientes

| Ambiente | Situação |
|---|---|
| **Local (dev)** | `astro dev` com `.env` local. Segundo o plano do piloto, aponta para o **mesmo projeto Supabase** do preview (não confirmado pelo código; não há `.env` nesta cópia). |
| **Preview (Vercel)** | Branch `feature/gestao-consultorio`, alias fixo. É onde o sistema roda de verdade hoje, com a Meta e os contatos de teste reais. |
| **Production (Vercel)** | Ainda é o **site institucional antigo**, de antes do sistema. |
| **Staging** | Não existe. |

Há **um único projeto Supabase** para tudo, sem separação de dados de teste e de uso real. A
limpeza é manual (`scripts/reset-test-data.mjs`).

### Deploy

- **Vercel**, plano **Hobby**, região fixa `gru1` (São Paulo, junto do Supabase `sa-east-1`) em
  `vercel.json`. Sem crons na Vercel.
- O preview é publicado pelo push na branch, e o piloto usa `vercel deploy` + alias quando precisa
  atualizar antes do push.
- **CI no GitHub Actions** (`.github/workflows/ci.yml`): em push na `main` e em pull requests roda
  `npm ci`, `astro check` e `astro build`. Não há testes automatizados. Nesta cópia o workflow já
  existe e roda em `tluiz22/recepclinic`.
- **Migrações** aplicadas **à mão** no SQL Editor do Supabase, sem a CLI do Supabase (não há
  `supabase/config.toml`) e sem controle de quais já foram aplicadas, além do próprio
  acompanhamento do plano.
- **Agendador**: 4 jobs `pg_cron` no banco (`lembrete-de-hora-em-hora`, `resumo-do-dia-vespera`,
  `resumo-do-dia-manha`, `lista-de-espera-ofertas`) chamam as rotas `/api/cron/*` por `pg_net`. A URL,
  o `cron_secret` e o token de bypass da proteção da Vercel ficam no **Vault**, cadastrados à mão
  (instruções em comentário na `0029`).

### Variáveis de ambiente

Todas lidas por `import.meta.env`, sem validação central na subida. Quando falta uma, cada ponto
de uso trata do seu jeito: a notificação vira `skipped_no_template` ou a rota responde 500.

| Grupo | Variáveis |
|---|---|
| Supabase | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| WhatsApp (conta) | `WHATSAPP_CLOUD_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` |
| WhatsApp (templates) | 12 nomes de template: `…_CONFIRMATION`, `…_CONFIRMATION_RETURN`, `…_RESCHEDULE`, `…_CANCELLATION`, `…_REMINDER`, `…_EXAM_PREPARATION`, `…_WAITLIST_OFFER`, `…_MASS_CANCELLATION`, `…_DAILY_SUMMARY_CONSULTAS`/`_EXAMES` e as versões `_TODAY`, `WHATSAPP_TEMPLATE_LANGUAGE` |
| Liga/desliga de layout | `WHATSAPP_TEMPLATE_CONFIRMATION_NEW_LAYOUT`, `…_CONFIRMATION_RETURN_NEW_LAYOUT`, `…_REMINDER_SHORT` |
| Agendador | `CRON_SECRET` (+ segredos do Vault no banco) |
| Site | `SITE_URL` (opcional), `VERCEL_ENV`, `VERCEL_URL` |

Tudo é **de uma conta só**: um número de WhatsApp, um conjunto de templates e um banco por deploy.

### Custos (situação atual)

| Serviço | Plano | Custo hoje |
|---|---|---|
| Vercel | Hobby (uso não comercial pelos termos) | US$ 0 |
| Supabase | Free (pausa após ~1 semana sem uso, sem backup automático) | US$ 0 |
| Meta WhatsApp Cloud API | cobrança por conversa/mensagem de template | não levantado aqui |
| Domínio do site | registro.br | não levantado aqui |

Referência registrada no planejamento de produto (30/set, confirmar preços antes de decidir):
Vercel Pro + Supabase Pro ≈ US$ 45/mês; cada projeto Supabase a mais na mesma organização Pro
≈ US$ 10/mês.
