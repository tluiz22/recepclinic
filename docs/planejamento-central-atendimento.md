# Central de Atendimento Humano: planejamento

> **Retomar daqui (05/nov/2026).** Só plano, nada implementado. Decisões 1 a 12 respondidas (seção 11); CN0
> (conferência da Meta) feito: seção 5.1, com **2 alertas para a produção** (mensagens de serviço cobradas desde
> 01/out; Embedded Signup v3 descontinuado em 15/out). Próximo: o cliente decide o que fazer com os alertas; depois,
> desenho das telas (CN3) ou CN1. Pendentes: fim da seção 11. **Novo (05/nov): seção 14** (ativação pelo
> Administrador com o custo da Meta, medição e calculadora em Sistema › Vendas), decisões abertas lá.

Pedido do cliente (05/nov/2026): secretárias, profissionais e outros usuários autorizados veem e respondem as
conversas do WhatsApp **dentro do RecepClinic**, com o mesmo histórico do bot, sem abrir o app do WhatsApp.

Legenda usada no documento: **[existe]** já está no código; **[reaproveitar]** serve como está ou com pouca
mudança; **[alterar]** muda algo que existe; **[criar]** é novo; **[decidir]** depende do cliente.

---

## Resumo executivo

**Recomendação técnica.** Construir a Central **sobre o que já existe**, sem segunda infraestrutura e sem tabelas
paralelas de conversa:

- `whatsapp_messages` continua a **fonte única** do histórico (paciente, bot, avisos, recepção pelo app e, agora,
  recepção pelo painel), com colunas novas para autor, usuário e mídia.
- `conversation_state` continua sendo **a conversa** (uma por clínica e telefone) e ganha **responsável** e
  **hora da última mensagem**; o `handoff_id` da CA já identifica **cada atendimento** dentro da conversa.
- `handoff_events` (CA) vira a **trilha de auditoria** do atendimento (assumir, transferir, finalizar), sempre
  gravada por gatilho.
- Mídias num bucket privado novo do Supabase Storage (`whatsapp-media`), no mesmo padrão do `patient-documents`,
  com download **fora** do webhook.
- Mesmo webhook (`/api/whatsapp/webhook`), mesmo envio (`createClinicSender`), mesmo token no Vault.

**O que impede começar hoje.** A **D12** (28/out/2026) proíbe guardar o texto das mensagens do paciente e das
respostas da recepção pelo app, e a migração `20261028150000_mensagens_sem_texto.sql` apagou o texto antigo e
fechou a leitura do `body` pelo login. A Central **não existe sem guardar o texto e as mídias**. É a primeira
decisão do cliente, com impacto em LGPD, contrato e política de privacidade.

**Principais riscos.** (1) Guardar dado de saúde em texto e anexos (LGPD, vazamento, retenção). (2) Coexistência:
a recepção no app e outra pessoa no painel respondendo o mesmo paciente. (3) O bot responder ao mesmo tempo que a
recepção numa conversa que acabou de ser assumida. (4) O webhook processa tudo em linha (bot incluso); mídia e
volume maior exigem trabalho assíncrono. (5) Clínicas em produção: nenhuma mudança pode alterar o caminho do bot.

**Decisões antes de implementar** (seção 11): rever a D12; coexistência junto com a Central; situações do
atendimento (as 2 da CA ou as 5 pedidas); quem vê o quê; assumir antes de responder; não lidas por usuário ou
por clínica; o que fazer fora da janela de 24 h; retenção; item da matriz (D11) e preço.

---

## 1. Diagnóstico da arquitetura atual

### 1.1 Caminho de uma mensagem hoje [existe]

| Peça | Onde | O que faz |
|---|---|---|
| Rota do webhook | `src/pages/api/whatsapp/webhook.ts` | GET de verificação; POST confere `X-Hub-Signature-256` (`isValidMetaSignature`), responde 200 sempre (erro só no log) |
| Processamento | `src/lib/data/whatsapp/webhook.ts` (`processWebhook`) | Clínica pelo `metadata.phone_number_id` (`resolveClinicByPhoneNumberId`), cliente limitado à clínica (`createClinicServiceClient`); mensagens, ecos, situações de entrega, templates, desconexão |
| Registro | `src/lib/data/whatsapp/messages.ts` | `recordInboundMessage`, `recordAgentEcho`, `updateDeliveryStatus` e o registro dos envios; idempotente pelo índice único |
| Bot | `src/lib/data/whatsapp/bot/router.ts` (`handleIncomingMessage`) | Responde **na mesma requisição** do webhook; calado com `human_handoff = true` (`checkHandoff`) |
| Envio | `src/lib/data/whatsapp/send.ts` (`createClinicSender`) e `graph.ts` (`sendMessage`, `uploadMedia`, v24.0) | Texto, lista, botões, template, documento; token da clínica no Vault |
| Atendimento humano | `conversations.ts` (`pauseForHuman`, `handleAgentEcho`, `markPatientWrote`, `returnToBot`), `attention.ts` (`listHumanAttention`, `finishAttendance`) | Pausa/retoma o bot e calcula a lista da tela |
| Rotina de 12 h | `handoffReturn.ts` + `src/pages/api/cron/atendimento-humano.ts` (pg_cron → rota) | Encerra em silêncio "Em atendimento" parado há 12 h |
| Notificação | `attentionPush.ts`, tabela `push_subscriptions` | Push no celular quando a conversa passa a aguardar a clínica |
| Tela | `src/pages/admin/atendimento.astro`, `src/pages/api/admin/atendimento.ts` | Abas Aguardando a clínica / Em atendimento / Notificações; "Abrir no WhatsApp" e "Finalizar atendimento" |

Particularidades que a Central precisa respeitar:

- **Clínica em implantação** (`clinics.status = 'onboarding'`): mensagens e ecos não são gravados.
- **Número do suporte** (`getSupportWhatsapp`): grava, mas não chama o bot nem entra no Atendimento.
- **Cortesia** (`courtesy.ts`, C27): "ok", "obrigado", 👍 não reabrem o atendimento.
- **Mensagem automática do app** (`isLikelyAutomaticEcho`, IS4): eco em até 5 s não pausa o bot.
- **`#bot`** no app finaliza o atendimento (CA).

### 1.2 Tabelas [existe]

**`whatsapp_messages`** (`20261004170000_whatsapp_e_rotinas.sql` e seguintes): uma linha por mensagem, entrada
e saída.

