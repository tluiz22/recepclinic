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
framework de testes, nem biblioteca de datas (fuso `America/Fortaleza` tratado à mão, em `lib/dates.ts` e no SQL). O
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

---

## 1.2 Dados e acesso

### Banco

Um projeto **Supabase** (Postgres) com o schema `public` montado por 38 migrações. Extensões:
`pgcrypto`, `pg_cron`, `pg_net` e Vault. Há
também um schema `internal` (fechado para `anon`/`authenticated`) com a função
`internal.call_cron_route`, que chama as rotas `/api/cron/*`.

**Nenhuma tabela tem coluna de clínica/consultório.** O banco inteiro é de um consultório só, e os
dados de configuração ficam em linhas fixas, como a `appointment_settings` com `id = 1`.

### Tabelas (estado em `aad94dd`)

| Grupo | Tabela | Para que serve |
|---|---|---|
| **Configuração** | `appointment_settings` | linha única (`id = 1`): durações, intervalo entre atendimentos, prazo do retorno, idade limite da consulta, hora do lembrete |
| | `clinic_locations` | "locais", com `type` = `clinic` (consultório físico), `home_visit` (domiciliar) ou `exam` (local fictício "Exames"); preços da consulta e do retorno |
| | `availability_windows` | janelas semanais de atendimento por local (dia da semana, início, fim) |
| | `exam_types` | exames: duração, preço, preparo, modo `individual` ou `group` (turma) |
| | `exam_type_availability_windows` | janelas semanais por exame; com `capacity` = turma |
| | `schedule_blocks` | bloqueios de agenda (período, motivo, quem criou, editou e removeu) |
| | `notification_recipients` | contatos da equipe que recebem o resumo do dia (consultas e/ou exames) |
| **Pessoas** | `guardians` | responsável: nome, **telefone único**, endereço domiciliar padrão, ativo |
| | `patients` | paciente: nome, nascimento, responsável, observações, ativo; `is_guardian_self` = o próprio responsável (adulto no exame) |
| | `staff_profiles` | perfil do login: nome e `role` = `secretaria` ou `medica` |
| **Agenda** | `appointments` | atendimento (ver abaixo) |
| | `booking_links` | link de uso único para marcar/remarcar pela página `/agendar/[token]` |
| | `waitlist_entries` | quem está na lista de espera (por atendimento) |
| | `waitlist_openings` | vaga aberta por cancelamento ou remarcação |
| | `waitlist_offers` | oferta de vaga feita a uma pessoa da lista |
| **WhatsApp e bot** | `conversation_state` | estado da conversa por telefone (máquina de estados do bot, `context` em JSON, pausa por atendimento humano) |
| | `whatsapp_messages` | mensagens enviadas/recebidas e status de entrega (`wa_message_id`) |
| | `bot_funnel_events` | eventos do funil (fluxo, passo, origem bot/web, telefone) |
| **Auditoria e jobs** | `appointment_events` | trilha do atendimento: tipo do evento, quem, canal, detalhes |
| | `job_runs` | execuções do lembrete e do resumo do dia (status, totais, automática ou manual) |
| | `daily_summary_sends` | controle de envio do resumo da manhã |

**`appointments`** é a tabela central (31 colunas, juntando todas as fases): paciente, local,
exame, horário, duração, tipo (`first_visit`, `return_visit`, `exam`), status (`scheduled`,
`confirmed`, `completed`, `canceled`, `no_show`), canal de marcação, preço gravado, endereço
domiciliar, retorno ligado à consulta de origem (`origin_appointment_id`), autoria (`created_by`,
`rescheduled_by`, `canceled_by` + canais), lembrete e resposta ao lembrete, presença confirmada,
cancelamento em massa e turma (`is_group_session`). Sobraram duas colunas sem uso no código:
`google_event_id` (da época do Google Calendar) e `confirmed_at`.

### Relacionamentos

```text
guardians 1─┬─N patients 1───N appointments N───1 clinic_locations 1───N availability_windows
            │                    │   │  └──N───1 exam_types 1───N exam_type_availability_windows
            │                    │   └── origin_appointment_id → appointments (retorno)
            ├─N booking_links ───┘ (patient, appointment, location, exam_type)
            ├─N whatsapp_messages (appointment opcional)
            └─N bot_funnel_events / conversation_state (pelo telefone, guardian opcional)

appointments 1───N appointment_events
appointments 1───N waitlist_entries 1───N waitlist_offers N───1 waitlist_openings
auth.users  1───1 staff_profiles;  auth.users ← created_by/rescheduled_by/canceled_by/
                                                 patient_confirmed_by/actor_id/ended_by…
```

O **telefone** é a chave natural do responsável: `guardians.phone` é único no banco inteiro, e o bot
encontra a conversa e o responsável por ele. O mesmo telefone não pode ser responsável em dois
cadastros.

