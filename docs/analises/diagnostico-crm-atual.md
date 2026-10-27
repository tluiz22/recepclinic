# Diagnóstico do CRM atual do RecepClinic

> **CRM.0, 27/out/2026, branch `CRM`.** Só investigação e documentação: nenhum código, banco ou migração foi
> alterado. Base: o código da branch `CRM` (igual à `main` em `eca4b79`), as migrações em `supabase/migrations/`, os
> testes em `tests/db/` e `src/**/*.test.ts` e a documentação em `docs/`. Sem dados reais de pacientes, segredos ou
> valores de variáveis de ambiente.
>
> **Como ler a "situação"** (critério pedido pelo cliente):
> - **Funcional**: tela + regra + gravação no banco com evidência no código e teste automatizado, e registrada como
>   validada pelo cliente no staging (docs). O uso real em produção **não** foi verificado aqui.
> - **Parcial**: funciona, mas falta parte do que o nome promete (ex.: lista sem ação de acompanhamento).
> - **Interface sem fluxo comprovado**, **Só infraestrutura**, **Não encontrada**, **Não verificável**: como no pedido.

---

## 1. Resumo executivo

1. **O RecepClinic já tem boa parte de um CRM operacional, mas com outros nomes e espalhada em seis lugares**:
   Início, Atendimento humano, Resumo do Dia (7 abas), ficha do paciente e do contato, trilha do atendimento e
   Métricas (Retomar contato, Faltosos, Oportunidade de retorno).
2. **Os dados são mais ricos do que as telas mostram.** Toda mensagem do WhatsApp, recebida e enviada (bot,
   templates e as respostas da recepção pelo app, na coexistência), fica gravada com texto, telefone, contato e
   atendimento (`whatsapp_messages`). Cada tentativa no bot fica registrada passo a passo (`bot_funnel_events`) e
   cada ação no atendimento fica na trilha (`appointment_events`). **Não há tela que mostre a conversa ou o
   histórico de interações do paciente**: a função existe (`listWhatsappMessages`, filtro por contato) e hoje só é
   usada pelo Suporte, para as 10 últimas mensagens da clínica.
3. **A maior lacuna é de visibilidade, não de dados.** As listas de relacionamento mais úteis ficam nas
   **Métricas**, que a **Recepção não acessa** (área `metrics`: só Administrador e Profissional, e as duas abas do
   bot só para quem vê a clínica toda): **Retomar contato** (quem começou no bot e não concluiu), **Oportunidade
   agora** (retornos ainda dentro do prazo e não marcados) e **Faltosos**.
4. **As lacunas reais (que pedem banco e regra nova) são poucas e claras:** não existe **registro de
   acompanhamento** (tentativa de contato, resultado, próxima ação, prazo, responsável) nem **motivo de
   desistência ou perda** informado pela equipe. Também não existe **histórico das passagens para a clínica**:
   `conversation_state` guarda só o estado atual, e o "Devolver ao bot" não registra quem nem quando. **Origem do
   contato** existe só como canal (painel, WhatsApp, link), sem "como conheceu a clínica".
5. **"Resumo do Dia" já não é um resumo do dia.** Das 7 abas, só 2 são de um dia (Resumo do dia e Lembretes). As
   outras são filas permanentes (Aguardando remarcação, A registrar, Lista de espera), um histórico (Registradas) e
   uma visão técnica (Envios). O nome também colide com o "**Lembrete à equipe / ao profissional (resumo do dia)**",
   a mensagem de WhatsApp com a lista do dia.
6. **Recomendação (a decidir com o cliente):** a **alternativa 3**, com o Resumo do Dia como visão do dia e da
   operação e uma área **"Relacionamento"** operacional que **reúne as filas que já existem**, antes de criar dado
   novo. Depois, em etapas: histórico unificado (só leitura, com o que já está gravado), registro de acompanhamento
   e motivos, e só no fim indicadores e qualquer coisa comercial.

---

## 2. Inventário das funcionalidades existentes

Tabela pedida (classificação na seção acima). "Recepção vê?" aparece na coluna de lacuna quando é o ponto principal.