| Coluna | Uso hoje |
|---|---|
| `clinic_id`, `contact_phone`, `contact_id`, `appointment_id` | Dono, telefone (E.164), contato e atendimento quando houver |
| `direction` | `inbound` / `outbound` |
| `message_type` | Tipo de negócio: `text`, `image`, `courtesy`, `agent_reply` (recepção pelo app), `app_auto_reply`, `bot_*`, `reminder`, etc. |
| `body` | **Nulo** para entrada e `agent_reply` (D12); preenchido no que o sistema envia |
| `status`, `wa_message_id` | Situação (`sent`, `delivered`, `read`, `failed`…; só sobe, `deliveryRank`) e id da Meta |
| `attempt`, `first_attempt_id`, `failure_*`, `retry_*` | Reenvio automático |
| `created_at` | **Hora da chegada no webhook** (não a hora da Meta) |

Índices: único `(clinic_id, wa_message_id)` (idempotência, L23); `(clinic_id, contact_phone, created_at desc)`
**só de entrada** (janela de 24 h); `contact_id`, `appointment_id`, reenvio e `agent_reply`.
RLS por clínica (`enable_clinic_data_rls`); o login **não lê** `body` nem `retry_payload` (só o Suporte, pela
função `support_latest_messages`).

**`conversation_state`**: **uma linha por clínica e telefone** (`unique (clinic_id, contact_phone)`). Estado do
bot (`state`, `context`, funil), pausa (`human_handoff`, `human_handoff_at`), motivo e início
(`handoff_reason`, `handoff_started_at`), assunto (`handoff_subject`, exceção da D12), notificações
(`handoff_notified_at`, `handoff_reminded_at`) e, desde a CA, `handoff_status` (`waiting_clinic` | `in_progress`),
`handoff_status_at`, `handoff_id` (um por atendimento) e `handoff_changed_by`.

**`handoff_events`** (CA): estado anterior e novo (`bot`, `waiting_clinic`, `in_progress`), origem, usuário, hora;
gravada **só** pelo gatilho `app.conversation_handoff_event`. A equipe lê; ninguém grava pela tela.

**`bot_funnel_events`**: funil do bot (Métricas). **`contacts`**: nome do paciente pelo telefone.

**Storage**: buckets privados `patient-documents` (10 MB, JPG/PNG/HEIC/PDF, caminho `<clínica>/<paciente>/…`,
política pela função `app.storage_folder_clinic`), arquivo do preparo, marca, NFS-e.

### 1.3 Papéis e acesso [existe]

D6: Administrador, Profissional (só a própria agenda), Recepção, Suporte RecepClinic (acesso a todas, leituras
registradas). D11: a tela Atendimento só existe com o item `whatsapp_bot` ligado. Pacientes: toda a equipe vê todos.

### 1.4 Meta [existe]

- App RecepClinic **Tech Provider**: Análise do App e Verificação do acesso **aprovadas (27/out)**, com
  `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`, `public_profile`
  (`docs/meta-tech-provider.md`).
- Conexão por **Embedded Signup com coexistência** (D3a): a secretária segue no app WhatsApp Business no mesmo
  número. Token por clínica no Vault (`get_whatsapp_access_token`).
- Webhook recebe `messages` (com `statuses`), ecos do app (`message_echoes`), `message_template_status_update`,
  `account_update`. Na conexão, o código **pede** a sincronização dos contatos e do histórico
  (`requestCoexistenceSync`) e **descarta** o que chega.

### 1.5 Infraestrutura [existe]

Produção: **Supabase Pro** (São Paulo, backup diário) + **Vercel Pro** (`gru1`); staging no plano gratuito. Banco
acessado pelo `supabase-js` (HTTP/PostgREST, que já faz o pool de conexões). Rotinas por pg_cron → rotas
`/api/cron/*`. Sem fila, sem Realtime.

---

## 2. O que existe, reaproveita, muda e cria

| Necessidade | Situação | Detalhe |
|---|---|---|
| Recebimento, assinatura, clínica pelo número | **[reaproveitar]** | Sem mudança |
| Idempotência de mensagens | **[reaproveitar]** | Índice único `(clinic_id, wa_message_id)` |
| Histórico único | **[alterar]** `whatsapp_messages` | Guardar texto (D12), autor, usuário, mídia, hora da Meta |
| Conversa | **[reaproveitar]** `conversation_state` | + responsável, hora e prévia da última mensagem, não lidas |
| Atendimento (episódio) | **[reaproveitar]** `handoff_id` | Já um por atendimento |
| Auditoria | **[alterar]** `handoff_events` | + assumir, transferir; leituras em tabela própria |
| Situação do atendimento | **[reaproveitar]** CA | `waiting_clinic` / `in_progress` / bot; ver 3.2 |
| Bot calado no atendimento | **[reaproveitar]** `human_handoff` | Envio pelo painel também pausa (como o eco) |
| Envio de texto | **[reaproveitar]** `sender.text` | Janela de 24 h já calculada (`CUSTOMER_SERVICE_WINDOW_MS`) |
| Envio de documento/imagem | **[alterar]** `send.ts` | `document` existe; criar `image` (e `audio`/`video` se decidido) |
| Download de mídia recebida | **[criar]** | Rotina assíncrona → bucket `whatsapp-media` |
| Caixa de entrada e tela da conversa | **[alterar]** `atendimento.astro` | Vira a Central (lista + conversa) |
| Notificações | **[reaproveitar]** `attentionPush.ts` | Etapa 2 amplia (atribuída a mim) |
| Rotina de 12 h | **[reaproveitar]** `handoffReturn.ts` | Avaliar com responsável (ver 3.2) |
| Anonimização | **[alterar]** `anonymize_patient` | Apagar texto e mídias do paciente |
| Leitura do texto pelo login | **[alterar]** | Hoje fechada (D12); reabrir só por função com checagem de papel |
| Item da matriz (D11) | **[criar] [decidir]** | Ex.: "Central de atendimento" |
| Métricas | **[reaproveitar]** | `handoff_events` + mensagens com autor |

---

## 3. Arquitetura proposta

### 3.1 Desenho

