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
| F0 | Base de trabalho | concluída (04/out) |
| F1 | Testes das regras atuais | concluída (04/out; 197 testes) |
| F2 | Schema novo | **em andamento** (F2.1 concluída) |
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
- **Validar:** `npm run check` e `npm run build` sem erro; `git grep -n "BaseLayout\|data/doctor" -- src`
  vazio.
- **Concluída em 03/out.** Além do previsto: `@types/node` passou a ser dependência direta (vinha
  pelo `@astrojs/sitemap`; o webhook usa `Buffer` e `node:crypto`) e o `robots.txt` perdeu a linha
  do sitemap. Os títulos "… | Dra. Ana Karina Fernandes" de `/agendar` e `/preparo` ficam para a
  F4/F5.

### F0.2 — Nome do produto

- `package.json` (nome `recepclinic`, descrição), `README.md` da raiz (o que é, como rodar, link
  para `docs/`), `public/manifest.json` (nome "RecepClinic").
- `astro.config.mjs` sem o domínio da Dra.: `SITE_URL` ou, na falta, o endereço da Vercel ou
  `localhost`.
- **Validar:** `git grep -n "draanakarinapneumo" -- astro.config.mjs package.json public` vazio;
  build sem erro.
- **Feito em 03/out**, além do previsto: `resolveSiteUrl()` (links enviados pelo bot) perdeu o mesmo
  domínio da Dra. em produção, e os botões "Voltar para o site" de `/agendar` e `/preparo` saíram
  (decisão do cliente; voltam na F5).

### F0.3 — Supabase local e migrações pela CLI (D5, D8)

- **Pré-requisitos do cliente:** Docker (OrbStack) e CLI do Supabase, instalados em 03/out.
- `supabase init` (`supabase/config.toml`). As 38 migrações do piloto vão para
  `supabase/piloto-migrations/` como **referência, sem aplicar** (o schema novo é a F2). A pasta
  `supabase/migrations/` fica vazia até a F2.
- Scripts no `package.json`: `db:start`, `db:stop`, `db:reset`.
- **Validar:** `npm run db:start` sobe o banco local; `supabase status` mostra as URLs locais;
  `npm run db:stop`.
- **Feita em 04/out**: Postgres 17 local, sem projeto vinculado (`linked_project: null`) e com o
  schema `public` vazio. `supabase/.temp/cli-latest` (cache da CLI) saiu do git. Dois avisos
  esperados até a F2 no start/reset: `.gitkeep` ignorado e `seed.sql` inexistente.

### F0.4 — Testes automatizados no CI (D5)

- Vitest configurado com o Vite do Astro; `npm test`.
- Um primeiro teste real e pequeno (ex.: `lib/phone.ts`, normalização do nono dígito) para provar a
  configuração.
- CI (`.github/workflows/ci.yml`): `npm ci` → `check` → `test` → `build`.
- **Validar:** `npm test` passa localmente; o CI do push fica verde no GitHub.
- **Feita em 03/out, antes da F0.3** (decisão do cliente, enquanto instalava o Docker). O CI já
  existia (herdado do piloto); ganhou o passo `npm test`. O `phone.ts` não tem regra de nono dígito:
  o primeiro teste cobre normalização E.164, formatação e link do wa.me.

---

## F1 — Testes das regras atuais

**Objetivo:** cobrir com testes as regras validadas no piloto **antes** de mudá-las, para que a
adaptação mostre quando uma regra quebrar.

**Escopo (detalhado em 04/out):** só as regras de **cálculo**, que não consultam o banco: as funções
puras e a parte pura dos módulos que também acessam o banco. **Decisão do cliente (04/out):** as
regras que dependem de consulta ao banco (elegibilidade do retorno, conflitos de exame, lista de
espera e ofertas, reenvios) **não ganham banco simulado**; recebem testes de integração contra o
Supabase local logo depois da F2, já no schema novo, para não escrever testes que seriam jogados
fora.

Etapas (cada uma com `npm test`, `check` e `build` verdes e CI verde):

- **F1.1 — Agenda:** horários livres (`computeAvailableSlots`), feriados nacionais. **Concluída em
  04/out** (39 testes). Observação para depois: só há feriados nacionais (+ Carnaval, Cinzas,
  Corpus Christi); feriados estaduais e municipais passam a importar com clínicas em outras cidades.
