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
| F2 | Schema novo | concluída (04/out; 158 testes de banco) |
| F3 | Acesso ao banco e contexto da clínica | concluída (05/out) |
| F4 | Painel | concluída (05/out; validada pelo cliente) |
| F5 | Páginas públicas e domínio | concluída (06/out; validada pelo cliente) |
| F6 | WhatsApp por clínica e bot | concluída (08/out; validada pelo cliente, menos o que depende de templates em análise) |
| F7 | Envios automáticos por clínica | concluída (09/out; validada pelo cliente com os templates aprovados) |
| F8a | Templates pela API: reenviar recusado e excluir sem uso | concluída (12/out; validada pelo cliente) |
| F8 | Conexão self-service na Meta | a detalhar (depende da Meta) |
| F9 | Operação e segurança | concluída (10/out; validada pelo cliente) |
| F10 | Primeiro piloto | a detalhar |
| F11 | Módulo financeiro: pagamentos e nota fiscal no CPF do responsável (NFS-e nacional e DMED) | em andamento (12/out; antecipada pelo cliente) |

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
  exceções por profissional e a opção "exigir dados do convênio na marcação" (D10). **Concluída em 04/out**
  (44 testes de banco). Padrões assumidos: profissional pode existir sem login; preço no serviço com
  preço próprio opcional por local; intervalo entre atendimentos por agenda; fuso padrão
  America/Fortaleza. (Substitui `appointment_settings`, `clinic_locations`, `exam_types`, `availability_windows`,
  `exam_type_group_schedule`, `notification_recipients`.)
- **F2.3 — Pacientes:** contatos e pacientes, telefone único por clínica; plano do paciente
  (particular ou plano, carteirinha, validade; D10). (`guardians`, `patients`.) **Concluída em 04/out** (17 testes de
  banco; toda a equipe vê todos os pacientes, D6). O banco recusa nascimento futuro (fuso da
  clínica) e data inexistente: achados 1 e 2 da F1.2 resolvidos no banco (a mensagem da tela fica
  para a F3/F4).
- **F2.4 — Atendimentos e séries:** atendimentos ligados a serviço e agenda, trava de horário por
  agenda, preço automático, turmas, bloqueios, links de agendamento, trilha; **séries recorrentes**
  (D9: frequência, fim por data, por sessões ou sem fim, sessões ligadas à série); particular ou
  plano do atendimento, copiado do paciente (D10). RLS também pelo acesso às agendas.
  (`appointments`, `schedule_blocks`, `booking_links`, `appointment_events`.) **Concluída em 04/out**
  (30 testes de banco). Gerar as sessões da série, pular conflitos e alterar "esta e as próximas"
  ficam na aplicação (F4).
- **F2.5 — Lista de espera:** inscrições, vagas abertas, ofertas e o gatilho. (`waitlist_*`.) **Concluída em 04/out** (16 testes de banco). A
  vaga vai só para quem espera na mesma agenda e no mesmo serviço (D2); sessão de série não entra
  na fila (D9). A chamada do gatilho à rota das ofertas entra na F7.
- **F2.6 — WhatsApp e rotinas:** estado da conversa, mensagens, funil, conexão e templates do
  WhatsApp por clínica, execuções das rotinas, envios do resumo, contadores de uso.
  (`conversation_state`, `whatsapp_messages`, `bot_funnel_events`, `job_runs`,
  `daily_summary_sends`.) **Concluída em 04/out** (19 testes de banco). Token da
  Meta no Vault do Supabase, lido só pelo bot da própria clínica; webhook descobre a clínica pelo
  `phone_number_id`; rotinas registradas por clínica; contadores de uso por mês.
- **F2.7 — Dados de teste e isolamento completo:** duas clínicas fictícias (uma com vários
  profissionais e recepção restrita a parte das agendas); varredura de isolamento em todas as
  tabelas para usuário, bot e agendador. **Concluída em 04/out**: `supabase/seed.sql` com
  as duas clínicas e logins locais (README); varredura automática pelo catálogo (RLS em toda tabela,
  ligação direta com a clínica, registro do Suporte, leitura e escrita bloqueadas para o
  Administrador e o bot de outra clínica e para o acesso anônimo, cobertura de dados em todas as
  tabelas). **F2 concluída** (158 testes de banco).

## F3 — Acesso ao banco e contexto da clínica

**Objetivo:** concentrar o acesso ao banco por domínio e fazer toda requisição saber de qual
clínica é.

**Escopo:** camada de acesso por domínio (agenda, pacientes, serviços, mensagens, configuração…);
clínica ativa a partir do login; **credencial limitada à clínica** para bot, agendador e páginas
públicas (fim da service role nesses caminhos); validação das variáveis de ambiente da plataforma
(L39); biblioteca de datas com fuso por clínica (L40).

**Detalhada em 04/out** (divisão aprovada pelo cliente). A F3 entrega o acesso ao banco testado
contra o Supabase local; as telas e APIs do painel são ligadas a ele na F4, e páginas públicas, bot
e envios nas F5–F7. Até lá o painel não abre com dados (o código antigo usa tabelas que o schema
novo não tem). Etapas (cada uma com `npm test`, `test:db`, `check`, `build` e CI verdes):

- **F3.1 — Base técnica:** tipos do banco gerados pela CLI do Supabase (o código passa a acusar
  tabela ou coluna inexistente); validação das variáveis de ambiente da plataforma na subida (L39);
  biblioteca de datas com fuso por clínica (L40). **Concluída em 04/out**: `npm run db:types` gera
  `src/lib/supabase/database.types.ts` e o CI confere que está em dia com as migrações;
  `src/lib/env.ts` confere as variáveis da plataforma no middleware (erro 500 com a lista no log);
  `src/lib/clinicTime.ts` com `date-fns` e `@date-fns/tz` (data e hora da clínica, começo e fim do
  dia, horário de verão), testado também com o servidor em outro fuso. A conversão de hora local
  para instante é feita à mão porque o `TZDate` escolhe a hora repetida do horário de verão pelo
  fuso do servidor. O código antigo continua com os clientes sem tipo e o "-03:00" fixo; cada
  domínio passa para os tipos e para `clinicTime` na sua etapa (F3.4–F3.9). 33 testes novos.
- **F3.2 — Contexto da clínica:** clínica ativa a partir do login, papéis e agendas acessíveis em
  cada requisição; fim de `staff_profiles`. Quem é membro de várias clínicas cai na última usada; a
  tela de escolha é da F4. **Concluída em 04/out**: o middleware monta o contexto
  (`src/lib/data/clinicContext.ts`: clínica, fuso, perfil, papéis e agendas acessíveis, lidos com o
  login da pessoa, sob RLS) e guarda a última clínica num cookie do navegador; sem cookie, abre a
  clínica em que a pessoa entrou primeiro. Login sem papel em clínica nenhuma sai com "sem acesso".
  Áreas da D6 na aplicação (`src/lib/clinicAccess.ts`): Configurações só do Administrador;
  Métricas e relatórios do Administrador e do Profissional; o resto de todos (no piloto,
  Configurações era da secretária também). O Suporte abre qualquer clínica pelo
  `POST /api/admin/clinica-ativa` (a tela de escolha é da F4) e **cada leitura dele fica registrada**
  em `platform_access_log` (migração `20261004190000`; sem o registro, a página não responde).
  Pendências para a F4: tela de escolha da clínica; aba Envios para a Recepção (D6; hoje é aba de
  Métricas); a trilha mostra o papel de quem fez (antes "Secretária"/"Médica"), e nome ou papel se
  decide na F3.6. 14 testes unitários e 15 de banco novos.
- **F3.3 — Credencial limitada:** emissão do token `clinic_service` da clínica da requisição para
  bot, agendador e páginas públicas; service role só em rotinas da plataforma. **Concluída em
  04/out**: `createClinicServiceClient(clinicId)` (`src/lib/data/clinicService.ts`) assina um token
  de 15 minutos com `SUPABASE_JWT_SECRET` (nova variável obrigatória). A service role ficou presa em
  `src/lib/data/platform.ts`, que só descobre a clínica de cada porta pública: número do WhatsApp
  (função da F2.6), link de agendamento e serviço da página de preparo (migração `20261004200000`);
  o resto segue com a credencial limitada. Um teste de arquitetura reprova qualquer arquivo novo com
  a service role e lista os herdados do piloto com a etapa em que saem (páginas públicas na F5, bot
  na F6, rotinas na F7, retirada da lista de espera na F3.7). **Conferir ao criar o projeto na
  nuvem:** o esquema de assinatura (segredo compartilhado HS256, como no local; alternativa: chave
  ES256 própria importada). 8 testes unitários e 8 de banco novos.
- **F3.4 a F3.7 e F3.9 — Acesso por domínio:** configuração; pacientes; agenda (atendimentos, séries,
  bloqueios, links); lista de espera; WhatsApp e rotinas. Cada uma com testes de integração,
  incluindo as regras que a F1 deixou para o banco (elegibilidade do retorno, conflitos de exame,
  ofertas e reenvios), e corrigindo os achados 1–5 da F1 onde aparecerem.
- **F3.4 — Configuração: concluída em 04/out.** `src/lib/data/config/`: perfil e identidade da
  clínica, profissionais, locais, agendas e acesso de cada membro às agendas, serviços (agendas e
  locais com preço próprio), dias e horários, feriados extras, contatos do resumo do dia, planos de
  saúde (busca e exceções por profissional). Base comum em `src/lib/data/errors.ts` (erros do banco
  traduzidos: inválido, repetido, não encontrado, em uso, sem permissão, conflito). **Decisão do
  cliente (04/out): a sobreposição de horários vale por agenda**, mesmo em locais diferentes; na
  mesma agenda e no mesmo dia conflitam horário geral com qualquer outro, o mesmo serviço consigo
  mesmo e turma com qualquer outro; serviços individuais diferentes podem dividir horário (regra do
  piloto para exames); agendas diferentes nunca conflitam. Padrões assumidos (revisáveis): a
  categoria do serviço e o tipo e o profissional da agenda não mudam depois de criados; horário de
  um serviço só numa agenda que atende o serviço; turma exige vagas e individual não aceita (piloto);
  profissionais, locais, agendas, serviços, contatos e planos saem por desativação, horários e
  feriados podem ser apagados (piloto). Sem limites novos além dos do banco e do piloto (endereço do
  local continua opcional). Cuidado novo: insert com `.select()` em `agendas` falha no RLS (a
  leitura consulta a própria tabela); gerar o id na aplicação e ler depois. 23 testes unitários e 24
  de banco novos.
- **F3.5 — Pacientes: concluída em 04/out.** `src/lib/data/patients.ts`: contatos (busca por nome
  ou telefone, edição, desativação) e pacientes (cadastro pela tela ou pelo bot, edição, plano do
  paciente da D10, busca, desativação), com as regras do cadastro do piloto (Fase 21): só maior de
  18 é o próprio contato, inclusive ao editar; telefone já cadastrado reaproveita o contato (e o
  reativa), e sendo o próprio paciente pede confirmação de que é a mesma pessoa; um só "próprio
  paciente" por contato; o nome do contato acompanha o do próprio paciente; idade limite da
  consulta só avisa. **Achados da F1:** (1) e (2) resolvidos na camada nova e no banco (data que
  existe, até hoje no fuso da clínica); a cópia antiga em `criancas/index.ts` e o
  `isValidBirthdate` herdado saem com as telas antigas na F4. (3) `formatAge` com nascimento no
  futuro mostra **"nascimento inválido"** (decisão do cliente, 04/out). Padrão assumido
  (revisável): o aviso de possível duplicado (mesmo contato e mesmo nascimento) vale sempre que o
  contato já existe; no piloto, só ao incluir paciente pela tela do responsável. O aviso "já tem
  atendimento marcado" da busca entra com a agenda (F3.6). 5 testes unitários e 14 de banco novos.
- **F3.6 — Agenda:** dividida em duas partes (cliente, 04/out). **F3.6a:** horários livres por
  agenda, serviço, local e dia (janelas, bloqueios, feriados, atendimentos, intervalo, fuso), próximas
  datas, vagas de turma e "primeiro horário disponível" entre as agendas do serviço (D2); marcar,
  remarcar, cancelar (individual e do dia), presença, realizado e falta, trilha, elegibilidade do
  retorno (Fase 17) e o aviso "já tem atendimento marcado". **F3.6b:** bloqueios (com o cancelamento
  dos atendimentos atingidos) e links de agendar/remarcar; séries recorrentes da D9 (gerar pulando
  conflitos, "só esta" / "esta e as próximas", encerrar, horizonte das séries sem fim). Reenvios e
  achados 4–5 ficam na F3.9 (antes F3.8; a F3.8 passou a ser a matriz de acesso, D11).
- **F3.6a — concluída em 04/out.** `src/lib/data/agenda/`: cálculo puro dos horários livres com o
  fuso da clínica (`freeSlots.ts`, mesmos casos da F1 e horário de verão), horários livres, próximas
  datas, "primeiro disponível" e sessões de turma (`slots.ts`), e marcar, remarcar, cancelar
  (individual e vários), presença, realizado/falta e trilha (`appointments.ts`). **Decisões do
  cliente (04/out):** a trava "já tem atendimento futuro" vale **por agenda** para Consulta/Retorno
  (Exame: o mesmo exame, como no piloto); o retorno se liga à **última consulta na mesma agenda**,
  com o **prazo do serviço de Retorno**. Mantido do piloto: o horário precisa estar entre os livres
  calculados na hora; domiciliar exige endereço; marcar invalida os links pendentes do mesmo
  serviço; remarcar zera lembrete e presença; cancelar é atômico; retorno na tela só avisa.
  Padrões assumidos (revisáveis): serviço individual usa as janelas gerais da agenda e as do
  próprio serviço, turma só as suas; no "tapar buracos" do retorno, a duração de referência é a
  menor Consulta ativa da agenda; turmas respeitam os bloqueios da agenda (no piloto, não olhavam a
  agenda); no "primeiro disponível", horário repetido fica com a primeira agenda em ordem de nome;
  realizado/falta não vale para atendimento cancelado; Retorno sem prazo cadastrado não tem limite.
  O link de remarcação e o aviso por WhatsApp do cancelamento em massa entram com os links (F3.6b)
  e o bot (F6/F7). 26 testes unitários e 17 de banco novos.
- **F3.6b — concluída em 04/out.** `src/lib/data/agenda/`: links de agendar/remarcar (`links.ts`:
  30 minutos no bot, 2 dias na remarcação pela clínica, uso atômico, prazo do retorno), bloqueios e
  cancelamento do dia pela clínica com link de remarcação (`blocks.ts`) e séries recorrentes da D9
  (`series.ts`). **Decisões do cliente (04/out):** séries sem fim mantêm as sessões **até 3 meses à
  frente** (o agendador estende, F7); **sessões de série não contam na trava** "já tem atendimento
  futuro" (nem a série é barrada por um avulso); no fim por número de sessões, **a data pulada não
  conta e a série se estende** até completar. Migração `20261004210000`: o agendador
  (`clinic_service`) registra as datas puladas da própria clínica. Padrões assumidos (revisáveis):
  o bloqueio atinge os atendimentos que **cruzam** o período (no piloto, só os que começavam
  dentro), e cancela só a lista escolhida na tela; o link de remarcação mantém a mesma agenda e o
  tipo de local; a série não confere os horários de atendimento (dia e horário combinados), turma
  não tem série e o local precisa oferecer o serviço; sessão cancelada uma a uma conta no número de
  sessões (só a data pulada estende); "esta e as próximas" com mudança de dia/horário encerra a
  série e abre outra com o mesmo fim por data, ou com as sessões que faltavam; hoje com o horário já
  passado não vira sessão nem data pulada. 8 testes unitários e 12 de banco novos (montagem da
  clínica de teste da agenda em `tests/db/agendaFixture.ts`). **F3.6 concluída.**
- **F3.7 — Lista de espera:** dividida em duas partes (cliente, 04/out). **F3.7a:** entrar, sair,
  consultar a fila (tela e selo da agenda) e retirada pela tela sem service role. **F3.7b:** motor
  de ofertas (vencer ofertas, tirar da fila quem já passou, oferecer a vaga ao próximo da mesma
  agenda e serviço, "Sim"/"Não"), com o envio do WhatsApp recebido de fora (ligado na F6/F7).
- **F3.7a — concluída em 04/out.** `src/lib/data/waitlist/entries.ts`: entrar (já estar na fila
  não é erro), sair pelo bot ("saiu") ou pela tela ("retirado", com quem retirou), quem está na
  fila (selo da agenda), a fila na ordem de entrada com atendimento, paciente, contato e oferta em
  aberto (filtro por agenda) e o histórico das últimas ofertas; tudo na trilha. **Decisão do
  cliente (04/out): a recepção também inclui na lista pelo painel** (pedido por telefone ou no
  balcão). Migração `20261004220000`: origem `admin` na inscrição e gatilho que, quando alguém sai
  da lista, retira a oferta em aberto e devolve a vaga à fila. Com isso a rota de retirada pela
  tela saiu da service role (passou para a camada nova). Padrões assumidos (revisáveis): só entra
  atendimento marcado ou confirmado e ainda no futuro; quem sai pelo bot também perde a oferta em
  aberto (no piloto, só quem era retirado pela tela). 4 testes unitários e 7 de banco novos.
- **F3.7b — concluída em 04/out.** `src/lib/data/waitlist/offers.ts`, com a credencial da clínica:
  rodada por clínica (vence ofertas sem resposta, tira da fila quem já passou do horário, oferece
  as vagas abertas), oferta da vaga e resposta "Sim" (antecipa pela regra de remarcar, com
  "antecipado pela lista" na trilha, tira da fila e preenche a vaga) ou "Não" (a vaga passa ao
  próximo na hora). Regras do piloto mantidas: vaga só com mais de 2h, ainda livre e sem horário
  livre antes dela; um por vez, por ordem de entrada, 60 minutos para responder; só quem está
  marcado depois da vaga; só o contato do paciente responde; quem não pode receber é pulado nessa
  vaga (até 20 por rodada). Com a D2: só quem espera **na mesma agenda e no mesmo serviço**, e no
  mesmo tipo de local (consultório com consultório, domiciliar com domiciliar, como no piloto). O
  envio pelo WhatsApp (template ou texto com botões, janela de 24h) e o aviso de remarcação ficam
  com quem chama (bot na F6, agendador na F7); o motor recebe a função que envia. Padrão assumido
  (revisável): retirado da lista pela tela, a vaga volta à fila e é oferecida ao próximo na rodada
  seguinte do agendador (no piloto, na hora). 9 testes unitários e 7 de banco novos. **F3.7
  concluída.**
- **F3.8 — Matriz de acesso (D11, cliente, 05/out):** entra antes do WhatsApp e das rotinas, que
  passam a ser a F3.9. Escopo: itens da matriz no código (telas, abas e funções, com rótulo, área,
  dependências e as rotas de cada um); itens liberados por clínica no banco, gravados só pelo
  Administrador do sistema (Suporte), com quem mudou e quando, e lidos pela equipe e pelo bot da
  própria clínica; o contexto da clínica passa a trazer os itens liberados e o middleware barra
  rota de item desligado; regra nova das métricas (Profissional só com "Métricas pessoais", só a
  própria agenda); a camada de acesso já feita passa a respeitar os itens (serviço de exame, local
  domiciliar, séries, convênios, lista de espera, hora do lembrete, contatos do resumo); acesso do
  Administrador do sistema para listar as clínicas e ler e gravar a matriz; dados de teste com
  tudo liberado. A tela da matriz é da F4; bot e envios checam os itens na F6/F7.
- **F3.8 — concluída em 05/out.** Itens da matriz em `src/lib/features.ts` (17 itens: agenda,
  WhatsApp e métricas aba a aba, com as dependências do bot) e na tabela `features` (um teste
  confere que são iguais). Migração `20261005120000`: itens liberados por clínica
  (`clinic_features`, com quem liberou e quando; o que sai fica no registro do Suporte), gravados
  só pela função `set_clinic_features` (Administrador do sistema; recusa item sem o item de que
  depende) e lidos pela equipe e pelo bot da própria clínica; **travas no banco**: com o item
  desligado não se cadastra serviço de exame, local domiciliar, convênio (plano, exceção, plano do
  paciente) nem contato do resumo, não se marca exame, domiciliar ou série e não se entra na lista
  de espera, nem chamando a API direto (erro `not_enabled` na camada de acesso). Desativar o que
  já existe, cancelar e registrar comparecimento continuam livres. O contexto da clínica traz os
  itens liberados e o middleware barra a rota (e a aba, pelo `?tab=`) de item desligado, para
  todos os papéis e para o Suporte. Métricas (muda a D6): o Administrador da clínica precisa de
  alguma aba liberada; o Profissional só entra com "Métricas pessoais", e o escopo é a própria
  agenda (`metricsScope`, `ownAgendaIds`). Na camada pronta: o motor da lista de espera não roda
  sem o item; o cancelamento pela clínica só gera link de remarcação com o bot liberado. Acesso do
  Administrador do sistema: clínicas com os itens liberados, gravar a matriz e o histórico de
  mudanças (`src/lib/data/features.ts`). Dados de teste e clínicas dos testes com tudo liberado
  (`createClinic(nome, itens)` escolhe outros). Padrões assumidos (revisáveis): o Suporte, ao
  abrir uma clínica, vê só o que ela tem liberado; item ligado de novo mantém quem o liberou
  primeiro; sem aba de Métricas liberada, o menu Métricas some até para o Administrador. 12 testes
  unitários e 11 de banco novos.
- **F3.9 — WhatsApp e rotinas** (antes F3.8): conexão e templates, conversas, mensagens e funil;
  lembrete e reenvios; resumo do dia e execuções das rotinas; achados 4–5 da F1. Dividida em
  três partes (cliente, 05/out): **F3.9a** WhatsApp (conexão e templates por
  clínica, estado da conversa e pausa da recepção, registro das mensagens com situação da entrega,
  repetidas da Meta e janela de 24h, funil); **F3.9b** lembrete e reenvios (quem recebe no fuso e
  hora da clínica, botões "Enviar"/"Reenviar lembrete", reenvio automático sem resposta, reenvio
  do preparo, achado 4); **F3.9c** resumo do dia e execuções das rotinas (horário pelas janelas das
  agendas, conteúdo, contatos, reenvio quando entra atendimento antes do horário avisado,
  `job_runs`, achado 5). Envio de verdade pelo WhatsApp recebido de fora (F6/F7), como na F3.7b;
  cada parte respeita os itens da matriz (D11).
- **F3.9a — concluída em 05/out.** `src/lib/data/whatsapp/`: conexão e token da Meta (Vault) e
  templates por clínica, gravados pelo Suporte, vistos pela equipe e usados pelo bot só quando
  conectada e com template aprovado (`connection.ts`); registro das mensagens recebidas, enviadas e
  do eco da recepção pelo app, situação da entrega sem regredir e com a chegada ao celular vista
  uma vez só, janela de 24h (com a margem de 23h30) e leitura por atendimento ou contato
  (`messages.ts`); conversa (estado, contato, tentativa do funil, abandono), pausa da recepção e
  volta ao bot por `#bot` ou pelo prazo (`conversations.ts`); funil do bot e da página de agendar
  (`funnel.ts`); regras puras dos eventos da Meta (`meta.ts`: telefone com o 9 do celular, texto
  da mensagem, ordem das situações). **Decisão do cliente (05/out):** o prazo da pausa (24h) que
  cair em **sábado, domingo ou feriado da clínica** (nacional ou próprio) passa para o próximo dia
  útil no mesmo horário, no fuso da clínica (no piloto, feriado não contava). Migração
  `20261005130000`: fluxo "handoff" no funil (o piloto grava pedido e recepção que assume, e a F2.6
  o deixou de fora); telefone na mensagem; repetidas da Meta barradas também nos ecos; início da
  pausa em campo próprio (no piloto, `updated_at`); conversa e funil só com o item "Bot de
  WhatsApp" liberado. Padrões assumidos (revisáveis): mensagens são registradas mesmo sem o bot
  liberado (o lembrete e o resumo têm itens próprios); mensagem repetida da Meta não é tratada de
  novo (no piloto, o roteador rodava outra vez); a janela de 24h é por número, inclusive de quem
  ainda não é contato (no piloto, só de responsável cadastrado); pausar e devolver a conversa pela
  tela não existe no piloto e não entrou. Envio de verdade, roteador do bot e webhook na F6. 12
  testes unitários e 16 de banco novos.
- **F3.9b — concluída em 05/out.** `src/lib/data/whatsapp/reminders.ts`: lembrete da véspera
  (rodada por clínica, de hora em hora: na hora do lembrete da clínica, os atendimentos ativos do
  dia seguinte no calendário dela; execução em `job_runs`, `src/lib/data/jobRuns.ts`), botões
  "Enviar"/"Reenviar lembrete" (falhou, ou entregue e sem resposta há 2h; "Enviar" só depois do
  envio da véspera; só contam as tentativas depois da última remarcação), reenvio automático (4h
  sem resposta, uma vez, entre 7h e 20h da clínica, não a menos de 2h do atendimento, não depois
  do botão) e resposta aos botões do lembrete (só o contato do paciente, atendimento ativo, futuro
  e com o lembrete de pé; "Confirmar" marca a presença pelo WhatsApp e o toque fica ligado ao
  atendimento). `preparation.ts`: preparo do exame uma única vez, quando a confirmação chega ao
  celular (texto com a janela de 24h aberta, template com ela fechada), e "Reenviar preparo do
  exame" quando a última tentativa não chegou. Tudo pelo item da matriz (D11: "Lembrete
  automático"; preparo com "Exames e procedimentos") e só com o WhatsApp conectado; o envio de
  verdade é recebido de quem chama (F6/F7), como na F3.7b. Migração `20261005140000`: resposta ao
  lembrete no atendimento (a F2.4 a deixou de fora), zerada ao remarcar, inclusive turma.
  **Achado 4 da F1 resolvido**: os avisos da tela só aceitam os próprios códigos
  (`Object.hasOwn`), na camada nova e nas funções herdadas. Padrões assumidos (revisáveis): sem
  conexão, o lembrete não sai e fica "não enviado" na trilha como no template desligado (novo
  motivo "WhatsApp desconectado"); o "sem telefone" do piloto sumiu (o contato sempre tem
  telefone); o reenvio automático usa as mesmas condições de envio. 15 testes unitários e 13 de
  banco novos.