```
Paciente ─WhatsApp─▶ Meta ─webhook─▶ /api/whatsapp/webhook (Vercel gru1)
                                        │ assinatura, clínica pelo phone_number_id
                                        ▼
                         processWebhook ──▶ whatsapp_messages (texto, autor, mídia pendente)
                                        │        └─ gatilho: conversation_state.last_message_at / não lidas
                                        ├─▶ human_handoff = false → bot (router.ts) → sender → Meta
                                        └─▶ human_handoff = true  → bot calado; push "aguardando"
pg_cron ─▶ /api/cron/midias ─▶ Graph (GET mídia) ─▶ Storage whatsapp-media (privado)

Recepção (painel) ─▶ /admin/atendimento (Central)
   lista: conversation_state (+ contacts)     conversa: whatsapp_messages paginada
   assumir/transferir/finalizar ─▶ conversation_state (update condicional) ─gatilho─▶ handoff_events
   enviar ─▶ /api/admin/atendimento/enviar ─▶ registra (sending) ─▶ sender ─▶ Meta ─▶ status pelo webhook
   anexo  ─▶ upload direto ao Storage (URL assinada) ─▶ servidor sobe à Meta (uploadMedia) ─▶ envia
```

Sem fila nova na Etapa 1: só a mídia sai do webhook (rotina). Fila para o bot fica para quando o volume pedir
(seção 7).

### 3.2 Situações e máquina de estados [decidir]

A CA (04/nov) decidiu **duas** situações, sem "Aguardar paciente", após ver as opções desenhadas. O pedido traz
cinco. Proposta que atende os dois sem estado inconsistente: **guardar pouco e derivar o resto**.

| Guardado (`conversation_state`) | Pedido | Como se obtém |
|---|---|---|
| `human_handoff = false` | Finalizado / com o bot | Já existe |
| `waiting_clinic`, sem responsável | **Não atribuído** | `assigned_to is null` |
| `waiting_clinic`, com responsável | **Aguardando atendimento** | Paciente escreveu por último |
| `in_progress`, com responsável | **Em atendimento** | Clínica respondeu por último |
| `in_progress` + última mensagem da clínica há X min | **Aguardando paciente** | Derivado (filtro), não estado |

Transições (todas por `update` condicional, como `finishAttendance` já faz):

```
bot ──pedido/limite/não entendeu──▶ waiting_clinic (sem responsável)
bot ──recepção escreve (painel ou app)──▶ in_progress (responsável = quem escreveu; app = sem usuário)
waiting_clinic ──Assumir──▶ waiting_clinic (responsável = eu)   [só se assigned_to is null ou confirmar troca]
waiting_clinic ──resposta da clínica──▶ in_progress
in_progress ──paciente escreve (não cortesia)──▶ waiting_clinic (responsável continua)
qualquer ──Transferir──▶ mesma situação, responsável = outro
qualquer ──Finalizar / #bot / 12 h──▶ bot (responsável apagado, handoff_id encerra)
bot ──paciente escreve depois de finalizado──▶ bot responde (regra da CA)
```

**Assumir ao mesmo tempo:** `update … set assigned_to = eu where id = … and assigned_to is null` (ou
`= quem eu vi`); 0 linhas = "Fulana assumiu agora"; a tela recarrega. Responder sem assumir: **[decidir]** se
assume sozinho (recomendado) ou se exige assumir antes.

**Rotina de 12 h:** hoje encerra "Em atendimento" parado. Com responsável, pode continuar igual (segurança
quando ninguém finaliza) **[decidir]**.

### 3.3 Fluxo completo de mensagens

1. Paciente envia → Meta → POST no webhook → assinatura ok → clínica pelo `phone_number_id`.
2. `recordInboundMessage` grava (com texto e `media_status = 'pending'` se houver mídia). Repetida: índice
   único barra, nada mais acontece (já é assim).
3. Gatilho atualiza `conversation_state.last_message_at`, prévia e não lidas.
4. `markPatientWrote` (já existe): `in_progress` → `waiting_clinic`.
5. `human_handoff = false` → bot responde como hoje (nenhuma mudança no caminho do bot).
   `human_handoff = true` → bot calado; push "aguardando" (já existe).
6. Bot decide transferir → `pauseForHuman` (já existe) → aparece em "Não atribuídas".
7. Usuário assume → update condicional → evento `assigned`.
8. Usuário envia: a rota confere papel, clínica, conversa em atendimento (ou pausa agora, como o eco), janela de
   24 h; grava a linha com `status = 'sending'` e uma chave de idempotência do formulário; chama
   `sender.text`; atualiza com o `wa_message_id` ou `failed` (+ motivo).
9. Situações `sent`/`delivered`/`read`/`failed` chegam pelo webhook (`updateDeliveryStatus`, já existe).
10. Paciente responde → passo 1, mesma conversa (mesma linha de `conversation_state`, mesmo `handoff_id`).
11. Finalizar → `returnToBot` (já existe, silencioso). Próxima mensagem do paciente → bot.

### 3.4 Situações especiais

| Situação | Tratamento |
|---|---|
| Várias mensagens seguidas | Cada uma grava; a conversa já está pausada; push com intervalo (já existe) |
| Atendente demora | Fica em "Aguardando"; ordenação pela espera; Etapa 2: alerta de tempo |
| Dois assumem | Update condicional; o segundo recebe aviso |
| Transferência | Update condicional + evento `transferred` (de, para, quem) |
| Paciente responde após finalizar | Bot responde (CA); a conversa mostra o histórico inteiro, com o atendimento anterior encerrado |
| Webhook repetido | Índice único; mídia baixada uma vez (chave pelo id da mensagem) |
| Falha temporária da Meta | Envio do painel **não** entra no reenvio automático: mostra "Não enviada · Tentar de novo" (o atendente decide) |
| Enviada, não entregue | `status` fica em `sent`; `failed` mostra o motivo (`failure_code`) |
| Bot e atendente juntos | O envio do painel primeiro pausa (`pauseForHuman`) e só depois envia; o bot relê `human_handoff` antes de responder. Janela residual: bot já no meio da resposta (ms). Mitigação: reler a pausa antes de cada envio do bot **[alterar, avaliar]** |
| Recepção no app e no painel (coexistência) | O app continua gerando eco (`agent_reply`, agora com texto); a Central mostra "pelo app" sem usuário. Risco de resposta dupla: só se resolve com regra de uso **[decidir]** |
| Fora da janela de 24 h | Texto livre bloqueado (já é regra do envio); só template aprovado **[decidir]** |

---

## 4. Modelagem de dados (proposta, tudo aditivo)

### 4.1 `whatsapp_messages` [alterar]