| Funcionalidade | Situação atual | Evidência no código | Local no sistema | Lacuna identificada | Recomendação |
|---|---|---|---|---|---|
| Cadastro de paciente e de quem fala com a clínica (contato) | Funcional | `src/lib/data/patients.ts` (`registerPatient`, `updatePatient`, `updateContact`); `tests/db/pacientes*.test.ts` | Pacientes › Novo, ficha do paciente e do contato | Sem e-mail, sem preferência de contato | Manter; nada a criar para o CRM inicial |
| Identificação pelo telefone (um contato por número na clínica) | Funcional | `unique (clinic_id, phone)` em `20261004140000_pacientes.sql`; `contactIdByPhone` em `whatsapp/messages.ts` | Bot, painel e webhook | — | Base do histórico unificado (chave telefone/contato) |
| Aviso de paciente possivelmente duplicado | Funcional (painel) | `registerPatient` (`possible_duplicate`: mesmo contato e nascimento), `patients.ts:458` | Pacientes › Novo, Marcar | No bot existe `duplicateCheck` em `bot/booking.ts`; a regra exata do bot não foi auditada | Ver item 12 (limitações) |
| Busca de paciente (nome, telefone, nascimento) e desativados | Funcional | `src/lib/patientSearch.ts`, `listPatientsPage`, `listContactsPage` | Pacientes (abas Pacientes e Contatos) | Sem filtro por situação de relacionamento | Filtros novos só se a área Relacionamento não bastar |
| Observações do paciente ("só a equipe vê") | Funcional | `patients.notes`; `pacientes/[id].astro` (cartão Dados) | Ficha do paciente | Texto livre único, sem data, autor ou histórico; o contato não tem observação | Não reaproveitar como "anotação de contato"; ver CRM.3 |
| Histórico de consultas e exames do paciente | Funcional | `listPatientAppointments` (`agenda/view.ts:173`); abas "Próximos" e "Anteriores e cancelados" | Ficha do paciente | Só atendimentos; não mostra mensagens, tentativas no bot nem passagens para a clínica | Base da linha do tempo (CRM.2) |
| Trilha do atendimento (quem fez o quê, por qual canal; mensagens e entrega) | Funcional | `appointment_events` + `whatsapp_messages` em `listTrail` (`agenda/trail.ts:143`); `agenda/trilha/[id].astro` | Agenda › Trilha; ficha › Trilha | Por atendimento, não por paciente | Reaproveitar `describeTrail` na linha do tempo do paciente |
| Selo de quem falta com frequência | Funcional | `listNoShowStats`, `isFrequentNoShow` (`agenda/view.ts`) | Cartões da Agenda e do Resumo | — | Reaproveitar |
| Faltosos (lista) | Funcional | `listFrequentNoShows` (`data/metrics.ts:75`); aba `faltosos` em `admin/metricas.astro` | Métricas › Faltosos | **Recepção não vê** (área Métricas) | Levar à área Relacionamento como fila (CRM.1) |
| Histórico das mensagens do WhatsApp por contato | Só infraestrutura | `whatsapp_messages` (texto, direção, tipo, contato, atendimento); `listWhatsappMessages(..., { contactId })` (`whatsapp/messages.ts:297`) usada só em `configuracoes/whatsapp.astro`, pelo Suporte | Nenhuma tela da clínica | **Não há visão da conversa** do paciente no painel | CRM.2: linha do tempo (só leitura) |
| Conversas pedindo a clínica (atendimento humano) | Funcional | `listHumanAttention`, `classifyAttention` (`whatsapp/attention.ts`); `admin/atendimento.astro`; `tests/db/atendimento-humano.test.ts` | Atendimento (menu, com contador); faixa no Início | Sem responsável, sem anotação, sem registro do fim (quem devolveu e quando) | Fila nº 1 da área Relacionamento; histórico do fim em CRM.3 |
| Motivo da passagem para a clínica | Funcional | `conversation_state.handoff_reason` (5 motivos, `HANDOFF_REASON_LABELS`) | Atendimento | Só o da pausa atual (uma linha por telefone) | Guardar histórico (CRM.3) |
| Espera e situação (Aguardando a clínica / Em atendimento) | Funcional | `classifyAttention` pelas horas do paciente e de `agent_reply` | Atendimento | Não diz **quem** da equipe respondeu (o app do WhatsApp Business não informa) | Limite da coexistência; registrar só "quem devolveu" pelo painel |
| Devolver ao bot (`#bot` ou botão) | Funcional | `returnToBot` (`whatsapp/conversations.ts:290`); `api/admin/atendimento.ts` | Atendimento | Zera o estado sem registro de quem, quando ou resultado | CRM.3 (resultado ao devolver, opcional) |
| Notificação no celular (Web Push) e lembrete do `#bot` | Funcional | `whatsapp/attentionPush.ts`, `api/cron/atendimento-humano.ts`, `push_subscriptions` | Atendimento (cartão Notificações) | — | Reaproveitar para alertas da área Relacionamento, se o cliente quiser |
| Bot que não entende (4ª mensagem vai para a clínica) | Funcional | `conversation_state.not_understood_count`; `tests/db/bot-nao-entende.test.ts` | Bot → Atendimento | — | — |
| Conversa parada há 15 min (aviso e encerramento) | Funcional | `api/cron/conversas-paradas.ts`, `closeIdleConversations` (`bot/router.ts`) | Automático (pg_cron) | Estado descartado; o abandono fica só no funil | Já alimenta "Retomar contato" |
| Tentativas no bot não concluídas (Retomar contato) | Parcial | `buildFunnelReportFromSessions` → `incomplete` (`data/botFunnel.ts`); aba `retomar_contato` em `admin/metricas.astro` | Métricas › Retomar contato | **Recepção não vê**; lista sem "já contatei", resultado ou próxima ação; só sai quando o paciente conclui o mesmo fluxo | Mover para Relacionamento (CRM.1) e dar acompanhamento (CRM.3) |
| Funil do agendamento digital (etapas, abandono, bloqueio, motivos) | Funcional | `FLOW_DEFS`, `buildDigitalReport` (`data/botFunnel.ts`); `metrics_bot_sessions` | Métricas › Agendamento digital | Só a clínica toda; o Profissional não vê | Manter nas Métricas (é gerencial) |
| Links de agendar e remarcar enviados e não usados | Funcional (como etapa do funil) | `booking_links` (`used_at`, `expires_at`, `funnel_session_id`) | Funil e Retomar contato | Sem lista própria | Já coberto pelo Retomar contato |
| Confirmação de presença (painel e botão "confirmo" do lembrete) | Funcional | `patient_confirmed_at`, `reminder_response`; `cardActions.ts` ("Confirmar presença") | Agenda; Resumo do dia (coluna Presença) | — | Manter na Agenda |
| Respostas aos lembretes (confirmaram, pediram para remarcar ou cancelar, não responderam, não entregue) | Funcional | `listRemindersOfDay`, `reminderGroup` (`data/daily.ts`); `LembretesTab.astro` | Resumo do Dia › Lembretes | Só do dia escolhido; sem "já liguei"; o contador conta só "não responderam" e "não entregue" de hoje | Grupos que pedem ação viram fila do Relacionamento (CRM.1) |
| Lembretes e envios automáticos (lembrete, preparo, orientações, confirmação, avisos) | Funcional | `whatsapp/reminders.ts`, `preparation.ts`, `guidance.ts`, `notices.ts`; `api/cron/*`; `tests/db/envios-automaticos.test.ts` | Configurações › Lembretes e Mensagens; Resumo › Envios | — | Manter fora do Relacionamento |
| Reenvio automático e falhas de envio | Funcional | `whatsapp/retries.ts`, `retryRules.ts`; `listAppointmentsWithFailedSends` (`data/sends.ts`) | Resumo › Envios; alerta no Início | Visão técnica, não de relacionamento | Manter no Resumo (ou sair para Configurações) |
| Cancelamento e remarcação (painel, bot e link) | Funcional | `appointments.canceled_via`, `rescheduled_via`; eventos `canceled` e `rescheduled` na trilha | Agenda; bot; `/agendar` | **Sem motivo do cancelamento** informado | CRM.4 (motivo opcional, com lista curta) |
| Aguardando remarcação (cancelados pela clínica) e "Desistiu" | Funcional | `listAwaitingRebooking`, `dismissRebooking` (`data/daily.ts`); `AguardandoTab.astro`; `tests/db/dia-a-dia.test.ts` | Resumo do Dia › Aguardando remarcação | Só cancelamento em massa ou por bloqueio; "Desistiu" sem motivo; sem tentativa de contato registrada | Fila do Relacionamento; motivo no "Desistiu" (CRM.4) |
| Avisar à mão quem não recebeu o aviso de cancelamento | Funcional | `admin/agenda/avisar.astro` (F6.5) | Agenda › Avisar | — | Ligar à fila "Aguardando remarcação" |
| Lista de espera (encaixe ou antecipar) e ofertas | Funcional | `waitlist_entries`, `waitlist_offers`, `waitlist_openings`; `ListaEsperaTab.astro`; `api/cron/lista-de-espera.ts` | Resumo do Dia › Lista de espera; bot | — | Pode ficar no Resumo ou ir ao Relacionamento (decisão) |
| Retorno: botão "Marcar retorno" na consulta apta | Funcional | `listReturnReady` (`agenda/returnReady.ts`, 7 regras); `cardActions.ts:128` | Cartão da consulta (Agenda, A registrar) | Só no cartão da consulta | Manter |
| Retorno: quem ainda pode marcar dentro do prazo (Oportunidade agora) | Parcial | `metrics_return_rights` (migração `20261023130000`), `listReturnOpportunities` (`data/performance.ts:171`); `PerformanceTab.astro:550` | Métricas › Desempenho (lista recolhida, até 50) | **Recepção não vê**; sem "contatei" nem resultado; regra é só a do serviço de Retorno (prazo), não uma regra clínica | Fila do Relacionamento (CRM.1) |
| Comparecimento a registrar e registrado | Funcional | `listPendingAttendance` (60 dias), `listRecordedPage`; `getResumoTabCounts` | Resumo › A registrar e Registradas; contador no Início | Operação da agenda, não relacionamento | Manter no Resumo |
| Limites do bot por contato, "Revisado" e liberar | Funcional | `bot_limit_events`, `contacts.bot_limits_reviewed_at`; `listContactsToReview` (`whatsapp/botLimits.ts`); `tests/db/bot-limites.test.ts` | Início › Contatos para revisar; ficha do contato | — | Fila do Relacionamento (é uma pendência da recepção) |
| Bloquear contato no bot | Funcional | `contacts.bot_blocked_*`; `whatsapp/contactBlock.ts` | Ficha do contato (Administrador) | — | Manter no contato |
| Quem marcou e por qual canal | Funcional | `appointments.booking_channel`, `created_by`; `bookedBy` em `ResumoDia.astro` | Resumo do dia; trilha; Desempenho ("Marcados por") | Canal ≠ origem do contato | Ver CRM.6 |
| Origem do contato ("como conheceu") | Não encontrada | — | — | Não existe campo | Só se o cliente quiser medir (C) |
| Motivo de perda ou desistência informado pela equipe | Não encontrada | Só motivos automáticos do bot (`REASONS` em `botFunnel.ts`: tempo esgotado, bloqueios, erros) | — | Não há campo para a equipe | CRM.4 |
| Responsável, prazo, próxima ação, tarefa | Não encontrada | Nenhuma tabela de tarefa, follow-up ou atribuição | — | Lacuna real | CRM.3 (decisões antes) |
| Anotação por contato ou por interação (com data e autor) | Não encontrada | Só `patients.notes` (texto único) | — | Lacuna real | CRM.3 |
| Indicadores de agendamento e conversão | Funcional (gerencial) | `data/performance.ts` (marcados, cancelados, comparecimento, resposta ao lembrete, retornos); funil digital | Métricas › Desempenho e Agendamento digital | Sem tempo de resposta da clínica nem resultado de contatos feitos pela equipe | CRM.5 depois do CRM.3 |
| Contadores de pendência | Funcional | `getResumoTabCounts` (`daily.ts`), `getDashboardCounts` (`dashboard.ts`), `countAwaitingClinic` (menu) | Abas do Resumo, Início, menu Atendimento | Espalhados em 3 lugares | Um só painel de contadores no Relacionamento |
| Campanhas, consentimento, opção de saída | Não encontrada | Nenhum campo de consentimento ou descadastro | — | Fora do escopo inicial | Só com base legal e regras (C) |
| Anonimização a pedido (LGPD) | Funcional | migração `20261009140000_anonimizacao.sql` (apaga o texto das mensagens, apaga `conversation_state`, anonimiza o funil) | Ficha do paciente (Administrador, Suporte) | — | Toda tabela nova do CRM precisa entrar nela |

