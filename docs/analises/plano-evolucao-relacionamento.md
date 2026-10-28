# Plano de evolução: Central de Relacionamento

> **CRM.1 (auditoria e plano), 27/out/2026, branch `CRM`.** Nenhum código funcional, banco ou migração foi
> alterado. Este documento confirma no código o [diagnóstico](diagnostico-crm-atual.md) (CRM.0), acrescenta as
> decisões pedidas pelo cliente e propõe a implementação em etapas. **Nada será implementado antes da aprovação
> explícita do cliente.**
>
> **Decisões já tomadas pelo cliente (27/out):** área nova **"Relacionamento"** com abas ou filtros por tipo de
> pendência; o **Resumo do Dia continua** como visão do dia (não é renomeado); escopo inicial = (1) reunir as listas
> que já existem, (2) histórico do paciente e do contato, (3) registro simples do resultado de um contato, (4)
> **anotações gerais do paciente e registros de interação**; acesso da Recepção por **permissão própria**, sem abrir
> as Métricas; nada de CRM comercial, campanhas ou tarefas avançadas.
>
> **Revisão pedida pelo cliente (27/out), seção 13:** a direção geral está aprovada. A revisão conferiu no código a
> segurança do histórico (**restringir rota e componente não basta**; proposta de proteção no banco, etapa nova
> **B0**), separou "marcou de fato" de "enviou o link", detalhou as Observações do paciente, acrescentou critérios de
> teste de desempenho e consistência e reforçou a regra da produção. Novas dúvidas **Q10 a Q13** (seção 11),
> **respondidas pelo cliente em 27/out** (todas na opção recomendada). Continua **sem código, banco ou migração** até a aprovação do documento revisado.

---

## 0. Estado do repositório e do ambiente (conferido em 27/out)

| Item | Situação |
|---|---|
| Branch | `CRM`, em dia com `origin/CRM`, **sem alterações locais nem stash** antes deste documento |
| Base | `main` em `eca4b79` (= produção publicada em `af0902d` + docs); a `CRM` só tem commits de documentação |
| Testes de unidade (`npm test`) | **84 arquivos, 691 testes, todos passaram** (local, 27/out 21:15) |
| Testes de banco (`npm run test:db`) | **60 arquivos, 636 testes, todos passaram** (Supabase local, 27/out 21:15) |
| Staging e produção | **Não acessados** nesta auditoria (nenhuma consulta, migração ou publicação) |
| Google Calendar | **Não existe no RecepClinic**: aparece só em `supabase/piloto-migrations/` (cópia do piloto, só leitura). Nenhum fluxo de calendário a proteger |

Os números de teste são a **linha de base**: cada etapa precisa terminar com todos passando, mais os testes novos.

---

## 1. Arquitetura atual das áreas envolvidas

- **Páginas Astro com renderização no servidor** (`src/pages/admin/**`), sem framework de cliente. Cada página lê
  os dados direto pela camada `src/lib/data/**` com o cliente Supabase **do login** (`createUserClient`), então o
  **RLS vale em toda leitura**. As ações são formulários `POST` para rotas em `src/pages/api/admin/**`, que voltam
  para a tela de origem (`return_to`, `src/lib/returnPath.ts`).
- **Acesso em duas camadas:**
  1. **Aplicação** (`src/middleware.ts` → `canAccessPath` em `src/lib/clinicAccess.ts`): papel por **área**
     (`AREA_ROLES`: `settings` = Administrador; `metrics` = Administrador e Profissional com "Métricas pessoais";
     `finance` = Administrador e Recepção com o item; `shared` = todos) **e** item da matriz por rota e aba
     (`PATH_RULES` em `src/lib/features.ts`). Sem acesso: página redireciona com `aviso=acesso_negado` e a API
     responde 403. O menu esconde o que a pessoa não acessa (`AdminLayout.astro`).
  2. **Banco (RLS):** tudo isolado por `clinic_id` (`app.is_clinic_member`, `app.has_clinic_role`;
     `app.service_clinic_id()` para o bot e as rotinas). `appointments` também por agenda (`app.can_access_agenda`:
     o Profissional restrito vê só as agendas dele e as liberadas). Mensagens, conversa e funil: qualquer membro da
     clínica lê, **inclusive o texto das mensagens e direto pela API do Supabase com o próprio login** (seção 13.1).
- **Funções de Métricas** (`public.metrics_*`, migração `20261023130000_metricas_acesso_na_entrada.sql`): `security
  definer`, conferem **clínica e agenda** na entrada (`app.metrics_agendas` → `app.can_access_agenda`; os passos do
  bot com `app.is_clinic_member`). **Não conferem o papel**: quem barra a Recepção nas Métricas é só a camada da
  aplicação. Isso é importante para o plano (seção 5): reaproveitar essas funções na central **não abre nada novo
  no banco**, porque a Recepção já pode chamá-las hoje. O controle continua sendo a rota.

---

## 2. Onde ficam as seis áreas (confirmado)

| Área | Rota e arquivo | Dados | Quem vê |
|---|---|---|---|
| Início | `/admin/dashboard` → `src/pages/admin/dashboard.astro` | `getDashboardCounts` (`data/dashboard.ts`), `listHumanAttention`, `listContactsToReview`, alertas | Todos |
| Atendimento humano | `/admin/atendimento` → `src/pages/admin/atendimento.astro` | `listHumanAttention` (`whatsapp/attention.ts`) | Todos, com `whatsapp_bot` (conferido na página) |
| Resumo do Dia | `/admin/consultas` → `src/pages/admin/consultas/index.astro` + `components/admin/resumo/*` | `data/daily.ts`, `data/sends.ts`, `waitlist/entries.ts` | Todos; abas Lembretes (`reminders`) e Lista de espera (`waitlist`) por item |
| Ficha do paciente e do contato | `/admin/pacientes/[id]`, `/admin/pacientes/contato/[id]` | `data/patients.ts`, `agenda/view.ts`, `whatsapp/botLimits.ts`, `contactBlock.ts` | Todos (ações sensíveis por papel) |
| Trilha | `/admin/agenda/trilha/[id]` | `listTrail` (`agenda/trail.ts`) | Todos |
| Métricas | `/admin/metricas` → `src/pages/admin/metricas.astro` + `components/admin/metricas/*` | `data/botFunnel.ts`, `data/performance.ts`, `data/metrics.ts` | Administrador (clínica toda); Profissional só com "Métricas pessoais" e sem as abas do bot; **Recepção não** |

---

## 3. Implementação real de cada lista de acompanhamento

| Lista (nome real) | Onde está | Origem dos dados | Regra de entrada e saída | Ações hoje | Item da matriz | Quem vê hoje |
|---|---|---|---|---|---|---|
| **Retomar contato** | Métricas › aba `retomar_contato` | `metrics_bot_sessions` → `listFunnelSessions` → `buildFunnelReportFromSessions(...).incomplete` (`data/botFunnel.ts`) | Tentativa no bot ou no link **iniciada no período** (padrão "Este mês"), com desfecho **abandono ou erro**, **sem conclusão posterior do mesmo fluxo** pelo mesmo telefone. Até 50 na tela. O nome do contato é lido **dentro da página** | Nome (abre o contato), WhatsApp | `metrics_recall` | Administrador |
| **Oportunidade agora** (retorno) | Métricas › Desempenho, bloco "Retornos" (lista recolhida) | `metrics_return_rights` → `listReturnOpportunities` (`data/performance.ts:171`); nomes lidos **dentro do componente** (`PerformanceTab.astro:161`) | Consulta **realizada**, não domiciliar, a **última** do paciente na agenda, prazo do serviço de Retorno **ainda aberto**, sem retorno ligado e sem consulta ou retorno futuro na agenda. Até 50 | Nome, WhatsApp | `metrics_performance` (e a agenda tem serviço de Retorno) | Administrador; Profissional (próprias agendas) |
| **Faltosos** ("Faltam com frequência") | Métricas › aba `faltosos` | `metrics_no_shows` → `listFrequentNoShows` (`data/metrics.ts:75`) + `isFrequentNoShow` (`agenda/view.ts:278`) | Paciente com 2+ faltas e a regra do piloto, nas agendas do escopo; sem período | Nome (ficha), WhatsApp | `metrics_no_shows` | Administrador; Profissional (próprias) |
| **Aguardando remarcação** (com "Desistiu") | Resumo › `aguardando_remarcacao` | `listAwaitingRebooking`, `wasRebooked`, `dismissRebooking` (`data/daily.ts`) | Cancelado **pela clínica** (em massa ou bloqueio), sem "Desistiu", e que **não** voltou a marcar a mesma jornada (atendimento futuro ou marcado depois do cancelamento, em qualquer situação). Até 200 lidos | **Remarcar** (abre o Marcar preenchido); **Desistiu** (com confirmação, vai à trilha) | — | Todos (Profissional: agendas dele) |
| **Lembretes** (respostas aos lembretes) | Resumo › `lembretes` | `listRemindersOfDay` + `listReminderTaps` + `reminderGroup` (`data/daily.ts`) | Lembretes **enviados no dia escolhido**, em 5 grupos. Toque em "remarcar" ou "cancelar" **abre o fluxo no bot** (`handleReminderTap`, `bot/manage.ts:507`); se a pessoa não termina, a tentativa também cai no Retomar contato (origem "lembrete") | Nenhuma (Agenda e WhatsApp) | `reminders` | Todos |
| **Lista de espera** | Resumo › `lista_espera` | `listWaitlist`, `listRecentOffers` (`waitlist/entries.ts`) | Quem está ativo na lista, por agenda e serviço, na ordem de entrada; últimas ofertas | **Tirar da lista** (com confirmação) | `waitlist` | Todos |
| Atendimento humano (não pedido como aba, mas é pendência) | `/admin/atendimento` | `listHumanAttention` | Conversa pausada e dentro do prazo; "Aguardando" ou "Em atendimento" | Abrir no WhatsApp, Devolver ao bot | `whatsapp_bot` | Todos |
| Contatos para revisar (idem) | Início | `listContactsToReview` (`whatsapp/botLimits.ts`) | Bateu limite do bot nos últimos 7 dias e não foi "Revisado" | Revisado (Recepção e Administrador) | `whatsapp_bot` | Todos (ação por papel) |

