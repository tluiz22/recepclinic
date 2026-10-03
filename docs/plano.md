# Plano de evolução do RecepClinic

> Etapa 4. Transforma as decisões da [arquitetura](arquitetura.md) em fases e etapas. Fases e
> ordem aprovadas pelo cliente em 03/out/2026.
>
> **Como executar:** uma etapa por vez. Ao fim de cada etapa: o que foi feito, os comandos para o
> cliente validar e **parada até a confirmação explícita**. Só a fase em curso é detalhada etapa
> por etapa; as seguintes têm objetivo e escopo e são detalhadas quando chegar a vez delas, com
> aprovação do cliente.
>
> **Triagem do piloto:** no início de cada fase, olhar os commits novos do piloto e registrar em
> [`triagem-piloto.md`](triagem-piloto.md) (sem merge cego).
>
> **Fora do P1 (de propósito):** escolha de profissional no bot, 2FA, autocadastro de clínica,
> cobrança.

## Visão geral

| Fase | Entrega | Situação |
|---|---|---|
| F0 | Base de trabalho | **próxima** |
| F1 | Testes das regras atuais | a detalhar |
| F2 | Schema novo | a detalhar |
| F3 | Acesso ao banco e contexto da clínica | a detalhar |
| F4 | Painel | a detalhar |
| F5 | Páginas públicas e domínio | a detalhar |
| F6 | WhatsApp por clínica e bot | a detalhar |
| F7 | Envios automáticos por clínica | a detalhar |
| F8 | Conexão self-service na Meta | a detalhar (depende da Meta) |
| F9 | Operação e segurança | a detalhar |
| F10 | Primeiro piloto | a detalhar |

---

## F0 — Base de trabalho

**Objetivo:** deixar o repositório pronto para evoluir com segurança: só o produto, com nome
próprio, banco local e testes rodando no CI. Nenhuma regra de negócio muda nesta fase.

### F0.1 — Tirar o site institucional do repositório (D7)

- Remover as páginas do site (`index`, `sobre`, `contato`, `blog`, `guias`,
  `politica-de-privacidade`, `termos-de-uso`, `rss.xml.js`), os componentes, layouts e dados do
  site (`Header`, `Footer`, `SeoHead`, `SpecialtyCard`, `StructuredData`, `WhatsAppButton`,
  `components/guias`, `BaseLayout`, `GuideLayout`, `src/data/*`), o conteúdo (`src/content`,
  `content.config.ts`) e os arquivos públicos do site (`foto-dra.png`, `public/guias/*.pdf`, ícones
  do site).
- `/agendar` e `/preparo` deixam de usar o rodapé do site e ganham um rodapé neutro provisório (a
  marca da clínica entra na F5).
- `/` passa a levar ao painel (`/admin`). A `404` fica, neutra.
- Sai das dependências o que só o site usava (`@astrojs/mdx`, `@astrojs/rss`, `@astrojs/sitemap`).
- Os textos com a identidade da Dra. **dentro do sistema** (bot, notificações) continuam por
  enquanto: saem na F4/F6, quando a configuração por clínica existir.
- **Validar:** `npm run check` e `npm run build` sem erro; `git grep -n "BaseLayout\|data/doctor"`
  vazio.

### F0.2 — Nome do produto

- `package.json` (nome `recepclinic`, descrição), `README.md` da raiz (o que é, como rodar, link
  para `docs/`), `public/manifest.json` (nome "RecepClinic").
- `astro.config.mjs` sem o domínio da Dra.: `SITE_URL` ou, na falta, o endereço da Vercel ou
  `localhost`.
- **Validar:** `git grep -n "draanakarinapneumo" -- astro.config.mjs package.json public` vazio;
  build sem erro.

### F0.3 — Supabase local e migrações pela CLI (D5, D8)

- **Pré-requisitos do cliente:** instalar o Docker (Docker Desktop ou OrbStack) e a CLI do
  Supabase (`brew install supabase/tap/supabase`). Nenhum dos dois está instalado hoje.
- `supabase init` (`supabase/config.toml`). As 38 migrações do piloto vão para
  `supabase/piloto-migrations/` como **referência, sem aplicar** (o schema novo é a F2). A pasta
  `supabase/migrations/` fica vazia até a F2.
- Scripts no `package.json`: `db:start`, `db:stop`, `db:reset`.
- **Validar:** `npm run db:start` sobe o banco local; `supabase status` mostra as URLs locais;
  `npm run db:stop`.

### F0.4 — Testes automatizados no CI (D5)

- Vitest configurado com o Vite do Astro; `npm test`.
- Um primeiro teste real e pequeno (ex.: `lib/phone.ts`, normalização do nono dígito) para provar a
  configuração.
- CI (`.github/workflows/ci.yml`): `npm ci` → `check` → `test` → `build`.
- **Validar:** `npm test` passa localmente; o CI do push fica verde no GitHub.

---

## F1 — Testes das regras atuais