- **F3.9c — concluída em 05/out.** `src/lib/data/whatsapp/dailySummary.ts`: resumo do dia por
  clínica, com a véspera às 18h e o do dia 1h antes do início (primeira janela do público ou
  primeiro atendimento; sem janela ou em feriado nacional ou da clínica, 6h30), novo envio quando
  entra atendimento antes do horário avisado, lista vazia não envia, sem template aprovado fica
  como "não enviado". **Decisões do cliente (05/out, D2 revista):** além dos contatos do resumo
  (clínica inteira, consultas e exames, com o **nome da agenda em cada item** quando a lista tem
  mais de uma agenda), **cada profissional recebe o resumo dos próprios atendimentos** no telefone
  do cadastro, se marcar "Recebe o resumo do dia", **com o horário pela agenda dele** e também
  separado em consultas e exames. **Achado 5 da F1 resolvido** (cliente): o resumo do dia
  **nunca sai antes da 0h** do próprio dia e a tela mostra "0h" (antes, "23h30" sem dizer que era a
  véspera), na camada nova e nas funções herdadas. `src/lib/data/sends.ts`: execuções das rotinas
  (`job_runs`, com "travada" depois de 15 minutos), atendimentos com envio com falha (regra do
  piloto) e o alerta do painel pela hora do lembrete e o fuso da clínica; `jobRuns.ts` grava as
  execuções. Cadastro do profissional com telefone e a opção do resumo (`config/professionals.ts`).
  Migração `20261005150000`: telefone e opção no profissional (a opção exige o item "Envio do
  resumo do dia"), público (profissional) e envio (véspera ou do dia) no registro dos resumos.
  Padrões assumidos (revisáveis): o feriado da clínica também usa a reserva das 6h30 (no piloto, só
  o nacional); janela geral de uma agenda conta para os tipos de serviço que a agenda atende; agenda
  de recurso (ex.: "Exames") só vai na lista geral; o da véspera também fica registrado (no piloto
  era chamado uma vez às 18h em ponto; com várias clínicas, o agendador passa de tempos em tempos);
  sem conexão, o resumo não roda. 14 testes unitários e 10 de banco novos. **F3.9 concluída. F3
  concluída.**

**Cuidado registrado na F2.5:** num insert de várias linhas, o `supabase-js` manda `null` nas
colunas ausentes de alguma linha, e o valor padrão do banco não é aplicado (ex.: `details` da
trilha). Mandar todas as colunas em todas as linhas, ou usar `defaultToNull: false`.

## F4 — Painel

**Objetivo:** o painel funcionando sobre o modelo novo, começando pela configuração.

**Escopo:** login, convite e recuperação de senha, escolha de clínica, papéis; **tela da matriz de
acesso** do Administrador do sistema (escolher a clínica e marcar os itens, D11); menus e abas
seguindo os itens liberados. **Configurações**
(perfil, identidade, profissionais, locais, serviços, agendas, disponibilidade, feriados extras,
contatos, equipe e acesso de cada pessoa às agendas); depois Agenda (com **escolha da agenda/
profissional a exibir**, D2 revista), **séries recorrentes** (criar, pular conflitos com aviso,
alterar "só esta" ou "esta e as próximas", D9), Pacientes, Resumo do Dia, Métricas, Trilha.
Vocabulário pelo perfil da clínica.

**Dividida em nove partes (cliente, 05/out),** cada uma com validação:
- **F4.1 — Base do painel:** login, recuperação de senha, aceite do convite, escolha de clínica
  (membro de várias e Suporte), menus e abas pelos papéis e itens liberados, vocabulário pelo
  perfil da clínica, alerta de envios.
- **F4.2 — Matriz de acesso:** tela do Administrador do sistema (clínica, itens, histórico).
- **F4.3 — Configurações I:** perfil e identidade, profissionais (telefone e resumo), locais,
  serviços (preço por local, preparo), agendas.
- **F4.4 — dividida em duas partes (cliente, 05/out):**
  - **F4.4a — Nova clínica e pedido de informações:** tela "Nova clínica" do Suporte (nome,
    perfil, fuso e e-mail do primeiro Administrador; **o convite sai sempre na criação**; nasce com
    a matriz desligada e limite de 1 profissional); **pedido de informações por e-mail** com
    **formulário por link** (8 seções, campos para o simples e texto livre com exemplo para
    serviços, horários e feriados, só o que estiver liberado), para quando o Administrador prefere
    que o Suporte configure; respostas na tela do Suporte, que revisa e cadastra. Envio de e-mail
    próprio (local: Mailpit; na nuvem, provedor de e-mail, pendência do cliente).
  - **F4.4b — Configurações II:** dias e horários, feriados extras, contatos do resumo, hora do
    lembrete, convênios, equipe (convites, com o mesmo envio) e acesso às agendas, situação do
    WhatsApp.
  - **F4.4a — concluída em 05/out.** Telas do Suporte em `/admin/sistema/clinicas`: lista (convites
    sem resposta, situação do pedido), **"Nova clínica"** (nome, perfil, fuso, e-mail do primeiro
    Administrador; criada com o login do Suporte, que fica no registro; nasce com a matriz desligada
    e limite de 1; o convite sai na hora; quem já tem login é só incluído e recebe um aviso) e o
    detalhe (convites com "Reenviar convite", "Abrir a clínica para configurar", **"Pedir as
    informações ao Administrador"** e as respostas, com "Marcar como revisado"). **Formulário
    público** em `/formulario/[código]` (só o hash do código fica no banco; vale 30 dias; rascunho e
    envio; as 8 seções, só o que está liberado; depois de enviado ou vencido, não muda; salvo pela
    credencial da clínica, D1). **E-mail próprio por SMTP** (`src/lib/email.ts`, `nodemailer`;
    variáveis opcionais `SMTP_*` e `EMAIL_FROM`; localmente, o Mailpit na porta 54325); sem envio, a
    clínica e o pedido são criados e o painel avisa (o link do pedido aparece uma vez para o Suporte
    mandar por outro meio). Links de convite e de senha passam a valer 24 horas. Migração
    `20261005180000`: convites por clínica (`clinic_invitations`, aceito quando a pessoa cria a senha),
    pedidos de informações (`onboarding_requests`, com trava para a página pública) e as funções da
    plataforma (login por e-mail, clínica do link). Correção: as travas do formulário e do limite
    de profissionais rodam como dono do banco (a credencial da clínica não lê o esquema `auth`).
    Padrões assumidos (revisáveis): enviar ao Suporte exige ao menos o nome da clínica (o resto
    pode ficar em branco); o Suporte acompanha as respostas pela tela (sem e-mail de aviso ao
    Suporte); o link do pedido vale 30 dias. 8 testes unitários e 7 de banco novos.
    **Ajuste pedido na validação (cliente, 05/out): RQE no cadastro do profissional**, campo
    opcional que aceita mais de um número separado por vírgula ("6271, 8890"), também no
    formulário de informações; o registro aparece como "CRM 5751 RN | RQE 6271"
    (`professionalRegistry`, para a assinatura das mensagens na F6). Migração `20261005190000`.
    3 testes unitários e 1 de banco novos.
  - **F4.4b — concluída em 05/out** (cliente: numa etapa só). Cinco abas novas em Configurações:
    **Horários** (escolhe a agenda; horários por dia e local, só de um serviço ou com vagas de
    turma; o mesmo horário em vários dias de uma vez, conferidos antes e gravados juntos, e um
    conflito num dia não grava nenhum; desativar, reativar e remover); **Feriados** (os da clínica,
    com aviso próprio para data repetida, e os nacionais dos próximos 12 meses, só leitura, agora
    com nome em `listNationalHolidays`); **Convênios**, só com o item (planos com outros nomes e
    código ANS, "pedir carteirinha e validade" e quem atende cada plano, desmarcar = exceção);
    **Equipe** (e-mail, papéis, convite pendente, profissional ligado e acesso às agendas;
    convidar com o mesmo envio da F4.4a, reenviar convite, salvar e remover da clínica, o que
    tira o convite e permite convidar de novo); **WhatsApp** (situação da conexão, só leitura, com
    o cadastro pelo Suporte até a F8; **hora do lembrete**, com o item; e quem recebe o resumo
    do dia, com o item: os profissionais marcados no cadastro e os outros contatos, com nome,
    WhatsApp, consultas e, com o item de exames, exames). **Decisões do cliente (05/out):** hora do
    lembrete em **horas cheias das 7h às 20h**, como no piloto (também no banco); **o papel
    Profissional exige o cadastro de profissional ligado ao login** (um cadastro, um login; tirar
    o papel solta o cadastro; D6). O convite segue a D6 no acesso às agendas (todas para
    Administrador e Recepção, a própria para o Profissional). Migração `20261005200000`: faixa do
    lembrete e `list_clinic_member_emails` (e-mails da equipe, só para o Administrador e o
    Suporte). Saiu a rota antiga `/api/admin/envios/reminder-hour`, que gravava no schema do
    piloto. Padrões assumidos (revisáveis): ninguém tira o próprio papel de Administrador nem se
    remove da equipe (outro Administrador faz); remover um horário não mexe nos atendimentos já
    marcados; profissional desativado sai da lista de quem atende o plano, e as exceções dele
    ficam como estão. 4 testes unitários e 11 de banco novos.
    **Ajuste pedido na validação (cliente, 05/out): item desligado depois de criado.** Um local
    domiciliar (ou serviço de exame) criado com o item liberado continuava como opção em Serviços
    e Horários depois de o item ser desligado na matriz. Agora, sem o item, eles saem das opções
    (com o selo "não liberado" em Locais e nos horários já gravados); as ligações já gravadas
    ficam guardadas e voltam se o item for liberado de novo (`setServiceLocations` com `keep`). O
    banco também trava: migração `20261005210000` (ligar serviço a local domiciliar e cadastrar
    ou reativar horário em local domiciliar ou de exame exigem o item). 1 teste de banco novo.
- **F4.5 — concluída em 05/out** (cliente: numa etapa só). Agenda no banco novo: **Dia, Semana
  e Mês** das agendas que a pessoa vê, **todas juntas por padrão**, com o nome da agenda em cada
  atendimento, e um seletor para ver só uma, lembrado no navegador por clínica (decisão do
  cliente, 05/out). Dia: atendimentos, **turma num cartão só** com os pacientes dentro, cancelados
  apagados e bloqueios (só leitura; criar e remover é da F4.6). Cartão do atendimento: presença
  confirmada (marcar/desfazer), "Confirmou pelo lembrete", lembrete e preparo não entregues com o
  botão (com os itens), lista de espera (pôr e tirar, com o item), remarcar e cancelar (com
  confirmação); **já passado: "Compareceu" / "Faltou"**, com correção depois; selo **"Faltou X de
  Y"** com a regra do piloto (2 ou mais faltas e pelo menos metade dos registrados). **Marcar**
  pelo serviço do catálogo (exame só com o item; turma escolhe a sessão com vaga), com **"com
  quem?" e "Primeiro horário disponível"** quando mais de uma agenda atende (D2 revista; decisão
  do cliente, 05/out), datas com horário livre (feriados fora), horários com o local, endereço
  para o domiciliar e o aviso da idade limite da Consulta; **cadastro rápido do paciente novo**
  (nome, nascimento e o WhatsApp do próprio paciente ou do responsável, com as confirmações de
  mesma pessoa e possível repetido; decisão do cliente, 05/out; o cadastro completo é da F4.7).
  **Remarcar** na mesma agenda e serviço (o horário atual não conta como ocupado). Todas as ações
  numa rota (`/api/admin/agenda/atendimentos/[id]`), com aviso de salvo ou erro. Saíram as telas
  e rotas antigas (Marcar exame, Remarcar exame, horários livres, origem do retorno, ações por
  atendimento); "Marcar consulta" e "Marcar exame" viraram um "Marcar". **Envio pelo WhatsApp
  (lembrete, preparo e os avisos ao paciente de marcado, remarcado e cancelado) fica para a F6**,
  como no plano: os botões avisam que o envio ainda não está ligado, sem registrar tentativa
  (`panelSender.ts`, um ponto só para ligar). Até a F4.6/F4.8, Bloquear, Bloqueios, cancelamento
  em massa e o Resumo do Dia continuam nas telas antigas, fora do menu da Agenda. Padrões
  assumidos (revisáveis): comparecimento também no cartão da Agenda (no piloto, só em Consultas);
  a semana começa na segunda; o Mês mostra quantos atendimentos e marca feriado e bloqueio.
  5 testes unitários e 3 de banco novos.
  **Ajuste pedido na validação (cliente, 05/out): uma coluna por agenda no Dia.** Com "Todas as
  agendas", o Dia mostra as agendas lado a lado, cada uma numa coluna com o nome no topo e os
  atendimentos de cima para baixo (no celular, as colunas rolam para o lado); agenda desativada só
  aparece se tiver algo no dia. A Semana continua com os 7 dias em colunas (decisão do cliente).
  Também a pedido do cliente, uma segunda barra de rolagem acima dos nomes das agendas, que anda
  junto com a de baixo.
  **Telefone (cliente, 05/out):** o número passa a ser texto simples, sem link de ligação, em todo
  o painel (tudo se resolve pelo WhatsApp; o botão do WhatsApp continua ao lado); paciente sem
  responsável mostra só o número, sem rótulo. Botões Remarcar e Cancelar do cartão ficam
  compactos (antes ocupavam a largura toda).
  **Cartão do atendimento (cliente, 05/out):** formato escolhido entre três opções: em cima, a
  informação e os **selos da situação** (presença confirmada, lembrete, preparo, lista de espera,
  comparecimento a registrar), que nunca são clicáveis; embaixo, **uma fileira de botões iguais,
  com ícone** (vermelhos os que desfazem). **Toda ação pede confirmação** no diálogo do painel,
  com o paciente e o horário (cliques sem querer); Remarcar só abre a tela, e a confirmação fica
  no botão final dela, como no Marcar. O diálogo ganhou o tom azul para as confirmações comuns
  (`data-confirm-tone="primary"`) e não abre com campo obrigatório vazio.
- **F4.6 — concluída em 05/out.** **Bloquear** no cabeçalho da Agenda: dia todo ou horário, motivo e
  **uma ou várias agendas** (um bloqueio por agenda marcada; decisão do cliente, 05/out); com
  atendimentos no período, a tela lista e pergunta "cancelar" ou "manter" (como no piloto), e se o
  período mudar depois de ver a lista, mostra de novo. Lista **Bloqueios** com editar (período e
  motivo; mudar o período não cancela nada) e remover; no Dia, o cartão do bloqueio tem Editar e
  Remover. **Cancelar selecionados** no Dia (caixinhas nos cartões; turma = todos os pacientes
  ativos dela), com o link de remarcação gerado com o bot liberado (D11). Depois de cancelar (em
  massa ou pelo bloqueio), a tela **"Avisar"** mostra cada paciente com o botão "Enviar pelo
  WhatsApp", que abre a conversa no WhatsApp de quem está no painel com a mensagem pronta (decisão
  do cliente, 05/out); **a mensagem vai sem o link até a página pública existir (F5)** (decisão do
  cliente, 05/out: hoje o link abriria inválido) e pede para responder; o envio automático com o
  link vem com a F5/F6. **Séries** (D9, item "Séries"): no Marcar, **"Repetir este atendimento"**
  (decisão do cliente, 05/out) com a frequência (toda semana, quinzenal, a cada N semanas, até 12)
  e o fim (sem data, até o dia, N sessões); a tela da **série** mostra o combinado, as sessões e as
  **datas puladas com o motivo** (feriado, agenda bloqueada, horário ocupado) e permite encerrar.
  No cartão de uma sessão: "Cancelar só esta", "Encerrar a série" (esta e as próximas) e "Ver
  série"; no Remarcar, "só esta sessão" ou "esta e as próximas" (a série passa para o dia e o
  horário escolhidos). Toda ação nova pede confirmação. O diálogo de confirmação leva o botão
  clicado junto (ex.: "cancelar" ou "manter"). Saíram as telas e rotas antigas de bloqueio e a
  rota antiga do cancelamento em massa continua só para o Resumo do Dia antigo (F4.8). **Fica para
  a F7**: a rotina que estende as séries sem fim (hoje ficam marcadas as sessões dos próximos 3
  meses a partir da criação). Padrões assumidos (revisáveis): o motivo do bloqueio aparece só para
  a equipe; turma não tem série (as vagas são por sessão, regra da F3). 4 testes unitários e 1 de
  banco novos.
  **Decidido na validação (cliente, 05/out): o cancelamento pela clínica volta a ser como no
  piloto, nas fases certas.** Fica a tela "Avisar" por enquanto. Depois: **F4.8**, a aba
  **"Aguardando remarcação"** do Resumo do Dia (cancelados pela clínica que ainda não
  remarcaram); **F5**, a página pública do link; **F6**, "Cancelar selecionados" e o bloqueio
  passam a mostrar um aviso de que **todos os selecionados recebem a mensagem pelo WhatsApp da
  clínica, com o link de remarcação**, e a tela "Avisar" sai. Texto pedido pelo cliente: "Olá,
  Maria! Aqui é da Clínica… Precisamos cancelar o atendimento de João (Consulta) de 12/10 às
  08:00. Pedimos desculpas pelo transtorno." + o link para remarcar.
- **F4.7 — concluída em 05/out.** Pacientes no banco novo, no vocabulário da clínica: lista com as
  abas **Pacientes** e **Responsáveis/Contatos**, busca pelo nome ou pelo telefone (4+ dígitos), 20
  por página e "Mostrar desativados" (como no piloto), com idade, plano (com o item) e o selo de
  faltas. **Cadastro** numa tela só, também usada pelo "Cadastrar novo" do Marcar (o cadastro rápido
  da F4.5 saiu): nome, nascimento, observações, plano de saúde com carteirinha e validade (com o
  item "Convênios") e o WhatsApp do próprio paciente ou de um responsável, com as confirmações de
  mesma pessoa e possível repetido; vindo da página do responsável, já entra ligado a ele.
  **Página do paciente**: dados, aviso da idade limite da Consulta, responsável (com link), plano,
  "Marcar", desativar/reativar e o **histórico** (próximos; anteriores e cancelados; "Registrar
  comparecimento" nos que já passaram) das agendas que a pessoa vê. **Página do responsável**:
  nome, WhatsApp (único na clínica, com aviso se já for de outro), endereço padrão do domiciliar
  (com o item), os pacientes dele com "Cadastrar outro" e desativar/reativar. No cartão da Agenda,
  o nome do paciente abre a página dele. Saíram as telas e rotas antigas de Pacientes e os scripts
  de navegador das telas antigas de Marcar e Pacientes. Padrões assumidos (revisáveis): sem
  confirmação nos formulários de cadastro e edição (como Configurações; a confirmação vale para as
  ações da Agenda); desativar o responsável não desativa os pacientes dele; o histórico mostra até
  os 200 atendimentos mais recentes. 3 testes de banco novos.
- **F4.8 — concluída em 05/out.** **Resumo do Dia** no banco novo, com as abas do piloto: **Resumo
  do dia** (só informação: hora, paciente, idade, responsável e WhatsApp, serviço, local, agenda,
  presença e quem marcou), **Lembretes** (item; enviados no dia, em grupos: confirmaram, pediram
  para remarcar ou cancelar, não responderam, não entregue), **Lista de espera** (item; por agenda e
  serviço, na ordem da vaga, com a oferta em andamento, "Tirar da lista" e as últimas ofertas),
  **Aguardando remarcação** (cancelados pela clínica, em massa ou pelo bloqueio, que ainda não
  remarcaram a mesma jornada; "Remarcar" abre o Marcar com paciente, serviço e agenda; "Desistiu",
  na trilha), **A registrar** (últimos 60 dias) e **Registradas** (20 por página, com correção),
  estas com o cartão da Agenda, e **Envios** (alerta, atendimentos com envio com falha e as últimas
  execuções; **no Resumo do Dia, para toda a equipe**, com o lembrete ou o resumo do dia liberado;
  decisão do cliente, 05/out; a aba de Métricas sai na F4.9). **Trilha** do atendimento
  (`/admin/agenda/trilha/[id]`, pelo botão "Trilha" do cartão e pelo histórico do paciente): os
  eventos e as mensagens do WhatsApp, com por onde e **quem fez pelo nome** (decisão do cliente,
  05/out: campo **"Nome" na Equipe**, no convite e na edição; sem nome, o e-mail; o Suporte como
  "Suporte RecepClinic (nome)"). O alerta de envios do Início leva à aba Envios. Migração
  `20261005220000`: `clinic_members.display_name`, `clinic_actor_labels` (toda a equipe vê os nomes
  de quem fez) e o evento "Desistiu" na trilha. Saíram o Resumo do Dia, a trilha, as rotas e os
  componentes antigos. 4 testes unitários e 4 de banco novos.
  **Ajuste pedido na validação (cliente, 05/out): cancelado bem destacado.** Na Agenda e no Resumo
  do dia, o atendimento cancelado tem faixa vermelha à esquerda, fundo avermelhado, horário riscado
  (o nome do paciente, não; cliente, 05/out) e o selo "Cancelado" em vermelho (também no histórico
  do paciente e na série).
  O cartão do bloqueio no Dia deixa de ficar apagado: aparece como um atendimento ativo, com o
  selo "Bloqueio" em cinza prateado (cliente, 05/out). O cartão do **retorno** mostra a consulta
  de origem ("Retorno da consulta de 12/10/2026 (cancelada)", ou "sem consulta de origem").
  **Regra do retorno (cliente, 05/out):** todo retorno é de uma consulta **que já começou**: a
  marcação do retorno é na data e hora de início da consulta de origem ou depois, e do mesmo
  paciente (o sistema já ligava o retorno à última consulta passada na mesma agenda; agora o banco
  também recusa o contrário, migração `20261005230000`). **O bot impede** o retorno sem consulta de
  origem, fora do prazo, de consulta domiciliar ou já usado; **no painel, a secretária pode marcar**
  com o aviso, que agora aparece **antes** de marcar, no Marcar (como no piloto). Com a regra, um
  retorno não fica ligado a uma consulta cancelada (consulta passada não se cancela pela Agenda).
  Dados de teste: o retorno do João passa a ser de uma consulta realizada 2 semanas antes (antes
  estava ligado a uma consulta futura, o que confundiu na validação). 1 teste de banco novo.
- **F4.9 — concluída em 05/out.** **Métricas** no banco novo: período no fuso da clínica (Hoje, 7
  dias, Este mês, Mês anterior, Personalizado até 366 dias), **seletor de agenda para o
  Administrador** (decisão do cliente, 05/out; o Profissional, com "Métricas pessoais", vê só as
  agendas do próprio cadastro, D11), filtro por paciente ou responsável e uma aba por item:
  **Visão geral** (atendimentos sem os cancelados, compareceram, faltaram com a taxa, cancelados, a
  registrar, por vir e por onde foram marcados), **Atendimentos** (volume por serviço e local, não
  comparecimento por tipo e por origem), **Faltosos** (regra do piloto, todo o histórico) e
  **Financeiro** (realizado, previsto e faltas por serviço e local, com o valor gravado na
  marcação; retorno fora). Decisões do cliente (05/out): saem da matriz os itens **"Métricas:
  Envios"** (a aba foi para o Resumo do Dia) e **"Relatórios"** (a aba Atendimentos cobre;
  `/admin/relatorios` leva a ela); **Funil do bot e Retomar contato vão para a F6**, com o bot.
  Migração `20261005240000`. **Retirada do código antigo sem uso**: métricas antigas, faltas,
  datas, itens e cancelamento em massa antigos da agenda, conflitos de janela de exame, reenvio de
  preparo antigo e os clientes antigos do Supabase (com os testes deles). O código antigo que
  continua é o das páginas públicas `/agendar` e `/preparo` (F5), do webhook (F6) e das rotinas
  automáticas (F7), que serão refeitos nessas fases. 3 testes unitários e 3 de banco novos.
- **F4.5 — Agenda I:** dia, semana e mês com a escolha da agenda; marcar, remarcar, cancelar;
  presença e comparecimento; lembrete e preparo; lista de espera.
- **F4.6 — Agenda II:** bloqueios, cancelamento do dia com link de remarcação, séries (D9).
- **F4.7 — Pacientes:** contatos, pacientes, plano de saúde, histórico.
- **F4.8 — Dia a dia:** Dashboard (resumo do dia), trilha, aba Envios (também para a Recepção),
  aba "Aguardando remarcação" (cancelados pela clínica, cliente, 05/out).
- **F4.9 — Métricas e relatórios:** abas pelos itens, escopo do Profissional; retirada do código
  antigo sem uso.