---

## 3. Análise detalhada de "Resumo do Dia"

**Onde está:** item do menu "Resumo do Dia" → `/admin/consultas` (`src/pages/admin/consultas/index.astro`; o nome
mudou de "Consultas" a pedido do cliente e o endereço ficou). Dados em `src/lib/data/daily.ts`, abas em
`src/components/admin/resumo/`. É de **todos os papéis**; o Profissional restrito vê só as próprias agendas (RLS de
`appointments` por agenda, `app.can_access_agenda`).

| Aba | Aparece com | O que mostra | De onde vem | Ações na tela |
|---|---|---|---|---|
| Resumo do dia | sempre | Atendimentos do dia: hora, situação, paciente e idade, contato e WhatsApp, serviço, local, agenda, presença, quem marcou e por onde | `appointments` (`listAgendaAppointments`); presença e "quem marcou" calculados (`presence`, `bookedBy`) | **Nenhuma** (só leitura, desde 03/out, como no piloto): "Abrir na Agenda", link para a ficha, WhatsApp |
| Lembretes | item `reminders` | Lembretes enviados no dia, em 5 grupos (não responderam, não entregue, pediram para remarcar, pediram para cancelar, confirmaram) | `whatsapp_messages` (envio + toque do botão) + `appointments`; grupo calculado (`reminderGroup`) | Nenhuma: link para a Agenda e WhatsApp |
| Lista de espera | item `waitlist` | Quem espera, por agenda e serviço, com a oferta em andamento; últimas ofertas | `waitlist_entries`, `waitlist_offers` | "Tirar da lista" (com confirmação) |
| Aguardando remarcação | sempre | Cancelados pela clínica (em massa ou bloqueio) que não remarcaram | `appointments` (`mass_canceled`, `rebooking_dismissed_at`) + regra `wasRebooked` | "Remarcar" (abre o Marcar preenchido) e "Desistiu" (com confirmação, vai à trilha) |
| A registrar | sempre | Atendimentos dos últimos 60 dias sem comparecimento | `appointments` | Cartão completo da Agenda (Compareceu, Faltou, Remarcar, Marcar retorno, Pagamento…) |
| Registradas | sempre | Compareceu ou faltou, 20 por página | `appointments` | Corrigir o registro |
| Envios | `reminders` ou `daily_summary` | Execuções das rotinas e atendimentos com envio com falha | `job_runs`, `whatsapp_messages` | Nenhuma (leva à Agenda do dia) |