| Coluna nova | Tipo | Por quê |
|---|---|---|
| `author` | text (`patient`, `bot`, `system`, `agent_app`, `agent_panel`) | Quem escreveu, sem depender do `message_type`; carga pelo tipo atual |
| `sent_by` | uuid → `auth.users` | Usuário do painel |
| `handoff_id` | uuid | Atendimento a que a mensagem pertence (métricas) |
| `wa_timestamp` | timestamptz | Hora da Meta (`timestamp` do evento); ordem: `coalesce(wa_timestamp, created_at), id` |
| `media_id` | uuid → `whatsapp_media` | Anexo |
| `client_key` | uuid, único por clínica | Idempotência do envio pelo painel (duplo clique, recarregar) |
| `body` | (existe) | Voltar a guardar entrada e `agent_reply` **só com a D12 revista** e, recomendado, só nas clínicas com a Central |

Índice novo: `(clinic_id, contact_phone, created_at desc, id)` **sem filtro de direção** (paginação do histórico).

### 4.2 `whatsapp_media` [criar]

`id`, `clinic_id`, `message_id`, `direction`, `meta_media_id`, `mime_type`, `size_bytes`, `sha256`,
`file_name`, `storage_path` (único), `status` (`pending`, `stored`, `failed`, `too_large`, `deleted`),
`attempts`, `error`, `created_at`, `stored_at`, `deleted_at`. RLS por clínica; gravação só pelo serviço.

### 4.3 `conversation_state` [alterar]

`assigned_to` (uuid), `assigned_at`, `last_message_at`, `last_message_preview` (até 120 caracteres, **[decidir]**
com a D12), `last_message_author`, `last_patient_at` (janela de 24 h sem consulta extra), `unread_count` (se não
lidas por clínica). Índice `(clinic_id, human_handoff, last_message_at desc)` para a caixa de entrada.

### 4.4 Não lidas [criar] [decidir]

- **Por clínica** (simples): `unread_count` zera quando alguém abre. Bom para equipe pequena.
- **Por usuário** (recomendado para várias secretárias): tabela `conversation_reads (clinic_id, contact_phone,
  user_id, last_read_at)`; não lidas = mensagens do paciente depois de `last_read_at`.

### 4.5 Auditoria [alterar] [criar]

- `handoff_events`: + `kind` (`status`, `assigned`, `transferred`, `finished`) e `assigned_from`/`assigned_to`;
  continua só por gatilho.
- `conversation_access_log` [criar]: quem abriu qual conversa e quem baixou qual anexo (exigência de LGPD para
  dado de saúde; o Suporte já tem leituras registradas pela D6).

### 4.6 Por que não `conversations` / `messages` novas

Já existem com outro nome; duplicar quebraria o bot, as Métricas, o reenvio e a anonimização, e exigiria migrar
o histórico. Uma conversa por telefone + `handoff_id` por atendimento cobre "conversa" e "atendimento".
`conversation_assignments` vira eventos `assigned`/`transferred` na `handoff_events`.

### 4.7 Histórico existente

Mensagens antes da Central não têm texto (apagado em 28/out, sem volta): a conversa mostra "Mensagem anterior à
Central de Atendimento" com tipo e hora. Carga do `author` pelo `message_type`/`direction`.

---

## 5. Integração com a Meta

| Item | Situação | Ação |
|---|---|---|
| `whatsapp_business_messaging` (texto e mídia na janela) | Aprovada (acesso avançado) | Nenhuma nova permissão prevista; o texto da Verificação do acesso já diz "a recepção pode assumir a conversa" e "vê as respostas dos pacientes" |
| Uso diferente do vídeo da análise | A conferir | Ver na política da Meta se nova funcionalidade com a mesma permissão pede nova análise (em geral não) **[validar]** |
| Campos do webhook | `messages`, ecos, templates, `account_update` | Conferir no painel do app os campos assinados (inclui `history` e `smb_app_state_sync`) **[validar]** |
| Mídia recebida | Não baixada hoje | `GET /{media-id}` devolve URL temporária (minutos) que exige o token; baixar logo (rotina) **[validar prazos na doc atual]** |
| Mídia enviada | `uploadMedia` existe | Subir e enviar por `media_id`; limites de tamanho por tipo **[validar na doc atual]** |
| Janela de 24 h | Regra no envio (`CUSTOMER_SERVICE_WINDOW_MS`) | Fora dela, só template; criar um de utilidade "retomar conversa" pode ser classificado como marketing **[decidir/validar]** |
| Token | Por clínica, no Vault, do Embedded Signup | Sem renovação nova; erro 190 já leva à desconexão |
| Histórico antigo | `requestCoexistenceSync('history')` pedido e descartado | A Meta só envia o histórico do app **uma vez, na conexão** (período limitado). Clínicas já conectadas perderam essa janela; para clínicas novas, guardar o que chega **[decidir]**. Não há API genérica para buscar mensagens antigas |
| Custo | Conversa de serviço | Respostas na janela não pagam template; conferir a tabela de preços vigente **[validar]** |

### 5.1 Conferência na documentação da Meta (CN0, 05/nov/2026)

Páginas lidas em 05/nov: [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/),
[history webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/history),
[Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing),
[Non-template messages pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages),
[Media](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media/).

**Alertas que valem já para a produção (fora da Central):**

1. **Mensagens de serviço passaram a ser cobradas em 01/out/2026.** Toda mensagem fora de template dentro da janela
   (respostas do bot, listas, botões e, depois, a Central) é cobrada por mensagem; **1.000 grátis por mês por
   número** (não acumula). Preço no Brasil igual ao de utilidade (referência da Meta: US$ 0,0068 por mensagem em
   jul/2026; tabela em BRL não lida). Utilidade dentro da janela também passou a ser cobrada (antes grátis).
   **Sem forma de pagamento na conta da clínica, a Meta para de entregar depois das 1.000 do mês.** Impacto: custo
   do bot para as clínicas (contrato, venda) e risco de o bot parar numa clínica sem pagamento (o guia
   `/guia/pagamento-meta` da IS1 já pede a forma de pagamento; conferir as clínicas em produção).
2. **Embedded Signup v2 e v3 descontinuados em 15/out/2026** (a página manda migrar para a v4). O botão de conexão
   usa `sessionInfoVersion: "3"` (`src/components/admin/WhatsappSignupButton.astro:132`). Conexões já feitas não
   mudam; **conexões novas podem falhar**. Conferir e migrar antes da próxima clínica.