**Objetivo:** cobrir com testes as regras validadas no piloto **antes** de mudá-las, para que a
adaptação mostre quando uma regra quebrar.

**Escopo:** funções sem banco ou com banco simulado: horários livres (`scheduling/slots.ts` e
afins), feriados, idade e idade limite, elegibilidade do retorno, corte e janela do lembrete,
horário do resumo do dia, regra de faltosos, formatação de datas e valores, textos que dependem de
regra (ex.: idade limite).

## F2 — Schema novo

**Objetivo:** a migração-base no modelo alvo (D1, D2, D4, D6), com RLS e testes de isolamento.

**Escopo:** clínicas; membros e papéis (Administrador, Profissional, Recepção) e Suporte da
plataforma; perfil e configuração da clínica (D4b); agendas; locais; serviços com categoria (D4c) e
disponibilidade por agenda; contatos → pacientes; atendimentos com trava de horários por agenda;
bloqueios; lista de espera; conversa e mensagens; funil; trilha; execuções dos jobs; conexão do
WhatsApp e templates por clínica; feriados extras; contadores de uso. RLS por clínica e por papel;
funções e gatilhos portados do piloto; dados de teste com 2 clínicas; **testes de isolamento** (A
não lê nem escreve B, para usuário, bot e agendador).

## F3 — Acesso ao banco e contexto da clínica

**Objetivo:** concentrar o acesso ao banco por domínio e fazer toda requisição saber de qual
clínica é.

**Escopo:** camada de acesso por domínio (agenda, pacientes, serviços, mensagens, configuração…);
clínica ativa a partir do login; **credencial limitada à clínica** para bot, agendador e páginas
públicas (fim da service role nesses caminhos); validação das variáveis de ambiente da plataforma
(L39); biblioteca de datas com fuso por clínica (L40).

## F4 — Painel

**Objetivo:** o painel funcionando sobre o modelo novo, começando pela configuração.

**Escopo:** login, convite e recuperação de senha, escolha de clínica, papéis. **Configurações**
(perfil, identidade, profissionais, locais, serviços, agendas, disponibilidade, feriados extras,
contatos, equipe); depois Agenda, Pacientes, Resumo do Dia, Métricas, Trilha. Vocabulário pelo
perfil da clínica.

## F5 — Páginas públicas e domínio

**Objetivo:** links públicos com a marca da clínica, no endereço do produto.

**Escopo:** `/agendar` e `/preparo` com nome, logo, cor e profissionais da clínica; aplicativo em
`app.recepclinic.com.br`; links para a política de privacidade e os termos, que ficam no site do
produto (projeto separado, ver D7).

## F6 — WhatsApp por clínica e bot

**Objetivo:** o bot atendendo pela conexão de cada clínica.

**Escopo:** criação do **staging** (projeto Supabase, preview da Vercel, número de teste da Meta);
conexão guardada por clínica (cadastrada pelo Suporte nesta fase); webhook que identifica a
clínica pelo `phone_number_id` e responde rápido; envio por clínica; templates padrão do
RecepClinic com nome e idioma por clínica; bot com menus montados pelo catálogo de serviços e textos
pelo perfil; coexistência e pausa da recepção.

## F7 — Envios automáticos por clínica

**Escopo:** lembrete, reenvio sem resposta, resumo do dia e lista de espera percorrendo as clínicas
ativas, cada uma com seu fuso, horário e contatos; falha de uma clínica não para as outras;
registro por clínica.

## F8 — Conexão self-service na Meta

**Escopo:** Embedded Signup com coexistência (o Administrador conecta o número pela tela); criação
e envio dos templates pela API na conta da clínica; acompanhamento da aprovação. **Depende** da
aprovação do RecepClinic como Tech Provider (pendente do cliente).

## F9 — Operação e segurança

**Escopo:** ferramenta de erros com a clínica em cada erro e monitor externo (painel e webhook);
cabeçalhos de segurança e `robots.txt`; proteção de origem explícita; logs sem dados pessoais;
anonimização de paciente/contato a pedido (LGPD); contadores de uso visíveis para o Suporte.

## F10 — Primeiro piloto

**Escopo:** produção (Supabase Pro + Vercel Pro, backup conferido); criação da 1ª clínica pelo
Suporte e configuração pelo Administrador; no cenário B, script de importação do banco do piloto
para o modelo novo; acompanhamento das primeiras semanas.

---

## Pendências do cliente que afetam o plano

| Pendência | Necessária para |
|---|---|
| Instalar Docker e a CLI do Supabase | F0.3 |
| Verificação da empresa e Tech Provider na Meta (CNPJ, site) | F8 (começar já, por causa do prazo) |
| Site `www.recepclinic.com.br` com política de privacidade e termos (projeto separado) | F8 (Meta) e F5 |
| Número de teste na Meta para o staging | F6 |
| CNPJ, contrato com as clínicas, termo de tratamento de dados | F10 |
| Custo da Meta por mensagem | definição de preço (fora do código) |