**Achados que mudam o desenho:**
1. **Duplicidade no Retomar contato:** cada tentativa abandonada vira uma linha. O mesmo telefone com 3 tentativas
   de "Marcar consulta" aparece 3 vezes (`incomplete.push` por sessão). Na central, agrupar por **telefone e
   fluxo**, mostrando a mais recente e quantas foram, sem mudar a regra das Métricas.
2. **Lógica dentro de páginas:** a leitura dos nomes do Retomar contato (`metricas.astro`) e da Oportunidade agora
   (`PerformanceTab.astro`) está na página. Para não duplicar, essas leituras saem para uma função em `src/lib/data/`
   usada pelas duas telas (refatoração pequena e local, coberta por teste).
3. **Período:** o Retomar contato depende do período das Métricas; a central precisa de uma janela fixa
   (pergunta Q3).
4. **"Respostas aos lembretes" como pendência:** "pediram para remarcar ou cancelar" **já vão ao bot**, e quem não
   conclui já entra no Retomar contato. A pendência que só os Lembretes mostram é **"não responderam"** e **"não
   entregue"**, dos atendimentos ainda por vir (pergunta Q4).
5. **Oportunidade agora** exige consulta **realizada** (`completed`); o botão "Marcar retorno" do cartão aceita a
   consulta já iniciada. As duas regras são diferentes de propósito e ficam como estão.

---

## 4. Agenda × Resumo do Dia (pedido do cliente)

### 4.1 O que se repete

| Informação ou ação | Agenda (Dia) | Resumo do Dia | Mesma fonte? |
|---|---|---|---|
| Atendimentos do dia, por horário, com situação | Sim (cartões, com bloqueios e turmas) | Sim (aba Resumo do dia, em tabela, **sem** bloqueios) | Sim: `listAgendaAppointments` |
| Legenda de situações com contadores | Sim (`SituationLegend`) | Sim (`SituationLegend`, sem bloqueio) | Sim |
| Paciente, contato e WhatsApp, serviço, local, agenda, endereço domiciliar | Sim | Sim | Sim |
| Presença ("Confirmou pelo lembrete", "Presença confirmada", "não confirmada") | Sim (sinal no cartão) | Sim (coluna Presença) | Mesma regra (`confirmedByReminder`, `patientConfirmedAt`) |
| Idade do paciente | Não | **Só no Resumo** | — |
| "Quem marcou e por onde" | Não (só na Trilha) | **Só no Resumo** | — |
| Selos (faltas, pago, lista de espera, lembrete sem resposta ou não entregue, preparo) | Sim | Só nas abas A registrar e Registradas (mesmo cartão) | Mesmo `AppointmentCard` |
| Ações no atendimento (confirmar, compareceu/faltou, remarcar, cancelar, retorno, pagamento, reenvios, lista de espera, trilha) | Sim | **Só nas abas A registrar e Registradas**, com o mesmo cartão e as mesmas ações (`cardActions.ts`) | Mesmo código |
| Comparecimento pendente | Sinal no cartão do dia | Aba A registrar (60 dias) + contador | Mesma regra de situação |
| Lembretes sem resposta ou não entregues | Sinal + "Reenviar lembrete" no cartão | Aba Lembretes (grupos, sem ação) | Fontes parecidas (`reminderActions` × `listRemindersOfDay`) |
| Falhas de envio | Sinal + reenvio no cartão | Aba Envios (leva à Agenda) | `data/sends.ts` × sinais do cartão |
| Navegação por data | Dia, semana, mês, busca | Só nas abas Resumo do dia e Lembretes | — |

**Não há código duplicado**: as duas telas usam as mesmas funções e o mesmo cartão. A repetição é de
**apresentação**. A aba "Resumo do dia" é a Agenda do dia em modo leitura, com idade e "quem marcou" a mais, sem
ações (decisão do piloto de 03/out).

### 4.2 Recomendação do que fica em cada tela (sem remover nada automaticamente)

| Tela | Fica | Observação |
|---|---|---|
| **Agenda** | Tudo como está: é onde se **age** sobre o atendimento | Nenhuma mudança neste plano |
| **Resumo do Dia** | Resumo do dia (visão do dia para conferir e imprimir de olho), A registrar, Registradas, Envios. **Lembretes, Lista de espera e Aguardando remarcação continuam também aqui** até o cliente decidir (Q1) | Se o cliente quiser, numa etapa posterior e só com o OK dele, essas três passam a abrir a central (redirecionamento, como já se fez com `/admin/envios`) |
| **Relacionamento** (nova) | Filas por **pessoa** que pedem contato: Atendimento humano (resumo + link), Retomar contato, Oportunidade agora, Faltosos, Aguardando remarcação, Lembretes não respondidos ou não entregues, Lista de espera, Contatos para revisar | Reusa as mesmas funções e ações; não cria segunda regra |
| **Métricas** | Tudo como está (as listas continuam lá para o Administrador) | Uma lista só passa a sair das Métricas com a decisão do cliente |
| **Início** | Como está; os contadores podem ganhar o link "Ver no Relacionamento" | Opcional |

Enquanto o cliente não decidir, algumas listas existem em dois lugares (Resumo ou Métricas, e a central). É o mesmo
dado e a mesma função, só em duas telas, sem risco de divergir.

---

## 5. Permissões: como conceder sem abrir as Métricas

**Proposta (a aprovar, Q2):**

1. **Área nova `relationship`** em `AREA_ROLES` (`clinicAccess.ts`), com prefixos `/admin/relacionamento` e
   `/api/admin/relacionamento`. Papéis: **Administrador e Recepção**; Profissional a decidir (Q2).
2. **Item novo na matriz** (`features.ts`): `relationship` ("Relacionamento"), liberado por clínica como os outros
   (D11). Cada aba da central também exige o item da lista de origem que faz sentido: `reminders` (Lembretes),
   `waitlist` (Lista de espera) e `whatsapp_bot` (Retomar contato, Atendimento humano, Contatos para revisar),
   **sem** exigir `metrics_*`. Assim a Recepção não ganha nenhuma rota das Métricas.
3. **Escopo de agenda:** Faltosos, Oportunidade agora e Aguardando remarcação já respeitam as agendas da pessoa no
   banco. Retomar contato e Atendimento humano são da clínica toda (os passos do bot não guardam agenda), e por isso
   hoje ficam fora do Profissional restrito; a central mantém essa regra.