- **F1.2 — Paciente e idade:** idade, adulto, idade limite da consulta e o aviso dela, data de
  nascimento válida, responsável como paciente. **Concluída em
  04/out** (42 testes). Achados registrados nos testes como estão, a corrigir na F3/F4 (decisão do
  cliente): (1) `api/admin/pacientes/[id]/criancas/index.ts` tem cópia própria de
  `isValidBirthdate` com o dia em UTC e aceita a data de amanhã entre 21h e 24h de Fortaleza;
  (2) datas inexistentes (31/02, mês 13) passam na validação e só o banco recusa, com a mensagem
  genérica; (3) `formatAge` com nascimento futuro devolve texto sem sentido ("11 meses").
- **F1.3 — Prazos e envios:** prazo do retorno, corte e janela do lembrete, dia e hora em
  Fortaleza, horário e descrição do resumo do dia, regra e rótulo de faltoso, estado das execuções
  automáticas, leitura dos resultados de reenvio. **Concluída em 04/out** (53 testes). Achados,
  também para a F3/F4: (4) `parseResendOutcome`/`parsePreparationResendOutcome` aceitam nomes
  herdados de Object (`?reenvio=toString` mostra um aviso vazio); (5) `describeSummarySchedule`
  mostra janela antes de 1h como "23h30" sem indicar a véspera.
- **F1.4 — Formatação e textos:** datas, valores, data e hora do WhatsApp, texto do WhatsApp para
  HTML, períodos das métricas, texto e prazo da oferta da lista de espera, título de sessão em
  grupo. **Concluída em 04/out** (56 testes, sem achados).

Os testes registram o comportamento **atual**, inclusive o que parecer estranho: o que for dúvida de
regra vira pergunta ao cliente, não correção silenciosa.

## F2 — Schema novo

**Objetivo:** a migração-base no modelo alvo (D1, D2, D4, D6, D9, D10), com RLS e testes de isolamento.

**Detalhada em 04/out**, já com as revisões de D2 e D6 e a nova D9 (várias agendas, acesso por
agenda, serviço em várias agendas, profissional genérico, atendimentos recorrentes) e a D10
(convênios: só o banco nesta fase). Cada etapa
traz a sua migração em `supabase/migrations/` (o conjunto é a migração-base da D5, já que ainda não
existe banco na nuvem), o RLS das suas tabelas e **testes de isolamento** contra o Supabase local
(Vitest entrando como usuários reais de cada clínica, `npm run test:db`, também no CI). O código da
aplicação continua no schema antigo até a F3; o agendamento das rotinas no banco (`pg_cron`) fica
para a F7.

- **F2.1 — Núcleo:** clínicas; membros e papéis (Administrador, Profissional, Recepção); Suporte da
  plataforma; funções "é membro", "tem papel"; padrão de RLS; ambiente de testes de banco no CI.
  (Substitui `staff_profiles`.) **Concluída em 04/out** (23 testes de banco). Padrões
  assumidos: a clínica nunca fica sem Administrador; o Administrador vê o registro do Suporte da
  própria clínica; "suspensa" ainda não bloqueia nada (decisão futura, com contrato e cobrança).
- **F2.2 — Configuração, profissionais e agendas:** perfil e identidade da clínica; profissionais
  genéricos (profissão, especialidade, conselho, número, UF); locais; **agendas** (profissional ou
  recurso); **acesso de cada membro às agendas** (todas por padrão para Administrador e Recepção,
  restringível; Profissional só a própria); **serviços** (consulta, retorno, exame) **em várias
  agendas**; disponibilidade por agenda; turmas de exame; feriados extras; contatos do resumo do
  dia; **planos de saúde atendidos** (com nomes alternativos e busca por semelhança, `pg_trgm`),
  exceções por profissional e a opção "exigir dados do convênio na marcação" (D10). (Substitui `appointment_settings`, `clinic_locations`, `exam_types`, `availability_windows`,
  `exam_type_group_schedule`, `notification_recipients`.)
- **F2.3 — Pacientes:** contatos e pacientes, telefone único por clínica; plano do paciente
  (particular ou plano, carteirinha, validade; D10). (`guardians`, `patients`.)
