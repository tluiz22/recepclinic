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
| F6 | WhatsApp por clínica e bot | **em curso** (detalhada em 06/out) |
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

## F10 — Primeiro piloto

**Escopo:** produção (Supabase Pro + Vercel Pro, backup conferido); criação da 1ª clínica pelo
Suporte (pela tela "Nova clínica", F4.4) e configuração pelo Administrador; no cenário B, script de importação do banco do piloto
para o modelo novo; acompanhamento das primeiras semanas.

**Depende da F8** (cliente, 06/out): o número da primeira clínica só é conectado por coexistência,
então o Tech Provider precisa estar aprovado antes da F10.

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
| CNPJ, contrato com as clínicas, termo de tratamento de dados | F10 |
| Custo da Meta por mensagem (cobrado da clínica, direto pela Meta; F8) | definição de preço e contrato (fora do código) |