Contadores nas abas: `getResumoTabCounts` (lembretes de hoje que pedem ação, lista de espera, aguardando, a
registrar, alerta de envios). Navegação de data só nas abas Resumo do dia e Lembretes (`DateStepper`).

**Há pacientes, conversas, pendências e próximos passos?** Pacientes e pendências da **agenda**, sim. **Conversas,
não**: nada do WhatsApp aparece aqui além do resultado do lembrete. O Atendimento humano, os contatos para revisar,
o Retomar contato e as oportunidades de retorno ficam em outras telas.

**Reaproveitável numa área de relacionamento:** `listAwaitingRebooking` + `dismissRebooking`; `listRemindersOfDay` +
`listReminderTaps` (os grupos "não responderam", "pediram para remarcar" e "pediram para cancelar"); a Lista de
espera inteira; o padrão de contadores das abas (`Tabs` com `count`); o `AppointmentCard` e o `cardActions.ts`; o
`PhoneLinks` (WhatsApp, sem ligação, como pede a regra do painel).

**Limitações para ser uma central de relacionamento:**
- organizada por **atendimento** (consulta/exame), não por **pessoa**: o mesmo paciente aparece em várias abas, e
  quem nunca marcou (conversa sem atendimento) não aparece;
- não mostra as conversas, as tentativas no bot, os retornos em aberto nem os contatos para revisar;
- nenhuma aba registra "tentei contato", resultado ou próxima ação; o "Desistiu" é a única ação de acompanhamento, e
  sem motivo;
- duas abas são de um dia; as filas não têm idade (há quanto tempo está pendente) nem ordem por urgência;
- Envios e Registradas são técnica e histórico, não relacionamento.

**O nome ainda serve?** Só para a 1ª aba. Hoje "Resumo do Dia" é uma central de **pendências da agenda** com uma
visão do dia na frente. E o nome colide com o "Lembrete à equipe / ao profissional (resumo do dia)" (mensagem de
WhatsApp, `whatsapp/dailySummary.ts`) e com a rotina "Resumo do dia" que aparece na própria aba Envios. A troca do
nome é decisão do cliente (pergunta P1).

---

## 4. Mapa de telas, módulos e fluxos ligados ao CRM

```
Paciente no WhatsApp ──► webhook (api/whatsapp/webhook.ts) ──► whatsapp_messages (tudo, com texto)
        │                                                      │
        ▼                                                      ▼
   bot (whatsapp/bot/*) ── bot_funnel_events ──► Métricas › Agendamento digital / Retomar contato
        │   ├─ marca/remarca/cancela ─► appointments + appointment_events ─► Agenda, Resumo, ficha, trilha
        │   ├─ link /agendar ─► booking_links ─► página pública ─► appointments
        │   ├─ lista de espera ─► waitlist_* ─► Resumo › Lista de espera
        │   ├─ limite do contato ─► bot_limit_events ─► Início › Contatos para revisar; ficha do contato
        │   └─ "Falar com a recepção" / não entende / sem horário / limite
        │          └─► conversation_state (pausa, motivo) ─► Atendimento humano, faixa do Início, Web Push
        │                    └─ recepção responde no app (eco agent_reply) / #bot / "Devolver ao bot"
        ▼
 Rotinas (pg_cron → api/cron/*): lembretes, preparo, resumo à equipe, lista de espera, reenvios, conversas paradas
        └─► whatsapp_messages + job_runs ─► Resumo › Lembretes e Envios; alerta no Início; trilha
```

| Tela | Papel no relacionamento | Quem vê |
|---|---|---|
| Início (`admin/dashboard.astro`) | Números de hoje, faixa do atendimento humano, contatos para revisar, alertas (envios, templates, certificado) | Todos (alertas de configuração, só o Administrador) |
| Atendimento (`admin/atendimento.astro`) | Fila de conversas que pedem a clínica | Todos, com o bot liberado |
| Resumo do Dia (`admin/consultas`) | Dia + filas da agenda (seção 3) | Todos (Profissional: as próprias agendas) |
| Agenda (`admin/agenda*`) | Ações no atendimento: confirmar, compareceu/faltou, remarcar, cancelar, retorno, lista de espera, reenvios, avisar | Todos |
| Pacientes, ficha e contato (`admin/pacientes/*`) | Cadastro, observações, histórico de atendimentos, limites e bloqueio no bot, financeiro | Todos (ações sensíveis, por papel) |
| Trilha (`admin/agenda/trilha/[id]`) | Histórico de um atendimento | Todos |
| Métricas (`admin/metricas.astro`) | Desempenho (com Oportunidade de retorno), Agendamento digital, Retomar contato, Faltosos, Financeiro | **Administrador** (Profissional: só "Métricas pessoais"); **Recepção não** |