**Central (o que muda no plano):**

| Item | Resultado |
|---|---|
| Campos do webhook na coexistência | `account_update`, `history`, `smb_app_state_sync`, `smb_message_echoes` (+ `messages`). Conferir no painel do app que os quatro estão assinados |
| Ecos | Edição e exclusão feitas no app chegam como `smb_message_echoes` (objeto de edição/`revoke`): a Central precisa mostrar "mensagem apagada/editada" **[criar]** |
| App × janela | "Mensagens enviadas pelo app não estão sujeitas à janela e não afetam janelas nem preços da Cloud API" (confirma a decisão 7) |
| Espelhamento | Mensagens da Cloud API (bot, Central) aparecem no app, e as do app chegam como eco |
| Limitações da coexistência | Sem grupos, mensagem temporária, visualização única, localização em tempo real, chamadas; respostas rápidas, saudação e ausência do app não suportadas. Dispositivos companheiros sem suporte (ex.: WhatsApp para Windows) não geram eco |
| Vazão | 20 mensagens/s por número em coexistência (sobra para os cenários da seção 7) |
| Histórico (decisão 10) | Pedir em até **24 h** após a conexão, **uma única vez** (repetir só desconectando e refazendo o cadastro). Até **180 dias**, em 3 fases (dia 0–1, 1–90, 90–180), em partes fora de ordem (`chunk_order`, `progress` até 100), com milhares de mensagens por evento: **gravar o evento e processar depois** (rotina, não no webhook). Sem grupos. Mídia vem como `media_placeholder`; o conteúdo só das mídias dos últimos 14 dias (a página se contradiz: "14 dias da conexão" × "duas semanas da consulta"). Recusa da clínica: erro `2593109` |
| Mídia recebida | URL vale **5 min** (pedir de novo pelo id); Cloud API aceita até 100 MB (acima: erro `131052`). Limites: imagem 5 MB (JPEG/PNG), áudio 16 MB (AAC, AMR, MP3, M4A, OGG/OPUS), vídeo 16 MB (MP4/3GP), documento 100 MB, figurinha 100–500 KB |
| Mídia enviada | Mesmos limites; a Central envia foto até **5 MB** (limite da Meta para imagem) e PDF até 10 MB (decisão 8b ajustada) |
| Nova análise do app | Nada nas páginas lidas exige nova análise para uso novo da mesma permissão; manter como verificação ao publicar |
| Janela só depois da conexão | Paciente que escreveu antes da conexão: só template até ele escrever de novo |

---

## 6. Mídias

- **Bucket** `whatsapp-media`, privado, caminho `<clinic_id>/<contact_phone sem +>/<message_id>.<ext>`;
  política pela `app.storage_folder_clinic` (já existe) + checagem de papel/atribuição.
- **Recebidas:** o webhook só grava `whatsapp_media (pending)`; rotina `/api/cron/midias` (pg_cron, a cada
  minuto) baixa, confere tamanho e tipo, calcula `sha256`, sobe ao Storage, marca `stored`; 3 tentativas.
  Fora do webhook para não atrasar o 200 à Meta.
- **Enviadas:** o navegador sobe **direto ao Storage** com URL assinada de upload (as funções da Vercel limitam o
  corpo da requisição a poucos MB); a rota lê do Storage, `uploadMedia` e envia.
- **Leitura:** URL assinada de curta duração (ex.: 5 min), gerada só pela rota que confere o acesso e registra
  em `conversation_access_log`.
- **Tipos e limites [decidir]:** proposta Etapa 1 — imagens (JPG, PNG, WEBP), PDF, áudio (OGG/MP3/AAC) recebidos;
  enviar imagem e PDF até 10 MB (igual a documentos do paciente). Vídeo e figurinha: mostrar "não suportado,
  abra no app".
- **Retenção [decidir]:** proposta — mídias por 12 meses (configurável por clínica), texto pelo prazo do
  contrato; apagar arquivo e marcar `deleted`; anonimização apaga na hora.
- **Antivírus:** o Supabase não verifica arquivo; documento recebido abre só para download (sem pré-visualização
  de HTML/SVG; `content-disposition: attachment`).

---

## 7. Escalabilidade

### 7.1 Estimativas (premissas: ~1 KB por linha com índices e texto; 10% das mensagens com mídia, 300 KB em média)

| Cenário | Mensagens/mês | Banco/mês | Banco/ano | Mídia/mês | Webhooks (média → pico ×10) |
|---|---:|---:|---:|---:|---:|
| Inicial (10) | 30 mil | ~30 MB | ~0,4 GB | ~0,9 GB | 0,01/s → 0,1/s |
| Crescimento (100) | 300 mil | ~0,3 GB | ~3,6 GB | ~9 GB | 0,1/s → 1/s |
| Escala (1.000) | 3 milhões | ~3 GB | ~36 GB | ~90 GB | 1,2/s → 12/s |

Supabase Pro inclui disco e Storage com cota e cobra o excedente por GB; conferir a tabela vigente
**[validar]**. Até o cenário de crescimento, cabe no plano atual; na escala, o custo dominante é **mídia**
(retenção resolve).

### 7.2 Quando cada estratégia entra

| Estratégia | Quando | Agora? |
|---|---|---|
| Índice do histórico e da caixa de entrada (4.1, 4.3) | Etapa 1 | **Sim** |
| Paginação (últimas 50, "carregar anteriores" por cursor `created_at,id`) | Etapa 1 | **Sim** |
| Lista separada do histórico | Etapa 1 (lista lê só `conversation_state`) | **Sim** |
| Idempotência (Meta e painel) | Etapa 1 | **Sim** (Meta já tem) |
| Mídia assíncrona | Etapa 1 | **Sim** |
| Atualização da tela | Etapa 1: consulta a cada 10–15 s na lista e 5 s na conversa aberta; Realtime do Supabase quando passar de ~50 usuários simultâneos ou o cliente pedir instantâneo | Consulta periódica |
| Pool de conexões | Já existe (PostgREST); só importa se surgir acesso direto ao Postgres | Não |
| Fila para o bot (pgmq/Supabase Queues) | Webhook com p95 > 3 s, ou cenário de crescimento | Não |
| Monitorar consultas lentas, CPU, I/O, conexões | Painel do Supabase + `pg_stat_statements`; revisão mensal a partir do crescimento | Rotina |
| Arquivamento (mensagens > 24 meses para tabela fria) | > ~50 milhões de linhas | Não |
| Particionamento por mês | > ~100 milhões de linhas ou índices maiores que a memória | Não |
| Réplica de leitura / computação maior | Escala, se CPU > 70% sustentado | Não |
| Banco por clínica | Sem justificativa: RLS + `clinic_id` em todo índice basta (D1) | Não |

