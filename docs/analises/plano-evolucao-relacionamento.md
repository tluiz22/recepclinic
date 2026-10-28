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
     clínica lê.
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
- **Banco:** nada.
- **Permissão:** depende da Q5 (quem lê o texto das conversas). A restrição, se houver, fica na aplicação (rota e
  componente), porque mudar o RLS de `whatsapp_messages` afetaria o bot, o Atendimento e as Métricas.

### Etapa C: Anotações e registro do resultado do contato (com banco)

**Anotações gerais do paciente:** reusar `patients.notes`, que já existe. Proposta mínima (Q6): mostrar
"Atualizado em … por …" exige duas colunas novas (`notes_updated_at`, `notes_updated_by`), ou o próprio registro de
interação "Anotação" na tabela abaixo. A recomendação é a primeira, mais simples, e a anotação **do contato**
ficar para depois, se o cliente pedir.

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

### 7.1 Migrações previstas (nenhuma criada ainda)

| Etapa | Migração | Tipo | Risco |
|---|---|---|---|
| A | Inserir o item `relationship` em `public.features` (como as migrações de `20261005120000_matriz_de_acesso.sql` em diante); conferir se a coluna `area` aceita um grupo novo ou se o item entra num grupo existente da matriz (hoje: Agenda, WhatsApp, Métricas, Financeiro) | Dados, aditiva | Baixo. Reversão: apagar a linha e as liberações em `clinic_features` |
| C | `contact_interactions` + RLS + gatilhos + anonimização; opcionalmente `patients.notes_updated_*` | Esquema, aditiva | Médio (anonimização e RLS precisam de teste). Reversão: `drop` |

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
| Expor texto de conversa a quem não deveria | Etapa B | Q5 antes; restrição na rota e no componente; teste com cada papel |
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
- regressão: os testes atuais inteiros a cada etapa (agendamento, cancelamento, remarcação, atendimento humano).

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

---

## 12. Proposta de implementação em etapas

| Etapa | Entrega | Banco | Depende de |
|---|---|---|---|
| **A1** | Permissão (área + item + regras de rota), menu, tela com as abas que já são de todos (Aguardando remarcação, Lista de espera, Lembretes), contadores e estados vazios; testes de acesso | Item na matriz (dados) | Q1, Q2, Q4 |
| **A2** | Abas das listas que hoje são só das Métricas (Retomar contato agrupado, Oportunidade agora, Faltosos), com as leituras extraídas para `src/lib/data/`; Atendimento e Contatos para revisar como abas-resumo | Nada | Q3 |
| **A3** | Validação por papel no navegador (local) e no staging; regressão completa | — | A1, A2 |
| **B1** | Linha do tempo do contato (mensagens, bot, passagens, atendimentos dos pacientes) com paginação | Nada | Q5 |
| **B2** | Histórico do paciente (atendimentos, trilha, mensagens dos atendimentos) + link para as conversas do contato | Nada | B1 |
| **C1** | Apresentar o SQL final de `contact_interactions` (e das anotações), testes e reversão, **para aprovação** | Proposta | Q6–Q9 |
| **C2** | Aplicar no local, depois no staging; "Registrar contato" na central e na ficha; registro na linha do tempo; saída da fila pela regra aprovada | Migração | C1 aprovado |
| **C3** | Integração final: central ↔ ficha ↔ Atendimento humano; regressão; staging; preparo da publicação | — | C2 |

Cada etapa termina com: o que mudou, arquivos, testes executados e resultados (unidade, banco, navegador local,
staging; nunca "validado" sem ter rodado), o que falta validar, riscos, e como o cliente valida no staging.
**Produção só com a autorização do cliente, depois do staging.**

**Fora do escopo** (documentado para depois): responsável e prazo por pendência, lembretes de próxima ação,
indicadores de relacionamento (tempo de resposta, conversão dos contatos), motivos de cancelamento pela equipe,
origem do contato, campanhas (base legal, consentimento, saída, frequência) e endurecimento do papel dentro do
banco (R1).