---

## 5. Entidades, tabelas e serviços relevantes

| Entidade | Tabela(s) | Finalidade | Relações | Persistido? |
|---|---|---|---|---|
| Clínica (tenant) | `clinics`, `clinic_settings`, `clinic_features` | Isolamento, fuso, regras do bot, itens liberados (D11) | Toda tabela tem `clinic_id` | Sim |
| Equipe | `clinic_members` (papéis, `agenda_scope`), `member_agenda_grants`, `professionals`, `platform_staff` | Quem acessa e o quê | `created_by`, `canceled_by`, `actor_id` apontam para o usuário | Sim |
| Contato (quem fala com a clínica) | `contacts` | Telefone único na clínica; limites e bloqueio no bot | 1 contato → N pacientes | Sim |
| Paciente | `patients` | Nome, nascimento, observações, plano, `created_via` | → `contacts`; ← `appointments` | Sim |
| Atendimento | `appointments` | Consulta, retorno, exame; situação, canal, presença, resposta ao lembrete, cancelamento em massa, "Desistiu" | → paciente, serviço, agenda, local; `origin_appointment_id` (retorno); `series_id` | Sim |
| Trilha | `appointment_events` | Eventos do atendimento (marcado, remarcado, cancelado, presença, comparecimento, lista de espera, "Desistiu", reenvios) com canal e autor | → `appointments` | Sim |
| Mensagens do WhatsApp | `whatsapp_messages` | Toda mensagem: direção, tipo (inclui `agent_reply`), texto, entrega, tentativas | → contato (quando já é contato), atendimento (quando é dele); chave também por `contact_phone` | Sim (o texto é apagado na anonimização) |
| Conversa | `conversation_state` | **Estado atual** do bot por telefone: etapa, `context`, pausa, motivo, notificações, "não entendeu" | Uma linha por `(clinic_id, contact_phone)`; → contato | **Só o estado atual**: `context` some ao recomeçar; a pausa é sobrescrita |
| Tentativas no bot | `bot_funnel_events` (+ função `metrics_bot_sessions`) | Passos de cada tentativa (marcar, retorno, exame, cancelar, remarcar, atendimento humano) e motivos de abandono e bloqueio | → contato, atendimento | Sim (só o bot e a página gravam) |
| Links de agendamento | `booking_links` | Link enviado, usado ou vencido; ligado à tentativa | → contato, paciente, atendimento, tentativa | Sim |
| Lista de espera | `waitlist_entries`, `waitlist_offers`, `waitlist_openings` | Quem espera, ofertas e respostas | → atendimento | Sim |
| Limites e revisão | `bot_limit_events`, colunas `bot_limits_*` e `bot_blocked_*` em `contacts` | Pendência "revisar contato" | → contato | Sim |
| Envios e rotinas | `job_runs`, `daily_summary_sends`, `cron_heartbeats` | Se as rotinas rodaram | por clínica | Sim |
| Notificações | `push_subscriptions` | Aparelhos que recebem o aviso do atendimento humano | → usuário | Sim |
| Indicadores | funções `metrics_*` (migrações `20261022*`/`20261023*`) | Desempenho, retornos, funil | leem as tabelas acima | Calculado na hora |
| Tarefa, follow-up, responsável, anotação datada, motivo de perda, origem | — | — | — | **Não existe** |

**Respostas pontuais:**
- **Visão unificada do paciente?** Parcial: a ficha une cadastro, contato, plano, financeiro e atendimentos. **Não**
  une mensagens, tentativas no bot, passagens para a clínica, ofertas da lista de espera nem limites (estes ficam na
  ficha do **contato**).
- **Histórico de interações centralizado?** Os **dados** sim, em 3 tabelas de evento (`whatsapp_messages`,
  `appointment_events`, `bot_funnel_events`), todas com `clinic_id` e contato ou telefone. As **telas** não: cada
  uma lê um pedaço.
- **Origem, motivo de desistência, resultado do atendimento?** Origem: só o canal (`booking_channel`,
  `created_via`). Desistência: só os motivos automáticos do bot e o "Desistiu" sem motivo. Resultado: comparecimento
  (compareceu/faltou) e resultado da tentativa no bot; nada sobre o resultado de um contato da equipe.
- **Acompanhamento com responsável, prazo ou próxima ação?** Não. O que existe são prazos do sistema (pausa de 24h
  em dias úteis, prazo do retorno, validade do link e da oferta).
- **Dá para achar quem não virou agendamento?** Sim, pelo funil: tentativas abandonadas ou com erro sem conclusão
  posterior (Retomar contato); links não usados; quem pediu a clínica (`handoff`) e não marcou depois. Quem
  escreveu à clínica **sem passar pelo bot**, por exemplo uma conversa só com a recepção, fica só em
  `whatsapp_messages`, sem classificação.
- **Risco de duplicação:** contato não duplica (telefone único na clínica). Paciente pode duplicar com nomes
  diferentes no mesmo contato (o painel só avisa quando o nascimento é igual). Interações não duplicam: os eventos
  repetidos da Meta são barrados por índice único em `wa_message_id`. Uma tabela de acompanhamento nova precisa
  evitar dois registros abertos para a mesma pendência.
- **Isolamento entre clínicas (RLS):** toda tabela tem RLS por `clinic_id` (`app.is_clinic_member`,
  `app.service_clinic_id` para o bot e as rotinas); `tests/db/isolamento.test.ts` e os testes "outra clínica não vê"
  cobrem isso. **Atenção:** `appointments` também é restrito por agenda (Profissional restrito), mas
  `whatsapp_messages`, `conversation_state` e `bot_funnel_events` são legíveis por **qualquer membro da clínica**.
  Hoje nenhuma tela mostra o texto das mensagens a quem tem agenda restrita. Uma linha do tempo com o texto abriria
  isso, e é uma decisão de negócio (pergunta P5).