- **F4.1 — concluída em 05/out.** Login no banco novo; **sem cadastro público** (convite); "Esqueci
  minha senha" e aceite do convite pelo link do e-mail, conferido no servidor
  (`/api/admin/auth/confirmar`, `token_hash`), com a tela de senha nova (mínimo de 8 caracteres;
  `src/lib/data/auth.ts`, modelos em `supabase/templates/`); tela de escolha da clínica para quem é
  membro de várias e para o Suporte (`/admin/escolher-clinica`, que agora recebe o Suporte sem
  clínica), com "Trocar" no topo e o aviso de que as leituras do Suporte ficam registradas; topo com
  o nome da clínica e a marca RecepClinic; **vocabulário pelo perfil** (`src/lib/vocabulary.ts`;
  **decisão do cliente, 05/out: a Mista usa "paciente/responsável"**, D4b); tela inicial no banco
  novo (atendimentos de hoje por tipo, comparecimento a registrar, lembretes sem resposta, alerta de
  envios, atalhos e cartões pelos itens liberados; `src/lib/data/dashboard.ts`), adiantada da F4.8
  por ser a primeira tela depois do login. Padrões assumidos (revisáveis): senha com pelo menos 8
  caracteres; "Esqueci minha senha" responde igual exista ou não o e-mail; "Presença não
  confirmada" conta os lembretes de hoje sem botão tocado. **Ao criar o projeto na nuvem:** desligar
  o cadastro público, apontar o endereço do site para o painel e copiar os dois modelos de e-mail.
  As outras telas continuam no código antigo até a sua parte. 4 testes unitários e 6 de banco novos.
- **F4.2 — concluída em 05/out.** Tela da matriz de acesso do Administrador do sistema
  (`/admin/sistema/matriz`): lista das clínicas com quantos itens cada uma tem, itens por área
  (Agenda, WhatsApp, Métricas) com a dependência de cada um, quem liberou e quando, e o histórico
  de mudanças com o nome de quem mudou; marcar um item marca o de que ele depende e desmarcar
  desmarca os que dependem dele (o servidor confere de novo e não salva nada se faltar
  dependência). As telas `/admin/sistema` são só do Suporte, sem clínica ativa (o middleware
  confere; o banco confere de novo). "Matriz de acesso" no menu do Suporte e na escolha da clínica.
  Migração `20261005160000`: nome de cada pessoa do Suporte (`platform_staff.display_name`, gravado
  pela plataforma). Padrões assumidos (revisáveis): abrir a lista de clínicas da matriz não fica no
  registro de leituras do Suporte (as mudanças ficam no registro de alterações); item liberado sem
  pessoa aparece "pela plataforma". 2 testes unitários e 2 de banco novos.
  **Ajuste depois da validação (05/out):** erro de acesso numa rota `/api` enviada por formulário
  do navegador (ex.: salvar a matriz depois de entrar com outro login em outra aba) passa a levar
  ao Início com o aviso, ou ao login sem sessão, em vez de mostrar `{"error":"forbidden"}`; chamadas
  por código continuam recebendo JSON (`expectsPage`).