Backup: diário do Pro já ativo; avaliar PITR quando o histórico de conversa virar dado de trabalho diário
**[decidir]**. Storage não entra no backup do banco: ver política de cópia do bucket **[validar]**.

---

## 8. Segurança e LGPD

- **Base:** dado de saúde (art. 11). Guardar texto e anexos reverte a D12; exige atualizar **termo de tratamento,
  contrato e política de privacidade** (pendência com advogado, como na D6) **[decidir]**.
- **Minimização:** guardar o texto **só nas clínicas com a Central ligada**; as outras seguem a D12 como hoje.
- **Isolamento:** `clinic_id` em todas as tabelas novas, RLS por clínica, caminho do Storage começando pela
  clínica, cliente de serviço limitado à clínica (D1).
- **Leitura do texto:** continua **fechada** para o login direto pela API (`grant` por coluna da migração
  `20261028150000`); a tela lê por função `security definer` que confere papel, item da matriz e atribuição, e
  registra a leitura. Evita que um login leia tudo pela API do Supabase.
- **Perfis [decidir]:** proposta — Administrador e Recepção: todas as conversas da clínica; Profissional: só as
  atribuídas a ele (por transferência); Suporte: todas, com registro (D6).
- **Anexos:** URL assinada curta, gerada só após a checagem; sem URL pública.
- **Tokens:** seguem no Vault; nunca no navegador.
- **Webhook:** assinatura HMAC já conferida; nada muda.
- **Retenção e exclusão:** prazo por clínica; anonimização apaga texto e mídia; exclusão da clínica apaga o bucket.
- **Backup:** texto apagado some do backup no prazo de retenção do backup (informar no termo).
- **Risco de acesso indevido:** login compartilhado na recepção, celular perdido com sessão aberta, captura de
  tela. Mitigações: sessão com prazo, registro de leitura, Etapa 2: aviso de acesso fora do horário.

---

## 9. Métricas futuras (a modelagem permite)

| Indicador | Fonte |
|---|---|
| Conversas recebidas | `whatsapp_messages` (entrada) por telefone/dia |
| Resolvidas pelo bot / encaminhadas | `handoff_events` (`bot → waiting_clinic`) e a regra da C21 |
| Taxa sem humano | As duas acima |
| Primeira resposta humana | 1ª mensagem `agent_*` do `handoff_id` − início do `handoff_id` |
| Tempo de atendimento | Fim − início do `handoff_id` |
| Pendentes | `conversation_state` com `waiting_clinic` |
| Por usuário | `sent_by`, `handoff_events.actor_id`, `assigned_to` |
| Finalizadas (manual, 12 h, `#bot`) | `handoff_events.origin` |
| Enviadas e recebidas | `whatsapp_messages` por `author` |

Limite: respostas pelo app (eco) não têm usuário.

---

## 10. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Rever a D12 (dado de saúde guardado) | Jurídico/LGPD | Só com a Central ligada, leitura registrada, retenção, termo revisado |
| Mudança quebrar o bot em produção | Clínicas reais sem atendimento | Tudo aditivo; caminho do bot intocado; suítes do bot como portão (seção 13); staging antes |
| Coexistência: resposta dupla app + painel | Paciente confuso | Mostrar "respondido pelo app às…" ao vivo; regra de uso **[decidir]** |
| Corrida bot × atendente | Mensagem do bot no meio do atendimento | Pausar antes de enviar; reler pausa antes do envio do bot |
| Webhook lento com mídia/volume | Meta reenvia, eventos duplicados | Mídia assíncrona; fila depois |
| Hora de chegada ≠ hora da Meta | Ordem errada | `wa_timestamp` |
| Custo de Storage | Fatura | Retenção, limites, só tipos aceitos |
| Profissional sem acesso hoje (D6) | Regra nova de visibilidade | Decisão explícita e teste de RLS |
| Nome "Atendimento" já usado (agenda e atendimento humano) | Confusão de tela | Nome da tela **[decidir]** |
| Central de Ajuda e capturas | Telas mudam | Anotar em `capturas-pendentes.md` (regra do projeto) |
| Jornada do bot | Fluxograma desatualizado | Atualizar `botJourney.ts` se a transferência mudar |

---

## 11. Decisões do cliente e validações

**Decisões (uma por vez, pela ferramenta de perguntas, nesta ordem):**

1. **Rever a D12:** ~~guardar texto e mídias do paciente e da recepção~~ **Decidido (05/nov): só nas clínicas com a
   Central ligada, com retenção e leitura registrada** (revisão registrada na D12, `arquitetura.md`).
2. **Coexistência:** **Decidido (05/nov): app e Central juntos, sem configuração.** Primeiro o cliente escolheu
   "cada clínica escolhe" (app e Central / só Central); depois das decisões 7 e 8c a diferença ficou só no aviso da
   resposta pelo app, e o cliente tirou a configuração. Resposta pelo app (eco): chega ao paciente normalmente
   (a Meta não deixa bloquear), entra no histórico da Central em segundos com o texto, marcada "Respondida pelo app
   do WhatsApp" (sem o nome de quem respondeu); pausa o bot e põe "Em atendimento" como hoje; não muda o
   responsável; `#bot` no app segue finalizando; a mensagem automática do app (IS4) não conta como resposta.
   A Central de Ajuda explica os dois caminhos.