4. **Ações:** reaproveitam as rotas que já existem (`/api/admin/agenda/atendimentos/[id]` para "Desistiu" e "Tirar da
   lista"; `/api/admin/atendimento` para "Devolver ao bot"; a rota do contato para "Revisado"), cada uma com a regra
   de papel que já tem. A central não cria atalho que contorne essas regras.
5. **Banco:** nenhuma mudança para a Etapa A. As funções `metrics_*` já conferem clínica e agenda; o controle de
   papel continua na rota, como hoje nas Métricas.
6. `PANEL_RETURN` (`returnPath.ts`) ganha `relacionamento`, para o "Voltar" das telas abertas pela central levar de
   volta a ela (regra do painel).

**Ponto de atenção registrado:** hoje qualquer membro da clínica consegue, pela API do Supabase com o próprio login,
chamar as funções `metrics_*` e ler `whatsapp_messages`, mesmo sem a tela. **Não vaza para fora da clínica** (o
isolamento está testado), e o plano não piora isso. Endurecer o papel dentro do banco é outra etapa, com risco para
as Métricas e o bot. Fica como recomendação futura (R1).
**Exceção revista em 27/out (seção 13.1):** o **texto das mensagens** não pode esperar a R1, porque a Q5 decidiu
que o Profissional não lê as conversas. A etapa B0 protege só o texto, no banco, sem mudar as Métricas nem o bot.

---

## 6. Pacientes, contatos, mensagens e eventos

```
clinics ─┬─ contacts (telefone único na clínica) ─┬─ patients (N por contato; is_contact_self ≤ 1)
         │                                         │      └─ appointments ── appointment_events (trilha)
         │                                         │                │
         ├─ whatsapp_messages ── contact_id? ──────┘   appointment_id? ┘   (+ contact_phone sempre)
         ├─ conversation_state (1 por telefone: estado atual, pausa, motivo)
         ├─ bot_funnel_events (passos por tentativa; contact_id?, contact_phone, appointment_id?)
         ├─ booking_links (link do bot ↔ tentativa, contato, paciente, atendimento)
         └─ waitlist_entries/offers (↔ atendimento)
```

- **Telefone ≠ paciente.** Um contato pode ter vários pacientes (ex.: mãe com dois filhos). Mensagens, conversa,
  tentativas no bot e limites são do **contato** (telefone); atendimentos e trilha são do **paciente**. Uma mensagem
  só é do paciente quando tem `appointment_id` de um atendimento dele (lembrete, preparo, avisos). As conversas
  livres e o menu do bot **não dizem de qual paciente se trata**.
- **`contact_id` nas mensagens é gravado na hora** (`contactIdByPhone`): mensagens anteriores ao cadastro ficam com
  `contact_id` nulo e só o telefone. Para o histórico completo, ler `contact_id = X` **ou** (`contact_id` nulo **e**
  `contact_phone` = telefone do contato). Se o telefone do contato mudou, as antigas continuam ligadas pelo
  `contact_id`.
- **Anonimização** (`20261009140000_anonimizacao.sql`): apaga o texto das mensagens, apaga `conversation_state`,
  troca o telefone e anonimiza o funil. A linha do tempo de um anonimizado mostra só "mensagem indisponível".
- **Passagens para a clínica:** o **início** de cada pausa fica em `bot_funnel_events` (fluxo `handoff`, passo =
  motivo, com a etapa em que a conversa estava, `pauseForHuman` em `whatsapp/conversations.ts:346`). O **fim** não
  fica registrado em lugar nenhum (`returnToBot` zera o estado). *Correção do diagnóstico CRM.0, já ajustado lá.*
- **Respostas da recepção pelo app** (coexistência) ficam como `agent_reply`, com texto, **sem dizer quem da
  equipe** escreveu (a Meta não informa).

### 6.1 Observações e históricos que já existem (pedido do cliente)

| Estrutura | O que é | Serve para o CRM? |
|---|---|---|
| `patients.notes` | Texto livre único, "só a equipe vê", editável por todos os papéis da clínica, apagado na anonimização | **Sim, como "Anotações gerais do paciente"**: já existe, com tela e regra. Falta data e autor da última edição |
| `contacts` | **Não tem** observação | Lacuna, se o cliente quiser anotação do responsável (Q6) |
| `appointments` | **Não tem** observação do atendimento | Fora do escopo |
| `appointment_events` | Trilha do atendimento (canal, autor, detalhes) | Sim, como fonte da linha do tempo; **não** serve para registrar contato (é por atendimento, e o insert exige atendimento) |
| `bot_funnel_events` | Passos do bot | Fonte da linha do tempo; só o bot e a página gravam (a equipe não pode) |
| `whatsapp_messages` | Mensagens | Fonte da linha do tempo |
| `schedule_blocks.reason`, `waitlist_offers.details`, `agenda_import_requests.return_comment`, `clinic_settings.bot_notes` | Textos de outros fins | Não |
| Registro de interação ou resultado de contato | **Não existe** | Precisa de tabela nova (Etapa C) |

---

## 7. Mudanças necessárias por etapa

### Etapa A: Central de Relacionamento (sem banco)

- **Interface:** `src/pages/admin/relacionamento.astro` (abas por `?tab=`, padrão `Tabs` com contador, estado vazio
  com `EmptyState`, celular igual ao Resumo); componentes em `src/components/admin/relacionamento/*`. Reusar
  `AguardandoTab`, `ListaEsperaTab` e `LembretesTab` como estão, ou extraindo a lista, sem mudar o visual no Resumo;
  `PhoneLinks` (WhatsApp, sem ligação); "Como funciona?" em `src/lib/ajuda/relacionamento.ts` (padrão da ajuda
  contextual). Cada linha diz **por que** a pessoa está ali (motivo e data) e leva à ficha, ao contato, ao
  atendimento ou à trilha.
- **Backend:** `src/lib/data/relationship.ts` só **compõe** as funções existentes (`listAwaitingRebooking`,
  `listRemindersOfDay`, `listWaitlist`, `listFunnelSessions` + `buildFunnelReportFromSessions`,
  `listReturnOpportunities`, `listFrequentNoShows`, `listHumanAttention`, `listContactsToReview`), com o
  agrupamento do Retomar contato por telefone e fluxo e os contadores. As leituras de nomes saem de `metricas.astro`
  e `PerformanceTab.astro` para uma função compartilhada. Área e item novos (`clinicAccess.ts`, `features.ts`),
  menu (`AdminLayout.astro`), `returnPath.ts`.
- **Banco:** **nada.** O item novo da matriz precisa existir na tabela `features`, que é lida do banco. Por isso
  **há uma migração pequena de dados** (inserir a linha `relationship` em `public.features`) — ver 7.1.

### Etapa B: Histórico (linha do tempo, só leitura)

- **Onde:** ficha do **contato**: a conversa inteira, as tentativas no bot, as passagens para a clínica, os limites
  e, com rótulo, os atendimentos de todos os pacientes dele. Ficha do **paciente**: os atendimentos e a trilha
  dele, as mensagens ligadas aos atendimentos dele e um link "Ver as conversas do contato", **sem misturar** as
  mensagens livres do contato como se fossem do paciente.
- **Backend:** `src/lib/data/timeline.ts` lendo `whatsapp_messages`, `appointment_events` (reuso de
  `describeTrail`), `bot_funnel_events` (reuso de `FLOW_DEFS`/`reasonLabel`) e `waitlist_*`. Ordenação por horário,
  fuso da clínica (`formatInstant`), tipo e origem em cada item (mensagem do paciente; resposta da recepção pelo
  app; mensagem automática; ação da equipe com o nome; passo do bot). Paginação por "Carregar mais" (por data, 50
  por vez). Falha numa fonte mostra aviso e o resto da ficha continua (padrão `safe` já usado nas Métricas).
  Índices existentes atendem: `(clinic_id, contact_phone, created_at desc)` e `contact_id`.
- **Banco:** nada na B1 e na B2. **Antes delas, a B0** (seção 13.1): o texto das mensagens sai da leitura direta
  pelo login e passa a ser lido só por funções que conferem o papel.
- **Permissão (Q5, revista em 27/out):** rota e componente restringem a **tela**, mas **não bastam**. Hoje qualquer
  membro lê `whatsapp_messages.body` pela API do Supabase com o próprio login. A proteção do texto fica no banco
  (B0), por coluna e por função, **sem mudar o RLS das linhas**: bot, Atendimento e Métricas seguem como estão.

### Etapa C: Anotações e registro do resultado do contato (com banco)

**Anotações gerais do paciente:** reusar `patients.notes`, que já existe. Proposta mínima (Q6): mostrar
"Atualizado em … por …" exige duas colunas novas (`notes_updated_at`, `notes_updated_by`), ou o próprio registro de
interação "Anotação" na tabela abaixo. A recomendação é a primeira, mais simples, e a anotação **do contato**
ficar para depois, se o cliente pedir. **Perfis, gravação e proteção detalhados na seção 13.3.**

**Registro de interação e resultado do contato (proposta, não executada):**

```sql
-- PROPOSTA (não aplicada): registros de contato feitos pela equipe.
create table public.contact_interactions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  contact_id uuid not null,                       -- quem foi contatado (telefone)
  patient_id uuid,                                -- de qual paciente se tratou (opcional; do mesmo contato)
  source text not null check (source in ('retomar_contato','oportunidade_retorno','faltosos',
         'aguardando_remarcacao','lembretes','lista_espera','atendimento_humano','avulso')),
  appointment_id uuid,                            -- pendência ligada a um atendimento (opcional)
  funnel_session_id uuid,                         -- pendência do Retomar contato (opcional)
  outcome text not null check (outcome in (...)), -- lista aprovada pelo cliente (Q7)
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  foreign key (clinic_id, contact_id) references public.contacts (clinic_id, id),
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id),
  foreign key (clinic_id, appointment_id) references public.appointments (clinic_id, id)
);
-- RLS: ler = membro da clínica (Q5 também vale aqui); gravar = Administrador e Recepção (Q2),
-- com created_by = auth.uid() e paciente do mesmo contato (trigger); sem update e delete (corrige-se com
-- um registro novo); auditoria do Suporte (app.audit_platform_staff_write); a anonimização apaga o texto.
```

- **Compatibilidade:** só tabela nova (e, se aprovado, duas colunas que aceitam nulo em `patients`). Nenhum dado
  existente muda; nenhuma tela antiga depende dela.
- **Reversão:** `drop table public.contact_interactions` (e `alter table patients drop column ...`), mais a remoção
  do item. Código publicado antes da migração quebraria a ficha; por isso vale a ordem do staging (simulação →
  aplicar → conferir → só então `git push`).
- **Saída da fila:** um registro **só** tira a pessoa da fila quando o cliente aprovar a regra (Q8). Proposta:
  sai do Retomar contato e da Oportunidade agora com o resultado "Marcou" ou "Não quer"; "Não atendeu" mantém e
  mostra "1 tentativa em dd/mm"; Aguardando remarcação continua saindo só por remarcar ou "Desistiu" (que pode
  pedir um resultado). Nenhuma outra pendência é concluída por inferência.
- **Linha do tempo:** cada registro entra na Etapa B como "ação da equipe", com o autor.

**Opções de resultado recomendadas (Q7, lista curta):**

| Chave | Rótulo | Tira da fila? (proposta) |
|---|---|---|
| `scheduled` | Marcou (pela equipe ou vai marcar pelo link) | Sim |
| `call_back` | Pediu para falar depois | Não (mostra a tentativa) |
| `no_answer` | Não respondeu | Não (mostra a tentativa) |
| `not_interested` | Não quer marcar agora | Sim |
| `wrong_number` | Número errado ou sem WhatsApp | Sim |
| `other` | Outro (com observação obrigatória) | Não |

**Revisto em 27/out (seção 13.2):** o rótulo de `scheduled` mistura o atendimento **marcado de fato** com o envio do
link ou a intenção de marcar. Proposta: "Marcou" só com um atendimento marcado conferido pelo sistema; o envio do
link ganha registro próprio que **não** tira da fila (Q10). A lista da Q7 só muda com a resposta do cliente.

### 7.1 Migrações previstas (nenhuma criada ainda)

| Etapa | Migração | Tipo | Risco |
|---|---|---|---|
| A | Inserir o item `relationship` em `public.features` (como as migrações de `20261005120000_matriz_de_acesso.sql` em diante); conferir se a coluna `area` aceita um grupo novo ou se o item entra num grupo existente da matriz (hoje: Agenda, WhatsApp, Métricas, Financeiro) | Dados, aditiva | Baixo. Reversão: apagar a linha e as liberações em `clinic_features` |
| B0, passo 1 | Funções `security definer` que leem o texto das mensagens com a conferência do papel (seção 13.1) | Esquema, aditiva | Baixo: nada usa ainda. Reversão: `drop function` |
| B0, passo 2 | Tirar `body` e `retry_payload` do `select` do `authenticated` (privilégio por coluna) e limitar o `update` às colunas que o painel atualiza | Permissão | **Médio:** código que ainda lê o texto pela tabela quebra. Só depois que o código que usa as funções estiver no mesmo ambiente. Reversão: `grant select on public.whatsapp_messages to authenticated` |
| C | `contact_interactions` + RLS + gatilhos + anonimização; `patients.notes_updated_at` e `notes_updated_by` com o gatilho da seção 13.3 | Esquema, aditiva | Médio (anonimização e RLS precisam de teste). Reversão: `drop` |

Cada uma será apresentada com o SQL final, o teste e o plano de reversão **antes** de aplicar, primeiro no local,
depois no staging; produção só no fluxo de publicação (`docs/producao.md`).

---

## 8. Proposta de navegação (antes de qualquer código)

**Menu no computador** (barra lateral):

```
Início
Agenda
Pacientes
Resumo do Dia
Relacionamento   (8)   ← novo, com o total de pendências
Atendimento      (2)
Configurações · Métricas · Financeiro
```

**Celular:** a barra de baixo tem 4 itens fixos (Início, Agenda, Pacientes, Resumo do Dia). Proposta:
**Relacionamento entra no "Mais"**, ao lado de Atendimento, com o contador. Alternativa (Q1): trocar o Resumo do
Dia pelo Relacionamento na barra.

**Tela Relacionamento:**

```
Relacionamento                                    Pendências que pedem contato da equipe
[Atendimento 2] [Retomar contato 5] [Retorno 3] [Lembretes 4] [Remarcação 1] [Faltosos 6] [Lista de espera 7] [Revisar 1]

Retomar contato · quem começou pelo WhatsApp e não concluiu (últimos 14 dias)        Como funciona?
┌───────────────────────────────────────────────────────────────────────────────────┐
│ Maria Souza (contato)   (84) 9 9999-0000 [WhatsApp]                               │
│ Marcar consulta · parou em "Receberam o link" · 2 tentativas · última 26/out 14:10 │
│ [Abrir contato] [Histórico] [Registrar contato]*                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
* "Registrar contato" só na Etapa C.
```

- As abas aparecem conforme o item e o papel. A primeira aberta é a que tem pendência; vazias mostram o motivo
  ("Ninguém para retomar nos últimos 14 dias").
- **Atendimento:** a aba mostra o resumo (aguardando e há quanto tempo) e o botão "Abrir Atendimento". A tela do
  Atendimento continua a mesma (notificações e `#bot`).
- **Ficha do contato:** nova seção "Histórico" (Etapa B); ficha do paciente: "Histórico do paciente" + link para as
  conversas do contato.
- "Voltar" de qualquer tela aberta pela central volta à aba de onde saiu.

---

## 9. Riscos para a produção e para os fluxos existentes

| Risco | Onde | Mitigação |
|---|---|---|
| Mexer nas abas do Resumo (componentes reaproveitados) e mudar o que a equipe já usa | `components/admin/resumo/*` | Reusar sem mudar a saída no Resumo; teste visual no local e no staging |
| Refatorar a leitura dos nomes nas Métricas | `metricas.astro`, `PerformanceTab.astro` | Extração 1:1 com teste; conferir as Métricas no staging |
| Lentidão: a central chama várias funções por página | `relationship.ts` | Contadores com as mesmas consultas leves do Resumo; listas só da aba aberta; Retomar contato com janela curta |
| Expor texto de conversa a quem não deveria | Etapa B | **Revisto (13.1):** rota e componente não bastam. B0 no banco (coluna + função com papel), testada com cada papel e também pela API direta |
| B0 passo 2 aplicado no staging antes do código da `main` usar as funções | Atendimento e Configurações › WhatsApp no staging | Duas migrações separadas; o passo 2 só depois do código nas funções estar publicado no mesmo ambiente (13.5) |
| Migração da branch `CRM` aplicada no staging sem estar na `main` | Histórico de migrações do staging | O `supabase db push` da `main` passa a acusar migração remota sem arquivo local. Proposta (Q13): o CRM vai ao staging só pela `main`, com o OK do cliente |
| "Marcou" sem atendimento de fato tira a pessoa da fila | Etapa C | Regra mínima da 13.2: exige o atendimento conferido |
| Contador diferente da lista ou zerado por falha | Etapa A | Critérios da 13.4: mesma consulta, "—" em vez de 0 quando a fonte falha |
| Mudança no bot para alimentar a tela | — | **Nenhuma mudança no bot, nos lembretes, na agenda ou no WhatsApp** está prevista |
| Migração aplicada fora de ordem quebra a tela | Etapas A e C | Ordem do staging (simulação → aplicar → conferir → push); produção só pelo fluxo de publicação |
| Anonimização esquecer a tabela nova | Etapa C | Teste de anonimização cobrindo `contact_interactions` |
| Divergência entre as listas da central e as originais | A | A central chama as mesmas funções; teste comparando as duas saídas |

---

## 10. Testes disponíveis e lacunas

**Existem (e passaram em 27/out):** regras do funil (`src/lib/data/botFunnel.test.ts`), desempenho
(`performance.test.ts`), Métricas no banco (`tests/db/metricas*.test.ts`, inclusive retornos e faltosos), dia a dia
(`tests/db/dia-a-dia.test.ts`: aguardando, desistiu, lembretes do dia, a registrar), lista de espera
(`tests/db/acesso-lista-de-espera*.test.ts`, `lista-de-espera.test.ts`), atendimento humano
(`tests/db/atendimento-humano.test.ts`), limites (`bot-limites.test.ts`), isolamento (`isolamento.test.ts`),
acesso por rota e item (`src/lib/features.test.ts`, `clinicAccess.test.ts`), anonimização (`anonimizacao.test.ts`),
WhatsApp e mensagens (`acesso-whatsapp.test.ts`, `webhook-whatsapp.test.ts`).

**Lacunas a cobrir no plano:**
- páginas Astro não têm teste automatizado: a validação das telas é no navegador (local, com Playwright) e no
  staging;
- acesso à rota `/admin/relacionamento` por papel e item (`features.test.ts`, `clinicAccess.test.ts`);
- agrupamento do Retomar contato (telefone e fluxo) e contadores da central (unidade);
- linha do tempo: ordem, fuso, tipos diferentes, contato com vários pacientes, mensagens sem `contact_id`,
  anonimizado, falha de uma fonte, paginação (unidade + banco);
- `contact_interactions`: RLS por papel, outra clínica, paciente de outro contato, autor forçado, sem update e
  delete, anonimização, saída da fila (banco);
- regressão: os testes atuais inteiros a cada etapa (agendamento, cancelamento, remarcação, atendimento humano);
- **critérios de desempenho e consistência** (contadores, agrupamento, carregamento das abas, isolamento por clínica e
  agenda, falha isolada de uma consulta), proteção do texto das mensagens (B0) e Observações: **seção 13.4**.

---

## 11. Dúvidas de negócio (uma de cada vez, na ordem)

- **Q1. Navegação:** Relacionamento no "Mais" do celular (proposta) ou no lugar do Resumo do Dia na barra? As abas
  Lembretes, Lista de espera e Aguardando remarcação continuam **também** no Resumo (proposta) ou passam só para a
  central?
  **Decidido (cliente, 27/out):** Relacionamento no **"Mais"** do celular, ao lado do Atendimento; as três abas
  continuam **também** no Resumo do Dia (nada sai de lá).
- **Q2. Papéis:** a central é do Administrador e da Recepção (proposta). O Profissional vê (só as próprias agendas,
  sem as listas do bot)? É item novo da matriz (proposta) ou do básico?
  **Decidido (cliente, 27/out):** **Administrador e Recepção**; o Profissional não entra. **Item próprio
  "Relacionamento" na matriz**, liberado por clínica.
- **Q3. Janela do Retomar contato** na central: 14 dias (proposta), 7 ou 30?
  **Decidido (cliente, 27/out):** **últimos 14 dias** (nas Métricas continua o período escolhido).
- **Q4. Lembretes como pendência:** só "não responderam" e "não entregue" dos atendimentos **por vir** (proposta), ou
  a aba do dia como está?
  **Decidido (cliente, 27/out):** só **"sem resposta" e "não entregue" dos atendimentos por vir**, sem escolher data.
  Implementação: reaproveitar a regra do sinal do cartão da Agenda (`reminderActions`: `resend` e
  `resend_unanswered`, em `whatsapp/reminders.ts`) para os atendimentos futuros, sem criar regra nova.
- **Q5. Texto das conversas:** quem lê o histórico com o texto: Administrador e Recepção (proposta), todos, ou também
  o Profissional dos próprios pacientes?
  **Decidido (cliente, 27/out):** **Administrador e Recepção** leem o texto; o Profissional vê o histórico de
  atendimentos e a trilha, sem o texto das conversas (restrição na aplicação: rota e componente). *Observação:* a tela
  Atendimento já mostra a última mensagem do paciente a todos os papéis (F8.5a); continua como está, salvo pedido do
  cliente.
- **Q6. Anotações gerais:** reusar as "Observações" do paciente com "atualizado em/por" (proposta)? Anotação do
  contato agora ou depois?
  **Decidido (cliente, 27/out):** reusar as **Observações** do paciente com **"Atualizado em … por …"**
  (`notes_updated_at`, `notes_updated_by`); anotação do contato fica para depois; as anotações datadas de cada contato
  ficam nos registros de interação.
- **Q7. Resultados do contato:** a lista da seção 7 serve?
  **Decidido (cliente, 27/out):** as **6 opções** da seção 7; observação obrigatória só em "Outro".
- **Q8. Saída da fila:** quais resultados tiram a pessoa de cada lista (proposta na seção 7)?
  **Decidido (cliente, 27/out):** "Marcou", "Não quer marcar agora" e "Número errado" tiram a pessoa de **Retomar
  contato, Oportunidade agora, Faltosos e Lembretes**; "Não respondeu", "Pediu para falar depois" e "Outro" mantêm e
  mostram a tentativa. Aguardando remarcação só sai ao remarcar ou com "Desistiu"; Lista de espera e Atendimento não
  mudam. **Pendência nova aparece de novo.** Como cada saída se liga à pendência (para não esconder a próxima):
  Retomar contato = tentativas do mesmo telefone e fluxo iniciadas **antes** do registro; Oportunidade agora = a
  consulta (`appointment_id`); Lembretes = o atendimento (`appointment_id`); Faltosos = o paciente, até uma **falta
  nova** depois do registro.
- **Q9. Registros:** podem ser corrigidos ou apagados, ou só acrescentados (proposta: só acrescentar)?
  **Decidido (cliente, 27/out):** **só acrescentar**; para corrigir, um registro novo (vale o último). A anonimização
  apaga a observação.

**Novas dúvidas da revisão de 27/out (respondidas pelo cliente em 27/out):**

- **Q10. Envio do link × marcou:** acrescentar a 7ª opção **"Enviou o link / vai marcar"** (`link_sent`), que mantém
  a pessoa na fila e mostra a tentativa, e deixar "Marcou" só quando o sistema achar o atendimento marcado (proposta,
  seção 13.2)? Ou manter as 6 opções e usar "Pediu para falar depois" ou "Outro" para o link?
  **Decidido (cliente, 27/out):** **7ª opção "Enviou o link / vai marcar"** (`link_sent`), que mantém na fila e
  mostra "link enviado em dd/mm"; **"Marcou" só com o atendimento marcado conferido** pelo sistema (regra da 13.2).
- **Q11. Lembretes:** "Marcou" não se aplica a quem já tem o atendimento. Proposta: na aba Lembretes, a saída é pelas
  ações que já existem (Confirmar presença, Remarcar, Cancelar) e pelos registros "Não quer marcar agora" e "Número
  errado"; "Marcou" não aparece nessa aba.
  **Decidido (cliente, 27/out):** como a proposta: ações atuais + "Não quer marcar agora" e "Número errado"; sem
  "Marcou" nessa aba; os outros registros só marcam a tentativa.
- **Q12. Observações do paciente:** quem lê e edita? Proposta: **como hoje** (Administrador, Recepção e
  Profissional, inclusive o restrito, que vê todos os pacientes; Suporte com auditoria), só acrescentando o
  "Atualizado em … por …". Alternativa: só Administrador e Recepção editam (o Profissional só lê).
  **Decidido (cliente, 27/out):** **como hoje** (os três papéis leem e editam; Suporte com auditoria), só com o
  "Atualizado em … por …".
- **Q13. CRM no staging:** as migrações e o código do CRM vão ao staging só depois de entrar na `main`, com o OK do
  cliente (proposta, porque o staging é o mesmo banco da `main`)? Até lá, a validação é no local.
  **Decidido (cliente, 27/out):** **só pela `main`, com o OK do cliente**: cada etapa é validada no local; aprovada,
  entra na `main` com as migrações e vai ao staging pelo fluxo de sempre. Nenhuma migração do CRM é aplicada no
  staging a partir da branch `CRM`.
- **Q14. Texto das mensagens (28/out, depois da apresentação da B0):** o cliente lembrou que as conversas já estão
  no app do WhatsApp. **Decidido:** o sistema **para de guardar** o texto das mensagens recebidas e das respostas
  da recepção pelo app, e o texto já guardado é apagado; a tela Atendimento e a notificação ficam sem a frase do
  paciente (D12).
- **Q15. Texto do que o sistema envia (28/out):** **Decidido:** continua guardado para o reenvio automático e para
  o diagnóstico do Suporte, sem leitura pelo login da clínica.
- **Q16. B1 e B2 (28/out):** **Decidido:** saem do plano. Depois da B0, segue a etapa C.
- **Q17. Registro sem cadastro (28/out, na C2):** **Decidido:** pelo telefone, contato opcional (ficou sem efeito pela Q18).
- **Q18. "Registrar contato" (28/out, depois de ver a C2 no local):** o cliente não viu valor nas 7 opções (o bot já
  acompanha a jornada) e explicou a necessidade real: na ficha do paciente, **anotações, lembretes e documentos**
  (foto ou PDF da carteirinha, identidade, pedido de exame ou médico) para a secretária pegar e encaminhar ao plano de
  saúde. Registro de contato, se houver, só onde a secretária iniciou o contato. **Decidido:** **tirar tudo** da C2
  (tabela, telas, saída das listas e o "Atualizado em … por …"); a nova necessidade vira uma etapa nova, planejada
  com o cliente.

---

## 12. Proposta de implementação em etapas

| Etapa | Entrega | Banco | Depende de |
|---|---|---|---|
| **A1** | Permissão (área + item + regras de rota), menu, tela com as abas que já são de todos (Aguardando remarcação, Lista de espera, Lembretes), contadores e estados vazios; testes de acesso | Item na matriz (dados) | Q1, Q2, Q4 |
| **A2** | Abas das listas que hoje são só das Métricas (Retomar contato agrupado, Oportunidade agora, Faltosos), com as leituras extraídas para `src/lib/data/`; Atendimento e Contatos para revisar como abas-resumo | Nada | Q3 |
| **A3** | Validação por papel no navegador (local); com o OK do cliente, entrada na `main` e validação no staging (Q13); regressão completa | — | A1, A2 |
| **B0** | **Revista em 28/out (Q14–Q16, seção 17):** sem guardar o texto das conversas; migração 1 (função do Suporte) com o código; migração 2 (apagar o texto guardado, tirar `body` e `retry_payload` da leitura do login) **só depois** do código publicado no mesmo ambiente | 2 migrações, aprovadas em 28/out | Q13–Q16 |
| ~~B1~~ | ~~Linha do tempo do contato~~: **fora do plano** (Q16) | — | — |
| ~~B2~~ | ~~Histórico do paciente~~: **fora do plano** (Q16) | — | — |
| ~~C1–C3~~ | **Desfeitas em 28/out (Q18)**; no lugar, a etapa de anotações, lembretes e documentos do paciente (a planejar) | — | — |
| **C1** | Apresentar o SQL final de `contact_interactions` (e das anotações), testes e reversão, **para aprovação** | Proposta | Q6–Q12 |
| **C2** | Aplicar no local, depois no staging; "Registrar contato" na central e na ficha; registro na linha do tempo; saída da fila pela regra aprovada | Migração | C1 aprovado |
| **C3** | Integração final: central ↔ ficha ↔ Atendimento humano; regressão; staging; preparo da publicação | — | C2 |

Cada etapa termina com: o que mudou, arquivos, testes executados e resultados (unidade, banco, navegador local,
staging; nunca "validado" sem ter rodado), o que falta validar, riscos, e como o cliente valida no staging.
**Produção só com a autorização do cliente, depois do staging** (regras completas na seção 13.5).

**Fora do escopo** (documentado para depois): responsável e prazo por pendência, lembretes de próxima ação,
indicadores de relacionamento (tempo de resposta, conversão dos contatos), motivos de cancelamento pela equipe,
origem do contato, campanhas (base legal, consentimento, saída, frequência) e endurecimento do papel dentro do
banco (R1).

---

## 13. Revisão do plano (pedido do cliente, 27/out)

Feita só no documento: nenhum código funcional, banco, migração, staging ou produção foi tocado. Tudo o que está
abaixo foi conferido no código e nas migrações da branch `CRM`.

### 13.1 Segurança do histórico (texto das conversas)

**O que existe hoje:**

| Caminho | Quem chega ao texto (`whatsapp_messages.body`) | Conferido em |
|---|---|---|
| RLS de `whatsapp_messages` e `conversation_state` (`app.enable_clinic_data_rls`) | `select` para **qualquer membro** da clínica (`app.is_clinic_member`, inclusive o Profissional restrito e o Suporte); `insert` e `update` para os três papéis; `delete` só Administrador. **Sem regra por papel nem por agenda** | `20261004170000_whatsapp_e_rotinas.sql:303`, `20261004140000_pacientes.sql:13` |
| API do Supabase direta | O login do painel fica no cookie do `@supabase/ssr` (`createUserClient`, `src/lib/data/clients.ts`), que por padrão o navegador consegue ler; o endereço e a chave anônima do Supabase são públicos por natureza. Quem tem login pode pedir `/rest/v1/whatsapp_messages?select=body` com o próprio token, **sem passar pelo `middleware.ts`** | `clients.ts`, `env.ts` |
| Telas do painel | `listHumanAttention` (`whatsapp/attention.ts:116`): última mensagem recebida ou da recepção, na tela Atendimento e no Início, **todos os papéis** (mantido pela Q5). `listWhatsappMessages` (`whatsapp/messages.ts:297`): Configurações › WhatsApp, área do Administrador | — |
| Outras leituras pelo login | 20 leituras (`daily.ts`, `sends.ts`, `dashboard.ts`, `agenda/trail.ts`, `whatsapp/reminders.ts`, `preparation.ts`, `guidance.ts`, `retries.ts`, `nfseDelivery.ts`, `agenda/avisar.astro`) leem **só** situação, tipo, datas e ids, nunca o texto | `grep` das chamadas `.from("whatsapp_messages")` |
| Rotas `/api/admin/**` | Nenhuma devolve o texto (são formulários que redirecionam) | — |
| Bot, webhook e rotinas | Papel `clinic_service`, com políticas próprias: não são afetados por mudanças nos privilégios do `authenticated` | `enable_clinic_data_rls` |
| Métricas | Funções `security definer` (rodam como dono): não dependem do privilégio do login e não devolvem o texto | `20261023130000_metricas_acesso_na_entrada.sql` |
| `retry_payload` | Guarda o pedido à Meta para o reenvio, com o texto: mesma exposição do `body` | `20261023140000_reenvio_automatico.sql` |
| `conversation_state.context` | Rascunho do bot (dados digitados no meio do fluxo, como nome e nascimento): mesma exposição; lido pelo login em `whatsapp/conversations.ts` (pausar e devolver ao bot) | `conversations.ts:102` |

**Conclusão:** restringir a rota e o componente **não basta** para cumprir a Q5. O Profissional (e qualquer membro)
consegue ler o texto de todas as conversas da clínica pela API, com o próprio login. O **isolamento entre clínicas
continua garantido** (o RLS por `clinic_id` vale também na API direta). Também pela API, qualquer papel consegue
**alterar** o texto de uma mensagem já gravada (`update` liberado aos três papéis).

**Proteção proposta (etapa B0, em dois passos, SQL final mostrado antes para aprovação):**

1. **Passo 1, aditivo:** funções `security definer` com a conferência na entrada, no padrão das `metrics_*`:
   - `public.attention_last_messages(p_clinic_id, p_phones, p_since)`: **qualquer membro**, só as mensagens
     recebidas e as `agent_reply` dos telefones com pausa em andamento. A tela Atendimento continua igual para todos
     (Q5).
   - `public.contact_message_history(p_clinic_id, p_contact_id, p_before, p_limit)`: **só Administrador, Recepção e
     Suporte** (`app.has_clinic_role` / `app.is_platform_staff`); os outros recebem erro de acesso. Lê
     `contact_id = X` ou (`contact_id` nulo e telefone do contato), no máximo 50 por vez, para a linha do tempo da B1
     e para Configurações › WhatsApp.
   - O código do Atendimento (`attention.ts`) e de Configurações › WhatsApp (`listWhatsappMessages`) passa a usar as
     funções.
2. **Passo 2, só depois que o código do passo 1 estiver no mesmo ambiente:**
   `revoke select on public.whatsapp_messages from authenticated` e `grant select (...)` de **todas as colunas menos
   `body` e `retry_payload`**. As 20 leituras sem texto continuam funcionando sem mudança. O `update` do login fica
   limitado às colunas que o painel atualiza hoje, conferidas na implementação (situação e dados do reenvio); o
   `insert` continua (o painel grava os reenvios e avisos pelo login).
3. **Fica como está:** o RLS das linhas (por clínica), o bot e as rotinas (`clinic_service`), as Métricas e a
   anonimização (que apaga o `body`). `conversation_state.context` **não muda agora** (não guarda conversa, e mexer
   arrisca o "Devolver ao bot"); fica registrado como risco R2, para avaliar na B0.
4. **Reversão:** `grant select on public.whatsapp_messages to authenticated` e `drop function` das duas funções.

### 13.2 Resultado do contato: marcou de fato × enviou o link

**Problema:** o rótulo aprovado de `scheduled` ("Marcou (pela equipe ou vai marcar pelo link)") junta o atendimento
**marcado** com o **envio do link ou a intenção** de marcar. Pela Q8, "Marcou" tira a pessoa de quatro listas. Com
o link enviado e nunca usado, a pessoa sumiria da fila sem ter marcado. Por isso a lista da Q7 precisa de ajuste, a
decidir na **Q10** (a lista aprovada não muda sem a resposta).

**Regra mínima proposta:**

1. **"Marcou" exige o atendimento.** A opção só fica disponível quando o sistema encontra um atendimento **ativo**
   (não cancelado) de um paciente do contato, **criado depois do início da pendência**. Na Oportunidade agora, vale
   o retorno ligado à consulta ou uma consulta futura. O registro guarda esse `appointment_id` (obrigatório para
   `scheduled`, conferido por gatilho no banco). Sem atendimento, a opção aparece desativada com "Ainda não há
   atendimento marcado para este contato".
2. **Envio do link ou intenção** ganha a opção própria **"Enviou o link / vai marcar"** (`link_sent`, Q10). Ela
   **mantém** a pessoa na fila e mostra "link enviado em dd/mm".
3. **A saída por dado real vem primeiro.** Retomar contato (conclusão posterior do mesmo fluxo), Oportunidade agora
   (retorno ligado ou consulta futura) e Aguardando remarcação (`wasRebooked`) **já tiram a pessoa sozinhos** quando
   ela marca. O registro "Marcou" não é necessário para a saída nessas listas; serve de histórico.
4. **Lembretes (Q11):** "Marcou" não se aplica, porque o atendimento já existe. Saída pelas ações atuais (Confirmar
   presença, Remarcar, Cancelar) e por "Não quer marcar agora" e "Número errado".
5. **Nada sai por inferência:** "Pediu para falar depois", "Não respondeu", "Outro" e "Enviou o link" só registram a
   tentativa.

### 13.3 Observações do paciente (`patients.notes`)

**Como funciona hoje (reaproveitado):** RLS de `patients` pelo `enable_clinic_data_rls`. **Lê:** qualquer membro da
clínica (inclusive o Profissional restrito, que vê todos os pacientes, e o Suporte). **Edita:** Administrador,
Recepção e Profissional. O bot (`clinic_service`) lê, mas não usa as observações. Tela: ficha do paciente
(`pacientes/[id].astro`, "Só a equipe vê"). Gravação: `createPatient` e `updatePatient` (`data/patients.ts`), pela
rota `/api/admin/pacientes/[id]`. **O mesmo formulário grava nome, nascimento e observações juntos.** A
anonimização apaga (`notes = null`), e as gravações do Suporte já ficam na auditoria (`audit_platform_staff_write`).

**Perfis (proposta, Q12):** **como hoje**. Administrador, Recepção e Profissional leem e editam; o Suporte também,
com auditoria. Assim não há regressão de acesso. Alternativa, se o cliente preferir: só Administrador e Recepção
editam, com o Profissional só lendo (`update` com regra por papel, mais um teste).

**Gravação de `notes_updated_at` e `notes_updated_by` (migração da etapa C):**

- Duas colunas novas em `patients`, ambas aceitando nulo (os pacientes existentes ficam "sem registro de edição").
- Gatilho `before insert or update of notes`. Ele grava **só quando `new.notes is distinct from old.notes`**, porque
  o formulário regrava as observações ao mudar só o nome; sem essa comparação, o "atualizado por" ficaria errado.
  `notes_updated_at = now()`, `notes_updated_by = auth.uid()` (nulo quando quem grava é o `clinic_service`). O valor
  enviado pela tela ou pela API é **sempre substituído** pelo gatilho, então ninguém escolhe o autor. Apagar a
  observação também registra quem apagou.
- Exibição: "Atualizado em dd/mm/aaaa às hh:mm por Nome (Papel)", com o `clinic_actor_labels` já usado na Trilha
  (inclusive "Suporte RecepClinic (nome)"). Conferir na implementação como aparece quem já saiu da clínica.
- A anonimização zera também as duas colunas (teste em `anonimizacao.test.ts`).

**Proteção:** o isolamento por clínica é o do RLS atual, inclusive pela API direta. O texto não vai para logs (regra
da F9), Métricas, bot, mensagens nem para a central: a central mostra só um link para a ficha. Testes: outra clínica
não lê nem grava; autor forçado é ignorado; editar só o nome não muda o "atualizado"; anonimização; Suporte
auditado.

### 13.4 Critérios de teste de desempenho e consistência

| Tema | Critério (teste) |
|---|---|
| **Contadores** | O contador da aba, do menu e do Início é **igual ao número de linhas da aba** com o mesmo filtro (teste com 0, 1, no limite e acima do limite). Acima do limite de leitura (Retomar contato 50, Aguardando 200), mostra "mais de N", **nunca um número menor** que o real. A soma do menu é a soma das abas que a pessoa acessa (item e papel) |
| **Agrupamento** | 3 tentativas do mesmo telefone e fluxo = **1 linha** ("3 tentativas", a mais recente). Mesmo telefone em fluxos diferentes = 2 linhas. Tentativa concluída depois sai. Tentativa fora dos 14 dias não conta. Telefone sem cadastro aparece pelo telefone. Contato com dois pacientes não duplica. Anonimizado não mostra dado pessoal. Registro (etapa C) só esconde as tentativas iniciadas antes dele |
| **Carregamento das abas** | Só a aba aberta carrega a lista; as outras só contam. Os nomes são lidos em lote (`in (...)`), sem uma consulta por linha (contagem de consultas no teste de unidade). Meta proposta: a página responde em **até 1,5 s no staging** com o volume de teste (≈500 atendimentos no mês, 2.000 mensagens e 300 tentativas no bot), medido e registrado. Resumo do Dia e Métricas sem piora medida antes e depois |
| **Isolamento por clínica** | Em cada aba, contador e ação: a clínica A não vê nem age em nada da B (banco e rota) |
| **Isolamento por papel e item** | Profissional sem a rota (redirecionamento na página, 403 na API), mesmo com o item; Recepção sem nenhuma rota das Métricas; item da clínica desligado esconde a aba e bloqueia a rota da aba; a central nunca contorna a regra de papel das ações (Desistiu, Tirar da lista, Revisado, Devolver ao bot) |
| **Isolamento por agenda** | As listas por agenda continuam respeitando `app.can_access_agenda` (teste com Profissional restrito pelas funções, porque a regra do banco vale mesmo fora da tela) |
| **Texto das mensagens (B0)** | Pela API direta, com o login de cada papel: Profissional e Profissional restrito **não leem** `body` nem `retry_payload`; a função do histórico nega o Profissional, aceita Administrador, Recepção e Suporte e nega outra clínica; a tela Atendimento continua para todos; o bot e o webhook gravam e leem como antes (`webhook-whatsapp.test.ts`); Métricas inalteradas |
| **Falha isolada** | Uma fonte que falha (função com erro simulado) mostra "Não foi possível carregar esta lista" **só na aba dela**, e o contador mostra "—" (nunca 0). As outras abas, o menu e a página continuam. O erro vai para Administração › Erros sem dado pessoal |
| **Consistência com as listas originais** | Para o mesmo período, a lista da central é igual à do Resumo ou das Métricas (teste comparando as saídas) |
| **Ações repetidas** | Ação feita em outra aba ou repetida (envio duplo) não duplica o registro; ao voltar, a lista já mostra o novo estado |

### 13.5 Produção e ambientes

- Cada etapa termina com **unidade, banco e navegador no local**, depois o **staging**. Nada é "validado" sem ter
  rodado.
- **Nenhuma migração é executada na produção e nenhuma versão é publicada sem autorização explícita do cliente**,
  dada para aquela publicação, pelo fluxo de `docs/producao.md`. Aprovar o plano ou uma etapa não autoriza a
  produção.
- **Staging:** a ordem de sempre (simulação → aplicar → conferir no banco → só então o push). O staging é o mesmo
  banco que a `main` usa. Por isso a proposta (Q13) é o CRM ir ao staging **só pela `main`**, com o OK do cliente.
  Uma migração aplicada a partir da `CRM` deixaria o histórico do staging com uma versão que a `main` não tem, e o
  próximo `supabase db push` da `main` acusaria o erro.
- **B0 em dois passos** em todo ambiente: o passo 2 (tirar o texto da leitura direta) só depois do código que usa as
  funções estar publicado no mesmo ambiente. Senão a tela Atendimento e Configurações › WhatsApp quebram.

### 13.6 Riscos ainda não resolvidos

| Risco | Situação |
|---|---|
| **R1** Papel dentro do banco: qualquer membro chama as `metrics_*` e lê os metadados das mensagens, a conversa e o funil pela API (sem texto, depois da B0) | Recomendação futura; não piora com o plano |
| **R2** `conversation_state.context` com dados digitados no bot, legível por qualquer membro pela API | A avaliar na B0 sem quebrar o "Devolver ao bot" |
| **R3** Cookie do login legível pelo navegador (padrão do `@supabase/ssr`): qualquer script na página teria o token | Mitigado pela CSP da F9; mudar para `httpOnly` é outra etapa, com teste do login |
| **R4** Tela Atendimento mostra a última mensagem a todos os papéis, inclusive o Profissional | Decisão da Q5; mantido salvo pedido do cliente |
| **R5** Lista da Q7 e saída da Q8 com "Marcou" ambíguo | **Resolvido** pela Q10 e pela Q11 (27/out) |
| **R6** Perfis das Observações | **Resolvido** pela Q12 (27/out): como hoje |
| **R7** Como validar no staging sem a `main` | **Resolvido** pela Q13 (27/out): staging só pela `main`, com o OK do cliente. Consequência: a A3 e as validações por etapa no staging acontecem depois de cada entrada aprovada na `main` |
| **R8** Meta de 1,5 s sem medida atual | Medir a linha de base do Resumo e das Métricas no staging antes da A1 |
| **R9** Edição das Observações sem histórico: só a última edição fica registrada (as anteriores se perdem) | Fora do escopo; as anotações datadas ficam nos registros de interação (Q6) |

---

## 14. A1 implementada (27/out, só no local)

**O que mudou:**

| Parte | Arquivos |
|---|---|
| Migração aprovada (item `relationship`, área `relationship`, ordem 190, nenhuma clínica recebe) | `supabase/migrations/20261028120000_relacionamento_matriz.sql` (aplicada **só no banco local**, com `migration up --local`) |
| Item, área e regras das abas (Lembretes exige `reminders`; Lista de espera, `waitlist`) | `src/lib/features.ts` |
| Área do painel: Administrador e Recepção, com o item; o Profissional não; Métricas continuam fechadas para a Recepção | `src/lib/clinicAccess.ts` |
| "Voltar" e ações voltam ao Relacionamento | `src/lib/returnPath.ts` |
| Matriz: o item aparece em "Fora da tabela de preços", como o Financeiro (a tela agrupa pela venda, não pela área) | `src/lib/plans.ts`, `src/lib/ajuda/sistema.ts` |
| Listas e contadores (as mesmas funções do Resumo; contador = linhas; falha isolada vira "!", nunca 0) | `src/lib/data/relationship.ts` |
| Tela e aba de lembretes pendentes; ajuda contextual | `src/pages/admin/relacionamento.astro`, `src/components/admin/relacionamento/LembretesPendentesTab.astro`, `src/lib/ajuda/relacionamento.ts` |
| Abas do Resumo reaproveitadas com a volta configurável (no Resumo, igual); o "Remarcar" do Aguardando passa a levar a volta | `src/components/admin/resumo/AguardandoTab.astro`, `ListaEsperaTab.astro` |
| Menu "Relacionamento" com o total, ao lado do Atendimento (no celular, no "Mais") | `src/layouts/AdminLayout.astro`, `src/env.d.ts` |

**Escolhas da implementação, a confirmar na validação:**
1. **Total do menu** = Aguardando remarcação + Lembretes. A Lista de espera mostra o número na aba (azul, informativo,
   como no Resumo), mas não soma no menu, porque quem espera vaga não pede contato.
2. **Abertura:** sem aba no endereço, abre a primeira com algum número (inclusive a Lista de espera).
3. **Lembretes:** lembretes enviados nos últimos 7 dias; entram os atendimentos por vir com o sinal "Reenviar
   lembrete" (não entregue) ou "Reenviar (sem resposta)" do cartão da Agenda (sem resposta há mais de 2 horas). O
   reenvio e o "Confirmar presença" continuam na Agenda ("Abrir na Agenda").

**Defeito anterior achado e corrigido (na `CRM`):** desde a F8.5a, o menu espera o contador do Atendimento antes de
montar a tela; depois dessa espera o cookie do aviso não era apagado, e o aviso de uma ação aparecia de novo na tela
seguinte, em toda clínica com o bot (conferido no local: com o bot desligado, não acontecia). O menu agora lê o aviso
antes das esperas (`pageFlash` no início do `AdminLayout`). Conferido em Resumo, Agenda, Pacientes, Relacionamento,
Atendimento e Início. **A produção tem o defeito** (publicação `af0902d`). **Decisão do cliente (27/out):** a correção vai à `main` só junto com o CRM.

**Testes:** unidade 703 (691 + 12: `relationship.test.ts`, acesso, rotas, volta, planos e matriz); banco 642 (636 + 6:
`tests/db/relacionamento.test.ts`: lembretes não entregues e sem resposta, saída ao confirmar ou cancelar, sem o item,
outra clínica, mesma lista do Resumo, contador = linhas); `astro check` sem erros. Navegador local (computador e
390px): Recepção (3 abas, contadores, "Desistiu" com confirmação e volta, menu atualizado), Recepção restrita (só as
agendas dela), Administrador, Profissional (sem menu; a rota volta ao Início com acesso negado). Os dados de teste
criados no banco local foram desfeitos; ficou só o item liberado para a Clínica Exemplo Saúde.

**Não testado:** staging (Q13: só pela `main`, com o OK do cliente); falha real de uma fonte no navegador (só no
teste de unidade); volume grande (meta de 1,5 s, R8).

---

## 15. A2 implementada (27/out, só no local)

**Validação da A1:** aprovada pelo cliente em 27/out, com as 3 escolhas da seção 14.

**Abas novas** (ordem da seção 8): Atendimento, Retomar contato, Retorno, Lembretes, Aguardando remarcação, Faltosos,
Lista de espera, Contatos para revisar.

| Aba | Fonte (a mesma de antes) | Item exigido | Ação |
|---|---|---|---|
| Atendimento | `listHumanAttention` (resumo: aguardando e há quanto tempo, em atendimento; **sem o texto das mensagens**) | `whatsapp_bot` | "Abrir Atendimento" |
| Retomar contato | `listFunnelSessions` + `buildFunnelReportFromSessions(...).incomplete`, **últimos 14 dias** (Q3), agrupado por telefone e fluxo (`groupRecall`) | `whatsapp_bot` | Nome abre o contato |
| Retorno | `listReturnOpportunities` (a Oportunidade agora das Métricas), nas agendas que o login vê | só o da central | "Marcar retorno" (Marcar com o paciente e a agenda; "Voltar" para a aba) |
| Faltosos | `listFrequentNoShows`, nas agendas que o login vê | só o da central | Nome abre a ficha |
| Contatos para revisar | `listContactsToReview` | `whatsapp_bot` | "Revisado" (com confirmação; volta para a aba) |

**Mudanças de apoio:** `src/lib/data/people.ts` (nomes lidos em lote; as Métricas passaram a usar, sem mudar a tela,
achado 2 da seção 3); `src/lib/data/relationship.ts` (abas, agrupamento, contadores, `MENU_TABS`); a rota do contato
aceita `return_to` no "Revisado" (o do Início continua voltando ao Início); `src/lib/features.ts` (Atendimento, Retomar
contato e Revisar exigem o bot).

**Total do menu (cliente, 27/out):** Aguardando remarcação + Lembretes + Retomar contato + Retorno + Contatos para
revisar. Ficam fora os Faltosos (lista permanente até o registro da etapa C), o Atendimento (já tem o próprio número
no menu) e a Lista de espera. Na aba Atendimento, o contador é o das conversas que aguardam a clínica (como o número do
menu Atendimento).

**Testes:** unidade 714 (abas por item, agrupamento do Retomar contato, total do menu, contador do Atendimento, regras
de rota, falha isolada); banco 644 (Retorno e Faltosos iguais às funções das Métricas, com nome e WhatsApp, lidos pela
Recepção; todas as 8 abas sem erro; outra clínica conta zero em todas); `astro check` sem erros. Navegador local:
Recepção nas 8 abas (vazias e com dados temporários de Retorno e Faltosos), "Marcar retorno" com o "Voltar", "Revisado"
com aviso uma vez só e o menu atualizado, celular (390px) sem rolagem lateral, Profissional barrado nas abas novas;
Métricas (Desempenho, Retomar contato e Faltosos) continuam iguais com a leitura extraída. Dados temporários desfeitos
(inclusive o contador de uso da clínica); ficou só o horário de "atualizado em" de um contato do banco local.

**Observações:**
- No computador, as 8 abas não cabem numa linha a 1280px e a barra rola de lado, como o componente de abas já faz.
- Retomar contato **não foi visto com dados no navegador** (o banco local não tem tentativas abandonadas); a regra é a
  das Métricas, coberta pelos testes do funil, e o agrupamento pelos testes de unidade.
- A tela lê as 8 listas a cada abertura (os contadores são o tamanho das listas) e o menu lê 5 em cada página. Medir no
  staging (R8).

---

## 16. A3: regressão e validação por papel (27/out, só no local)

**Validação da A2:** aprovada pelo cliente em 27/out.

**Regressão completa no local:** unidade 714 passando; banco 644 passando; `astro check` sem erros; `npm run build`
completo.

**Validação por papel no navegador (local):**

| Login | Relacionamento | Métricas | Resumo do Dia |
|---|---|---|---|
| Administrador (Exemplo Saúde) | Menu e as 8 abas | Abre | As 7 abas de sempre |
| Recepção (todas as agendas) | Menu e as 8 abas | Barrada (acesso negado) | As 7 abas de sempre |
| Recepção restrita (psicóloga e fisioterapia) | Menu e as 8 abas; Lista de espera sem número (é de outra agenda); Atendimento e Revisar são da clínica toda, como na tela Atendimento | Barrada | As 7 abas de sempre |
| Profissionais (pediatra, psicóloga) | Sem menu; a rota volta ao Início com acesso negado | Métricas pessoais, como antes | As 7 abas de sempre |
| Clínica Odonto (item não liberado): Administrador + Profissional e Recepção | Sem menu; rota barrada | Como antes | As 7 abas de sempre |
| Suporte | Matriz mostra "Relacionamento (central de pendências)" em "Fora da tabela de preços", desmarcado na Odonto | — | — |

O "Revisado" do Início continua voltando ao Início (`voltar=painel`), e o "Tirar da lista" do Resumo continua voltando
ao Resumo.

**Staging (conferido só com leitura, `migration list`):** todas as migrações em dia; falta só a
`20261028120000_relacionamento_matriz.sql`. A `main` não andou desde a criação da `CRM` (`eca4b79`), então a entrada
é um avanço direto, sem conflito.

**Próximo passo, só com o OK do cliente (Q13):** levar a `CRM` à `main`; no staging, simulação do `db push` → aplicar
→ conferir o item no banco → push da `main` (a Vercel publica o staging). Junto vai a correção do aviso que
reaparecia (decisão do cliente). Nenhuma clínica do staging recebe o item pela migração: o Suporte libera na Matriz.
**Produção: nada**, só com autorização explícita depois do staging.

---

## 17. B0 revista e implementada (28/out, só no local)

**Como chegou aqui:** o passo 1 da seção 13.1 (funções `attention_last_messages` e `contact_message_history`) foi
aprovado, implementado e testado no local. Em seguida o cliente decidiu (Q14–Q16, D12) que o RecepClinic **não
guarda** o texto das conversas, porque elas ficam no app do WhatsApp; B1 e B2 saíram do plano. O passo 1 foi
desfeito no banco local (as funções apagadas e a linha da migração tirada) e substituído pelo que está abaixo, com o
OK do cliente. Nada foi ao staging.

**Migração 1, `20261028140000_mensagens_suporte.sql`:** `public.support_latest_messages(p_clinic_id, p_limit)`,
`security definer`, só o Suporte (os outros: erro `42501`), no máximo 50. Reversão: `drop function`.

**Migração 2, `20261028150000_mensagens_sem_texto.sql`** (só depois do código publicado no mesmo ambiente): apaga o
`body` das mensagens recebidas e das `agent_reply` (sem volta); `revoke select, update` de `anon` e
`authenticated`; `grant select` de todas as colunas menos `body` e `retry_payload`; `grant update` só de `status`,
`message_type`, `appointment_id`, `retry_at`, `retry_payload` e `failure_code`/`failure_reason`. O `insert` do login,
o bot e as rotinas (`clinic_service`), a anonimização e as Métricas não mudam. Reversão: `grant select, update on
public.whatsapp_messages to anon, authenticated` (o texto apagado não volta).

**Código:** o webhook grava `body` nulo nas mensagens recebidas e nos ecos da recepção (`whatsapp/messages.ts`; o
`#bot` continua lido da mensagem que chega); `listHumanAttention` lê sem o texto e o item perdeu a última mensagem; a
tela Atendimento e a notificação ficam sem a frase do paciente; Configurações › WhatsApp usa
`listLatestWhatsappMessages` (a função do Suporte). Tipos do banco regerados.

**Testes:** unidade 714 passando; banco 649 passando (5 novos em `tests/db/mensagens-sem-texto.test.ts`: o que é
gravado, leitura e alteração por coluna para Administrador, Recepção e Profissional, `anon` sem acesso, últimas
mensagens só do Suporte; ajustados `acesso-whatsapp`, `atendimento-humano`, `webhook-whatsapp` e o teste da
notificação); `astro check` sem erros. No banco local, a migração 2 apagou o texto de 4 mensagens recebidas e 1
resposta da recepção (conferido antes e depois). Navegador local: a conferir pelo cliente.

**Ordem no staging (depois do OK do cliente, pela `main`):** migração 1 → push da `main` (código publicado) →
conferir → migração 2 (simulação → aplicar → conferir). Na produção, a migração 2 apaga para sempre as frases já
guardadas.

**Staging (28/out, com o OK do cliente depois da validação no local):** `CRM` → `main` por avanço direto
(`51dc07a`). Migração 1 sozinha (simulação → aplicar; a função existe e recusa quem não tem login) → push da `main`
(Vercel do staging publicada; no projeto da produção, só a *preview*, porque a produção segue a branch `producao`) →
contagem antes da migração 2 (385 recebidas e 15 respostas da recepção com texto; 609 enviadas pelo sistema) →
migração 2 (simulação → aplicar) → conferido: 0 recebidas e 0 respostas com texto, as 609 enviadas intactas; com o
login, `body` e `retry_payload` dão 403 (42501) e as outras colunas leem; sem login, nada. **Produção: nada.**

---

## 18. C2 desfeita (28/out, Q18)

A C1 foi aprovada e a C2 (registro do resultado do contato, com a tabela `contact_interactions`, "Registrar contato"
nas abas e na ficha, saída das listas e "Atualizado em … por …" nas Observações) foi implementada e testada só no
local (commit `0a7e8eb`, na `CRM`). Ao ver o resultado, o cliente decidiu tirar tudo (Q18). Desfeita pelo commit de
reversão: o código volta ao da B0; a migração `20261029120000` foi apagada do banco local (as funções, a tabela, as
colunas e a linha do histórico) e o arquivo saiu. Fica só o seed com a mensagem recebida sem texto (D12). Nada foi
à `main`, ao staging ou à produção.

**Aprendizado registrado:** antes de implementar uma etapa planejada, confirmar com o cliente, em linguagem simples e
com o exemplo de uso, se ela resolve a necessidade do dia a dia.

---

## 19. Etapa nova: anotações, lembretes e documentos do paciente (planejamento, 28/out)

**Objetivo (cliente, Q18):** a secretária guarda na ficha do paciente o que precisa ter à mão (anotações, lembretes e
documentos em foto ou PDF) e encontra rápido para encaminhar ao plano de saúde. Reaproveita o Storage privado do
Supabase, já usado no XML das notas fiscais.

**Decisões do cliente (28/out):**

- **Q19. Documentos, quem:** a equipe toda vê (Administrador, Recepção e Profissional; o profissional pode precisar do
  pedido médico); só Administrador e Recepção anexam e apagam; Suporte com auditoria.
- **Q20. Anotações × Observações:** **só anotações datadas** (com data e autor). O texto atual das Observações vira a
  primeira anotação de cada paciente e o campo único deixa de existir. Escrevem os mesmos papéis de hoje
  (Administrador, Recepção e Profissional, Q12).
- **Q21. Corrigir ou apagar:** quem escreveu corrige (aparece "editada em …"); só o Administrador apaga.
- **Q22. Lembretes:** aba nova **"Lembretes da equipe"** na central Relacionamento, com os do dia e os atrasados,
  somando no número do menu; some ao marcar "Feito"; aparece também na ficha do paciente.
- **Q23. Arquivos:** JPG, PNG, HEIC (foto do iPhone) e PDF, até 10 MB cada, enviados direto do aparelho ao
  armazenamento privado (o limite de 4,5 MB das funções da Vercel não se aplica).
- **Q24. Encaminhar ao plano:** "Baixar" (computador) e "Compartilhar" (menu do celular: WhatsApp, e-mail), com
  seleção de vários documentos; nenhum link público. Os links para abrir valem poucos minutos.

**Regras de sempre:** isolamento por clínica (RLS e caminho do arquivo por clínica), arquivos fora de logs e Métricas,
anonimização apaga anotações, lembretes e arquivos; cada etapa com o SQL mostrado antes, testes, local → staging pela
`main` com o OK do cliente; produção só com autorização.

**Ordem (cliente, 28/out):** P1 Documentos → P2 Anotações → P3 Lembretes.

### 19.1 P1 Documentos implementada (28/out, só no local)

**SQL aprovado pelo cliente em 28/out.** Migração `20261029120000_documentos_do_paciente.sql` (aplicada só no local):
armazenamento privado `patient-documents` (10 MB; JPG, PNG, HEIC/HEIF e PDF), tabela `patient_documents` (tipo,
descrição até 120, caminho `<clínica>/<paciente>/<documento>.<ext>`, nome, tipo e tamanho lidos do arquivo pelo
gatilho, autor e hora pelo banco), RLS (lê quem é da clínica; anexa e apaga Administrador e Recepção; sem `update`;
bot sem acesso), as mesmas regras nos arquivos pela pasta da clínica (`app.storage_folder_clinic`), auditoria do
Suporte e o gatilho da anonimização (apaga as linhas; o código apaga os arquivos com os caminhos lidos antes; arquivo
que não sai vai para Administração › Erros).

**Código:** `src/lib/data/patientDocuments.ts`; rotas `/api/admin/pacientes/[id]/documentos` (preparar e confirmar em
JSON; apagar por formulário com confirmação) e `/api/admin/pacientes/[id]/documentos/[documento]` (link de 2 minutos
para abrir ou baixar); cartão "Documentos" na ficha (Anexar, Abrir, Baixar, Apagar, seleção com "Baixar selecionados"
e "Compartilhar" quando o aparelho aceita arquivos); a ficha libera o endereço do Supabase no `connect-src` da CSP;
`anonymizePatient` apaga os arquivos.

**Testes:** unidade 717 passando (3 novos); banco 657 passando (8 novos em `tests/db/documentos-do-paciente.test.ts`,
com o armazenamento de verdade: quem anexa, vê, abre e apaga; outra clínica; tipo e tamanho; caminho de outro
paciente; anonimização; auditoria); `patient_documents` fora da varredura de dados do seed (o seed em SQL não envia
arquivos; motivo em `isolamento.test.ts`); `astro check` sem erros; `npm run build` completo. Navegador local
(Recepção, ficha da Ana Souza): anexou um PDF, abriu (200, `application/pdf`) e apagou com confirmação (linha e
arquivo saíram). **Não conferido:** a CSP (o `npm run dev` não a aplica; conferir primeiro no staging), "Baixar
selecionados" e "Compartilhar" (este só no celular), foto pelo celular.