- **Persistido x só durante a conversa:** `conversation_state.context` (escolhas no meio do fluxo) e a etapa atual
  são temporários; o resto (mensagens, passos do funil, links, eventos) fica.

---

## 6. Matriz comparativa (atual x desejado)

Legenda da coluna "Muda": **I** interface, **R** regra de negócio, **B** banco, **X** integração.

### A. CRM operacional (prioridade)

| Desejado | O que já existe e onde | O que falta | Dados disponíveis? | Muda | Depende de |
|---|---|---|---|---|---|
| Histórico unificado de interações | Dados em `whatsapp_messages`, `appointment_events`, `bot_funnel_events`; trilha por atendimento | Tela por paciente/contato que junte tudo | Sim | I (+ R para resumir) | P5 (quem vê o texto) |
| Conversas pendentes ou abandonadas | Atendimento humano (pendentes); Retomar contato (abandonadas no bot) | Juntar as duas numa fila; Recepção ver o Retomar | Sim | I | P2 |
| Fila de contatos que pedem a recepção | Atendimento, Contatos para revisar, Aguardando remarcação, Lembretes sem resposta, Retomar contato, Oportunidade de retorno, Faltosos, A registrar | Uma tela só com contadores e ordem | Sim | I | P1, P2 |
| Status do atendimento e responsável | Situação do atendimento; "Aguardando/Em atendimento" na conversa | Responsável e status do **acompanhamento** | Não | B, R, I | P3 |
| Próxima ação ou retorno de contato | — | Data e descrição da próxima ação | Não | B, R, I | P3 |
| Pedidos que não viraram agendamento | Retomar contato (bot e link) | Ação de acompanhamento; incluir quem pediu a clínica e não marcou | Sim (parcial) | I, R (+ B para acompanhar) | P2, P3 |
| Confirmações, cancelamentos e remarcações | Lembretes (do dia), trilha, Desempenho | Fila "pediram para remarcar/cancelar e não concluíram" fora do dia escolhido | Sim | I, R | — |
| Bot ↔ equipe | Pausa, motivo, `#bot`, "Devolver ao bot", Web Push, alerta no Início | Histórico das pausas (quando, motivo, quanto esperou, quem devolveu) | Parcial (funil `handoff`; `agent_reply`) | B, R | — |
| Indicadores de pendência e resultado | Contadores espalhados; Desempenho; funil | Tempo de resposta da clínica; resultado dos contatos | Parcial | R, I (+ B) | CRM.3 |

### B. Continuidade do relacionamento

| Desejado | O que já existe e onde | O que falta | Dados? | Muda | Depende de |
|---|---|---|---|---|---|
| Quem precisa agendar retorno | Oportunidade agora (prazo do serviço de Retorno); botão "Marcar retorno" | Recepção ver; acompanhar o contato | Sim (regra administrativa: prazo do Retorno) | I (+ B para acompanhar) | P4 (outras regras) |
| Pedidos ainda não resolvidos | Retomar contato; Aguardando remarcação; Lista de espera | Acompanhamento e idade da pendência | Parcial | I, B | P3 |
| Lembretes operacionais para a equipe | Lembrete à equipe e ao profissional (lista do dia por WhatsApp); Web Push do atendimento humano | Lembrete de "próxima ação" vencendo | Não | B, R (+ X se por push) | CRM.3 |
| Retomar sem pedir de novo o que já se sabe | Ficha (cadastro, plano, atendimentos); a última mensagem do paciente no Atendimento | Ver a conversa e a tentativa no bot (onde parou, por quê) | Sim | I | P5 |
| Listas com critério claro e autorizado | Faltosos (regra fixa), Oportunidade de retorno, Retomar contato | Juntar, com o critério escrito na tela | Sim | I | P1 |

### C. Comercial e inteligência

| Desejado | O que já existe e onde | O que falta | Dados? | Muda | Depende de |
|---|---|---|---|---|---|
| Origem dos contatos | Canal da marcação (painel, WhatsApp, link) | "Como conheceu" (indicação, Instagram, convênio…) | Não | B, I | P6 |
| Conversão de contato em agendamento | Funil digital (por etapa, por origem: menu ou lembrete) | Conversão dos contatos feitos pela equipe | Parcial | R (+ B) | CRM.3 |
| Motivos de perda ou desistência | Motivos automáticos do bot | Motivo informado pela equipe | Parcial | B, I | P7 |
| Oportunidades não concluídas | Retomar contato, Oportunidade de retorno, Aguardando remarcação | Visão única (CRM.1) | Sim | I | — |
| Indicadores por canal, período e equipe | Desempenho ("Marcados por", período, agenda, serviço, local) | Por pessoa da equipe no relacionamento | Parcial | R | CRM.3 |
| Campanhas | — | Base legal, consentimento, saída, frequência, templates de marketing na Meta | Não | B, R, I, X | P8 (fora do inicial) |

---

## 7. Lacunas reais x problemas de navegação ou apresentação

**Só navegação, visibilidade ou apresentação (sem banco novo):**
1. Retomar contato, Oportunidade de retorno e Faltosos **escondidos da Recepção** (estão nas Métricas).
2. Pendências da recepção espalhadas em Início, Atendimento, Resumo do Dia (4 abas) e Métricas, com contadores em
   3 lugares.
3. Histórico de mensagens gravado e **sem tela** para a clínica.
4. Lembretes "pediram para remarcar/cancelar" e "não responderam" só no dia escolhido.
5. O nome "Resumo do Dia" não descreve as filas e colide com o "resumo do dia" do WhatsApp.

**Lacunas reais (pedem regra e, em geral, banco):**
1. Registro de acompanhamento: tentativa de contato, resultado, anotação datada com autor, próxima ação e prazo.
2. Responsável pela pendência (se o cliente quiser).
3. Motivo de desistência, perda ou cancelamento informado pela equipe.
4. Histórico das passagens para a clínica (hoje só o estado atual; o "Devolver ao bot" não deixa rastro).
5. Origem do contato (só se o cliente quiser medir).
6. Consentimento e opção de saída (só se houver campanha, e não no início).