3. **Situações:** **Decidido (05/nov): lista única** (opção C do canvas
   https://claude.ai/artifact/X5J2LaD5AshozLPrKqV6fa). Abas "Abertas" e "Finalizadas"; nas Abertas, cada conversa
   com o selo da situação (Aguardando a clínica / Em atendimento) e o responsável, "Aguardando a clínica" no topo;
   filtro numa caixa de seleção (Todas, Não atribuídas, Minhas, Aguardando paciente). No banco, continuam as 2
   situações da CA + responsável (3.2); as demais são calculadas. Muda a tela de abas da CA (Aguardando a clínica /
   Em atendimento / Notificações): onde ficam as Notificações, decidir no desenho da tela (CN3).
4. **Quem vê:** **Decidido (05/nov): Administrador e Recepção veem todas as conversas da clínica; o Profissional só
   as transferidas a ele** (responde e finaliza; depois de finalizada ou transferida a outro, deixa de ver). Suporte:
   todas, com registro (D6). Vale no banco (função de leitura e Storage) e na tela. A conversa não tem agenda, então
   não há restrição da Recepção por agenda.
5. **Responder assume:** **Decidido (05/nov).** Quem envia numa conversa sem responsável vira o responsável; com
   outra dona, a tela confirma antes ("Está com Ana. Responder e assumir?"); envio simultâneo: só o primeiro sai, o
   segundo recebe "Ana assumiu agora" e a mensagem não é enviada. Resposta pelo app (eco) não define responsável.
   O responsável não esconde a conversa: Administrador e Recepção veem todas e podem assumir ou transferir.
   **Liberação automática (decidido, 05/nov):** paciente esperando **30 min** sem resposta da responsável → volta
   para "Sem responsável" e todas recebem a notificação ("Maria Souza aguarda há 30 min"); se estava com um
   Profissional, volta para a Recepção. Rotina por pg_cron (como a de 12 h), evento `released` na `handoff_events`.
   Prazo ajustável por clínica: avaliar no CN4.
6. **Não lidas:** **Decidido (05/nov): por pessoa** (tabela `conversation_reads`, 4.4): abrir a conversa zera só para
   quem abriu.
7. **Fora das 24 h:** **Decidido (05/nov).** A conversa continua "Aguardando a clínica" no fim de semana e no
   feriado (regra da CA, sem mudança). Passadas 24 h da última mensagem do paciente, a caixa de texto trava com o
   aviso e o botão **"Retomar conversa"**, que envia um modelo de utilidade aprovado pela Meta (pago por envio, na
   conta da clínica); a resposta do paciente reabre a janela. **A Central não tem o botão "Abrir no WhatsApp"**
   (cliente: gera confusão; exceção só na 8c); usar o app segue possível por conta da equipe. Padrão do mercado
   (caixas sobre a Cloud API): o mesmo. Criar o modelo (texto, classificação de utilidade) no CN4; texto a aprovar
   pelo cliente.
8. **Retenção:** **Decidido (05/nov): texto 5 anos, mídias 12 meses**; vencido, uma rotina apaga (mídia: arquivo
   apagado e `whatsapp_media.status = 'deleted'`; texto: `body` nulo). Anonimização apaga na hora. Documento
   importante: botão "Salvar nos documentos do paciente" (Etapa 2), fora desse prazo. Advogado confirma o prazo.
   **Tipos de mídia (8b, decidido 05/nov):** recebe e mostra foto, PDF/documento (baixar) e áudio (tocador); vídeo e
   figurinha só com aviso, sem guardar o arquivo. Envia foto e PDF até 10 MB. Gravar áudio pelo painel: Etapa 2.
   **Fora do limite (8c, decidido 05/nov):** documento recebido até 16 MB é guardado; vídeo ou arquivo acima do
   limite mostra, **só naquela mensagem**, o aviso "O paciente enviou um vídeo (35 MB). A Central não mostra
   vídeos: veja e responda esta mensagem pelo app do WhatsApp." **com o botão "Abrir no WhatsApp"** (única exceção
   à decisão 7; o app recebe tudo na coexistência). Clínica sem
   coexistência: "peça ao paciente para enviar como foto ou PDF", sem botão.
9. **Matriz (D11) e preço:** **Decidido (05/nov): item novo "Central de atendimento", liberado pelo Suporte,
   depende do bot** (só liga com o bot; desligar o bot desliga a Central). Central sem bot: avaliar na Etapa 2.
   Ligar o item ativa a guarda do texto e das mídias (D12 revista). Preço/pacote: a decidir.
10. **Histórico do app na conexão:** **Decidido (05/nov): guardar.** Na conexão (ou reconexão) de clínica com a
    Central ligada, o histórico do app que a Meta envia uma única vez (`requestCoexistenceSync('history')`, hoje
    descartado) entra no histórico da Central, com a data original e o mesmo prazo de guarda (texto 5 anos, mídia 12
    meses, contados da data original; tipos da 8b). Clínicas já conectadas (inclusive a piloto) não recebem.
    Período e formato do evento `history`: conferir na documentação atual da Meta.
11. **Rotina de 12 h:** **Decidido (05/nov): mantém, igual para todas** (com ou sem responsável). "Em atendimento"
    sem mensagem há 12 h volta ao bot em silêncio, o responsável sai e a conversa vai para Finalizadas; se o paciente
    escrever depois, o bot responde e, pedindo a recepção, a conversa volta sem responsável, com todo o histórico.
12. **Nome da tela:** **Decidido (05/nov): "Conversas"** (substitui "Atendimento humano"); o botão segue "Finalizar
    atendimento"; o item da matriz pode continuar "Central de atendimento". Lugar no menu: no desenho da tela (CN3).
    Muda Central de Ajuda, notificações e capturas (anotar em `capturas-pendentes.md` no CN3).

**Ainda pendentes:** preço/pacote do item (9); texto do modelo "Retomar conversa" (7, no CN4); desenho das telas
(CN3, com as opções desenhadas); advogado (D12 revista, prazos da 8a); conferências da Meta (seção 5).

**Validações técnicas (sem decisão de negócio):** campos assinados do webhook no app da Meta; prazos e limites de
mídia e do histórico na documentação atual; preços da Meta e do Supabase; política de nova análise do app;
termo/contrato com advogado.

---

## 12. Plano de implementação (após aprovação)

Cada passo: staging, roteiro no `staging.md`, validação do cliente, depois produção. Tudo atrás do item da matriz.

**Etapa 1 — Central de Atendimento**

| Passo | Conteúdo | Migração |
|---|---|---|
| CN0 | Decisões da seção 11; termo/contrato; conferências da Meta | — |
| CN1 | Colunas novas (4.1, 4.3), `whatsapp_media`, bucket, item da matriz, funções de leitura com registro, carga do `author` | Sim (aditiva) |
| CN2 | Gravar texto (entrada e eco) e `wa_timestamp` nas clínicas com a Central; `last_message_at`/prévia por gatilho | — |
| CN3 | Caixa de entrada (filtros, busca por nome/telefone, ordem) e tela da conversa só leitura, paginada | — |
| CN4 | Enviar texto (janela de 24 h, idempotência, pausa antes, falha com "Tentar de novo"); assumir e finalizar; não lidas | Talvez (`conversation_reads`) |
| CN5 | Mídia recebida (rotina de download, visualização por URL assinada) | — |
| CN6 | Enviar imagem e PDF | — |
| CN7 | Ajuda, capturas pendentes, Jornada do bot, roteiro de staging | — |