### Regras garantidas pelo banco

| Regra | Como |
|---|---|
| **Sem sobreposição de atendimentos ativos** | restrição de exclusão `appointments_no_overlap` (GiST) sobre o período `[início, início + duração)` de **todos** os atendimentos ativos que não são turma, **em todos os locais**. Pressupõe uma única agenda (uma médica). |
| Vagas da turma | funções `book_group_exam_session` / `reschedule_group_exam_session` (`security definer`, trava a janela e conta as vagas) |
| Marca de turma | gatilho `appointments_set_is_group_session` |
| Preço gravado | gatilho `appointments_set_price` (retorno = 0, exame = preço do exame, consulta = preço do local) |
| Lista de espera | gatilho `appointments_waitlist` (`security definer`): fecha entradas e ofertas, abre vaga e chama a rota por `pg_net` |
| Um "próprio responsável" por responsável | índice único parcial em `patients` |
| Estados do bot | `check` com a lista de estados (cada estado novo exige uma migração) |
| Fuso | `America/Fortaleza` fixo nas funções e nos horários dos jobs (horários em UTC no `cron.schedule`) |

### Autenticação

- **Supabase Auth com e-mail e senha.** `POST /api/admin/auth/login` → `signInWithPassword`. A sessão
  fica em cookie (`@supabase/ssr`, cliente em `lib/supabase/server.ts`).
- Não há cadastro, convite, recuperação de senha nem troca de senha no sistema: os logins são
  criados à mão no painel do Supabase. O perfil (`staff_profiles`) é cadastrado por SQL (seed em
  comentário na `0020`). Hoje só a médica tem perfil.
- Sem 2FA e sem limite de tentativas próprio (só o do Supabase Auth).

### Autorização

Feita **na aplicação**, no `src/middleware.ts`:

1. Qualquer caminho `/admin/*` ou `/api/admin/*` (fora o login) exige usuário logado. Sem login, vai
   para `/admin/login`.
2. O perfil vem de `staff_profiles.role`. **Login sem perfil é tratado como secretária.**
3. Só a médica acessa `/admin/relatorios` e `/admin/metricas` (incluindo as abas Faltosos e Envios).
   As outras telas e APIs, Configurações inclusive, são das duas. A tela antiga `/admin/envios` e
   o Início verificam o perfil por conta própria para redirecionar ou mostrar os links.
4. `locals.userId` é gravado como autor nas ações (marcar, remarcar, cancelar, presença,
   bloqueios, lista de espera).

O banco **não conhece os perfis**: secretária e médica têm o mesmo acesso no RLS.

### RLS

Todas as tabelas de `public` estão com RLS ligado. Há três padrões de política:

| Política | Tabelas |
|---|---|
| **"authenticated full access"**: todo usuário logado lê e escreve tudo (`auth.uid() is not null`) | `clinic_locations`, `availability_windows`, `appointment_settings`, `guardians`, `patients`, `appointments`, `whatsapp_messages`, `conversation_state`, `booking_links`, `exam_types`, `exam_type_availability_windows`, `notification_recipients`, `schedule_blocks`, `waitlist_entries` |
| **Só leitura** para logados (escrita só pela service role) | `staff_profiles`, `bot_funnel_events`, `job_runs`, `waitlist_offers`, `waitlist_openings`; `appointment_events` também aceita inserção |
| **Sem política** (só service role) | `daily_summary_sends` |

`anon` não tem política nenhuma: sem login, o Postgres não devolve nada. As 11 migrações que usam
`auth.uid()` usam só para "está logado", nunca para dono de linha.

### Acesso sem login (service role, ignora o RLS)

| Quem | Como se autentica |
|---|---|
| Webhook do WhatsApp (`/api/whatsapp/webhook`) e todo o bot | assinatura `X-Hub-Signature-256` com o `WHATSAPP_APP_SECRET` (HMAC, comparação em tempo constante); `GET` de verificação com `WHATSAPP_WEBHOOK_VERIFY_TOKEN` |
| Rotas do agendador (`/api/cron/*`) | `Authorization: Bearer <CRON_SECRET>` |
| Página `/agendar/[token]` e suas APIs | o **token é o `id` (UUID) do `booking_link`**, com validade (`expires_at`) e uso único (`used_at`) |
| Página `/preparo/[id]` | o `id` (UUID) do tipo de exame; mostra só nome e preparo |
| Saída da lista de espera pela tela (`/api/admin/.../waitlist`) | login normal (middleware) e service role para gravar em `waitlist_offers`/`openings` |

O código que roda com a service role confia apenas nos filtros que ele mesmo aplica. Como não
existe clínica no modelo, nenhum desses caminhos filtra por clínica.