**Duplicado ou distribuído:** "pendente de comparecimento" é contado no Início e no Resumo; a lista de quem bateu
limite fica no Início e na ficha do contato; o atendimento humano aparece no menu, na faixa do Início e na tela
própria. Nada disso é defeito: é o mesmo dado em telas diferentes, e o risco é a central nova virar a quarta cópia.

---

## 8. As três alternativas para "Resumo do Dia" e "Relacionamento"

| | 1. Manter o Resumo e criar "Relacionamento" à parte | 2. Evoluir o Resumo para central de relacionamento | 3. Resumo como visão do dia/gestão e "Relacionamento" operacional |
|---|---|---|---|
| O que é | Resumo intacto (7 abas); área nova com o que falta (conversas, retomar, retornos) | O Resumo vira "Relacionamento": junta as filas e mantém o dia como uma aba | Resumo fica com o dia, os lembretes, o comparecimento e os envios; as filas de pessoas vão para "Relacionamento" |
| Prós | Nada muda para quem já usa; entrega rápida | Uma tela só; aproveita contadores e abas | Cada tela com um propósito: "o que acontece hoje" × "quem precisa de contato"; filas por pessoa, não por atendimento |
| Contras | Duas centrais de pendência (Aguardando remarcação e Lista de espera ficariam fora do Relacionamento ou duplicadas) | Mistura operação da agenda (A registrar, Envios) com relacionamento; a aba "Resumo do dia" fica escondida numa central; tela pesada | Muda o lugar de 1 ou 2 abas (Aguardando remarcação, talvez Lista de espera) para quem já se acostumou |
| Reaproveitamento | Alto (nada é mexido) | Alto (a página e os contadores) | Alto: as abas são componentes independentes (`resumo/*.astro`) e as consultas estão em `daily.ts`; as listas das Métricas já têm função própria (`listReturnOpportunities`, `buildFunnelReportFromSessions`, `listFrequentNoShows`) |
| Impacto funcional | Baixo, mas a dispersão continua | Médio (muda a tela que todos usam) | Médio e localizado (menu, duas abas que mudam de lugar, um redirecionamento de endereço) |
| Banco | Nenhum para começar | Nenhum para começar | Nenhum para começar |

**Recomendação técnica: a alternativa 3**, com um detalhe que o código favorece. O "Relacionamento" começa como
uma **fila por pessoa** que lê as funções que já existem e mostra cada pendência com o motivo, há quanto tempo
espera e o atalho (WhatsApp, ficha, Marcar). O Atendimento humano continua tela própria (tem notificação e o fluxo
do `#bot`) e entra no Relacionamento como o 1º grupo, com o link. **Quem decide é o cliente** (pergunta P1). Se for
importante não mexer no Resumo agora, a alternativa 1 é um primeiro passo aceitável, com a 3 depois.

---

## 9. Roadmap recomendado (por valor para a recepção e esforço)

| Etapa | O que entra | Valor | Esforço | Banco? |
|---|---|---|---|---|
| **CRM.1 Fila de relacionamento** | Área "Relacionamento" com os grupos que já existem: conversas aguardando a clínica (link para o Atendimento), Retomar contato, Oportunidade de retorno, Aguardando remarcação, lembretes que pediram para remarcar ou cancelar e não concluíram, não responderam e não entregues dos próximos dias, contatos para revisar e faltosos. Contadores, idade da pendência, WhatsApp e atalhos. Recepção passa a ver essas listas. Ajuste do menu e do Resumo conforme P1 | Alto | Baixo a médio | Não (talvez uma função SQL de leitura) |
| **CRM.2 Linha do tempo do paciente e do contato** | Na ficha: atendimentos + trilha + mensagens (com e sem texto, conforme P5) + tentativas no bot (onde parou e por quê) + passagens para a clínica + lista de espera. Só leitura | Alto | Médio | Não (leitura; índices já existem por contato e telefone) |
| **CRM.3 Acompanhamento** | Registro de contato feito pela equipe numa pendência: resultado (lista curta), anotação, próxima ação e data, autor, e responsável (opcional). Fecha a pendência da fila. Histórico das passagens para a clínica (início, motivo, fim, quem devolveu). Entra na anonimização e na trilha | Alto | Médio | Sim (1 ou 2 tabelas com RLS, sem apagar, com auditoria) |
| **CRM.4 Motivos** | Motivo no "Desistiu", no cancelamento pela equipe e no resultado "não quer marcar", em lista definida pelo cliente | Médio | Baixo | Sim (coluna ou tabela de motivos) |
| **CRM.5 Indicadores de relacionamento** | Tempo de resposta da clínica, pendências abertas e resolvidas, conversão dos contatos feitos e motivos mais comuns, nas Métricas | Médio | Médio | Leitura (depende do CRM.3) |
| **CRM.6 Comercial (opcional, só com decisão)** | Origem do contato; listas segmentadas; qualquer envio ativo só com base legal, consentimento registrado, opção de saída, limite de frequência e template aprovado pela Meta | A definir | Alto | Sim |

Ordem sugerida: CRM.1 → CRM.2 → CRM.3 → CRM.4 → CRM.5; o CRM.6 só se o cliente pedir. Cada etapa com validação
no staging, como nas outras fases.

---

## 10. Dúvidas de negócio (antes de implementar)

- **P1.** Qual alternativa da seção 8, e qual nome: "Relacionamento", "Pendências", "Contatos a fazer"? E o "Resumo
  do Dia" mantém o nome?
- **P2.** A Recepção deve ver Retomar contato, Oportunidade de retorno e Faltosos? Isso muda a D6/D11: hoje são das
  Métricas, só do Administrador.
- **P3.** A clínica quer **registrar** cada contato feito (resultado, anotação, próxima ação)? Quer **responsável** por
  pendência, ou a fila é da recepção inteira? Com prazo?
- **P4.** "Precisa de retorno" é só o prazo do serviço de Retorno (como hoje), ou há outras regras, como retorno
  anual, exame periódico ou pós-procedimento? Quem define cada uma: a clínica, por serviço?