- **F2.4 — Atendimentos e séries:** atendimentos ligados a serviço e agenda, trava de horário por
  agenda, preço automático, turmas, bloqueios, links de agendamento, trilha; **séries recorrentes**
  (D9: frequência, fim por data, por sessões ou sem fim, sessões ligadas à série); particular ou
  plano do atendimento, copiado do paciente (D10). RLS também pelo acesso às agendas. (`appointments`, `schedule_blocks`, `booking_links`, `appointment_events`.)
- **F2.5 — Lista de espera:** inscrições, vagas abertas, ofertas e o gatilho. (`waitlist_*`.)
- **F2.6 — WhatsApp e rotinas:** estado da conversa, mensagens, funil, conexão e templates do
  WhatsApp por clínica, execuções das rotinas, envios do resumo, contadores de uso.
  (`conversation_state`, `whatsapp_messages`, `bot_funnel_events`, `job_runs`,
  `daily_summary_sends`.)
- **F2.7 — Dados de teste e isolamento completo:** duas clínicas fictícias (uma com vários
  profissionais e recepção restrita a parte das agendas); varredura de isolamento em todas as
  tabelas para usuário, bot e agendador.

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
contatos, equipe e acesso de cada pessoa às agendas); depois Agenda (com **escolha da agenda/
profissional a exibir**, D2 revista), **séries recorrentes** (criar, pular conflitos com aviso,
alterar "só esta" ou "esta e as próximas", D9), Pacientes, Resumo do Dia, Métricas, Trilha.
Vocabulário pelo perfil da clínica.

## F5 — Páginas públicas e domínio

**Objetivo:** links públicos com a marca da clínica, no endereço do produto.

**Escopo:** `/agendar` e `/preparo` com nome, logo, cor e profissionais da clínica; aplicativo em
`app.recepclinic.com.br`; links para a política de privacidade e os termos, que ficam no site do
produto (projeto separado, ver D7). O botão "Voltar para o site", removido na F0.2 (decisão do
cliente, 03/out), volta apontando para o site da clínica, só quando ela tiver um.

## F6 — WhatsApp por clínica e bot

**Objetivo:** o bot atendendo pela conexão de cada clínica.

**Escopo:** criação do **staging** (projeto Supabase, preview da Vercel e o **chip novo de testes do
RecepClinic**, comprado pelo cliente; o número usado no piloto não pertence ao cliente e não é usado
aqui);
conexão guardada por clínica (cadastrada pelo Suporte nesta fase); webhook que identifica a
clínica pelo `phone_number_id` e responde rápido; envio por clínica; templates padrão do
RecepClinic com nome e idioma por clínica; bot com menus montados pelo catálogo de serviços e textos
pelo perfil; **"com quem?"** quando o serviço tem mais de um profissional, com "primeiro horário
disponível" (D2 revista); sessão de série cancelada ou remarcada sozinha (D9); coexistência e pausa
da recepção.

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

## Depois do 1º piloto (já previsto no banco)

- **Convênios (D10):** telas de planos atendidos e exceções por profissional; plano no cadastro do
  paciente e no atendimento; no bot, convênio pedido junto com o nome, busca por semelhança,
  confirmação única de nome, idade e convênio, e "particular, outro nome ou recepção" quando não
  atendido; dados do convênio na página de data e horário, se a clínica exigir.

---

## Frentes paralelas (fora deste repositório)

| Frente | Situação | Depende de | Destrava |
|---|---|---|---|
| **Site do RecepClinic** (`www.recepclinic.com.br`, repositório separado) | **planejado**: [`site-plano.md`](site-plano.md), execução numa sessão paralela | — | Tech Provider; páginas legais usadas pela F5 |
| **Cadastro como Tech Provider na Meta** (verificação da empresa, app do RecepClinic, análise) | **pendente, a tratar depois da construção do site** | site no ar com política de privacidade e termos; CNPJ | F8 (e a conexão de números de outras clínicas) |

## Pendências do cliente que afetam o plano

| Pendência | Necessária para |
|---|---|
| Verificação da empresa e Tech Provider na Meta (CNPJ, site) | F8 (começar já, por causa do prazo) |
| Site `www.recepclinic.com.br` com política de privacidade e termos (projeto separado) | F8 (Meta) e F5 |
| Chip novo de testes do RecepClinic (WhatsApp) | F6 |
| CNPJ, contrato com as clínicas, termo de tratamento de dados | F10 |
| Custo da Meta por mensagem | definição de preço (fora do código) |