- **F4.3 — concluída em 05/out.** Configurações no banco novo, abas Clínica, Profissionais,
  Locais, Agendas e Serviços: **Clínica** (nome, perfil com o vocabulário de cada um, fuso do
  Brasil, idade limite da consulta, cor e, com o bot liberado, as informações que o bot responde);
  **Profissionais** (nome, profissão, especialidade, conselho, número e UF, WhatsApp e "Recebe o
  resumo do dia" com o item liberado); **Locais** (consultório com endereço ou domiciliar, este só
  com o item); **Agendas** (de profissional ou de recurso, intervalo entre atendimentos);
  **Serviços** (consulta, retorno e exame, este só com o item; duração, valor, prazo do retorno,
  individual ou turma, preparo com prévia, agendas que atendem e locais com valor próprio
  opcional). Cada cadastro com lista ("Mostrar desativados"), criar, editar, desativar (com
  confirmação) e reativar. Aviso de salvo ou de erro num cookie de uso único (`src/lib/flash.ts`;
  o texto não vai na URL), rotas de formulário com `runFormAction` e leitura dos campos em
  `src/lib/forms.ts` (valores "150,50" e "1.234,56"). **Decisão do cliente (05/out): o envio do
  logo fica para a F5**, junto das páginas que o mostram. Saíram as telas e rotas antigas de
  Configurações (Disponibilidade, Duração, Valores, Tipos de exame, Contatos, Envios), que liam o
  schema do piloto; as que voltam em outra forma ficam na F4.4. Padrões assumidos (revisáveis): o
  tipo do local não muda depois de criado (como a categoria do serviço e o tipo da agenda); o login
  ligado ao profissional é definido na equipe (F4.4). 4 testes unitários novos (a camada de acesso
  já tinha os de banco da F3.4).
  **Ajuste pedido na validação (cliente, 05/out, D11): limite de profissionais ativos por
  clínica**, definido pelo Suporte na tela da matriz (com o número de ativos, aviso quando a
  clínica está acima e a mudança no histórico). Contam só os ativos (desativar libera a vaga);
  clínica nova começa com 1 e as que já existiam ficaram com o que tinham; baixar o limite não
  desativa ninguém, só impede novos. Em Profissionais, "X de Y profissionais ativos" e "Novo
  profissional" bloqueado no limite. Migração `20261005170000`: `clinics.max_professionals`, trava
  no cadastro e na reativação (erro `limit_reached`, "Limite de profissionais da clínica atingido.
  Fale com o suporte."), só o Suporte muda (`set_clinic_professional_limit`); dados de teste com
  limite 5 e 2, clínicas dos testes com 50. 3 testes de banco novos.

## F5 — Páginas públicas e domínio

**Objetivo:** links públicos com a marca da clínica, no endereço do produto.

**Escopo:** `/agendar` e `/preparo` com nome, logo, cor e profissionais da clínica; aplicativo em
`app.recepclinic.com.br`; links para a política de privacidade e os termos, que ficam no site do
produto (projeto separado, ver D7). O botão "Voltar para o site", removido na F0.2 (decisão do
cliente, 03/out), volta apontando para o site da clínica, só quando ela tiver um.

**Decisões do cliente (05/out):** o domínio `app.recepclinic.com.br` entra **nesta fase** (não
espera o staging da F6). O site do produto já está no ar com `/privacidade` e `/termos`, e o DNS
de `recepclinic.com.br` já está na Cloudflare. As páginas públicas mostram **só nome e logo** da
clínica (topo na cor dela); o rodapé leva "Feito com RecepClinic" e os links
`www.recepclinic.com.br/privacidade` e `/termos`, sem contato nem endereços da clínica.
Padrões assumidos (revisáveis): a marca é editada por quem já edita os dados da clínica em
Configurações; logo PNG, JPG ou WebP até 1 MB, no Supabase Storage; o link de remarcação vale 2
dias (regra do piloto).

**Dividida em cinco partes (cliente, 05/out),** cada uma com validação:
- **F5.1 — Marca da clínica:** em Configurações › Clínica, envio do logo, cor e site da clínica
  (campo novo); topo e rodapé públicos com a marca e os links legais.
- **F5.1 — concluída e validada pelo cliente em 05/out.** Em Configurações › Clínica, bloco
  **"Páginas públicas"**: logo (enviar, trocar, remover; PNG, JPG ou WebP até 1 MB), cor (**10 cores prontas** e "Outra" para
  qualquer cor; cliente, 05/out) e **site da clínica** (sem "https://" ganha o prefixo), com o link **"Ver como fica"** (prévia do topo e do
  rodapé com a marca salva). Migração `20261005250000`: `clinic_settings.website_url` e o bucket
  público `clinic-logos` (um arquivo por clínica, nome novo a cada envio, o anterior é apagado; só
  quem edita os dados da clínica escreve na pasta dela). Topo público na cor da clínica, com o texto
  branco ou escuro pelo contraste, logo e nome, e "Voltar para o site" só com site. Rodapé com o
  aviso de emergência para qualquer área ("…procure atendimento imediato ou ligue 192"; cliente,
  05/out), "Feito com RecepClinic", Privacidade e Termos de uso. `/agendar` e `/preparo` passam a
  usar o topo e o rodapé na F5.2 e na F5.3. 3 testes unitários e 5 de banco novos.
- **F5.2 — `/agendar` no banco novo:** marcar e remarcar pelo link, serviço do catálogo, "primeiro
  horário disponível" ou a agenda escolhida, turma, local, prazo do retorno, lista de espera;
  "Voltar para o site" só para a clínica que tem site.
- **F5.2 — concluída e validada pelo cliente em 06/out.** `/agendar/[token]` e as rotas de
  horários e de confirmar no banco novo, com a **credencial limitada à clínica do link** (saem da
  service role) e a marca da clínica (F5.1). Módulo `src/lib/data/agenda/publicBooking.ts`:
  agendas do link (a escolhida, a do atendimento remarcado ou todas as do serviço, no "primeiro
  horário disponível") e locais do serviço filtrados pelo link (local ou tipo); **cada horário
  mostra o profissional e o local quando houver mais de um** (cliente, 05/out); o mesmo horário
  aparece uma vez, na primeira agenda em ordem de nome (D2). Regras do piloto mantidas: link
  vencido ou usado não marca; usar é atômico e o horário é conferido de novo ao confirmar (ocupado
  no meio do caminho devolve o link); retorno ligado a uma consulta só até o prazo (o link da
  clínica dispensa) e um retorno por consulta; turma pelas sessões com vagas; lista de espera
  pedida antes entra ao confirmar; funil do bot (abriu, trocou a data, falhou, confirmou). Novo:
  atendimento já marcado na agenda mostra o aviso para falar com a clínica; link usado mostra o
  atendimento marcado (ou "cancelado"); a marcação aceita a consulta de origem indicada pelo link.
  **A confirmação pelo WhatsApp fica para a F6** (a página não promete mais a mensagem). Dados de
  teste: 4 links fixos, válidos por 30 dias (comentário no `seed.sql`). 8 testes de banco novos.
- **F5.3 — `/preparo` no banco novo:** instruções de preparo do serviço de exame.
- **F5.3 — concluída e validada pelo cliente em 06/out.** `/preparo/[id]` no banco novo: a
  clínica vem do serviço e o preparo é lido com a **credencial limitada a ela** (sai da service
  role), com a marca da clínica (F5.1). Mantido do piloto: nenhum dado de paciente, formatação do
  WhatsApp (negrito, itálico), exame inativo continua mostrando o preparo; serviço que não é exame
  ou sem preparo mostra "Preparo não encontrado" (404). 1 teste de banco novo.
- **F5.4 — Link de remarcação na tela "Avisar":** a mensagem do cancelamento pela clínica passa a
  levar o link (o envio automático continua na F6).
- **F5.4 — concluída e validada pelo cliente em 06/out.** A mensagem da tela **"Avisar"**
  (bloqueio e "Cancelar selecionados") leva o **link de remarcação ainda válido** de cada
  cancelado, com a validade e "Se preferir, responda esta mensagem" (cliente, 06/out): "…Pedimos
  desculpas pelo transtorno. / Para escolher um novo horário, use o link (vale até 08/10 às
  14:30): <link> / Se preferir, responda esta mensagem." Sem link válido (bot não liberado, link
  vencido ou usado), fica a mensagem da F4.6 ("Responda esta mensagem…"). O endereço do link é o
  mesmo em que a equipe usa o painel. Migração `20261006090000`:
  `booking_links.canceled_appointment_id`, preenchido ao gerar o link de remarcação. O envio
  automático continua na F6. 1 teste unitário e 1 de banco novos.
- **F5.5 — Domínio:** projeto na Vercel, banco na nuvem e `app.recepclinic.com.br` pela Cloudflare.

- **F5.5 — concluída e validada pelo cliente em 06/out.** Decisões do cliente (06/out):
  `app.recepclinic.com.br` serve o **staging** (D8: Supabase Free na organização própria
  "RecepClinic", projeto `recepclinic-staging` em São Paulo; Vercel Hobby, projeto `recepclinic`)
  até a F10, quando passa para a produção e o staging vai para `teste.recepclinic.com.br`; o banco
  do staging tem só o schema (26 migrações, sem o seed) e o login do Suporte; as clínicas de
  teste são criadas pela tela "Nova clínica". DNS: CNAME `app` na Cloudflare, só DNS (certificado
  da Vercel). Os modelos de e-mail do Supabase ficam para quando houver o provedor de e-mail (o
  Supabase só deixa editar com SMTP próprio): até lá, "Esqueci minha senha" não funciona no
  staging. O legacy JWT secret do Supabase (que assina a credencial limitada à clínica) **nunca
  pode ser revogado**. Roteiro em [`staging.md`](staging.md); scripts `criar-suporte.mjs` (login
  do Suporte com o link de definir a senha) e `trocar-email.mjs`. A tela de nova senha passou a
  dizer o motivo da recusa do Auth (senha atual, fraca, link vencido). Conferido pelo cliente na
  nuvem: login do Suporte, Nova clínica, logo e cor, e `/preparo` com a marca.

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
da recepção. **Aba "Mensagens" em Configurações** (cliente, 05/out, D3b revista): prévia de
cada mensagem no balão do WhatsApp (templates e mensagens de conversa, com os dados da clínica);
com o item **"Mensagens personalizadas"** (D11), o **Administrador da clínica** edita os textos de
conversa do bot e propõe o texto dos templates (mesmas variáveis; versão nova revisada pelo
Suporte e enviada à Meta à mão até a F8; o padrão continua até a aprovação e a troca é sozinha);
`whatsapp_templates` passa a guardar versões, com o texto e a versão em uso.
**Métricas do bot** (cliente, 05/out, adiadas da F4.9): abas **Funil do bot** e **Retomar contato**
(itens da matriz que já existem), com os passos do bot desta fase.
**Cancelamento pela clínica como no piloto** (cliente, 05/out): "Cancelar selecionados" e o
bloqueio com cancelamento mostram o aviso de que todos recebem a mensagem pelo WhatsApp, com o link
de remarcação (texto da F4.6), e enviam sozinhos; sai a tela "Avisar" da F4.6.

**Dividida em sete partes (cliente, 06/out),** cada uma com validação:
- **F6.1 — Conexão e webhook:** número de testes do RecepClinic **direto na Cloud API** do app
  RecepClinic, sem o app do celular (cliente, 06/out: o número é só de testes; a coexistência fica
  para a F8); conexão cadastrada pelo Suporte na tela WhatsApp da clínica; webhook novo que
  identifica a clínica pelo `phone_number_id`, confere a assinatura da Meta e registra mensagens e
  situações de entrega.
- **F6.1 — concluída e validada pelo cliente em 07/out.** Conferido de ponta a ponta no staging: mensagem do celular do cliente recebida pelo webhook, gravada na clínica de teste e ligada ao contato. Webhook novo
  (`/api/whatsapp/webhook`): confere a assinatura com o App Secret do app RecepClinic, descobre a
  clínica pelo `phone_number_id` e grava com a credencial dela (mensagens recebidas, situações de
  entrega, ecos da recepção); número sem clínica ou desconectado é ignorado (200 para a Meta);
  sai da service role. O bot fica sem responder até a F6.3. Em Configurações › WhatsApp, só para
  o Suporte: cadastro da conexão (token só para gravar, no Vault), **Registrar o número** na
  Cloud API com o PIN, **Testar conexão** (a Meta responde pelo número e o app é inscrito na
  conta) e **Últimas mensagens**. Variáveis da plataforma `WHATSAPP_APP_SECRET` e
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. API da Meta na versão v24.0 (a v21.0 do piloto vence em 2026).
  Roteiro da Meta em [`staging.md`](staging.md) (parte E). 4 testes unitários e 6 de banco novos.
  Número de testes `+55 61 9903-3143` ("RecepcClinic - Teste", nome em revisão na Meta), na Cloud
  API do app RecepClinic, que está em modo Ao vivo; forma de pagamento cadastrada na conta do
  WhatsApp do RecepClinic. Lição: o número não pode ser verificado em app nenhum depois de ir para
  a API (sairia dela); o celular que já conversou com o número antigo pode levar horas para
  reconhecê-lo (o WhatsApp Web atualizou antes).
- **F6.2 — Envio e templates padrão:** envio pela conexão de cada clínica; templates padrão do
  RecepClinic criados pela API na conta (WABA) do RecepClinic; envios do painel (lembrete, preparo)
  e a confirmação depois de marcar pela página `/agendar`.
  **Detalhada com o cliente em 07/out:** (1) envio pela conexão de cada clínica (número e token
  dela, API v24.0), registrado em `whatsapp_messages` com o texto que o paciente vê; (2) os textos
  dos templates ficam no código, uma versão para todas as clínicas (D3b), e o Suporte, em
  Configurações › WhatsApp, cria pela API na conta da clínica os que faltam (categoria Utilidade,
  `pt_BR`) e atualiza a situação (em análise, aprovado, recusado com o motivo); o webhook também
  recebe a mudança de situação; (3) **cinco templates nesta parte**: confirmação, remarcação,
  cancelamento, lembrete (botões Confirmar presença · Remarcar · Cancelar) e preparo do exame.
  Oferta da lista de espera, resumo do dia e cancelamento pela clínica com link entram nas fases
  em que são usados; a "confirmação de retorno" do piloto deixa de existir (só diferia pela frase
  de pagamento, que sai dos templates); (4) enviam: os botões de lembrete e de preparo da Agenda;
  a confirmação e a remarcação feitas pela página `/agendar`; o preparo, sozinho, quando a
  confirmação do exame chega ao celular; e **os avisos ao paciente quando a equipe marca, remarca
  ou cancela pela Agenda**, como no piloto (cliente, 07/out). **Nome da clínica nas mensagens**
  (cliente, 07/out): em Configurações › Clínica, "da" ou "do" (padrão "da"), e o texto sai "Aqui é
  da Clínica Sorriso". **Textos aprovados pelo cliente (07/out)**, com 👤 em vez do 👶 do piloto e o
  profissional só quando o atendimento tem um:
  - *Confirmação:* "Olá, {contato}! Aqui é {da clínica}. Seu atendimento está marcado:" + lista
    (📋 serviço com o profissional · 👤 Paciente · 📅 data e hora · 📍 local e endereço) +
    "Qualquer dúvida, é só responder esta mensagem."
  - *Remarcação:* igual, com "O atendimento foi remarcado:" e "📅 Nova data".
  - *Cancelamento:* "O atendimento abaixo foi cancelado:", sem o local, terminando em "Se quiser
    marcar outro horário, é só responder esta mensagem."
  - *Lembrete:* "Passando para lembrar do seu atendimento:" + lista + "Pode confirmar a presença?"
    e os três botões.
  - *Preparo:* "O exame {nome} precisa de preparo. As orientações estão neste link: {link}" +
    "Qualquer dúvida, é só responder esta mensagem."
  **Séries pela Agenda** (cliente, 07/out): um aviso só. Criar ou remarcar a série ("esta e as
  próximas") confirma a primeira sessão nova; encerrar avisa o cancelamento da primeira sessão
  cancelada. As outras contam com o lembrete da véspera. "Cancelar selecionados" e o bloqueio
  seguem com a tela "Avisar" até a F6.5.
- **F6.2 — implementada em 07/out (aguarda a validação do cliente no staging).** Textos dos
  templates em `whatsapp/templates.ts`; criação e situação na conta em `templateSync.ts` (cartão
  *Templates* do Suporte em Configurações › WhatsApp, com o texto de cada um e o motivo da recusa);
  envio pelo número e token da clínica em `send.ts` (lido com a credencial da clínica; registro e
  trilha com a de quem chamou); avisos em `notices.ts`. Os botões de lembrete e preparo da Agenda
  passaram a enviar; Marcar, Remarcar, Cancelar e Encerrar a série avisam o paciente (só
  atendimento futuro) e o aviso de salvo diz se a mensagem saiu; as confirmações dessas ações
  dizem que o paciente é avisado. A série remarcada usa o template de remarcação na primeira
  sessão nova. `/agendar` envia a confirmação ou a remarcação. Webhook: preparo do exame quando a
  confirmação chega ao celular e situação dos templates pela conta (`resolve_whatsapp_clinics_by_waba`).
  Configurações › Clínica: "da/do" nas mensagens. Sem template aprovado, o aviso fica registrado
  como "não enviado" (sem chamar a Meta); sem conexão, nada é registrado. Migração
  `20261007120000`. Roteiro do staging na parte F de [`staging.md`](staging.md). 10 testes
  unitários e 6 de banco novos.
- **F6.3 — Bot I (marcar):** menu pelo catálogo de serviços, textos pelo perfil, "com quem?" com
  "primeiro horário disponível", link de agendar, retorno e exame.
  **Detalhada com o cliente em 07/out** (começada enquanto a Meta analisa os templates da F6.2):
  (1) **menu só com o que funciona**, na estrutura do piloto: Consultas › Marcar consulta /
  Marcar retorno; Exames › Marcar exame; Informações (a F6.4 acrescenta Cancelar, Remarcar,
  Encaixe e Falar com a recepção); (2) marcar: qual serviço (sempre, com o valor; revisto na
  validação) → **"com quem?"** (só com mais de um profissional; "Primeiro horário disponível" em
  primeiro) → local (só se o serviço tem consultório e domiciliar, com o valor) → endereço do
  domiciliar → identificação do paciente como no piloto → link de 30 minutos; retorno pela lista
  de quem tem direito, com o mesmo profissional da consulta de origem; exame só com horário
  cadastrado; (3) **"É para você ou para outra pessoa?" pelo perfil**: Pediátrica só no exame;
  Adultos e Mista na consulta e no exame; retorno nunca pergunta; (4) **retorno sem trava de
  idade** (o direito vem da consulta de origem; no piloto era só para menores de 18); (5)
  **Informações com os itens que têm conteúdo**: Valores (serviços e preços, com as formas de
  pagamento), Convênios, Endereço (com o mapa), Preparo para exames e Outras informações
  (observações do bot); (6) **conversa parada por 15 minutos** no meio de um atendimento recebe
  "Como não tivemos resposta nos últimos minutos, encerramos este atendimento. Quando quiser, é só
  mandar uma mensagem que começamos de novo. 😊", volta ao começo e o funil registra a desistência
  por tempo; quem confere é o agendador do Supabase (`pg_cron`, a cada minuto; L34), porque a
  Vercel gratuita só roda rotina uma vez por dia; (7) textos pelo perfil e pelo nome da clínica,
  aprovados pelo cliente (boas-vindas "Olá! 👋 Aqui é da Clínica Sorriso.", demais como no piloto
  sem citar a Dra.; link "O link vale por 30 minutos."; já marcado: "Para mudar o dia ou horário,
  fale com a clínica." até a F6.4).
- **F6.3 — implementada em 07/out (aguarda a validação do cliente no staging).** Bot novo em
  `src/lib/data/whatsapp/bot/` (entrada `router.ts`, menus e Informações `menus.ts`, marcar e
  retorno `booking.ts`, catálogo `catalog.ts`, textos `texts.ts`), com a credencial da clínica e
  as regras da camada nova (links, retorno, duplicidade, cadastro, funil). O webhook passa cada
  mensagem recebida ao bot (repetida pela Meta não é respondida de novo). Só com o item "Bot de
  WhatsApp" e o WhatsApp conectado; conversa pausada fica em silêncio. Listas e botões nos limites
  da Meta: o "Primeiro horário disponível" virou "Primeiro horário" com "Disponível, com qualquer
  profissional" na descrição (o título da linha tem 24 caracteres). Itens desligados na matriz
  somem do bot (exames, domiciliar). Conversa parada: rota `/api/cron/conversas-paradas`, chamada
  a cada minuto pelo `pg_cron` do Supabase com o CRON_SECRET (endereço e segredo no cofre,
  gravados por `scripts/agendador.mjs`). Saiu o roteador antigo do piloto; o resto do bot antigo
  (cancelar, remarcar, lista de espera) sai na F6.4. Migração `20261007130000`. Roteiro na parte G
  do [`staging.md`](staging.md). 7 testes unitários e 10 de banco novos.
  **Regra confirmada na validação (cliente, 07/out):** no meio de uma jornada, qualquer mensagem
  fora das opções responde "não entendi" (um cumprimento também); a conversa só volta às
  boas-vindas e ao menu quando a jornada terminou (link enviado, bloqueio) ou parou por 15 minutos.
  **"Qual exame" e "Qual consulta" sempre aparecem** (cliente, 07/out), mesmo com um serviço só,
  para o paciente ver e confirmar o que está marcando; o "com quem?" continua pulado com um
  profissional só (D2).
- **F6.3b — Jornada de configuração** (cliente, 07/out, depois de a Espirometria sumir do bot por
  estar sem horário; feita antes da F6.4): as Configurações mostram a dependência entre os
  cadastros, na ordem Clínica → Profissionais → Locais → Agendas → Serviços → Horários (o
  WhatsApp continua só na aba dele, decisão do cliente). (A) **Guia de configuração** no topo da
  aba Clínica, com cada passo "Feito", "Atenção" ou "Falta" e cada pendência levando direto à
  correção; completo, vira uma linha; nas outras abas, só o aviso "N pendências · Ver o guia".
  (B) **Próximo passo** na tela do cadastro enquanto a pendência existir (logo depois de salvar,
  inclusive): profissional sem agenda → "Criar a agenda" (já com o profissional); agenda sem
  serviço ou sem horário → Serviços ou "Cadastrar os horários"; local sem serviço ou sem
  endereço; serviço sem agenda, local ou horário → "Cadastrar os horários" (já com a agenda e o
  serviço). (C) **Selos nas listas**: "sem horário", "sem agenda", "sem local", "sem serviço",
  "sem endereço". "Sem horário" segue a regra do bot (horário ativo da agenda e do local do
  serviço, "qualquer serviço" ou o próprio). Itens desligados na matriz e desativados não contam.
  **Implementada em 07/out (aguarda a validação do cliente).** Regra em
  `src/lib/data/config/setup.ts`; sem migração. 7 testes unitários novos.
- **F6.4 — Bot II:** cancelar, remarcar, resposta ao lembrete, lista de espera, sessões de série,
  "falar com a recepção" e pausa do bot.
  **Detalhada com o cliente em 07/out:** menus completos como no piloto (Consultas e Exames ›
  Remarcar · Cancelar · Encaixe ou antecipar; o Encaixe só com o item "Lista de espera");
  identificação do atendimento como no piloto (até 3 em lista, mais de 3 pela data de nascimento,
  nunca misturando consulta e exame); cancelar com Sim/Não e resposta na conversa; remarcar com o
  link de 30 minutos (mesmo profissional e serviço; retorno com o prazo vencido orienta falar com a
  clínica; domiciliar reconfirma o endereço); sessão de série cancela ou remarca só ela (D9);
  botões do lembrete (Confirmar presença vale até com o bot pausado; Remarcar e Cancelar respeitam
  a pausa; "Não" ao cancelar pergunta se confirma a presença); Encaixe (entrar, sair, marcar e
  entrar sozinho na lista) e a resposta à oferta de vaga (o envio das ofertas é da F7); pausa da
  recepção pelo eco do app e "#bot". **"Falar com a recepção" pronto, mas desligado até a F8**
  (cliente, 07/out): o item só aparece quando o Suporte marca a conexão como **coexistência**
  (hoje ninguém responderia: o número de testes só está na API e o painel não tem caixa de
  conversas); até lá os textos dizem "fale com a clínica". Textos do piloto aprovados pelo
  cliente (07/out), sem citar a Dra.
- **F6.4 — implementada em 07/out (aguarda a validação do cliente no staging).** `bot/manage.ts`
  (cancelar, remarcar, lembrete, encaixe, oferta de vaga, recepção), ligado aos menus e à entrada
  do bot; os toques do lembrete e da oferta valem em qualquer ponto da conversa (Confirmar e a
  oferta até com o bot pausado). Oferta aceita manda o aviso de remarcação pelo template; quem
  recusa passaria a vaga ao próximo, mas o envio da oferta é da F7 (até lá não sai). O eco da
  recepção pausa o bot (com o item "Bot de WhatsApp"); "#bot" devolve. Na conexão (Suporte), a
  marca **Coexistência**. Saiu o bot antigo do piloto (fica só o que as rotinas antigas ainda usam,
  até a F7). Migração `20261007140000`. 10 testes de banco novos.
  **Ajuste da validação (08/out, cliente):** no "Encaixe ou antecipar", antes de entrar na lista,
  o bot procura horário livre antes do atendimento (mesma agenda, serviço e tipo de local, a mais
  de 2h de agora) e mostra até 3, mais "Nenhum desses". Escolhido e confirmado, remarca na hora
  (aviso de remarcação pelo template); ocupado no meio, procura de novo. "Nenhum desses" pergunta
  se quer entrar na lista. Sem horário livre antes, entra direto. Textos aprovados em 08/out.
  Quem já está na lista também vê antes os horários livres; antecipando, sai da lista; sem
  escolha ("Nenhum desses" ou nenhum horário), pergunta se continua na lista ou sai.
- **F6.5 — Cancelamento pela clínica automático:** aviso a todos com o link; sai a tela "Avisar".
  **Detalhada e implementada em 07/out (aguarda a validação do cliente).** Depois de "Cancelar
  selecionados" ou "Bloquear e cancelar", cada paciente recebe o aviso pelo WhatsApp da clínica,
  com o link de remarcação (2 dias), pelo template novo `rc_cancelamento_clinica_v1` (texto do
  cliente de 05/out, aprovado em 07/out: "Olá, {contato}! Aqui é {da clínica}. Precisamos cancelar
  o atendimento de {paciente} ({serviço}) de {data}. Pedimos desculpas pelo transtorno. Para
  escolher um novo horário, use o link (vale por 2 dias): {link}. Se preferir, responda esta
  mensagem."); sem link (clínica sem o bot), o template de cancelamento da F6.2. O aviso de salvo
  diz quantos saíram. **A tela "Avisar" fica só para quem não recebeu** (cliente, 07/out), com o
  motivo (WhatsApp não conectado, template não aprovado, recusa da Meta) e a mensagem pronta para
  enviar à mão; se todos receberam, volta para a Agenda. As confirmações das duas ações dizem que
  todos recebem a mensagem com o link. Migração `20261007150000` (chave do template novo); o
  Suporte cria o template pelo "Criar na Meta". 1 teste de banco novo.
  **Validada em 08/out**, com um ajuste do cliente: **sai o "Cancelar selecionados"** da Agenda
  (as caixinhas nos cartões e a rota `cancelar-selecionados`), porque confundia a recepção com o
  "Cancelar" de cada atendimento. Para cancelar vários, bloqueia-se a agenda e usa-se "Bloquear e
  cancelar", que já avisa todos com o link.
- **F6.6 — Aba "Mensagens":** prévia no balão e edição com "Mensagens personalizadas".
  **Detalhada com o cliente em 07/out:** aba **Mensagens** em Configurações com cada mensagem num
  balão do WhatsApp, preenchida com os dados da clínica: os avisos (templates: confirmação,
  remarcação, cancelamento, cancelamento pela clínica, lembrete com os botões, preparo, com a
  situação na Meta) e, com o bot liberado, as mensagens de conversa. Item novo da matriz
  **"Mensagens personalizadas"** (D11): só o Administrador da clínica edita. **Conversa do bot**
  (lista da D3b + o aviso de conversa parada, cliente 07/out): boas-vindas, menu, não entendi,
  falar com a recepção, link enviado, cancelamento confirmado, presença confirmada e conversa
  parada; texto com marcadores ({nome}, {clinica}, {paciente}, {servico}, {data}, {link}…), vale
  na hora, com "Voltar ao padrão"; sem o item, os textos padrão. **Templates:** o Administrador
  propõe o texto com as mesmas variáveis, na mesma ordem (marcadores); o **Suporte revisa no
  painel e clica em "Aprovar e enviar à Meta"** (ou "Recusar" com o motivo), e o sistema cria a
  **versão nova** pela API na conta da clínica (cliente, 07/out: muda o "à mão até a F8" da D3b);
  enquanto a Meta analisa, segue a versão em uso; aprovada, passa a ser usada sozinha; recusada, o
  motivo aparece e nada muda; "Voltar ao padrão" volta à versão padrão aprovada.
  `whatsapp_templates` passa a guardar versões.
  **Implementada em 07/out (aguarda a validação do cliente).** Tela `configuracoes/mensagens`
  (balão do WhatsApp com os dados da clínica: o primeiro serviço de consulta, o profissional da
  agenda dele, o primeiro consultório e a próxima segunda às 08:00), regras em
  `whatsapp/customMessages.ts` (marcadores, validação da ordem e das regras da Meta, propostas,
  revisão do Suporte), o envio usa a versão aprovada mais nova (`getApprovedTemplate`) e o texto
  dela, e o bot usa o texto próprio (`textFor`); na presença confirmada de exame, o lembrete do
  preparo continua indo junto. O banco confere o papel e o item (RLS). Migração `20261007160000`
  (item novo, versões, `bot_messages`). 5 testes unitários e 4 de banco novos.
  **Ajustes da validação (cliente, 08/out):** (1) a aba ganha um combo **"Mensagens do bot"**
  (padrão) / **"Mensagens aprovadas pela Meta"**; (2) o item da matriz vira dois, **"Mensagens do
  bot"** e **"Mensagens da Meta (templates)"** (quem tinha o item fica com os dois); as mensagens
  de cada grupo só aparecem com o item dele; (3) **orientações gerais da consulta**: um texto da
  clínica (fora da matriz; sempre aparece em "Mensagens do bot" e o Administrador sempre edita),
  enviado **uma vez** depois que a confirmação da marcação de uma **consulta** (não retorno nem
  exame) chega ao celular, como o preparo do exame; envio ligado na própria aba, abaixo do título
  (desligado por padrão; só liga com o texto escrito). Dentro das 24h vai "Orientações gerais para
  a consulta:" e o texto; fora delas, o template `rc_orientacoes_consulta_v1` com o link da página
  `/orientacoes/{clínica}` (textos aprovados em 08/out). Falhou: selo e "Reenviar orientações" na
  Agenda. Migração `20261008120000`. 1 teste unitário e 3 de banco novos.
- **F6.7 — Métricas do bot:** abas Funil do bot e Retomar contato.
  **Detalhada, aprovada e implementada em 07/out (aguarda a validação do cliente).** Como no
  piloto (Fases 15 e 23): **Funil do bot** com um cartão por fluxo (Marcar consulta: Iniciaram →
  Escolheram o serviço → Identificaram o paciente → Receberam o link → Abriram o link →
  Confirmaram; Marcar retorno; Marcar exame com "Disseram para quem"; Remarcar e Cancelar
  separados por menu e lembrete), barras com a conversão, resultados (concluídas, abandonaram,
  barradas com o motivo, desistiram, erro, em andamento), notas (idade limite, já marcado) e o
  cartão Atendimento humano; **Retomar contato** com quem não concluiu (abandono ou erro), sem
  quem concluiu o mesmo fluxo depois, com o telefone e o botão do WhatsApp. Os passos do bot não
  guardam a agenda: as duas abas valem para a clínica toda (sem o seletor de agenda; o filtro por
  paciente ou responsável vale) e o Profissional com "Métricas pessoais" não as vê. Regra em
  `src/lib/data/botFunnel.ts`; sem migração. 4 testes unitários novos.
  **Achado na validação (cliente, 07/out):** com só o Funil e o Retomar contato liberados,
  Métricas dizia "Essa tela não está disponível para o seu acesso": a regra de acesso exigia a
  "Visão geral" quando a tela abre sem aba, e a aba Retomar contato tinha outro nome na regra.
  Corrigido: sem aba, basta ter alguma liberada (a tela abre nela).
**F6 concluída na implementação em 07/out** (F6.1 validada; F6.2 a F6.7 aguardam a validação do
cliente no staging).
O código antigo do bot e do webhook sai conforme cada parte o substitui.

## F7 — Envios automáticos por clínica

**Escopo:** lembrete, reenvio sem resposta, resumo do dia e lista de espera percorrendo as clínicas
ativas, cada uma com seu fuso, horário e contatos; falha de uma clínica não para as outras;
registro por clínica.

**Detalhada com o cliente em 07/out:** rotinas pelo agendador do Supabase (`pg_cron`, o mesmo da
F6.3), cada clínica com a própria credencial: **lembrete** de hora em hora (o da véspera na hora
da clínica; o reenvio automático das 7h às 20h), **resumo do dia** e **lista de espera** a cada 5
minutos, **séries sem fim** uma vez por dia (pendência da F4.6). **Templates novos aprovados
(07/out):** 4 do resumo do dia ("Olá, {nome}! Consultas {da clínica} para amanhã, {data}: {lista}
Mensagem automática do RecepClinic."; exames igual; "para hoje" no do dia) e o da oferta de vaga
("Olá, {nome}! Aqui é {da clínica}. Abriu uma vaga de {consulta} para {paciente}: {data e local}. É
antes do horário marcado ({horário atual}). Quer antecipar? Responda em até 60 minutos." com os
botões Sim, quero antecipar · Não, manter horário; texto com botões na janela de 24h, como no
piloto). Sai o código antigo das rotinas do piloto.
**Mudança nos envios (cliente, 07/out), em Configurações › WhatsApp:**
(1) **Lembrete ao paciente na véspera** com a opção de enviar ou não e o horário, explicando que é
o lembrete do dia anterior ao atendimento (horas cheias das 7h às 20h, **padrão 18:00**; sem
enviar, também não há o reenvio automático; os botões da Agenda continuam);
(2) **Resumo da equipe na véspera**: enviar ou não e o horário (7h às 20h, padrão 18:00);
(3) **Resumo da equipe no dia**: enviar ou não e quantas horas antes da primeira agenda do dia
(1 a 4 h, padrão 1 h; nunca antes da 0h do próprio dia; dia sem agenda, 6h30, como hoje).
**Implementada em 07/out (aguarda a validação do cliente).** Rotas `/api/cron/lembretes`,
`resumo-do-dia`, `lista-de-espera` e `series` (ajudante `src/lib/cron/route.ts`: o CRON_SECRET,
as clínicas ativas pela plataforma e, em cada uma, a credencial e o WhatsApp dela; erro numa não
para as outras), agendadas no `pg_cron` pela migração `20261007170000` (com as opções novas em
`clinic_settings`; o padrão antigo de 14h passou para 18h). Quem envia em `whatsapp/send.ts`
(resumo do dia; oferta de vaga com texto e botões na janela de 24h, senão o template, registrada
no atendimento). As opções nas telas Configurações › WhatsApp (Lembrete ao paciente; Resumo do
dia, com o horário de cada dia da semana já com as horas escolhidas) e os 5 templates novos no
"Criar na Meta" e na aba Mensagens. **Saiu o código antigo do piloto** das rotinas e do bot
(`src/lib/whatsapp`, as três rotas antigas de `/api/cron`, a lista de espera, os envios e a trilha
antigos e `supabase/service.ts`): a lista do código herdado com a service role ficou vazia (D1).
Ficam os testes das regras do piloto da F1 (`src/lib/scheduling`, `patientRegistration`), sem uso
no sistema, como rede de segurança. 1 teste unitário e 5 de banco novos.
**Na criação dos templates (cliente, 07/out):** os dois resumos "de hoje" foram recusados na hora
pela Meta (`INVALID_FORMAT`; provavelmente por serem quase iguais aos "de amanhã") e o preparo do
exame foi classificado como **marketing**. Textos novos aprovados pelo cliente, como versão 2:
resumo de hoje "Oi, {nome}, tudo bem? A agenda de consultas {da clínica} para hoje, {data}, é
esta: {lista} Bom trabalho! Esta é uma mensagem automática do RecepClinic." (exames igual) e
preparo "Olá, {nome}! Aqui é {da clínica}. Para o exame {exame} que você marcou, siga as
orientações de preparo neste link: {link} Qualquer dúvida, é só responder esta mensagem." Também:
quando a Meta responde que o template já existe (criado antes, com a resposta perdida), o sistema
guarda a situação dele, e os erros da Meta aparecem com a explicação em português.
**Ajuste de 08/out (cliente):** a aba "WhatsApp" de Configurações confundia. Virou **"Lembretes"**,
com a situação da conexão, o *Lembrete ao paciente* e o *Resumo do dia* (e os contatos dele); a
aba **"WhatsApp"** ficou **só para o Suporte** (cadastro da conexão, templates e últimas
mensagens), e a opção de envio das orientações gerais foi para a aba Mensagens, logo abaixo do
título delas.
**Reestruturação dos lembretes (cliente, 09/out):** **um lembrete só por público**, cada um com
enviar ou não, **na véspera ou no dia** e o horário (horas cheias das **6h às 20h**), na aba
Lembretes: (1) **ao paciente** (sai o reenvio automático de 4h; o "Reenviar lembrete" da Agenda
continua; no dia, recebem os atendimentos do dia que começam depois do horário); (2) **ao
profissional (resumo do dia)**, com a lista de quem recebe (saiu do cadastro do profissional); (3)
**à equipe (resumo do dia)**, com os outros contatos. O resumo deixa de ter o par véspera + dia
(1h antes da agenda) e o reenvio quando entra atendimento mais cedo. O **WhatsApp do profissional
passa a ser obrigatório** no cadastro. Na matriz, o item do resumo vira o do profissional e entra
o da equipe (quem tinha fica com os dois). Migração `20261009120000` (opções novas em
`clinic_settings`, as antigas do resumo saem; trava dos outros contatos pelo item da equipe).
Corrigido junto: o alerta "o lembrete de hoje ainda não rodou" não aparece com o envio desligado.
**Validada pelo cliente em 09/out** com os templates aprovados (lembrete ao paciente). O resumo do
dia e a oferta de vaga ficam para conferir quando a Meta aprovar os templates deles; o cliente segue
testando em paralelo e traz os ajustes.

## F8a — Templates pela API: reenviar recusado e excluir sem uso

**Escolhida pelo cliente em 12/out/2026**, enquanto a Meta analisa o app. Não depende do Tech
Provider nem gera custo novo. Já existiam (F6.2 e F6.6): "Criar na Meta", "Atualizar situação",
situação pelo webhook e as versões personalizadas revisadas pelo Suporte. A F8a tira do site da
Meta o que ainda era feito à mão. Tudo em Configurações › WhatsApp, só para o Suporte.

| | Subetapa | Situação |
|---|---|---|
| F8a.1 | Reenviar template padrão recusado | aceita pelo cliente em 12/out, sem teste real (nenhum padrão recusado no staging) |
| F8a.2 | Excluir template do RecepClinic sem uso | validada em 12/out (a busca no staging achou nenhum sem uso, o que está certo: os 3 antigos já tinham sido excluídos na Meta; a exclusão real fica conferida no primeiro uso) |

**F8a.1:** o template padrão recusado mostra o motivo da Meta e o botão **"Reenviar à Meta"**, que
edita o template na conta da clínica **com o mesmo nome** (sem `_v2`) e com o texto atual do
código, e ele volta para a análise. O resultado chega pelo webhook, como hoje. **Quem muda o texto
é o Claude, no código** (cliente, 12/out): o texto padrão segue um só para todas as clínicas (D3b).
O cliente aprova o texto novo, o código é atualizado e o Suporte reenvia em cada clínica.

Regras da Meta conferidas (12/out): a edição é `POST /{id do template}` e troca todos os
componentes (texto, exemplos e botões vão de novo); recusado pode ser editado sem limite; aprovado,
1 vez por dia e 10 por mês, sem mudar a categoria. **Implementada em 12/out:** `editTemplate`
(`graph.ts`), `resendRejectedTemplate` (`templateSync.ts`) e o botão na tela, só no padrão recusado
com o nome atual do código (nome diferente segue no "Criar na Meta"); erro da Meta aparece em
português e nada muda no banco.

**F8a.2:** lista dos templates da conta da Meta da clínica com nome começando por `rc_` que o
RecepClinic não usa mais (versões antigas), cada um com **"Excluir da Meta"** e confirmação.
**Só os do RecepClinic** (cliente, 12/out): os templates criados pela própria clínica (contas
conectadas por coexistência na F8) nunca aparecem.

Regras da exclusão conferidas (12/out): pelo nome, apaga todos os idiomas; o nome fica bloqueado por
30 dias; o que já saiu e não foi entregue ainda é tentado por 30 dias, e o que sair depois falha.
**Implementada em 12/out:** "Procurar templates sem uso" (a busca na Meta só roda com o clique,
seguindo as páginas da conta), "Excluir da Meta" com confirmação e nova conferência na hora de
excluir (`listUnusedTemplates` e `deleteUnusedTemplate` em `templateSync.ts`). **Em uso** = os
nomes padrão atuais do código e todo nome gravado em `whatsapp_templates` da própria clínica e das
**outras clínicas ligadas à mesma conta** (uma conta pode atender várias clínicas, como a do
RecepClinic no staging); clínica com a conexão desligada não entra nessa conta, só a própria.

## F8 — Conexão self-service na Meta

**Escopo:** Embedded Signup com coexistência (o Administrador conecta o número pela tela); criação
e envio dos templates pela API na conta da clínica, **inclusive as versões personalizadas
revisadas pelo Suporte** (D3b revista); acompanhamento da aprovação (webhook de situação do
template: aprovado vira o usado, recusado mostra o motivo). **Depende** da
aprovação do RecepClinic como Tech Provider (pendente do cliente).

**Pré-condições para conectar o número de uma clínica (cliente, 06/out):** o número da clínica
**não passa pela API direto** (como o chip de testes): entra por **coexistência**, sem apagar a
conta nem trocar de chip; a secretária segue no app WhatsApp Business no mesmo número e o bot
atende pela API (eco da recepção pausa o bot, `#bot` devolve, como no piloto; F6.4). Para isso:
1. **Tech Provider aprovado** (análise do app com acesso avançado a `whatsapp_business_management`
   e `whatsapp_business_messaging`, e a configuração do Embedded Signup): começar a análise já,
   em paralelo com a F6 e a F7 (a verificação da empresa saiu em 06/out);
2. o número da clínica **no app WhatsApp Business** (quem usa o WhatsApp comum migra antes, no
   mesmo celular);
3. **conferir as regras atuais da Meta para a coexistência** antes de conectar (o que fica
   limitado no app: aparelhos conectados, listas de transmissão etc.) e testar com um número de
   app Business antes da primeira clínica.
4. **forma de pagamento da própria clínica** na conta do WhatsApp Business dela (cliente, 06/out):
   no Embedded Signup a clínica conecta com o próprio portfólio e a própria conta; a Meta cobra
   a clínica direto pelos templates que o RecepClinic envia em nome dela (o RecepClinic, como Tech
   Provider, não paga nem repassa; a linha de crédito compartilhada é só de Solution Partner).
   Na conexão, o **Suporte confere se a forma de pagamento está ativa** (sem ela, lembretes e
   confirmações não saem; o bot responde quando o paciente escreve primeiro). A proposta e o
   contrato deixam claro que as mensagens da Meta são cobradas da clínica, à parte. Conferir
   essas regras da Meta junto com as da coexistência.

## F9 — Operação e segurança

**Escopo:** ferramenta de erros com a clínica em cada erro e monitor externo (painel e webhook);
cabeçalhos de segurança e `robots.txt`; proteção de origem explícita; logs sem dados pessoais;
anonimização de paciente/contato a pedido (LGPD); contadores de uso visíveis para o Suporte.

Subetapas (cliente, 09/out/2026), cada uma validada antes da próxima:

| | Subetapa | Situação |
|---|---|---|
| F9.1 | Cabeçalhos de segurança, `robots.txt` e proteção de origem explícita (L44, L46) | validada em 09/out |
| F9.2 | Logs sem dados pessoais: só ids e a clínica (L43) | validada em 09/out |
| F9.3 | Ferramenta de erros com a clínica em cada erro e monitor externo do painel e do webhook (L45) | validada em 09/out |
| F9.4 | Anonimização de paciente e contato a pedido (LGPD, L42) | validada em 09/out |
| F9.5 | Contadores de uso por clínica para o Suporte (L49) | validada em 09/out |
| F9.6 | Proteção contra abuso no agendamento pelo bot | validada em 10/out (F9.6a e F9.6b) |

**F9.1:** CSP do Astro como cabeçalho nas páginas do servidor (`astro.config.mjs`): scripts e
estilos só do próprio domínio, com o hash dos embutidos; estilo em atributo liberado (cor da marca,
barras do funil); imagens também de `https:` (logos no Storage); sem moldura, `object` nem envio de
formulário para outro site. Por causa do CSP, saíram os `onchange` do HTML (os filtros usam
`data-autosubmit`, tratado no layout do painel) e os scripts com `define:vars` (valores em
atributos `data-*`). Demais cabeçalhos em toda resposta (`src/lib/securityHeaders.ts`):
`X-Frame-Options`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy` e
`X-Robots-Tag: noindex`. `robots.txt` bloqueia tudo (o domínio `app.` é só painel e links de
pacientes). `checkOrigin` ligado explicitamente. **Na F8**, o Embedded Signup vai pedir no CSP o
script e a moldura do Facebook (`connect.facebook.net`, `www.facebook.com`).

**F9.2:** todo log do servidor passa por `src/lib/log.ts` (`logError` e `logWarn`), e um teste
recusa `console.*` em qualquer outro arquivo de `src`. A linha leva o escopo, os ids (clínica,
atendimento, mensagem na Meta, link, série) e o tipo e a mensagem do erro, com a causa. Nunca vai o
objeto do erro inteiro (o do Postgres traz os valores da linha em `details`; o do e-mail, o
endereço). A mensagem passa por uma máscara de telefone (10 dígitos ou mais) e e-mail, porque pode
vir da Meta, do banco ou do SMTP, e é cortada em 500 caracteres. Saiu o telefone do log das
conversas paradas.

**F9.3** (cliente, 09/out): **sem ferramenta externa de erros**, para não entrar um operador novo
nos dados (o Tratamento de dados na Meta declara só Supabase e Vercel). O `logError` também grava
cada erro em `system_errors` (migração `20261009130000`; só a service role grava, só o Suporte lê;
90 dias, apagados pela rotina `limpar-erros`), e o Suporte vê a lista, com a clínica, em
**Administração do sistema › Erros**, junto com a última execução de cada rotina. Cada rotina do
agendador registra o fim da execução em `cron_heartbeats`. **Monitor externo: Better Stack**
(gratuito, uso comercial, a cada 3 minutos, aviso por e-mail), com 4 monitores:

| Monitor | Endereço | Fica vermelho quando |
|---|---|---|
| Painel | `https://app.recepclinic.com.br/admin/login` | não responde 200 |
| Webhook | `https://app.recepclinic.com.br/api/saude/webhook` | 503: falta o App Secret ou o token de verificação do app da Meta (o próprio webhook responde 403 a quem não é a Meta, e o Better Stack não tem como aceitar 403) |
| Saúde | `https://app.recepclinic.com.br/api/saude` | 503: banco fora ou rotina atrasada (minuto: 10 min; 5 min: 20; hora: 90; diária: 26 h) |
| Erros | `https://app.recepclinic.com.br/api/saude/erros` | 503: algum erro gravado nos últimos 15 minutos (volta sozinho) |

**F9.4** (regras do cliente, 09/out): a clínica (controladora) atende o pedido do paciente e
anonimiza em *Pacientes › paciente › Anonimizar (LGPD)*, com confirmação que mostra o que vai
acontecer. Função `anonymize_patient` (migração `20261009140000`), irreversível:
1. **histórico fica, sem identificação**: o paciente vira "Paciente anonimizado" (nascimento
   neutro 01/01/1900, sem observações nem carteirinha, inativo); atendimentos passados mantêm
   data, serviço, profissional, valor e situação, sem o endereço domiciliar;
2. **o contato vai sempre junto**, mesmo que responda por outros pacientes: nome, telefone (vira
   `+00…`, número que não existe e que o envio recusa antes da Meta), endereço, textos das
   mensagens, conversa do bot, funil e links. Os outros pacientes ficam sem telefone até a clínica
   editar o contato com o nome e o WhatsApp de quem fala por eles (aí ele volta a ser ativo);
3. **só o Administrador da clínica e o Suporte** (o banco confere);
4. **futuros cancelados junto, sem aviso** (a trilha registra "anonymized"; a lista de espera pode
   oferecer as vagas); séries encerradas;
5. **registro do Suporte**: os campos pessoais das cópias viram "anonimizado".

O paciente anonimizado não pode ser editado nem reativado (gatilho e restrição no banco). As
telas mostram "telefone anonimizado" e "idade anonimizada".

**F9.5** (cliente, 09/out): **Administração do sistema › Uso** mostra, por clínica, nos últimos 6
meses: atendimentos criados, **templates** (a Meta cobra da clínica) e **respostas do bot e da
conversa** (sem custo na janela de 24 h). Só contam as mensagens que saíram: antes o contador
somava também as puladas por falta de template e as que falharam (migração `20261009150000`, que
recalculou os meses a partir do histórico). Sem cobrança: só para acompanhar.

**F9.6, proteção contra abuso no agendamento** (cliente, 09/out). Risco: um número de WhatsApp
cadastra pelo bot muitos pacientes ("para outra pessoa") e marca um atendimento para cada um,
ocupando a agenda e gastando templates da clínica (confirmação e lembrete). Hoje só existe a regra
de um atendimento futuro por paciente em cada agenda. Decisões:

1. **Limite de atendimentos futuros por contato no bot**, somando todos os pacientes dele:
   padrão **3**, ajustável por clínica (1 a 10). Acima disso, o bot não marca: passa a conversa
   para a recepção (pausa, como "falar com a recepção"). A equipe marca sem limite pelo painel.
2. **Limite de pacientes novos cadastrados pelo bot por contato**: **3 em 30 dias**, ajustável.
   Acima disso, vai para a recepção. Cadastros da equipe não contam.
3. **Bloquear contato** (tela do contato, com confirmação; só Administrador e Suporte): o bot para
   de marcar para o número e responde que a conversa está com a recepção. Na mesma confirmação,
   uma opção marcada **cancela todos os atendimentos futuros dos pacientes dele, sem aviso** (não
   gasta template; a lista de espera pode oferecer as vagas). Dá para desbloquear.
4. **Faltas**: com **2 faltas nos últimos 90 dias**, somando os pacientes do contato, o bot não
   marca e passa para a recepção. Ajustável; 0 desliga.
5. **Alerta**: a conversa pausada mostra o motivo (limite de atendimentos, de cadastros ou
   faltas); o **Painel** ganha o cartão **"Contatos para revisar"** (quem bateu limite nos últimos
   7 dias, com atalho para a tela do contato); o Suporte vê a contagem na tela Uso.

Os 3 números ficam em Configurações › Clínica.

Detalhes da F9.6a (cliente, 10/out):
- o limite de atendimentos futuros conta **todos** os atendimentos dos pacientes do contato,
  marcados pelo bot ou pela equipe;
- o limite **só trava marcar** (e cadastrar): cancelar, remarcar, confirmar e responder ao lembrete
  seguem pelo bot;
- a resposta ao paciente é **neutra**, sem revelar a regra ("vou passar sua conversa para a
  recepção, que responde em breve");
- a verificação é **logo no início**: atendimentos e faltas quando o contato escolhe marcar;
  cadastros quando ele pede para cadastrar outra pessoa;
- o **motivo** aparece num aviso na **tela do contato** (com os últimos limites atingidos) e no
  cartão "Contatos para revisar" do Painel (não há caixa de conversas no painel; no app da
  recepção só aparece a mensagem neutra);
- conexão **sem coexistência** (hoje só o chip de testes; toda clínica real entra por
  coexistência, F8): o bot **não pausa** (ninguém responderia pelo app); avisa, neutro, que a
  recepção vai entrar em contato, sem repetir o menu (cliente, 10/out, na validação); a próxima
  mensagem recomeça. O contato entra em "Contatos para revisar" do mesmo jeito.

**F9.6a — validada pelo cliente em 10/out**, com os ajustes abaixo. Migração
`20261010120000_limites_do_bot`: os 3 limites em `clinic_settings` (padrão 3, 3 e 2), a origem do
cadastro em `patients.created_via` (`admin` ou `whatsapp`; os antigos ficam como da equipe) e a
tabela `bot_limit_events` (motivo, limite, valor na hora e se pausou; só o contato, sem telefone;
a equipe lê, só o bot grava), contada em `clinic_usage_monthly.bot_limit_hits`. Regras em
`src/lib/data/whatsapp/botLimits.ts`. **Os links de marcar ainda válidos contam como atendimento**
(um por paciente): sem isso, quem pedisse vários links antes de usar o primeiro passaria do
limite. Verificação em `bot/booking.ts`: atendimentos e faltas no início de Marcar consulta, Marcar
exame, Marcar retorno e do Encaixe sem nada marcado; cadastros antes de pedir o nome do paciente
novo (ou a data de nascimento do "para mim"). No funil, a tentativa fica como bloqueada
("Limite de … do contato") e a pausa entra como `handoff` com o passo `bot_limit`. Telas:
Configurações › Clínica (bloco "Limites do bot por contato", com o bot liberado), tela do contato
(aviso, se dos últimos 7 dias, e os últimos 5 limites), Painel (cartão "Contatos para revisar", com
o bot liberado) e Administração › Uso (coluna "Limites do bot"). Com a pausa (coexistência), o
contato fica como em "Falar com a recepção": durante as 24h o bot não responde, nem para cancelar
ou remarcar (só o Confirmar do lembrete). 11 testes de banco novos (`bot-limites.test.ts`) e 4
unitários.

**Ajustes da validação (cliente, 10/out):**
- sem coexistência, o aviso neutro vai sozinho, **sem repetir o menu**; a próxima mensagem recomeça;
- **"Revisado"** (tela do contato e cartão do Painel, com confirmação; Recepção e Administrador):
  tira o contato de "Contatos para revisar" até ele atingir um limite de novo. Sem a ação, sai
  sozinho em 7 dias;
- **"Liberar dos limites do bot"** (tela do contato, com confirmação; só o Administrador): o bot
  não aplica nenhum dos três limites ao número até alguém desfazer ("Voltar a aplicar os
  limites"); a tela mostra quem liberou (pelo papel) e quando. Caso típico: empresa com acordo
  que marca vários pacientes;
- **contato desativado continua contando**: o bot procura o número mesmo desativado (antes, o
  número virava "novo" e a primeira marcação passava sem verificar). Desativar um paciente não
  muda nada nos limites (os atendimentos futuros e o cadastro dele continuam contando).
Migração `20261010130000_revisar_e_liberar_contato`: colunas em `contacts`, gravadas só pelas
funções `mark_contact_bot_limits_reviewed` e `set_contact_bot_limits_exempt` (o banco confere o
papel; a edição comum do contato não mexe nelas). 3 testes de banco novos.

**F9.6b — Bloquear contato: decisões (cliente, 10/out):**
- número bloqueado que escreve recebe uma resposta **neutra, uma vez por dia** ("Sua conversa
  está com a recepção, que responde por aqui assim que possível"; sem coexistência, "a recepção
  vai entrar em contato com você"); as outras mensagens do dia ficam sem resposta; sem menu, sem
  revelar o bloqueio;
- bloqueado **sem** cancelar: os atendimentos que ficaram seguem normais (lembrete, preparo,
  avisos da clínica) e os botões do lembrete funcionam (confirmar, cancelar, remarcar);
- ao bloquear, os pacientes do contato **saem da lista de espera** (a oferta aberta volta para a
  fila); desbloquear não devolve ninguém à lista;
- etiqueta **"bloqueado"** na tela do contato (quem, quando e o motivo, se informado), na ficha de
  cada paciente dele e nas listas de Pacientes e Contatos; a Agenda não muda;
- "cancelar todos os atendimentos futuros" também **encerra as séries** dos pacientes do contato
  (senão o agendador criaria sessões novas); o bloqueio vale mais que a liberação dos limites.

**F9.6b — validada pelo cliente em 10/out.** Migração
`20261010140000_bloquear_contato`: `contacts.bot_blocked_at/by/reason`, gravados só pela função
`set_contact_bot_blocked` (só o Administrador e o Suporte; desbloquear apaga o motivo), e
`bot_blocked_notified_at` (a resposta do dia, gravada pelo bot). Regras em
`src/lib/data/whatsapp/contactBlock.ts`: ao bloquear, sai da lista de espera; com a opção,
encerra as séries e cancela os atendimentos futuros pela tela (trilha de cada um, cancelamento em
massa, sem aviso). No bot (`router.ts`), o número bloqueado (mesmo com o contato desativado) só
passa nos toques do lembrete e no fluxo que eles abrem; o resto recebe a resposta neutra uma vez
por dia e a conversa volta ao começo. Telas: cartão "Bloqueio no bot" na tela do contato (motivo
opcional; a opção de cancelar vem marcada e mostra quantos atendimentos; confirmação), etiqueta
"bloqueado" no contato, na ficha do paciente e nas listas. 5 testes de banco novos
(`bot-bloqueio.test.ts`) e 1 unitário.

## E-mail de verdade (antes do 1º piloto)

Escolhido pelo cliente em 10/out, enquanto a Meta não responde. O código já envia por SMTP desde a
F4.4a (convite, aviso de acesso, pedido de informações); falta o provedor. Decisões (cliente,
10/out):
- provedor **Resend** (SMTP; plano grátis de 3.000 e-mails por mês e 100 por dia), região de São
  Paulo se oferecida;
- remetente **`RecepClinic <nao-responda@recepclinic.com.br>`**, sem caixa de entrada;
- o mesmo provedor vira o SMTP do Supabase ("Esqueci minha senha" e os modelos em
  `supabase/templates/`);
- **LGPD:** o Resend é um operador novo (e-mail e nome da equipe e de quem pede informações; nada
  de pacientes): incluir na política de privacidade do site (sessão do site).

**Validado pelo cliente em 10/out** no staging (roteiro na parte L do [`staging.md`](staging.md)):
"Esqueci minha senha", convite de nova clínica e pedido de informações chegando de
`nao-responda@recepclinic.com.br`. Sem código novo: só a configuração (Resend, Vercel com
redeploy, SMTP e modelos no Supabase). O formulário respondido fica só no painel do Suporte
(Administração › Clínicas › a clínica), **sem e-mail de aviso** (cliente, 10/out).

## Ajustes dos testes do cliente (antes da F8a)

Pontos que o cliente encontrou testando o staging, um por vez, cada um validado antes do próximo.
**Rodada encerrada e toda validada em 11/out/2026.**

| | Ajuste | Situação |
|---|---|---|
| 1 | Cores da situação na Agenda | validado em 10/out |
| 2 | Atendimentos marcados de um paciente (busca na Agenda) | validado em 10/out |
| 3 | "Voltar" leva à tela de onde a pessoa veio (3a: ficha do paciente e contato; 3b: telas da Agenda e Configurações) | validado em 10/out |
| 4 | "Aguardando remarcação" com o mesmo paciente repetido | validado em 11/out |
| 5 | Mensagens com "fale com a clínica", caso a caso (5a: clínica sem serviço, serviço sem horário, como a clínica é chamada e prazo para oferecer horários; 5b: os demais casos) | validado em 11/out (5a e 5b) |
| 6 | Avisos de marcação, remarcação e cancelamento por template | mantido como está (11/out) |
| 7 | Explicação dos campos "Informações que o bot responde" | validado em 11/out |
| 8 | Página de tecnologia para o Suporte | validado em 11/out |
| 9 | Comercial no Suporte: 9a planos e aplicar plano; 9b clínicas de demonstração; 9c roteiro de vendas | validado em 11/out (9a, 9b e 9c) |

**1. Cores da situação** (cliente, 10/out/2026): no Dia, na Semana e no Resumo do dia, cada
atendimento tem faixa à esquerda e fundo claro conforme a situação, com uma legenda acima:
não confirmado **amarelo** (o que falta confirmar), confirmado **verde** (presença confirmada ou
pelo lembrete), compareceu **azul**, faltou **laranja**, cancelado **vermelho** (como já era, com o
horário riscado) e bloqueio **cinza**. Verde só para o que está garantido (sugestão aceita pelo
cliente no lugar de dois tons de verde). Os selos continuam; "já passou: registre o
comparecimento" mantém a cor da situação. Código em `components/admin/agenda/situationStyle.ts`.

**2. Atendimentos marcados de um paciente** (cliente, 10/out/2026): campo com esse nome no topo
da Agenda (Dia, Semana e Mês), pelo nome ou pelo telefone (4+ dígitos), como em Pacientes, inclusive
desativados. **O resultado é sempre de um paciente só:** um encontrado, a tela já mostra os
atendimentos marcados dele; mais de um, a pessoa escolhe na lista (nome, idade, responsável,
telefone e quantos atendimentos marcados cada um tem). Na tela do paciente: os próximos
atendimentos (data, hora, serviço, agenda e local, na cor da situação; o clique abre o dia na
Agenda), a ficha (histórico completo), voltar à lista e buscar outro (`/admin/agenda/buscar`).
**Só as agendas que a pessoa vê** (D6 mantida: o Profissional, só as próprias; garantido pelo RLS).

**3. Voltar para a tela anterior** (cliente, 10/out/2026, regra para o sistema todo): "toda tela
deve voltar para a tela anterior que levou o usuário até a tela atual, para o usuário não se
perder". O link de saída leva a origem em `?volta=` (`withReturn` em `lib/returnPath.ts`); a tela
de destino mostra "Voltar" para essa origem e a mantém depois das próprias ações (salvar,
desativar etc.); sem origem, o padrão de antes (ex.: Pacientes). Origem só de telas do Início, da
Agenda, do Resumo do Dia e de Pacientes (`safeReturnPath`). **3a:** ficha do paciente e
responsável/contato, abertas da busca da Agenda, de Pacientes (volta à busca feita), dos cartões
da Agenda, do Resumo do Dia, da Trilha e do Início. **3b:** Marcar (a origem fica no estado da
tela, entre os passos), Bloquear, Bloqueios e a edição do bloqueio (salvar volta à origem), Série,
Remarcar e Avisar (rótulo "Voltar"), abertas do cabeçalho e dos cartões da Agenda; Cadastrar
paciente (de Pacientes ou do contato; depois de cadastrar, a ficha volta à origem). Nas
Configurações, cada tela já volta à lista de onde veio; a "Nova agenda" aberta pelo profissional
volta a ele. O resultado de uma ação que cria algo (marcar, bloquear) continua levando ao dia na
Agenda, para mostrar o que foi feito.

**4. Aguardando remarcação sem repetição** (cliente, 11/out/2026): a lista mostrava o mesmo
paciente duas vezes quando a clínica cancelava, o paciente remarcava e a clínica cancelava de novo
(dois cancelamentos da mesma jornada). Regra nova: o cancelamento sai da lista também quando o
paciente foi **marcado de novo para a mesma jornada depois dele**, em qualquer situação (marcado,
compareceu, faltou ou cancelado de novo); jornada como no "já tem marcado" (Consulta/Retorno na
mesma agenda; o mesmo exame). Continua saindo com atendimento futuro da jornada e com "Desistiu".
Fica no máximo uma linha por paciente e jornada, a do último cancelamento (`wasRebooked` em
`lib/data/daily.ts`).

**5. "Fale com a clínica" nas mensagens** (cliente, 11/out/2026), revisado caso a caso.
**5a:**
- **Como a clínica é chamada** nos textos genéricos (Configurações › Clínica): "a clínica", "o
  consultório" ou outro nome com o artigo (`message_noun`, `message_noun_article`; migração
  `20261011120000`). O nome próprio continua com "Aqui é da/do …".
- **Prazo para oferecer horários** (mesma tela, `booking_horizon_days`, 7 a 365, padrão 60): o
  bot e a página de marcar usam o mesmo prazo (na página, entra no último dia, junto com o prazo
  do retorno).
- **Clínica sem serviço para o bot:** depois das boas-vindas, "A clínica responderá sua mensagem
  em breve." e a recepção assume (pausa padrão de 24 horas úteis).
- **Serviço sem horário livre no prazo** (tudo marcado ou bloqueado): conferido logo depois da
  escolha do serviço, antes de qualquer cadastro; "No momento não há horários livres para
  *Consulta*. A clínica responderá sua mensagem em breve." e a recepção assume. Com vários
  profissionais, a lista mostra só os que têm horário (sobrando um, segue direto); os locais
  também. No retorno, conferido logo depois de escolher o paciente (até o fim do prazo dele).
**5b** (decidido caso a caso com o cliente, 11/out/2026):
- **Erro ao gerar o link:** fica como era, com a forma de chamar a clínica ("…ou fale com o
  consultório.").
- **Já tem atendimento marcado:** "…Para mudar o dia ou horário, escolha *Consultas › Remarcar*."
  (ou *Exames › Remarcar*) e o bot já mostra esse menu.
- **Não achou neste número** (sem cadastro; sem atendimento futuro; "Não" em "é essa que você
  quer remarcar?" com um só; prazo do retorno vencido): o texto aponta a opção *Falar com a
  recepção* do menu inicial ("Se o agendamento foi feito por outro número, escolha a opção…"; sem
  recepção no número, "…escreva por aquele número.") e o bot mostra o menu inicial de novo. A
  opção do menu continua "Falar com a recepção".
- **Data de nascimento sem atendimento:** pede de novo uma vez; na segunda, como o anterior.
- **Páginas do link** (marcar, preparo, orientações): "…fale com o consultório pelo WhatsApp.",
  com a forma de chamar a clínica.

**6. Avisos por template** (discussão, 11/out/2026): ficam como estão (sempre template). Pela
página oficial de preços da Meta, texto livre e template de utilidade dentro da janela de 24h
(paciente que acabou de falar com o bot) são grátis; fora da janela (ações da clínica pelo
painel) só o template é aceito, e ele é cobrado. Se o custo com a Meta pesar, voltar ao assunto
(opções levantadas: texto livre dentro da janela; a clínica escolher se avisa nas ações do painel).

**7. "Informações que o bot responde"** (Configurações › Clínica): cada campo ganhou a explicação de
onde aparece no bot (Informações › Valores, Convênios e Outras informações) e o que acontece vazio.

**8. Tecnologia** (Administração do sistema › Tecnologia, só o Suporte; `admin/sistema/tecnologia.astro`):
tecnologias, onde cada parte está hospedada (Vercel e Supabase em São Paulo, Cloudflare, GitHub,
Meta, Resend, Better Stack), integrações, rotinas do agendador, onde ficam os segredos (só os
nomes), ambientes, segurança e o desenho da arquitetura (SVG). Conteúdo fixo: **atualizar a página
quando mudar hospedagem, plano ou integração** (ex.: na F10, os planos pagos da produção).

**9. Comercial no Suporte** (cliente, 11/out/2026): os planos e o roteiro de vendas ficam **só no
Suporte**, nunca no site público. Os nichos das primeiras clínicas: pediatras, médicos que atendem
todas as idades e dentistas (sem psicologia e sem agendamento recorrente por ora). Pilotos (a
pediatra e, depois, uma psicóloga) são de graça, combinados pelo cliente; **sem oferta de entrada**
para as demais.

**Página Vendas** (Suporte › Vendas, `admin/sistema/vendas`; cliente, 11/out): reúne a apresentação e
a venda do RecepClinic em abas, e os próximos assuntos de venda entram como abas novas. Hoje:
**Planos** (a antiga tela Planos; `/admin/sistema/planos` redireciona) e **Demonstração** (as 3
clínicas e os logins, com a hora em que cada uma foi montada e onde está o chip; os comandos para
criar ou atualizar as demos, criar a senha dos logins e mover o chip; o roteiro da apresentação de
20 minutos) e **Roteiro de vendas** (9c).

- **9a. Planos** (`lib/plans.ts`, tela `admin/sistema/planos`): mensalidade por clínica + R$ 47 por
  profissional além do primeiro (pelo limite contratado). **Básico R$ 147** (o que é sempre ligado,
  mais Bot, Lembrete automático e Lembrete ao profissional); **Completo R$ 297** (Básico e todos os
  adicionais). **Adicionais** com valor fixo por clínica: Exames R$ 35, Lista de espera R$ 35,
  Métricas R$ 45 (as 7 sempre juntas), Mensagens personalizadas R$ 29 (bot e templates juntos),
  Domiciliar R$ 19, Convênios R$ 19, Lembrete à equipe R$ 15. **Implantação R$ 297** (isenta só nos
  pilotos). Séries recorrentes fora da tabela (o Suporte ainda pode ligar, sem valor). Mensagens da
  Meta à parte. Na **Matriz de acesso**, os itens aparecem como são vendidos (Básico, Adicionais,
  Fora da tabela); escolher Básico ou Completo marca os itens, e a tela mostra o plano e a
  mensalidade de referência. A tela Planos tem a tabela, exemplos e o plano de cada clínica,
  deduzido da matriz (sem coluna nova no banco).
  **Simulação da negociação** (cliente, 11/out): ao lado de cada valor da tela Planos há um campo;
  o Suporte escolhe Básico ou Completo, os adicionais, os profissionais e se a implantação é isenta,
  clica em Calcular e vê a mensalidade, a implantação e o primeiro pagamento, comparados com a
  tabela. **Nada é gravado.** Pendência antes da 1ª clínica pagante: **manutenção das clínicas
  contratadas** (valor negociado, vencimento, implantação, histórico de reajustes), desenhada com o
  contrato do advogado.
- **9b. Clínicas de demonstração** no staging, nomes e dados fictícios, montadas por
  `scripts/demo-clinicas.mjs` (só mexe nelas; rodar de novo antes de uma demonstração refaz tudo
  com os atendimentos a partir de hoje e mantém os logins):
  - **Pediatria Sol Nascente** (Básico): Dra. Laura Mendes; `demo.basico@recepclinic.com.br`.
  - **Odonto Sorriso Leve** (Básico + Exames e procedimentos + Lista de espera): Dr. Felipe Andrade,
    avaliação, retorno e os procedimentos (limpeza, restauração, clareamento); chamada de "o
    consultório"; `demo.odonto@recepclinic.com.br`.
  - **Clínica Vida Plena** (Completo, 3 profissionais): clínico geral, pediatra e cardiologista,
    eletrocardiograma com preparo, consulta domiciliar, 3 convênios, bloqueio, lista de espera,
    um "Aguardando remarcação" e as últimas semanas para as métricas (com o funil do bot);
    `demo.completo@recepclinic.com.br`.
  - Logins de Administrador (+ Profissional), senha por `scripts/link-de-senha.mjs`. Telefones
    fictícios (+55 11 9000x-xxxx); sem conexão de WhatsApp, nada é enviado.
  - **Chip de testes** (cliente: só com pedido): `--chip-para-demo` passa a conexão da Consultorio
    Tluiz22 para a Vida Plena (copia os templates e desliga os envios automáticos dela, porque os
    telefones são fictícios); `--chip-devolver` desfaz. Com o chip na Vida Plena, o script não
    remonta as clínicas.
- **9c. Roteiro de vendas** no Suporte (vem do artifact de 11/out), com os ajustes da lista "Antes de
  abordar": preço definido; sem o item da liberação da Meta; demonstração pelas 3 clínicas; imagens
  tiradas das demos; clínicas-alvo nos novos nichos; contrato e LGPD com a resposta pronta. Sai a
  mensagem 7 (convite às primeiras clínicas). **Feito** (aba Vendas › Roteiro de vendas,
  `components/admin/vendas/RoteiroTab.astro`): a frase de 15 segundos, a lista "Antes de abordar"
  (marcação salva no navegador), as 4 camadas, a tabela de complemento com o limite (sem sincronia
  com outras agendas), a calculadora de ganho, o passo a passo em 8 etapas (a demonstração aponta
  para a aba Demonstração), **4 imagens para baixar** (lembrete, conversa de marcação, agenda do
  dia e resumo do dia, tiradas da Vida Plena; modelo em `scripts/vendas-imagens/conversas.html`,
  arquivos em `src/assets/vendas`), 8 mensagens com "Copiar" (a proposta com o plano e a
  implantação) e as objeções (LGPD com a resposta pronta). As imagens ficam em endereços com nome
  aleatório (`/_astro/…`), sem login, mas com dados fictícios. O material antigo no claude.ai
  (`R3VCJ9t1ebygPzjJhyvdJf`) foi substituído por esta aba.

## F10 — Primeiro piloto

**Escopo:** produção (Supabase Pro + Vercel Pro, backup conferido); criação da 1ª clínica pelo
Suporte (pela tela "Nova clínica", F4.4) e configuração pelo Administrador; no cenário B, script de importação do banco do piloto
para o modelo novo; acompanhamento das primeiras semanas.

**Depende da F8** (cliente, 06/out): o número da primeira clínica só é conectado por coexistência,
então o Tech Provider precisa estar aprovado antes da F10.

## F11 — Módulo financeiro: pagamentos e nota fiscal no CPF do responsável

**Pedida pelo cliente em 12/out/2026** para as clínicas piloto de **Mossoró (RN)**. Primeiro foi
registrada para depois do 1º piloto e, no mesmo dia, **antecipada pelo cliente** ("podemos iniciar
a implementação"). A clínica, com **CNPJ**, emite a **NFS-e** do atendimento no CPF de quem pagou.
A despesa chega à declaração pré-preenchida do IR do responsável pela **DMED**, que o RecepClinic
gera.

**Decisões do cliente (12/out):**
- **Nota municipal, padrão nacional:** a NFS-e é do município (ISS), não do estado. Mossoró
  instituiu a NFS-e de padrão nacional (Decreto 7.497, de 13/jan/2026, obrigatória para pessoa
  jurídica desde 01/jan/2026).
- **Integração direta na API nacional** (Sefin Nacional), sem intermediário pago. Cada clínica
  envia o **certificado digital A1** (e-CNPJ) dela; o RecepClinic o guarda criptografado (fora do
  alcance da equipe da clínica) e assina as notas. Cidade fora do padrão nacional fica sem a
  funcionalidade. O RecepClinic acompanha as mudanças do layout (ex.: IBS e CBS da reforma
  tributária).
- **Emissão ao registrar o pagamento:** no atendimento, a recepção registra o pagamento (valor,
  forma, data e quem pagou) e confirma "Emitir nota"; a nota sai na hora. Também cancelar a nota
  (CPF ou valor errado) e emitir de novo.
- **Responsável financeiro (cliente, 12/out):** por padrão, o **contato do WhatsApp** do
  paciente (ou o próprio paciente, quando ele é o contato); pode ser trocado por **outra pessoa**
  (nome e CPF) quando quem paga não é quem conversa com a clínica. A nota sai no CPF de quem pagou
  e o paciente é o beneficiário. CPF é dado pessoal: logs sem CPF, anonimização a pedido (F9)
  cuidando da guarda fiscal das notas.
- **Só dentro do Módulo financeiro (cliente, 12/out):** CPF, responsável financeiro e os demais
  dados da nota são pedidos e guardados **só no módulo novo**, que passa a tratar das questões
  financeiras (pagamentos e notas). O cadastro do paciente, o bot e a página de agendamento **não
  mudam** e não pedem CPF. Paciente e contato ganham uma área **"Financeiro"** (só com o módulo
  liberado) com o CPF e o responsável; ao registrar um pagamento, o que faltar é pedido ali mesmo.
- **DMED:** o sistema gera, para o ano escolhido, o **arquivo da DMED** no formato da Receita
  (responsável e beneficiário, valores do ano); o contador confere e entrega até o fim de
  fevereiro.
- **Entrega:** o PDF da nota vai pelo **WhatsApp** da clínica (template novo, aprovado na Meta) e
  fica no histórico do paciente para baixar e reenviar.
- **Matriz (D11) e menu (cliente, 12/out):** um item **"Módulo financeiro (pagamentos e nota
  fiscal)"**, desligado por padrão, que libera tudo acima e um **menu novo "Financeiro"**
  (pagamentos, notas e DMED). A aba **Métricas › Financeiro** continua como está (só os
  gráficos).
- **Fora:** recibo do Receita Saúde (profissional pessoa física, sem API oficial) e outras cidades,
  até alguma clínica pedir.

**Prioridade (cliente, 12/out):** quando a Meta aprovar, a F11 pausa e o trabalho volta à F8 e
à F10 para terminar e iniciar o piloto; a F11 continua depois.

**Subetapas** (uma por vez, cada uma validada pelo cliente):

| | Subetapa | Depende de | Situação |
|---|---|---|---|
| F11.1 | Item "Módulo financeiro" na matriz e menu "Financeiro"; área Financeiro do paciente e do contato (CPF e responsável) | — | implementada (12/out), validação no fim (cliente, 12/out) |
| F11.2 | Registro do pagamento no atendimento (sem nota ainda) | F11.1 | implementada (12/out), validação no fim (cliente, 12/out) |
| F11.3 | Dados fiscais da clínica e certificado A1 | F11.1 | implementada (12/out), validação no fim (cliente, 12/out) |
| F11.4 | Emissão e cancelamento na API nacional (ambiente de testes da Receita) | F11.2, F11.3 e os itens do cliente abaixo | implementada (12/out), falta o teste real na Produção Restrita |
| F11.4b | Ambiente "Simulação" da nota (testar sem e-CNPJ, só no staging) | F11.4 | implementada (13/out), validação no fim |
| F11.5 | PDF da nota no histórico e envio pelo WhatsApp (template novo) | F11.4 e a Meta | implementada (12/out), falta o template aprovado na Meta |
| F11.6 | Arquivo da DMED do ano | F11.2 | implementada (12/out), validação no fim (cliente, 12/out) |

- **F11.1:** item `finance` ("Módulo financeiro (pagamentos e nota fiscal)", área nova
  **Financeiro**) na matriz e o menu "Financeiro" (por ora, a lista de pacientes com e sem dados
  financeiros). Tabelas do módulo, separadas do cadastro: dados financeiros do **contato** e do
  **paciente** (CPF com validação dos dígitos) e o **responsável financeiro** do paciente (o
  contato, por padrão, ou outra pessoa com nome e CPF). Área "Financeiro" na tela do paciente e
  do contato, só com o item. O CPF não vai para logs, bot nem páginas públicas (máscara de CPF e
  CNPJ no log). A anonimização (F9) apaga esses dados.
  **Como ficou (12/out):** migração `20261012120000_modulo_financeiro.sql` (tabelas
  `contact_finance` e `patient_finance`, CPF conferido no banco por `app.is_valid_cpf`, gravação só
  com o item, RLS: Administrador e Recepção gravam, o Suporte só lê, Profissional, bot e outras
  clínicas não veem; anonimizar apaga). Só o CPF do responsável será exigido para a nota; o do
  paciente é opcional (cliente, 12/out). Quem fala por si é o próprio contato: o CPF dele fica uma
  vez só, no contato. O módulo fica **fora da tabela de planos** por ora (cliente, 12/out). Menu
  "Financeiro" (lista com o responsável de cada paciente e "falta CPF"), cartão "Financeiro" na tela
  do paciente (CPF, quem paga: o contato, o próprio paciente ou outra pessoa) e na do contato (CPF).
  Testes: unidade (CPF, responsável, acesso, planos, máscara de CPF e CNPJ no log) e banco
  (`tests/db/modulo-financeiro.test.ts`, mais a varredura de isolamento com as tabelas novas).
- **F11.2:** tabela de pagamentos por atendimento: valor (sugerido pelo preço do atendimento),
  forma (Pix, dinheiro, cartão), data e **quem pagou** (o paciente ou o responsável), com a
  confirmação das ações da Agenda.
  **Decisões do cliente (12/out):**
  - **Vários pagamentos** por atendimento (ex.: parte no Pix e parte no cartão, ou sinal antes e
    o restante no dia); cada um terá a sua nota (F11.4) e a DMED soma tudo no ano.
  - **Onde:** botão **"Pagamento"** no cartão do atendimento na Agenda (só com o módulo), que abre
    uma tela própria com o preço, o que já foi pago, o que falta e o formulário; a confirmação fica
    no botão final (como no Remarcar) e o "Voltar" leva de volta à Agenda. Os pagamentos também
    aparecem no cartão "Financeiro" do paciente.
  - **Quando:** atendimento marcado, confirmado ou que compareceu (permite o sinal antes do dia).
    Cancelado e falta não recebem pagamento novo, mas os já feitos continuam visíveis.
  - **Formas:** Pix, dinheiro, crédito e débito (fixas, iguais para todas as clínicas).
  - **Quem pagou:** vem marcado o responsável financeiro do paciente; pode ser trocado, só naquele
    pagamento, para o contato, o próprio paciente ou outra pessoa (nome e CPF). Nome e CPF ficam
    gravados no pagamento (a nota e a DMED não mudam se o cadastro mudar depois).
  - **CPF não é obrigatório para registrar** (o caixa não trava): aviso "falta CPF"; o CPF passa a
    ser exigido só na emissão da nota (F11.4). Digitado na tela para o contato ou o paciente, vai
    também para o cadastro financeiro dele.
  - **Corrigir:** "Excluir" (Administrador ou Recepção), com confirmação; o pagamento sai das somas
    mas fica guardado como excluído (quem e quando), e registra-se de novo o certo. Pagamento com
    nota (F11.4) só se exclui depois de cancelar a nota.
  - **Valor:** vem sugerido o que falta; pode ser mudado e a soma pode passar do preço, com o aviso
    "acima do preço" antes de confirmar.
  - **Guarda:** a anonimização (F9.4) não apaga pagamentos (prazo fiscal, regra 8 da segurança).
  **Como ficou (12/out):** migração `20261012130000_pagamentos.sql` (tabela `payments`: valor,
  forma, data, quem pagou com nome e CPF gravados; o banco confere o item, a situação do
  atendimento, a data até hoje no fuso da clínica e o CPF; não se altera nem se apaga, só se
  marca excluído com quem e quando; RLS como a F11.1). Tela **Financeiro › Pagamento** do
  atendimento (`/admin/financeiro/pagamento/<id>`), botão "Pagamento" e selos **"Pago"** e
  **"Pago em parte"** nos cartões da Agenda e do Resumo do dia (A registrar e Registradas), e o
  cartão **"Pagamentos"** na tela do paciente (fica visível depois da anonimização). Testes:
  unidade (`payments.test.ts`) e banco (`tests/db/pagamentos.test.ts`, mais a varredura de
  isolamento com a tabela nova).
- **F11.3:** em Configurações (Administrador da clínica): CNPJ, inscrição municipal, município
  (código IBGE), regime tributário, código do serviço na lista nacional (ex.: 04.01 Medicina) e
  alíquota do ISS. **Envio do certificado A1** (arquivo .pfx e senha), guardado no cofre
  (Vault) do banco; a tela mostra só o titular e a validade, com aviso antes de vencer.
  **Decisões do cliente (12/out):**
  - **Dados fiscais:** o Administrador preenche e muda; o Suporte também pode preencher (ajuda na
    implantação, com o registro de alterações do Suporte), mas nunca mexe no certificado nem
    aceita o termo.
  - **Código do serviço:** um padrão da clínica (com a alíquota do ISS) e, quando for diferente,
    um código próprio por serviço (ex.: clínica com médico e psicólogo).
  - **Município:** lista fixa dos municípios liberados, por ora só **Mossoró/RN** (IBGE
    2408003); cidade nova entra quando uma clínica pedir e o padrão nacional for conferido lá.
  - **Regime:** os dois campos da nota, com o aviso "confirme com o contador": situação no
    **Simples Nacional** (não optante, MEI, ME/EPP optante) e **regime especial** (nenhum,
    sociedade de profissionais, profissional autônomo, ato cooperado, estimativa, microempresa
    municipal).
  - **Vencimento do A1:** aviso a partir de **30 dias** antes, na tela da nota e no Início do
    Administrador; vencido, a emissão fica desligada até enviar o novo.
  - **CNPJ do A1:** o certificado só é aceito se for do **mesmo CNPJ** dos dados fiscais (a tela
    mostra o CNPJ do certificado para conferir); o CNPJ vem antes do certificado.
  **Como ficou (12/out):** migração `20261012140000_dados_fiscais.sql`: tabelas
  `clinic_fiscal_settings` (CNPJ conferido no banco por `app.is_valid_cnpj`, já no formato
  alfanumérico da Receita; município pela lista `app.is_supported_fiscal_municipality`; código no
  formato 04.01.01; ISS de 0 a 5%), `service_fiscal_codes`, `clinic_fiscal_certificates` (só
  titular, CNPJ, validade, versão do termo e os ponteiros do Vault) e `fiscal_audit_log` (só
  inclusão). Certificado só pelas funções `set_fiscal_certificate` e `revoke_fiscal_certificate`
  (Administrador da clínica de verdade; o Suporte não): o servidor abre o .pfx com a senha
  (`node-forge`) para conferir a senha e ler titular, CNPJ e validade; o banco confere o CNPJ e a
  validade e guarda arquivo e senha no Vault; revogar (ou excluir a clínica) apaga os segredos.
  Tela **Configurações › Nota fiscal** (aba só com o módulo), aviso no Início do Administrador a
  partir de 30 dias. Termo **provisório** (`src/lib/fiscalTerms.ts`, versão
  `provisorio-2026-10-12`), a revisar com o advogado antes de uma clínica real. Testes: unidade
  (CNPJ, leitura do .pfx com um certificado gerado no teste, vencimento, acesso) e banco
  (`tests/db/dados-fiscais.test.ts`, mais a varredura de isolamento com as tabelas novas).
- **F11.4:** montar a DPS (XML do padrão nacional), assinar com o certificado, enviar à Sefin
  Nacional (conexão com o certificado) e guardar a chave de acesso, o número e o XML da nota.
  Cancelamento pelo evento da API. Testes primeiro no ambiente de **Produção Restrita** da
  Receita (sem valor fiscal). Erros da API em português na tela e na Administração › Erros.
  **Decisões do cliente (12/out):**
  - **Quando:** ao registrar o pagamento (ou depois, pelo botão "Emitir nota"), com a
    **competência na data do pagamento** (serve também para o sinal pago antes do atendimento).
  - **Descrição:** o tipo, o paciente e a data, nunca dado clínico (ex.: "Consulta. Paciente:
    João Souza. Atendimento em 05/10/2026."); o nome do paciente ajuda quem paga por um
    dependente a comprovar a despesa no IR.
  - **Ambiente:** toda clínica começa em **Produção Restrita** (testes, sem valor fiscal); só o
    **Suporte** passa a clínica para **Produção**, com confirmação e registro na trilha, depois
    que a clínica testou e o contador conferiu uma nota de teste. Em Produção Restrita a nota
    leva o selo "teste".
  - **ME/EPP do Simples:** a nota nacional exige o regime de apuração do Simples e o percentual
    aproximado de tributos do Simples (sem eles, a Receita recusa: E0712). Os dois entram em
    Configurações › Nota fiscal, com o aviso "confirme com o contador".
  **Como ficou (12/out), sem o teste real na Receita:** migração `20261012160000_emissao_nfse.sql`
  (campos do Simples e o ambiente nos dados fiscais, troca só pelo Suporte e na trilha; tabelas
  `nfse_dps_counters` e `nfse_invoices`; funções `begin_nfse_issue`/`finish_nfse_issue` e
  `begin_nfse_cancel`/`finish_nfse_cancel`, que conferem papel, item, pagamento, CPF, dados
  fiscais e certificado em dia, reservam o número com trava e gravam a trilha; uma nota ativa por
  pagamento, no banco; pagamento com nota não se exclui; o certificado só sai do Vault para a
  plataforma, `get_fiscal_certificate_secret`; bucket privado `nfse-xml`; rotina diária
  `notas-fiscais` às 3h30, que confere as pendentes). Código em `src/lib/nfse/` (DPS e pedido de
  cancelamento no leiaute 1.01, **validados contra o XSD oficial**; assinatura RSA-SHA256 com
  `xml-crypto`, conferida nos testes; HTTPS com TLS mútuo, testado contra um servidor local) e
  `src/lib/data/nfse.ts`. Tela do pagamento: a situação da nota de cada pagamento ("Emitindo…",
  "Nota nº", "teste", "Recusada pela Receita" com o código, "Cancelada"), "Emitir nota",
  "Conferir na Receita", "Baixar XML" (link de 2 minutos) e "Cancelar nota" (motivo e texto); no
  registro, "Emitir a nota fiscal agora" já marcado. Testes: `src/lib/nfse/nfse.test.ts` e
  `tests/db/emissao-nfse.test.ts` (com uma Receita simulada).
  **Falta (cliente):** o teste de verdade na Produção Restrita, com o e-CNPJ A1 de uma clínica
  de Mossoró; os pontos a conferir nesse teste são a alíquota (hoje só a ME/EPP a informa) e as
  mensagens de erro da Receita. O Profissional ainda não vê as notas dos atendimentos dele (fica
  para a F11.5, com o histórico).
- **F11.4b (cliente, 13/out):** sem o e-CNPJ de uma clínica, os Testes 4 e 5 do roteiro não
  rodam (a Receita só aceita certificado da ICP-Brasil). O cliente escolheu uma **Receita
  simulada**: um terceiro ambiente, **"Simulação"**, que só o Suporte liga (Configurações › Nota
  fiscal, ao lado de "Passar para Produção") e só onde a variável **`NFSE_SIMULATION=1`** estiver
  na Vercel (o staging; nunca na produção). Nele, o servidor monta a nota a partir da DPS
  assinada, no formato da Sefin (número = número da DPS, chave de acesso de 50 dígitos), sem
  falar com a Receita: PDF, envio, cancelamento, histórico e DMED funcionam como na Produção
  Restrita. A nota leva o selo "simulada", "SEM VALIDADE JURÍDICA" e o aviso "NOTA SIMULADA PELO
  RECEPCLINIC" nas informações complementares; numeração própria. Sem a variável, a clínica
  que ficou na simulação não emite (aviso para voltar à Produção Restrita). Migração
  `20261013120000_nfse_simulacao.sql` (só o valor novo `simulation`); código em
  `src/lib/nfse/simulator.ts`. Testes: `src/lib/nfse/simulator.test.ts` e
  `tests/db/emissao-nfse.test.ts`. Para o Teste 3 sem e-CNPJ, três certificados fictícios
  (CNPJ 11.222.333/0001-81 e 44.555.666/0001-81, senha `teste123`) foram gerados na Área de
  Trabalho do cliente; o sistema aceita qualquer A1 com CNPJ, e a Receita recusa os fictícios.
- **F11.5:** PDF da nota (DANFSe) no histórico do paciente, com baixar e reenviar; envio pelo
  WhatsApp com um template novo de documento (`rc_nota_fiscal_v1`, a aprovar na Meta).
  **Descoberta (12/out):** a Nota Técnica 008 v1.02 (SE/CGNFS-e, 14/07/2026) suspendeu a API
  oficial do DANFSe em 03/08/2026: o PDF passa a ser gerado pelo RecepClinic, no modelo do
  Anexo I da NT (A4, uma página, QR Code da consulta pública, "NFS-e SEM VALIDADE JURÍDICA" em
  vermelho na Produção Restrita, marca d'água "CANCELADA", linha obrigatória dos totais
  aproximados de tributos, só dados do XML da nota). As fontes da NT (Arial e Microsoft Sans
  Serif) não podem ser embutidas por licença: usa-se a Helvetica, de mesmas medidas.
  **Decisões do cliente (12/out):**
  - **Destinos:** além do WhatsApp do contato, **outro número de WhatsApp** e **e-mail** (pelo
    Resend, com o PDF e o XML anexados).
  - **Quando:** ao emitir, o PDF vai **sozinho para o WhatsApp do contato**; na tela do pagamento,
    "Enviar nota" escolhe os destinos (contato, outro número, e-mail; mais de um). Nota de teste
    não vai sozinha.
  - **Guardar:** o outro número e o e-mail ficam no cartão Financeiro do paciente (só
    Administrador e Recepção veem; o bot não), já marcados nas próximas notas, com "enviar
    sempre" opcional para irem sozinhos junto com o contato; a anonimização apaga.
  - **Template** `rc_nota_fiscal_v1` (Utilidade, com o PDF no topo), texto aprovado: "Olá, {{1}}!
    Aqui é {{2}}. Segue a nota fiscal nº {{3}}, de {{4}}, referente ao atendimento de {{5}} em
    {{6}}. Qualquer dúvida, é só responder esta mensagem." O e-mail usa o mesmo texto, com o
    assunto "Nota fiscal nº {{3}} – {{clínica}}".
  **Como ficou (12/out):** PDF gerado do XML guardado (`src/lib/nfse/danfse.ts`, `pdf-lib` e
  `qrcode`), no download "Baixar PDF" da nota (com "CANCELADA" na cancelada) e nos envios.
  Migração `20261012170000_envio_nfse.sql`: no Financeiro do paciente, outro WhatsApp, e-mail e
  "enviar sempre"; tabela `nfse_deliveries` (canal, destino, resultado, automático, quem pediu;
  a anonimização troca o destino por "anonimizado"); template `nfse_document` (`rc_nota_fiscal_v1`)
  na lista dos padrões, sem "Personalizar" (a versão própria perderia o PDF). WhatsApp: o PDF
  sobe para a Meta e vai pelo template aprovado; sem ele, só dentro da janela de 24h, como
  documento com legenda. E-mail pelo Resend, com o PDF e o XML; a frase "é só responder" virou
  "fale com a clínica", porque o remetente não recebe resposta. Na tela do pagamento: "Enviar
  nota" (contato, outro WhatsApp, e-mail, guardar, enviar sempre) e a lista de envios com a
  entrega do WhatsApp; ao emitir em Produção, vai sozinha para o contato (e os guardados com
  "enviar sempre"). O template da nota exige um PDF de exemplo, que sobe pelo app: a variável
  **`WHATSAPP_APP_ID`** (ID do app RecepClinic na Meta) precisa estar na Vercel antes de "Criar
  na Meta". Testes: `src/lib/nfse/danfse.test.ts` e `tests/db/envio-nfse.test.ts`.
  **Fica para depois:** a rotina diária, quando acha na Receita uma nota que estava "emitindo",
  não manda a nota sozinha (a recepção usa "Enviar nota"); o Profissional ainda não vê as notas
  dos atendimentos dele.
- **F11.6:** no menu Financeiro (só o Administrador): escolher o ano e baixar o
  arquivo da DMED no layout da Receita, com responsável, beneficiário e valores; avisos de
  pagamento sem CPF.
  **Decisões do cliente (12/out):**
  - **Responsáveis:** o responsável pelo preenchimento (CPF, nome, DDD, telefone, e-mail; em
    geral o contador), o CPF do responsável perante o CNPJ e o CNES (opcional) são preenchidos na
    tela da DMED e ficam guardados para o ano seguinte.
  - **Pagamento sem CPF de quem pagou:** o arquivo sai sem ele, e a tela lista os que ficaram de
    fora (data, valor, quem pagou, paciente), com o link para o pagamento.
  - **Leiaute:** o do Ato Declaratório Executivo Cofis nº 34/2024 (arquivo texto com `|`;
    registros Dmed, RESPO, DECPJ, PSS, RPPSS, BRPPSS e FIMDmed). Declaração original (a
    retificadora, se precisar, o contador faz no programa da Receita, que também valida o
    arquivo antes de transmitir).
  **Como ficou (12/out):** migração `20261012150000_dmed.sql` (tabela `clinic_dmed_settings`,
  gravada só pelo Administrador da clínica; função `log_dmed_generated`, que põe cada arquivo na
  trilha fiscal com ano e totais, sem CPF). Tela **Financeiro › DMED** (botão no menu Financeiro,
  só para o Administrador; o Suporte vê o resumo): ano (padrão, o passado), resumo, "Ficam de
  fora" (sem CPF de quem pagou ou beneficiário anonimizado) com o link para o pagamento, quem
  pagou e os beneficiários, e "Baixar o arquivo" (`DMED_<ano>_<CNPJ>.txt`, ISO-8859-1, CRLF).
  Regras do arquivo: quem pagou agrupado por CPF, em ordem crescente; o que o paciente pagou
  para si (ou com o mesmo CPF) vai no valor do RPPSS; cada outro paciente vira um BRPPSS (CPF,
  se houver, e sempre a data de nascimento); PSS sempre (prestador). Testes: unidade
  (`src/lib/dmed.test.ts`) e banco (`tests/db/dmed.test.ts`, mais a varredura de isolamento).
  **A conferir com o contador:** importar um arquivo no PGD Dmed do ano antes da primeira
  entrega real (codificação e ordem de beneficiários sem CPF são os pontos de dúvida).

**Segurança da F11 (requisitos do cliente, 12/out/2026)**, obrigatórios em todas as subetapas:

1. **Isolamento por clínica:** tabelas novas (pagamentos, notas, trilha da nota, dados fiscais)
   com RLS e chaves amarradas à clínica (D1); as rotas conferem clínica, papel e o item "Módulo
   financeiro"; testes de banco de isolamento entre duas clínicas.
2. **Segredos:** certificado A1 e senha dele no **Vault**; lidos só no servidor, na hora de
   assinar; nunca voltam para a tela (só titular e validade), nem vão para o Storage, o navegador
   ou o repositório. (F11.3)
3. **Privilégio mínimo (cliente, 12/out):** o **Administrador** envia e revoga o certificado,
   aceita o termo, **cancela** nota e baixa a **DMED**; a **Recepção** (e o Administrador)
   registra o pagamento e **emite**; o **Profissional** só consulta as notas dos atendimentos dele
   (acesso por agenda, D6); o **Suporte** só consulta e nunca vê o certificado. No banco (RLS) e
   nas rotas.
4. **Auditoria:** trilha da nota, só de inclusão: quem pediu emissão ou cancelamento, quando e o
   resultado (número da nota ou código de erro da Receita); também envio, troca e revogação do
   certificado e aceite do termo. (F11.3 e F11.4)
5. **Duplicidade:** uma nota ativa por pagamento (único no banco); número da DPS sequencial por
   clínica, com trava; estado "emitindo" durante o pedido; se a resposta se perder, **consultar a
   Receita antes de repetir**; rotina diária que reconcilia as pendentes. (F11.4)
6. **Armazenamento:** XML e PDF num **bucket privado**, pasta por clínica com RLS; baixar por
   **link temporário** (minutos); no WhatsApp, o PDF sobe direto para a Meta. (F11.4 e F11.5)
7. **Logs:** máscara de **CPF e CNPJ** no `src/lib/log.ts` (como telefone e e-mail, F9.2), com
   teste; nunca XML, certificado, senha ou dado clínico (a nota descreve só "consulta" ou
   "exame"). (F11.1)
8. **Retenção e exclusão:** a anonimização (F9.4) apaga o CPF do cadastro, mas notas,
   pagamentos e DMED ficam pelo prazo fiscal (LGPD: cumprimento de obrigação legal). **Prazo a
   definir com o contador e o advogado.**
9. **Webhooks:** não se aplica à emissão (a API nacional responde na hora); conexão com a Receita
   por TLS mútuo com o certificado. O webhook do WhatsApp já confere a assinatura e descarta
   repetidos (F6).
10. **Autorização formal e revogável:** ao enviar o certificado, o Administrador aceita um **termo
    de autorização** (grava quem, quando e a versão do texto); **"Revogar"** apaga o certificado do
    Vault e desliga a emissão na hora. Nenhuma senha de portal (gov.br, prefeitura) é pedida.
    **Texto do termo com o advogado.** (F11.3)

**Antes da F11.4 (cliente):**
- confirmar com o contador das clínicas de Mossoró se a NFS-e já sai pelo portal nacional
  (`nfse.gov.br`), e não por sistema próprio da prefeitura;
- uma clínica piloto disposta a testar, com o **certificado A1** dela (e-CNPJ), a inscrição
  municipal, o regime tributário e o código de serviço que o contador usa hoje;
- com o advogado e o contador: o **prazo de guarda** das notas, pagamentos e DMED, e o **texto do
  termo de autorização** (antes da F11.3 ir para uma clínica real).

## Redesign do painel (a partir da auditoria de frontend)

Pedido pelo cliente em 15/out/2026, a partir da [auditoria](auditoria-frontend/frontend-audit-report.md)
e do [brief](auditoria-frontend/frontend-redesign-brief.md). Só muda a forma: rotas, permissões,
regras e textos de negócio ficam como estão. Avaliação global, identidade visual e proposta da
Agenda no canvas
[Redesign RecepClinic: avaliação global e Agenda](https://claude.ai/artifact/AUajFVHWJNscFp5w5Pvqn4).

**Ordem (cada etapa: proposta no canvas → aprovação → implementação → validação → staging):**
R0 fundação (cores, fontes e componentes base) · R1 moldura do painel (largura útil até 1600px,
cabeçalho, menu do Suporte agrupado) · R2 Agenda (Dia, Semana, Mês e o cartão de atendimento) ·
R3 Resumo do Dia · R4 Marcar e Remarcar · R5 Pagamento · R6 Pacientes e Ficha · R7 Início e
Métricas · R8 Financeiro e DMED · R9 Configurações · R10 Sistema e Acesso · R11 páginas do paciente.

**Decisões do cliente (15/out/2026), proposta da Agenda:**
1. **Cartão de atendimento:** ficam à vista só a ação do momento (cheia: Confirmar presença ou
   Compareceu) e as frequentes (Remarcar, Pagamento, a ação que resolve um sinal, como "Reenviar
   lembrete"). As raras vão para um botão **"Mais"** (Lista de espera, Trilha, Ver série, correções,
   Encerrar a série). **Cancelar** fica separado, à direita, em vermelho. Toda ação continua pedindo
   confirmação. Substitui a "fileira de botões iguais" de 05/out.
2. **Celular:** com "Todas as agendas", a Agenda do dia vira **uma lista única por horário**, com o
   nome da agenda em cada cartão. No computador continuam as colunas por agenda (05/out).
3. **Legenda das cores com contadores:** quantos atendimentos do dia há em cada situação, com
   ícone. Só contagem, sem filtro.
4. **Marca do site no painel:** verde `#0B7A62`, Bricolage Grotesque nos títulos e números e
   Source Sans 3 no texto (fontes no próprio servidor, por causa da CSP), no lugar do azul. As
   cores de situação de 10/out continuam, sempre com ícone e texto.

**R0, R1 (parcial) e R2 implementadas em 15/out/2026** (aprovadas pelo cliente e publicadas no staging em 15/out):
- **R0:** tokens de cor e fontes em `src/styles/global.css` (`@fontsource-variable`, no próprio
  servidor); componentes base em `src/components/admin/ui/` (`Button`, `StatusPill`, `Signal`, `Tag`,
  `SegmentedControl`, `MoreMenu` com `popover` e `styles.ts`); ícones novos no `Icon`.
- **R1 (só o necessário para a Agenda):** cabeçalho, menu e barra do celular com a marca; fonte do
  painel todo em Source Sans 3; largura de 1600px só nas telas da Agenda (`wide`); diálogo de
  confirmação no padrão do canvas. O menu do Suporte agrupado (U-07) ficou para depois e foi
  feito em 16/out (ver abaixo, depois da R4).
- **R2:** Dia (barra única, legenda com contadores, colunas em grade com rolagem só na área delas e
  sombra na borda, lista única por horário no celular), cartão novo (`cardActions.ts`, tabela do
  canvas, testada) e Semana/Mês/busca com o cabeçalho e as cores novas. As outras telas mantêm o azul
  até a etapa delas (cliente, 15/out). O Resumo do Dia herda o cartão e as cores de situação.
- **Corrigido em 15/out** (antes da R3, cliente): o toque em "confirmo" no lembrete grava
  `reminder_response = 'confirmed'`, mas a Agenda, o Resumo e `daily.ts` comparavam com `"confirm"`
  (Lembretes punha quem confirmou em "Não responderam"). Regra única em `src/lib/reminderResponse.ts`,
  com teste de banco em `painel-base.test.ts`.
- **Corrigido em 15/out** (depois da R3, relato do cliente): quem tocou em "Remarcar" no lembrete e
  remarcou pelo WhatsApp aparecia em "Não responderam" no dia original, porque o gatilho
  `app.reset_reminder_on_reschedule` zera `reminder_response` (para a data nova receber outro
  lembrete). Lembretes e o contador "Lembretes sem resposta" da tela inicial passam a ler o botão
  tocado na mensagem recebida (`reminder_confirm`, `reminder_reschedule`, `reminder_cancel`), com o
  campo do atendimento como reserva. O gatilho não mudou. Teste de banco em `acesso-lembrete.test.ts`.

**R3 (Resumo do Dia), decisões do cliente (15/out/2026):** as 7 abas continuam, no estilo
sublinhado da Agenda, com contador onde há pendência (Lembretes: sem resposta ou não entregues
hoje; Lista de espera: quem espera; Aguardando remarcação e A registrar: o total; Envios: alerta);
a aba Resumo do dia em linhas no computador (cartões no celular), só informação, com "Abrir na
Agenda". **Implementada em 15/out**, aprovada e publicada no staging: `getResumoTabCounts` em `daily.ts` (com teste de
banco), componentes `Tabs`, `DateStepper`, `PageHeader` e `Pill` em `ui/`, as 7 abas redesenhadas e
o dia antes do horário nos cartões de A registrar e Registradas. O sinal "Confirmou pelo lembrete"
vem antes de "Presença confirmada" (o toque no lembrete grava os dois).

**R4 (Marcar e Remarcar), decisão do cliente (15/out/2026), U-09 da auditoria:** vindo de um dia
da Agenda, os horários do Marcar **começam no dia escolhido**, que continua valendo depois da
escolha do serviço. Se esse dia não tiver vaga, aparece um aviso e o primeiro dia livre depois
dele. As setas continuam levando a outros dias.

**R4, proposta aprovada pelo cliente em 15/out/2026** (página "4 · Marcar e Remarcar" do canvas):
passos numerados com um resumo e o botão à direita (no celular, uma barra fixa embaixo); faixa de
7 dias livres com setas e "Outra data"; horários por turno (Manhã, Tarde, Noite); Remarcar com o
atendimento atual no alto e o resumo "De → Para" com a escolha da série. **Implementada em
15/out** e testada no navegador (computador e celular), **publicada no staging em 15/out a pedido do cliente, que testa depois**:
regra da faixa em `src/lib/dayStrip.ts` (com teste), componentes `DayStrip`, `SlotPicker` e
`StepCard` em `ui/`; o diálogo de confirmação aceita o botão ligado ao formulário por `form="…"`.

**Ajustes do teste da R4 (cliente, 16/out/2026):** no Remarcar, o "De" do resumo sem risco. No
Marcar, a busca mostrava os pacientes sem deixar claro que era preciso escolher um, e a tela seguia
para o serviço e as datas sem paciente: agora cada resultado tem o botão "Escolher" e o aviso
"Toque no paciente para escolher", e Serviço e Data e horário ficam travados ("Escolha o paciente
primeiro") até o paciente ser escolhido (serviço e dia já escolhidos continuam valendo). **R4 validada pelo cliente em 16/out/2026.**

**Pendência da R1: menu do Suporte agrupado (U-07), proposta aprovada pelo cliente em 16/out/2026**
(página "R1 · Menu do Suporte" do canvas). Dentro de uma clínica, os 7 itens dela ficam no
cabeçalho e os 6 do sistema (Clínicas, Matriz de acesso, Vendas, Uso, Erros e Tecnologia) vão para
o botão **"Sistema"** (`MoreMenu`, que passou a aceitar outro texto e outro estilo de botão);
"Suporte RecepClinic" sai do canto direito, porque a faixa amarela já diz isso. Na Administração do
sistema (sem clínica aberta), só os 6 itens do sistema (saem Início, Agenda, Pacientes e Resumo do
Dia); no celular, a barra de baixo dessa tela fica com Clínicas, Matriz de acesso, Vendas e Uso, e
o "Mais" com Erros e Tecnologia. No celular, dentro da clínica, o "Mais" separa os grupos
**Clínica** e **Sistema · só o Suporte**. Ícones novos no `Icon` (`building`, `squares`, `tag`,
`cpu`). Em 1280px o cabeçalho cabe numa linha (eram 2); em 1024px, 2 linhas (eram 3). O menu dos
outros perfis não mudou. **Validado pelo cliente e publicado no staging em 16/out/2026. R1 concluída.**

**Teste de interface da R0 a R4 (16/out/2026, a pedido do cliente)** com a skill
`playwright-ui-form-best-practices`, no ambiente local e sem gravar dados:
[relatório](auditoria-frontend/redesign-r0-r4-report.md). 27 cenários: 19 passaram, 6 falharam (2
Médias e 4 Baixas) e 2 ficaram bloqueados (envio válido e envio duplo, que gravariam). As 6 foram
corrigidas, retestadas, validadas pelo cliente e publicadas no staging no mesmo dia:
- **NAV-07:** a busca de paciente da Agenda leva a tela de origem (`volta`), mostra "Voltar" para ela
  e usa o dia dela nos links Dia, Semana e Mês.
- **NAV-08:** as abas Resumo do dia e Lembretes do Resumo do Dia mantêm a data escolhida.
- **QA-07:** Marcar e Remarcar ficam desabilitados até haver horário (`data-needs-slot`), como na proposta
  aprovada.
- **QA-08 a QA-10:** nome acessível nas células do Mês; selo da situação (ícone e texto) na Semana e
  na busca; "às" minúsculo na data da busca.
- **Fica com o cliente:** o texto da confirmação da série ("no horário escolhido", sem dia,
  frequência nem número de sessões; S-01 do relatório) e o envio duplo, que entra na R5.
- **Texto das confirmações, decisão do cliente (17/out/2026, S-01):** as três confirmações dizem o horário.
  Marcar: "Ana Souza: Consulta pediátrica, terça-feira, 20/10 às 09:00, com Rafael Lima (Consultório Centro). …";
  série: "…, toda semana às terças, 09:00, com Rafael Lima (Consultório Centro), a partir de 20/10, com 10 sessões"
  (ou "até 15/12", ou "sem data para terminar (ficam marcadas as sessões dos próximos 3 meses)"), mais "Feriado,
  bloqueio ou horário ocupado: a data é pulada e aparece na tela da série."; Remarcar: "Carlos Pereira sai de
  terça-feira, 20/10 às 09:00 e vai para …". O texto da série acompanha o formulário. Textos em
  `src/lib/confirmText.ts` (com teste); sem JavaScript, fica o "no horário escolhido" (o diálogo depende dele).
- **Busca de paciente, decisão do cliente (17/out/2026):** com letras, busca pelo nome (que pode ter números: "Paciente 2001";
  antes, 4 dígitos viravam busca por telefone); só números (4+), pelo telefone; dd/mm/aaaa, pela data de nascimento (nos
  Responsáveis, o contato com um paciente nascido no dia). Os resultados mostram "34 anos · nasc. 30/09/1992". Vale em todas
  as buscas de paciente (Marcar, Pacientes, Agenda, Financeiro, Métricas). Regra em `src/lib/patientSearch.ts` (com teste).
- **"Já marcado" no Marcar, decisão do cliente (17/out/2026):** selo "Já marcado" na busca; os atendimentos futuros no
  cartão do paciente (até 3, mais as sessões de série); com o serviço escolhido, a regra de 04/out é conferida na hora: todas
  as agendas da escolha travadas → aviso vermelho ("… já tem atendimento marcado: …") com "Remarcar esse atendimento" (volta
  para o Marcar) e sem horários; só algumas, no "Primeiro horário disponível" → os horários delas saem, com aviso amarelo.
  A trava ao gravar continua.
- **Recomendações de UX da auditoria (U-01 a U-12), revisão com o cliente (17/out/2026):** já resolvidas pelo redesign
  U-01 a U-04, U-06, U-07, U-09 a U-11 e o envio duplo; **U-08 corrigido** (uma mensagem de telefone inválido com exemplo,
  `INVALID_PHONE_MESSAGE` em `src/lib/phone.ts`; valor que não é número: "Informe o valor em reais, ex.: 150,00.");
  U-05 fechado e U-12 aceito, sem mudança. **QA-09 da R8 corrigido:** sem JavaScript, o `EditCard` com erro volta aberto e
  com o campo marcado (`pageFlash` em `src/lib/flash.ts`, lido uma vez por pedido), com o que estava salvo.
- **Telefone, relato do cliente na validação (17/out/2026):** um celular sem os dois últimos dígitos era aceito e aparecia
  como "+55619986454". Causa: `normalizePhone` aceitava qualquer número de 8 a 13 dígitos. Agora, número brasileiro só
  com DDD sem zero e celular de 9 dígitos (começando com 9) ou fixo de 8 (começando de 2 a 5); de outro país, só com o "+".
  Exibição sempre sem o +55: "(61) 99854-5490" e "(61) 3333-4444"; um número já gravado errado aparece como "(61) 9986454",
  para a clínica corrigir. Os prefixos fictícios de 7 testes de banco do módulo financeiro foram completados.

**R5 (Pagamento), proposta aprovada pelo cliente em 16/out/2026** (página "5 · Pagamento" do canvas):
contas no alto (Preço, Pago e Falta em números grandes, barra do quanto já foi pago e o selo "Pago"
ou "Pago em parte"); "Registrar pagamento" à esquerda (valor em destaque, forma em botões com ícone,
quem pagou em cartões com o CPF) e os pagamentos à direita, cada um com a sua nota (PDF, XML,
"Enviar nota" e "Conferir na Receita" à vista); Cancelar nota e Excluir pagamento no "Mais"; os
excluídos recolhidos; no celular, o botão Registrar na barra fixa, com o valor e quem pagou.
**Decisões do cliente (16/out/2026):** "Emitir a nota fiscal agora" vem **desmarcado** (U-10); a
proteção contra **envio duplo** vale para **todo o painel**: um formulário enviado trava os botões
até a tela seguinte abrir (`src/scripts/sendOnce.ts`, no `AdminLayout`; o botão com
`data-sending-label` troca o texto, ex.: "Registrando…"; o "Baixar o arquivo da DMED" fica de fora,
com `data-envio-livre`, porque não sai da tela). **Implementada em 16/out** e testada no navegador
local (computador e celular, sem gravar dados; o envio duplo com um formulário de teste para um
endereço inexistente: 1 envio, 2 barrados). **Teste de interface da R5 (16/out, a pedido do
cliente)**: [relatório](auditoria-frontend/redesign-r5-report.md), com gravação autorizada só no banco
local (apagada no fim); 3 falhas (o erro de CPF de "Outra pessoa" marcado num campo escondido, o
"Voltar" da ficha aberta pelo Pagamento pulando o Pagamento e o foco perdido ao fechar um painel da
nota) e 1 suspeita (o aceite do diálogo sem conferir a trava), **todas corrigidas e retestadas**.
**R5 validada pelo cliente e publicada no staging em 16/out/2026.**

**R6 (Pacientes e Ficha), proposta aprovada pelo cliente em 16/out/2026** (página "6 · Pacientes e
Ficha" do canvas). Decisões, uma a uma:
1. **Lista em linhas** no computador (nome e selos, idade, plano, responsável com o número e o botão
   do WhatsApp); no celular, cartões. Busca com rótulo e "Mostrar desativados" na mesma barra; sem
   resultado, "Limpar a busca" e "Cadastrar".
2. **Ficha com os atendimentos em destaque:** à esquerda, em abas (Próximos | Anteriores e
   cancelados); à direita, os cartões Dados, Plano de saúde, Financeiro e Pagamentos.
3. **Dados em modo leitura com "Editar"** (ficha e responsável): "Editar" abre o formulário no
   próprio cartão, com Salvar e Cancelar, sem JavaScript.
4. **Atendimentos da ficha só informação**, com "Abrir na Agenda" e "Trilha" (as ações continuam na
   Agenda).
5. **Ações raras no "Mais" do cabeçalho:** na ficha, Desativar/Reativar e Anonimizar (LGPD); no
   responsável, Liberar dos limites, Desativar/Reativar e Bloquear no bot. As confirmações não mudam.
6. **Selos novos na ficha** (só para quem vê o Financeiro): "Pago" ou "Pago em parte" nos
   atendimentos anteriores e o selo da nota ("Nota nº" ou "Sem nota") nos pagamentos; "falta CPF"
   continua.
7. **Cadastrar em 3 blocos numerados** (Paciente, Quem fala pelo WhatsApp, Plano de saúde), "Quem
   fala" em cartões de escolha e o aviso do número já cadastrado junto do campo.
No celular, a ficha mostra o paciente e os atendimentos primeiro, os outros cartões recolhidos e
"Marcar" na barra fixa.
**Implementada em 16/out** e testada no navegador local (computador e celular, sem gravar dados):
cartão `EditCard` em `ui/` (dados em leitura, "Editar" com `<details>`, recolhido no celular; o
`keepFormValues` abre o cartão do formulário que voltou com erro); `Tabs` com `inCard` e contador
neutro; `Pill` com o tom `alert` (faltas). No responsável, "Bloquear no bot…" abre o cartão do
bloqueio por `?bloquear=1`.
**Teste de interface da R6 (16/out, a pedido do cliente)**: [relatório](auditoria-frontend/redesign-r6-report.md),
com gravação autorizada só no banco local (desfeita no fim e conferida com um snapshot). 31 cenários:
28 passaram e 3 falharam, todos Baixos: no celular, o campo com erro fica atrás das barras fixas
(QA-02); no computador, os títulos dos cartões entram na tabulação (QA-06); no Cadastrar, o erro do
servidor não marca o campo (QA-03, já existia). 4 bloqueados (Anonimizar, Bloquear no bot e os
casos sem dado no seed).
As 3 falhas foram **corrigidas e retestadas** no mesmo dia (seção 10 do relatório): o campo com erro
rola até o meio da tela antes do foco, e o celular reserva espaço para as barras fixas; o título do
cartão sai do Tab no computador; o Cadastrar mostra cada erro embaixo do campo, com o foco nele.
**R6 publicada no staging e validada pelo cliente em 16/out/2026** (sem migração).

**R7 (Início e Métricas), proposta aprovada pelo cliente em 16/out/2026** (página "7 · Início e
Métricas" do canvas). Decisões, uma a uma:
1. **Um indicador só** (U-04) no Início e nas Métricas: rótulo, número grande e uma linha de
   explicação; o que pede ação ganha o sinal âmbar e "Ver ›" e leva à aba onde se resolve.
2. **Início:** os atalhos (Agenda do dia, Registrar comparecimento e Marcar, cheio) vão para o
   cabeçalho da tela; os avisos (envios com falha, certificado vencendo) no padrão do painel, com
   ícone e o link de resolver; "Contatos para revisar" em linhas. No celular, Marcar na barra fixa.
3. **Métricas:** abas sublinhadas (U-03) na **ordem nova** (cliente): Visão geral, Atendimentos,
   Funil do bot, Faltosos, Retomar contato e Financeiro. Período em botões, agenda e filtro de
   paciente numa barra só; o período por extenso embaixo do título. No celular, os filtros
   recolhíveis.
4. **Tabela única** (cabeçalho, números à direita, total em negrito, rolagem própria no celular),
   sem gráfico; o Funil mantém as barras, no verde da marca.
5. **"Marcados por"** ganha a coluna **Parte** (%) e a linha **Total**.
6. **Faltosos:** o nome abre a ficha (com "Voltar" para as Métricas) e o telefone ganha o botão do
   WhatsApp.
7. **Financeiro:** em cada célula, a quantidade em cima e o valor embaixo.
8. **Retomar contato:** no computador, uma linha por contato (contato com o WhatsApp, fluxo, onde
   parou, quando iniciou); no celular, cartões com o WhatsApp.
Sem mudança de regra: os números e como são contados, quem vê cada aba, os itens da matriz, o
período que abre em Hoje, as confirmações e o "Voltar".
**Implementada em 16/out** e testada no navegador local (computador e celular, sem gravar dados):
componentes `Stat` (indicador), `Notice` (aviso) e `DataTable` (tabela, com as classes em `TABLE` no
`styles.ts`) em `ui/`; saíram `metricas/Stat` e `metricas/Table`. "Contatos para revisar" ganhou o
telefone com o WhatsApp (`listContactsToReview` traz o `phone`; teste de banco ajustado). "Marcar" do
Início leva o `volta`. No celular, o período quebra a linha e os filtros abrem recolhidos (abertos
com o período personalizado ou uma busca; sem JavaScript, abertos). Faltosos e Retomar contato com
linhas não foram vistos com dados (o seed não tem faltosos nem conversas interrompidas).
**Teste de interface da R7 (16/out, a pedido do cliente)**: [relatório](auditoria-frontend/redesign-r7-report.md),
sem gravar dados. 30 cenários: 22 passaram, 4 falharam (3 defeitos) e 4 ficaram bloqueados (Faltosos e
Retomar contato sem dados no seed, o envio do "Revisado" e os itens desligados na matriz). Defeitos:
no Personalizado inválido, De e Até voltam para hoje e o digitado se perde (FORM-01/02, Média, já
existia); a mensagem do período inválido é genérica e solta dos campos (QA-04, Baixa); a caixa da
tabela entra no Tab sem precisar rolar (QA-06, Baixa). Suspeita: abas e período com menos de 44px de
toque no celular (componentes já aprovados).
Os 3 defeitos foram **corrigidos e retestados** no mesmo dia (seção 10 do relatório): as datas do
Personalizado inválido voltam como digitadas, com uma mensagem por caso, o campo marcado e o foco nele
(`invalidReason` e `requested` em `parsePeriod`, com teste); a caixa da tabela só entra no Tab quando
rola (`src/scripts/scrollRegion.ts`).
**R7 publicada no staging em 16/out/2026** (commit `9e02dc5`, a pedido do cliente; sem migração). **R7 validada pelo cliente em 17/out/2026.**

**Largura única (cliente, 16/out/2026), muda a R1:** a Agenda (Dia, Semana, Mês e a busca) e o Resumo
do Dia deixam a largura de 1600px e ficam na largura das outras telas (1152px), com o cabeçalho
igual. Sai a opção `wide` do `AdminLayout`. Consequência aceita pelo cliente: com 3 ou 4 agendas, as
colunas do Dia rolam de lado dentro da área delas (U-01). Na coluna estreita, o "Cancelar" do
paciente da turma descia para fora do cartão; agora desce para a linha de baixo, à direita.
**Revisão da Agenda na largura única (cliente, 17/out/2026):** com 1152px, a Agenda tinha perdido o
leiaute da proposta aprovada. Corrigido: a barra (visualização, data, "Hoje", agenda e busca) volta a
ficar numa linha só; as colunas do Dia têm no mínimo 250px, então 4 agendas cabem sem rolagem (5 ou
mais rolam de lado); no cartão do paciente da turma, o nome não quebra (o selo desce, se preciso) e
"Mais" e Cancelar andam juntos, na linha de baixo quando não cabem ("Mais" à esquerda, Cancelar à
direita), como no cartão aprovado; na Semana, o selo da situação fica menor e não sai do atendimento.
Conferido em 1440px, 1280px e 390px, validado pelo cliente e publicado no staging em 17/out.

**R8 (Financeiro e DMED), proposta aprovada pelo cliente em 17/out/2026** (página "8 · Financeiro e
DMED" do canvas). Decisões, uma a uma:
1. **DMED como aba do Financeiro:** abas sublinhadas "Quem paga" e "DMED" (sai o botão "DMED do
   ano"). A Recepção vê só "Quem paga", sem a barra de abas; o Administrador e o Suporte veem as duas.
2. **Quem paga em linhas** no computador (paciente, quem paga com o tipo: Responsável, Próprio
   cadastro ou Outra pessoa, e o CPF mascarado com o selo verde ou "Falta CPF" em âmbar); no
   celular, cartões. Busca com rótulo, como em Pacientes.
3. **Filtro "Todos | Falta CPF (n)"** ao lado da busca (decisão à parte do cliente: é a única
   novidade da etapa). Vale junto com a busca e fica no endereço.
4. **DMED:** o ano em botões (os mesmos 6 anos), o declarante embaixo do título e 4 indicadores
   (Quem pagou, Beneficiários, Total e Ficam de fora, com o sinal âmbar e "Ver ›" quando há algum).
5. **"Antes de baixar":** lista de conferência ao lado do botão (dados fiscais, responsáveis, ano
   encerrado, ficam de fora), cada item com ícone e o link de resolver; o botão só habilita sem
   pendência que impeça (o ano em curso e os que ficam de fora só avisam). No celular, o botão na
   barra fixa.
6. **Responsáveis da declaração** em modo leitura com "Editar" (`EditCard`, R6); sem nada salvo, o
   formulário já vem aberto. "Ficam de fora" e "Quem pagou" em tabelas, com o total em negrito.
Sem mudança de regra: quem vê cada aba, quem baixa o arquivo (só o Administrador), o arquivo, quem
entra e quem fica de fora, os anos, a busca, os 20 por página e o "Voltar".
**Implementada em 17/out** e testada no navegador local (computador e celular): cabeçalho com as abas em
`src/components/admin/financeiro/FinanceHeader.astro`; a DMED continua em `/admin/financeiro/dmed` (agora
a aba); `EditCard` ganhou `editOpen` (formulário aberto quando nada foi salvo). O filtro "Falta CPF" usa a
função `public.finance_patients_missing_payer_cpf` (migração `20261017120000_falta_cpf.sql`, só leitura,
com as permissões de quem chama; mesma regra de `resolvePayer`), pela opção `missingPayerCpf` de
`listPatientsPage`, e a contagem `countPatientsMissingPayerCpf`; teste de banco em
`modulo-financeiro.test.ts`. O nome na lista leva à ficha já no cartão Financeiro (`#financeiro`). O
estado "Ficam de fora" foi conferido tirando por alguns segundos o CPF de um pagamento no banco local
(devolvido em seguida). [Teste de interface](auditoria-frontend/redesign-r8-report.md) em 17/out: a mensagem do "Falta
CPF" com busca sem resultado ganhou "Buscar em Todos" (FIL-03); no staging, o cliente achou o erro 500
da busca por telefone com o filtro (FIL-04, Alta), corrigido sem migração (contatos primeiro, depois a
função pelo `contact_id`). Migração aplicada no staging e registrada no histórico; código publicado
(commit `16d5553`). **R8 validada pelo cliente em 17/out.** Mantido (cliente, 17/out): a DMED abre no
ano passado, o da entrega até fevereiro. A decidir: "Voltar" nas abas de Configurações abertas de
outra tela (S-01 do relatório da R8).

**R9 (Configurações), proposta aprovada pelo cliente em 17/out/2026** (página "9 · Configurações" do
canvas). Decisões, uma a uma:
1. **Menu lateral agrupado** no lugar das 13 pílulas: A clínica (Clínica, Equipe), Atendimento
   (Profissionais, Locais, Agendas, Serviços, Horários, Feriados, Convênios), Mensagens (Lembretes,
   Mensagens, WhatsApp só do Suporte, com o selo "Suporte") e Financeiro (Nota fiscal). No celular, o
   botão "Seção: <nome>" abre a mesma lista (sem JavaScript). Os formulários também mostram o menu.
2. **Título da seção** (U-06): o título grande é o nome da seção ("Serviços"), com "Configurações"
   pequeno acima e uma linha de apoio; a ação principal ("Novo serviço") à direita do título.
3. **Clínica em 5 blocos com salvar por bloco** (U-11, decisão à parte do cliente): Identificação,
   Atendimento, Páginas públicas, Informações que o bot responde e Limites do bot por contato, cada
   um em modo leitura com "Editar" e o seu "Salvar" (`EditCard`, R6). Um erro num bloco não mexe nos
   outros. Os campos e as regras são os de hoje; a gravação da Clínica passa a aceitar um bloco por vez.
4. **Guia com progresso:** na Clínica, "4 de 6 passos prontos", barra e os 6 passos com link; nas
   outras seções sai a faixa "A configuração tem n pendências" e o número de pendências aparece ao
   lado do item no menu.
5. **Listas em linhas** (Profissionais, Locais, Agendas, Serviços, Convênios e Equipe), como em
   Pacientes; "Mostrar desativados" vira "Ativos | Todos"; os selos do guia continuam na linha; no
   celular, cartões.
6. **Formulários em blocos:** título com o nome do cadastro e "‹ <lista>" acima; blocos com título;
   "Salvar" e "Cancelar" no fim; desativar numa área separada, com confirmação.
7. **"Voltar" para a origem** (S-01 da R8, decisão à parte do cliente): uma seção aberta de outra
   tela (DMED, aviso do Início, Pagamento) mostra "‹ Voltar para <tela>" acima do título, também
   depois de salvar (a DMED volta no mesmo ano). Aberta pelo menu, não aparece.
Sem mudança de regra: quem vê Configurações (Administrador e Suporte), o WhatsApp só do Suporte,
Convênios e Nota fiscal só com o item liberado, o limite de profissionais, os campos, as validações,
os passos do guia e o que cada seção grava.
**Implementada em 17/out** e testada no navegador local (computador e celular, Administrador e Suporte,
nas duas clínicas do seed): moldura em `src/components/admin/config/ConfigShell.astro` (menu, botão
"Seção", título e "Voltar"; sai o `ConfiguracoesTabs`), seções e pendências em `config/sections.ts`
(teste em `sections.test.ts`), campos, linhas e cartões no padrão novo em `config/formStyles.ts`,
`Panel.astro`, `Badge.astro`, `ActiveFilter.astro` e `ConfigEmpty.astro` (o `fieldStyles` antigo segue
no Sistema e na página do paciente, R10 e R11). A gravação da Clínica aceita `bloco` (sem ele, grava
tudo, como antes). "Voltar" para a origem: `returnLabel` em `returnPath.ts`; a DMED e o aviso do Início
mandam a origem para a Nota fiscal, que a mantém nos formulários e depois de salvar. Conferido: erro num
bloco da Clínica mantém o que foi digitado e não grava nada; salvar um bloco não mexe nos outros; a
Nota fiscal volta para a DMED no mesmo ano depois de salvar; as 13 seções e os 7 formulários abrem sem
erro; sem rolagem lateral em 390px. Não visto com dados: o guia com pendências (as duas clínicas do seed
estão completas; coberto pelo teste das contagens). `astro check` sem erros e `npm test` (501) passando.
[Teste de interface](auditoria-frontend/redesign-r9-report.md) em 17/out: 3 falhas, as 3 corrigidas e
retestadas a pedido do cliente: o aviso não era apagado em 14 telas de Configurações e reaparecia nas
seguintes (QA-02; o `ConfigShell` lê o aviso antes de esperar o guia); o erro de um bloco de baixo da
Clínica ficava fora da tela (QA-01; a mensagem vai para dentro do cartão "Editar", à vista com o campo,
e o campo ganha borda vermelha); "‹ lista", "Cancelar" e salvar perdiam o filtro "Todos" (NAV-06,
anterior à R9; `withAllFilter` em `returnPath.ts`). O guia com pendências foi visto com dados (serviço
de teste no banco local). `npm test` (502) passando.
**Ajustes da validação no celular (cliente, 17/out), proposta aprovada no canvas** (quadro "Revisão
aprovada", página 9): (1) na lista de seções do celular não dava para saber o que é grupo
("Atendimento") e o que é seção tocável ("Profissionais"): o nome do grupo sai do cartão, cada grupo é
um cartão com uma seção por linha, a seta › e um fio entre as linhas; a seção aberta fica em verde
com "Aqui" e tocar nela só fecha a lista. (2) Lentidão sem retorno ao tocar, e o usuário tocava de
novo: a linha tocada mostra "Abrindo…" e ignora os toques seguintes até a tela nova chegar; a barra
de carregamento do topo (que já existia) ficava escondida atrás da barra de status do iPhone
(`viewport-fit=cover`) e agora fica abaixo dela (`env(safe-area-inset-top)`), em todo o painel. O
servidor faz o mesmo trabalho de antes da R9 (o guia já era carregado nas abas antigas); medir o
tempo do staging com login fica a combinar com o cliente. O menu do computador não muda.
Implementado e testado no navegador local (390px): um toque, uma requisição; "Abrindo…" e a barra à
vista; voltar pelo navegador não deixa a linha presa. `astro check` sem erros e `npm test` (502).

**R10 (Sistema e Acesso), proposta aprovada pelo cliente em 17/out/2026** (página "10 · Sistema e
Acesso" do canvas). Decisões, uma a uma:
1. **Marca nas telas de acesso:** Entrar no painel, Esqueci minha senha, Senha nova e Escolher a
   clínica com o logo, o verde e as fontes do painel (sai o azul), campos de 44px e o botão na largura
   do cartão. Depois de uma senha errada, o **e-mail continua no campo** (a senha nunca é guardada). O
   erro da senha nova vai embaixo do campo certo, com borda vermelha e o foco nele.
2. **"Mostrar" na senha** (decisão à parte do cliente): botão dentro do campo de senha, no login e na
   senha nova; vira "Ocultar".
3. **Escolher a clínica em cartões** (iniciais, papel, "Aberta agora", "Suspensa" com selo) e os links
   do sistema separados no pé, com o título "Administração do sistema". **Busca "Buscar clínica"**
   (decisão à parte do cliente) para o Suporte quando houver **mais de 6 clínicas**, aqui e em
   Sistema › Clínicas.
4. **Clínicas em linhas** (nome com o plano, criada em, o que falta: convites e o pedido de
   informações; suspensa em cinza), com **"Abrir" na linha** (decisão à parte do cliente: entra na
   clínica direto) e a seta para a tela da clínica. Na clínica: resumo embaixo do nome (criada em,
   plano, profissionais), "Matriz de acesso" e "Abrir a clínica para configurar" no cabeçalho,
   convites em linhas e os pedidos num cartão. Nova clínica em 2 blocos (A clínica, Primeiro
   Administrador), com "Cancelar".
5. **Matriz de acesso:** lista em linhas (plano com o número de itens, profissionais "de" o limite,
   "Fora dos planos" em âmbar); na clínica, itens à esquerda por grupo com o contador ("2 de 5") e o
   preço, e plano, limite, mensalidade e "Salvar matriz" à direita, acompanhando a rolagem (no
   celular, na barra fixa); histórico em tabela.
6. **Uso:** tabela do painel com a linha **"Total em 6 meses"** e o filtro **"Clínica"** (Todas ou
   uma; abre em Todas), decisão à parte do cliente.
7. **Erros, Vendas e Tecnologia:** rotinas com o selo de ícone e texto e o resumo das atrasadas,
   erros em linhas, filtro com rótulo à vista; Vendas com as abas sublinhadas; Tecnologia com atalhos
   "Nesta página". Título com "Sistema" pequeno acima em todas as telas do sistema.
Sem mudança de regra: quem vê cada tela (Sistema só o Suporte), sem cadastro aberto, a mesma resposta
do "Esqueci" exista ou não o e-mail, os 8 caracteres e os textos de erro da senha, o registro de cada
tela aberta pelo Suporte, as dependências e o cálculo da matriz, como o Uso é contado, os 90 dias dos
erros e o conteúdo de Vendas e Tecnologia.
**Implementada em 17/out** e testada no navegador local (Suporte, 1280px e 390px, sem gravar dados):
`AuthLayout` com a marca, `auth/PasswordField.astro` e `src/scripts/passwordToggle.ts` ("Mostrar"/"Ocultar";
antes de enviar, o campo volta a ser de senha); o login com senha errada devolve o e-mail pelo
`keepFormValues` (agora também nas telas de acesso, com o `sendOnce`) e põe o foco na senha. Busca de
clínica em `src/lib/clinicSearch.ts` (sem acento, acima de 6; com teste). Cabeçalho das telas do sistema
em `sistema/SystemHeader.astro`; Clínicas, a clínica e Nova clínica com os estilos da R9 (`formStyles`);
Matriz com o resumo ao lado (e na barra fixa do celular), o "n de m" por grupo e a mensalidade em
destaque, atualizados pelo mesmo script; Uso com `DataTable`, o total e o filtro; Erros com `Pill`;
Vendas com `Tabs`; Tecnologia com os atalhos. Achado no teste e corrigido: no celular, o "Suporte
RecepClinic" do cabeçalho do sistema empurrava o "Sair" para fora da tela (30px de rolagem lateral em
todas as telas do sistema, desde a R1); agora some só no celular. Não visto com dados: a busca (o seed
tem 2 clínicas; coberta pelo teste) e uma clínica suspensa. `astro check` sem erros e `npm test` (506).
**Teste de interface da R10 em 17/out** ([relatório](auditoria-frontend/redesign-r10-report.md)): 3 falhas Baixas,
corrigidas e retestadas a pedido do cliente: a Matriz aberta pela tela da clínica volta para ela (`de=clinica`, também
depois de salvar e do erro); o "n de m" dos grupos com o espaço; a Matriz que volta com erro mantém as marcações e marca o
limite (anterior à R10). **Decisão do cliente (17/out, S-01):** "Abrir a clínica para configurar" entra na clínica e
abre **Configurações** (campo `destino=configuracoes`, único destino aceito; "Abrir" da lista e Escolher a clínica
continuam no Início).
**R10 publicada no staging e validada pelo cliente em 17/out** (ajustes dos testes dele entram depois).

**R11 (páginas do paciente), proposta aprovada pelo cliente em 17/out/2026** (página "11 · Páginas do
paciente" do canvas). Decisões, uma a uma:
1. **Marca da clínica, letra do painel:** a cor da clínica no topo (como hoje), no botão, no dia e no horário
   escolhidos e nos realces; a letra passa a ser a Source Sans 3. O verde do RecepClinic não aparece nas páginas do
   paciente.
2. **`/agendar` com faixa de dias e turnos:** no lugar da lista de datas, uma faixa de dias com setas; os horários em
   Manhã, Tarde e Noite, em botões de 48px, como no Marcar do painel (com mais de um profissional ou local, o nome no
   próprio horário). Trocar o dia busca os horários sem recarregar, como hoje. A turma de exame em cartões com as vagas.
3. **Barra fixa no celular** com o dia e a hora escolhidos e o "Confirmar" (ou "Confirmar remarcação"), com o envio
   único; no computador, o resumo ao lado ("Seu atendimento") com o botão.
4. **Confirmação em linhas:** "Atendimento confirmado!" (ou "remarcado!") com Quando, Serviço, Paciente, Com quem e
   Onde (com o endereço); "Ver o preparo do exame" vira botão na cor da clínica.
5. **Avisos do link num padrão** (inválido, expirado, já usado, cancelado): ícone, título e o texto de hoje. **Novidade
   aprovada:** o botão "Falar com a clínica no WhatsApp", que abre a conversa com o número conectado da clínica
   (`display_phone`); só com o WhatsApp conectado e nunca no link inválido (não se sabe a clínica).
6. **Preparo e orientações para ler:** texto em 17px, com mais espaço entre as linhas, na largura de leitura; o nome
   do exame no título. As duas páginas são o link do template fora da janela de 24h (dentro dela, o texto vai na
   conversa, como decidido em 08/out).
7. **`/formulario` da clínica com a marca RecepClinic** (como as telas de acesso; sai o azul): as 8 seções em blocos
   numerados, cada local, profissional ou pessoa num cartão ("Local 2"), campos de 44px e a barra fixa com "Salvar e
   continuar depois" e "Enviar ao Suporte".
8. **Cor padrão:** a clínica sem cor escolhida passa do azul `#0369A1` para o verde `#0B7A62`; a página 404 sai do
   azul para o cinza neutro, com o mesmo texto.
Sem mudança de regra: os textos dos avisos, nenhum dado de paciente no preparo e nas orientações, o aviso de
emergência, o "Feito com RecepClinic", o ícone da aba (logo da clínica), o 404 dos links inválidos, o funil do bot e
as regras de retorno, duplicado e horário tomado.
**Implementada em 17/out** e testada no navegador local (390px e 1280px, sem gravar dados; os estados do link vistos
mudando 3 links do seed por alguns minutos, desfeito em seguida): moldura `src/layouts/PatientLayout.astro` (topo,
rodapé, fontes e as variáveis da cor da clínica de `clinicColorStyle` em `src/lib/brandColor.ts`: `--clinic`, o texto
sobre ela, a cor para texto sobre o branco, escurecida até 4,5:1, e o fundo claro; classes `bg-clinic`,
`text-clinic-ink` etc. pelo `@theme inline` do `global.css`). Componentes em `src/components/public/`: `LinkNotice`
(avisos, com o botão do WhatsApp pelo `whatsappPhone` da marca pública, só com a conexão ligada), `PatientDayStrip`
(a faixa do Marcar, `buildDayStrip`, com links `?date=&start=`) e `PatientSlots` (turnos ou turma). No `/agendar`, um
dia ou uma seta busca a mesma página e troca só a escolha (sem JavaScript, o link abre a página no dia); no funil, o
`?date=`/`?start=` conta como `date_changed`, não como página aberta. A rota `/api/agendar/[token]/slots` deixou de ser
usada pela página (fica para quem já está com a página antiga aberta). O `/formulario` com o `PublicLayout` na marca
RecepClinic e os campos de `formStyles`; cada campo dentro do rótulo. Cor padrão `#0B7A62` também como a primeira cor
pronta em Configurações › Clínica ("Verde RecepClinic"). Não visto com dados: as orientações com texto (o seed não
tem) e a prévia de Configurações (mesma moldura). `astro check` sem erros, `npm test` (508) e o teste de banco da marca.
**R11 validada pelo cliente em 17/out.** **S-01 do teste da R11 (faixa de dias no celular), decisão do cliente em
17/out:** no celular, as setas sobem para a linha do título ("Escolha o dia") e os 7 dias cabem sem arrastar (cada dia
divide a largura, `min-w-0 flex-1`); vale no `/agendar` (`PatientDayStrip`, que passa a receber o `title`) e no Marcar e
Remarcar do painel (`DayStrip`: saem o "Antes" e o "Depois" da linha de baixo, que fica só com o "Outra data"). No
computador, nada muda (setas dos lados da faixa). Conferida no local em 390px e 360px.
**S-02 (dia pedido sem horário no `/agendar`), decisão do cliente em 17/out:** aviso amarelo acima da faixa. Sem agenda
aberta no dia (o profissional não atende nesse dia da semana, feriado, dia passado, depois do prazo do link ou bloqueado
por inteiro, este último decidido pelo cliente): "Não existe agenda aberta para esse dia.". Com agenda, mas ocupado:
"Terça-feira, 27/10 não tem mais horário livre. Mostramos o próximo dia com horário.". A regra fica em
`isAgendaOpenOn` (`src/lib/data/agenda/slots.ts`: janelas, feriados e bloqueios, sem contar os atendimentos nem as
horas que já passaram) e `isLinkDayOpen` (`publicBooking.ts`, qualquer profissional ou local do link). Também no
Marcar e no Remarcar do painel (cliente, 17/out): a primeira frase do aviso segue a mesma regra e o "Mostrando a partir
de …" continua.
**Teste de interface da S-01 e da S-02 (17/out),** [relatório](auditoria-frontend/redesign-r11-s01-s02-report.md); decisões do
cliente: no `/agendar`, dia pedido depois do último dia livre mostra o aviso e a faixa a partir do primeiro dia livre
(S02-08); cada dia da faixa com no máximo 1/7 da largura, alinhado à esquerda (dia sozinho não estica); abaixo de 380px o
papel sai do cabeçalho do painel (QA-01).
**"Outra data" no iPhone (relato do cliente, 17/out):** no Marcar e no Remarcar, tocar no campo abria o calendário e
fechava em seguida. Causa: o campo vazio com `data-autosubmit`; o Safari do iPhone põe hoje no campo ao abrir e dispara o
`change`, que recarregava a tela. Decisão do cliente: o campo já vem com o dia escolhido na faixa (ou hoje, sem dia livre),
como a data da Agenda › Dia (`DayStrip.astro`).

**Aviso do Retorno em Serviços (relato do cliente, 18/out):** o bot não mostrava "Marcar retorno" na "Consultorio de
Teste". Causa: a clínica não tinha serviço do tipo Retorno (o bot só mostra a opção com um Retorno com agenda, local e
horário; os testes automatizados cobrem o menu com o serviço, não a configuração de cada clínica). Decisão do cliente:
em Configurações › Serviços, um aviso quando nenhum Retorno ativo está pronto ("o bot não mostra a opção Marcar
retorno"), com o atalho "Cadastrar o retorno", que abre o Novo serviço no tipo Retorno (`?tipo=retorno`); com Retorno
pendente, o aviso aponta para os selos. Validado pelo cliente no local e publicado no staging em 18/out (sem migração).

**Link do WhatsApp copiado como chave Pix (relato do cliente, 18/out):** só o fim do link vinha sublinhado e o toque
copiava em vez de abrir (a prévia com a logo abria). Causa: o id no fim do endereço era um UUID, o formato da chave Pix
aleatória. Correção: os links do paciente (`/agendar`, `/preparo` e `/orientacoes`) levam o mesmo id em 22 caracteres
(base64url, `src/lib/publicId.ts`); as páginas aceitam também o UUID, e os links já enviados continuam abrindo. Sem
migração e sem mudança nos templates da Meta (o link é variável do texto). Validado pelo cliente no local e publicado no
staging em 18/out.

**Trilha com o nome interno das mensagens (relato do cliente, 18/out):** "consultation_guidance entregue", "WhatsApp:
appointment_reschedule entregue". Causa: a trilha só tinha nome para 6 tipos e o da remarcação estava escrito errado
(`appointment_rescheduled`). Agora todos os tipos têm nome (orientações gerais, aviso de remarcação, aviso de
cancelamento pela clínica, nota fiscal…), a situação concorda com o nome ("Orientações gerais da consulta entregues") e um
tipo sem nome sai como "Mensagem"; o "Mensagem não enviada (reminder: template_disabled)" virou "WhatsApp: Lembrete não
enviado (template não aprovado)". Validado pelo cliente no local e publicado no staging em 18/out (sem migração).

**"Marcados por" das Métricas pelo dia da marcação (relato do cliente, 18/out):** com "Hoje", os atendimentos marcados no
dia para outras datas não apareciam (a conta usava a data do atendimento). Decisão do cliente: o "Marcados por" da Visão
geral conta os marcados no período (`created_at`, `listMetricsRows` com `by: "booked"`), qualquer que seja a data deles,
sem os cancelados depois, com a linha de explicação e a coluna "Marcados"; os outros números seguem pela data do
atendimento. Validado pelo cliente no local e publicado no staging em 18/out (sem migração).

**Lista de espera: vaga de Retorno sem oferta (relato do cliente, 18/out):** com uma pessoa na fila de Consulta e outra
na de Retorno, abriram uma vaga de cada; a de Consulta (09:00) estava em oferta quando a de Retorno (11:45) foi
conferida, contou como "horário livre antes" e a vaga do Retorno fechou (`earlier_free`); a de Consulta foi aceita
depois e ninguém recebeu a do Retorno. Correção: vaga ainda em andamento na fila (aberta ou em oferta, mesma agenda) não
conta como livre (`withoutReserved` em `offers.ts`). Decisão do cliente: com horário livre de verdade antes, a vaga
**não fecha**: fica aberta, sem oferta, e o agendador reconfere a cada rodada (5 min); fecha com menos de 2h ou com o
horário ocupado. A rodada pega as vagas pela conferência mais antiga (`updated_at`), para as que esperam não travarem as
outras. Sem migração. Validado pelo cliente pelos testes e publicado no staging em 19/out; a vaga das 11:45 de 19/10 da
"Consultorio de Teste" foi reaberta no staging a pedido do cliente.

**Redesign de 19/out (pedido do cliente): tipo na Agenda, menu de Configurações e Horários em colunas.** Propostas no
[canvas](https://claude.ai/artifact/8x8Zi8osZZLypbMkGRiPbQ), na identidade do painel; decisões do cliente em 19/out:

1. **Agenda, tipo do atendimento: 1C.** Faixa no alto do cartão com o tipo (Consulta, Retorno ou Exame) em letra de
   título; o Retorno em roxo (`#5A3E9E`, cor que nenhuma situação usa) e com "da consulta de dd/mm/aaaa" na faixa (sai do
   pé do cartão). O nome do serviço vai para a faixa ao lado do tipo, quando é diferente do tipo. Na Semana, o tipo na
   primeira linha de cada atendimento.
2. **Configurações no computador: 2B.** Cada seção com um ícone; o grupo vira um título pequeno com uma linha ao lado,
   sem maiúsculas. No celular, os grupos continuam em cartões (17/out), mas cada seção ganha o mesmo ícone e o nome do
   grupo também sai das maiúsculas.
3. **Configurações › Horários: 3B.** Uma coluna por dia (segunda a domingo), com os horários empilhados (sem a escala de
   horas), o total de horas do dia no topo, o total da semana na barra (com a agenda e "Mostrar desativados"), o menu
   "⋯" em cada horário (Desativar ou Reativar e Remover, com a confirmação de hoje) e "Adicionar" no pé de cada coluna,
   que abre o formulário com o dia marcado. Horário só de um serviço com contorno verde; desativado tracejado e com
   listras. No formulário, os dias viram botões. No celular, uma linha por dia, com o "+" e o "⋯".

**1C implementada e testada no local em 19/out** (`categoryStyle.ts`, `AppointmentCard.astro`, a Semana e a turma;
tom `ret` no tema; ícones `clipboard`, `arrow-uturn-left` e `beaker`). A faixa vale também no Resumo do Dia (mesmo
cartão). [Teste de interface](auditoria-frontend/redesign-1c-report.md): nenhuma falha; S-01 (turma sem o tipo)
decidida pelo cliente: a turma também ganha a faixa; corrigida e retestada. Publicada no staging em 19/out a pedido
do cliente (sem migração), que valida em paralelo.

---

## Depois do 1º piloto (já previsto no banco)

- **Convênios (D10):** telas de planos atendidos e exceções por profissional; plano no cadastro do
  paciente e no atendimento; no bot, convênio pedido junto com o nome, busca por semelhança,
  confirmação única de nome, idade e convênio, e "particular, outro nome ou recepção" quando não
  atendido; dados do convênio na página de data e horário, se a clínica exigir.

---

## Frentes paralelas (fora deste repositório)

| Frente | Situação | Depende de | Destrava |
|---|---|---|---|
| **Site do RecepClinic** (`www.recepclinic.com.br`, repositório separado) | **no ar** (05/out, com `/privacidade` e `/termos`; DNS na Cloudflare): [`site-plano.md`](site-plano.md), sessão paralela | — | Tech Provider; páginas legais usadas pela F5 |
| **Cadastro como Tech Provider na Meta** (verificação da empresa, app do RecepClinic, análise) | **em andamento**: verificação da empresa aprovada e app RecepClinic criado (cliente, 06/out); faltam a análise do app (App Review) e o Tech Provider com o Embedded Signup | site no ar com política de privacidade e termos; CNPJ | F8 (e a conexão de números de outras clínicas) |

## Pendências do cliente que afetam o plano

| Pendência | Necessária para |
|---|---|
| Verificação da empresa e Tech Provider na Meta (CNPJ, site) | F8 (começar já, por causa do prazo) |
| Site `www.recepclinic.com.br` com política de privacidade e termos (projeto separado) | F8 (Meta) e F5 |
| Chip novo de testes do RecepClinic (WhatsApp) | F6 |
| ~~CNPJ~~ (aberto, cliente, 10/out), contrato com as clínicas, termo de tratamento de dados | F10 |
| Custo da Meta por mensagem (cobrado da clínica, direto pela Meta; F8) | definição de preço e contrato (fora do código) |