- **P5.** Quem pode ver o **texto** das conversas do WhatsApp no painel: todos, ou só Administrador e Recepção? O
  Profissional com agenda restrita vê as conversas dos próprios pacientes, de todos ou de nenhum?
- **P6.** A clínica quer saber a origem do paciente ("como conheceu")? Perguntada pelo bot, pela recepção ou nenhuma
  das duas?
- **P7.** Quais motivos de desistência, perda e cancelamento usar (lista fechada e curta)?
- **P8.** Há intenção de mensagens ativas (campanhas, aniversário, "faz tempo que não vem")? Se sim, qual a base
  legal e o texto do consentimento? Fica fora das etapas iniciais?
- **P9.** O CRM vira um item da matriz de acesso (D11), liberado por clínica e por plano, ou faz parte do básico?
- **P10.** Por quanto tempo guardar as mensagens e os registros de contato? A política de retenção (L42) ainda está
  pendente.

---

## 11. Referências ao código

- Menu e áreas: `src/layouts/AdminLayout.astro` (itens e contador do Atendimento); `src/lib/clinicAccess.ts`
  (`AREA_ROLES`, `canAccessArea`); `src/lib/features.ts` (itens da matriz).
- Resumo do Dia: `src/pages/admin/consultas/index.astro`; `src/components/admin/resumo/{ResumoDia,LembretesTab,ListaEsperaTab,AguardandoTab,EnviosTab}.astro`;
  `src/lib/data/daily.ts` (`listRemindersOfDay`, `listReminderTaps`, `listAwaitingRebooking`, `wasRebooked`,
  `dismissRebooking`, `listPendingAttendance`, `listRecordedPage`, `getResumoTabCounts`); `src/lib/data/sends.ts`.
- Início: `src/pages/admin/dashboard.astro`; `src/lib/data/dashboard.ts` (`getDashboardCounts`);
  `src/lib/data/whatsapp/botLimits.ts` (`listContactsToReview`).
- Atendimento humano: `src/pages/admin/atendimento.astro`; `src/lib/data/whatsapp/attention.ts`
  (`listHumanAttention`, `classifyAttention`, `HANDOFF_REASON_LABELS`); `src/lib/data/whatsapp/conversations.ts`
  (`returnToBot`, `handoffDeadline`, `checkHandoff`); `src/lib/data/whatsapp/attentionPush.ts`;
  `src/pages/api/admin/atendimento.ts`; `src/pages/api/cron/atendimento-humano.ts`.
- Mensagens: `src/lib/data/whatsapp/messages.ts` (`recordInboundMessage`, `recordAgentEcho`,
  `recordOutboundMessage`, `listWhatsappMessages`); `src/lib/data/whatsapp/webhook.ts`.
- Bot e funil: `src/lib/data/whatsapp/bot/{router,engine,menus,booking,manage}.ts`;
  `src/lib/data/whatsapp/funnel.ts` (`logFunnelEvent`); `src/lib/data/botFunnel.ts` (`FLOW_DEFS`, `REASONS`,
  `buildFunnelReportFromSessions`, `buildDigitalReport`); `src/pages/api/cron/conversas-paradas.ts`.
- Pacientes: `src/pages/admin/pacientes/{index,novo,[id]}.astro`, `src/pages/admin/pacientes/contato/[id].astro`;
  `src/lib/data/patients.ts`; `src/lib/patientSearch.ts`.
- Agenda e trilha: `src/components/admin/agenda/cardActions.ts`; `src/lib/data/agenda/{view,trail,returnReady,appointments}.ts`;
  `src/pages/admin/agenda/{trilha/[id],avisar}.astro`.
- Métricas: `src/pages/admin/metricas.astro`; `src/components/admin/metricas/{PerformanceTab,DigitalTab}.astro`;
  `src/lib/data/performance.ts` (`listReturnRights`, `listReturnOpportunities`); `src/lib/data/metrics.ts`
  (`listFrequentNoShows`).
- Banco: `supabase/migrations/20261004140000_pacientes.sql` (contatos, pacientes, RLS),
  `20261004150000_atendimentos.sql` (atendimentos, trilha, RLS por agenda), `20261004170000_whatsapp_e_rotinas.sql`
  (mensagens, conversa, funil, RLS), `20261005130000_whatsapp_conversas.sql`, `20261007130000_conversa_parada.sql`,
  `20261009140000_anonimizacao.sql`, `20261010120000_limites_do_bot.sql`, `20261022130000_metricas_contas.sql` e
  `20261023130000_metricas_acesso_na_entrada.sql` (`metrics_return_rights`), `20261027120000_atendimento_humano.sql`,
  `20261027180000_bot_nao_entende.sql`; tipos em `src/lib/supabase/database.types.ts`.
- Testes: `tests/db/{dia-a-dia,atendimento-humano,bot-nao-entende,bot-limites,pacientes,isolamento,metricas*,envios-automaticos}.test.ts`.

---

## 12. Limitações da investigação

- **Nada foi executado**: nem a aplicação, nem os testes, nem consultas ao banco do staging ou da produção. As
  situações vêm da leitura do código, dos testes e dos registros de validação em `docs/`. O uso em produção não foi
  comprovado.
- O motor do bot (`bot/engine.ts`, `booking.ts`, `manage.ts`) foi lido por partes. A regra exata de duplicidade de
  paciente pelo bot (`duplicateCheck`) e todos os passos que vão ao funil não foram auditados linha a linha.
- As funções SQL das Métricas (`metrics_*`) foram lidas na assinatura e no começo do corpo, não por inteiro.
- O comportamento real da coexistência (quais ecos a Meta entrega do app do WhatsApp Business, e se todas as
  respostas da recepção viram `agent_reply`) depende da Meta e só foi validado no staging com o número de testes.
- Volume de dados e desempenho de uma linha do tempo com muitas mensagens não foram medidos.
- Não foram examinados dados reais. Nenhum segredo ou variável de ambiente foi lido.
