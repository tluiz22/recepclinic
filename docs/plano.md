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
| F3 | Acesso ao banco e contexto da clínica | **próxima** (a detalhar) |
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
  lembrete e reenvios; resumo do dia e execuções das rotinas; achados 4–5 da F1. Divisão a
  combinar com o cliente ao começar; proposta: **F3.9a** WhatsApp (conexão e templates por
  clínica, estado da conversa e pausa da recepção, registro das mensagens com situação da entrega,
  repetidas da Meta e janela de 24h, funil); **F3.9b** lembrete e reenvios (quem recebe no fuso e
  hora da clínica, botões "Enviar"/"Reenviar lembrete", reenvio automático sem resposta, reenvio
  do preparo, achado 4); **F3.9c** resumo do dia e execuções das rotinas (horário pelas janelas das
  agendas, conteúdo, contatos, reenvio quando entra atendimento antes do horário avisado,
  `job_runs`, achado 5). Envio de verdade pelo WhatsApp recebido de fora (F6/F7), como na F3.7b;
  cada parte respeita os itens da matriz (D11).

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