**Etapa 2 — Gestão:** transferência com motivo, notas internas (não vão ao paciente), respostas rápidas por
clínica, notificações "atribuída a mim", alertas de espera, pendências.

**Etapa 3 — Inteligência:** indicadores (seção 9) nas Métricas, produtividade por usuário, gargalos, sugestão de
resposta e resumo por IA (exige decisão própria de LGPD: dado de saúde enviado a provedor de IA), priorização.

---

## 13. Testes para não prejudicar o bot

**Portão (rodar antes e depois de cada passo, sem mudar resultado):** `tests/db/bot-*.test.ts` (entrada, marcar,
gerenciar, limites, não entende, base de conhecimento, não concluído, assunto, bloqueio, convênio, pediatria),
`atendimento-humano.test.ts`, `ciclo-atendimento-humano.test.ts`, `envio-whatsapp.test.ts`,
`acesso-whatsapp.test.ts`, `src/lib/data/whatsapp/*.test.ts` (webhook, cortesia, reenvio, lembretes, templates).

**Novos:**

- Webhook repetido: uma linha, uma resposta do bot, uma mídia baixada.
- Clínica sem a Central: texto **não** é guardado (D12 continua).
- Clínica em implantação e número do suporte: nada muda.
- Bot calado com a conversa pausada; envio pelo painel pausa antes de enviar.
- Dois usuários assumem ao mesmo tempo: um vence, o outro recebe aviso.
- Transferência e finalização geram eventos certos; finalizar com mensagem nova recusa (regra da CA).
- Paciente escreve depois de finalizado: bot responde.
- Fora da janela de 24 h: envio recusado.
- Falha da Meta no envio: `failed` com motivo; "Tentar de novo" não duplica (chave do formulário).
- Ordem por `wa_timestamp` com eventos fora de ordem.
- RLS: login de outra clínica não lê mensagem, mídia nem caminho do Storage; login direto pela API não lê `body`;
  Profissional só vê o atribuído (se decidido).
- Anonimização apaga texto e mídia.
- Leitura e download registrados em `conversation_access_log`.
- Tela: 390 px e 1280 px (regra do projeto).

---

## 14. Custo da Meta: ativação pela clínica, medição e calculadora (cliente, 05/nov/2026)

**Por quê:** desde 01/out/2026 a Meta cobra cada mensagem que sai pela API (bot, Central, avisos), com 1.000
mensagens de serviço grátis por mês e por número (seção 5.1); as respostas pelo app do WhatsApp não são cobradas.
O cliente quer o custo claro para a clínica antes de ela usar o atendimento pelo RecepClinic.

**Pedido do cliente:**

1. **Ativação pelo Administrador da clínica.** A Central (tela "Conversas") é ligada pelo Administrador da clínica,
   numa tela que mostra com clareza o valor cobrado pela Meta. **[decidir: relação com o item da matriz liberado
   pelo Suporte, decisão 9]**
2. **Medição em tempo real** nessa mesma tela: mensagens enviadas no mês (por tipo) e o valor estimado a ser cobrado
   pela Meta.
3. **Calculadora no Suporte:** Sistema › Vendas ganha uma aba (ao lado de Planos, Demonstração, Roteiro de vendas e
   Implantação) para estimar o valor médio pago à Meta por clínica. Campos: quantidade de profissionais, dias de
   atendimento por semana, média de atendimentos por dia. Resultado: valor médio das mensagens que o RecepClinic já
   envia hoje (avisos e bot), estimativa com o atendimento pelo RecepClinic (Central) e o total.

**O que existe [reaproveitar]:** `clinic_usage_monthly` (mensagens e atendimentos por clínica e mês, `app.bump_usage`)
e a tela Sistema › Uso, que separa templates das demais mensagens. **[alterar]** O texto da tela Uso diz "respostas
do bot e da conversa (sem custo na janela de 24h)", que deixou de valer em 01/out.

**Proposta técnica (a confirmar com as decisões):**

- **Contagem:** pelas próprias mensagens (`whatsapp_messages`, saída, entregues ou enviadas), por categoria: modelo de
  utilidade (confirmação, lembrete, preparo por modelo, retomar conversa), serviço (bot, avisos de texto, Central).
  Resposta pelo app (eco) aparece só como "grátis, pelo app". A franquia de 1.000 de serviço é descontada no mês.
- **Preço:** tabela da Meta no Brasil guardada em Sistema (valor por categoria, moeda, data de vigência), editada pelo
  Suporte quando a Meta muda; câmbio também em Sistema (ou a clínica que paga em reais usa o valor em BRL da tabela).
  A Meta não tem uma API simples de preço por mensagem para a clínica; a fatura real fica no Gerenciador do WhatsApp da
  clínica. A tela diz "estimativa" e onde ver o valor oficial.
- **"Tempo real":** a contagem lida a cada abertura da tela (consulta somada no mês, com índice por clínica e data);
  sem rotina nova.
- **Calculadora:** parâmetros médios (mensagens por atendimento por tipo, % de atendimentos que vão para a
  recepção, respostas por atendimento humano) com valor padrão tirado da produção (média real das clínicas) e
  editáveis pelo Suporte; a calculadora só lê, não grava.

**Etapas propostas (antes do CN3, porque a ativação depende delas):**

| Passo | Conteúdo |
|---|---|
| CU1 | Medir a produção: mensagens por clínica em outubro, por tipo, e médias por atendimento (só leitura, para calibrar) |
| CU2 | Tabela de preços da Meta e câmbio em Sistema; contagem por categoria; corrigir o texto da tela Uso |
| CU3 | Aba da calculadora em Sistema › Vendas |
| CU4 | Tela de ativação da Central pelo Administrador, com o valor da Meta e a medição do mês (junto com o CN1/CN3) |

**Decisões abertas:** relação entre a ativação pelo Administrador e o item da matriz; o que acontece com o texto
guardado quando o Administrador desliga a Central; onde fica a medição (Configurações › WhatsApp ou a própria tela
de ativação); se a medição também aparece para clínicas sem a Central (custo do bot); se a tabela de preços tem
histórico por vigência.
