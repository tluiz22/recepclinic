# Central de Atendimento Humano: planejamento

> **Retomar daqui (05/nov/2026).** Só plano, nada implementado. Decididas: seção 11 (1 a 12 e R1 a R3), seção 14 e as
> telas T1 a T11 (seção 15; canvas https://claude.ai/artifact/SiRBQtc2kSnQoMrgGnRn4y). **Próximo (cliente, 05/nov):**
> implementar a partir do **CU2** (ordem na seção 12; CU1 resolvido pela T11), em branch curta criada da `main`.
> **CU2, CU3, CN1, CU4, CN2, CN3a e CN3b feitos na branch `central-atendimento` (05/nov)**. Staging e produção só com a
> Central pronta (cliente, 05/nov). CN4a e CN4b feitos (enviar, assumir, transferir, Retomar conversa, liberação em 30 min). CN5 feito (mídia recebida). CN6 feito (enviar foto e PDF). CN7 feito (prazo de guarda e anonimização). CN8 feito (histórico do app e cadastro v4; falta a configuração v4 na Meta, pelo cliente). Próximo: CN9 (ajuda, capturas, Jornada do bot, roteiro de staging).

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

**D12 revista (05/nov).** A D12 (28/out/2026) proibia guardar o texto do paciente e da recepção pelo app (a
migração `20261028150000_mensagens_sem_texto.sql` apagou o texto antigo e fechou a leitura do `body` pelo login).
Revista: o texto e as mídias são guardados **só nas clínicas com a Central ligada pelo Administrador**, com retenção
(texto 5 anos, mídia 12 meses) e leitura registrada. Falta o advogado (termo, contrato, política de privacidade).

**Principais riscos.** (1) Guardar dado de saúde em texto e anexos (LGPD, vazamento, retenção). (2) Coexistência:
a recepção no app e outra pessoa no painel respondendo o mesmo paciente. (3) O bot responder ao mesmo tempo que a
recepção numa conversa que acabou de ser assumida. (4) O webhook processa tudo em linha (bot incluso); mídia e
volume maior exigem trabalho assíncrono. (5) Clínicas em produção: nenhuma mudança pode alterar o caminho do bot.

**Decisões:** as 12 da seção 11 e as da seção 14 estão tomadas (05/nov). Em aberto: preço/pacote do item, texto
do modelo "Retomar conversa", advogado e as perguntas da revisão (seção 11, "Ainda pendentes").

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
| Item da matriz (D11) | **[criar]** | "Central de atendimento" (decisão 9); preço a decidir |
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

### 3.2 Situações e máquina de estados (decidido, 05/nov: decisões 3, 5 e 11)

**Lista única** (decisão 3): abas "Abertas" e "Finalizadas"; nas Abertas, selo da situação e responsável,
"Aguardando a clínica" no topo; filtro Todas / Não atribuídas / Minhas / Aguardando paciente. No banco, as **2
situações da CA + responsável**; o resto é calculado.

| Guardado (`conversation_state`) | Na tela | Como se obtém |
|---|---|---|
| `human_handoff = false` | Finalizadas | Já existe |
| `waiting_clinic`, sem responsável | Aguardando a clínica · filtro "Não atribuídas" | `assigned_to is null` |
| `waiting_clinic`, com responsável | Aguardando a clínica · nome do responsável | Paciente escreveu por último |
| `in_progress` | Em atendimento · nome do responsável (ou "pelo app") | Clínica respondeu por último |
| `in_progress` + última mensagem da clínica | Filtro "Aguardando paciente" | Derivado, não estado |

Transições (todas por `update` condicional, como `finishAttendance` já faz):

```
bot ──pedido/limite/não entendeu──▶ waiting_clinic (sem responsável)
bot ──recepção escreve pelo painel──▶ in_progress (responsável = quem escreveu)
bot ──recepção escreve pelo app (eco)──▶ in_progress (responsável não muda; "pelo app")
waiting_clinic ──Assumir──▶ waiting_clinic (responsável = eu)   [sem dona, ou confirmar troca]
waiting_clinic ──resposta pelo painel──▶ in_progress (sem dona: assume; com outra dona: confirma antes)
in_progress ──paciente escreve (não cortesia)──▶ waiting_clinic (responsável continua)
qualquer aberta ──Transferir──▶ mesma situação, responsável = outro (evento transferred)
waiting_clinic com responsável, 30 min de espera no horário da clínica ──rotina──▶ sem responsável (evento
                    released; sem notificação; se era Profissional, volta para a Recepção)
qualquer ──Finalizar / #bot / 12 h──▶ bot (responsável apagado, handoff_id encerra)
bot ──paciente escreve depois de finalizado──▶ bot responde (regra da CA)
```

**Responder assume** (decisão 5): `update … set assigned_to = eu where id = … and (assigned_to is null or
assigned_to = quem eu vi)`; 0 linhas = "Ana assumiu agora", a mensagem **não** sai e a tela recarrega.

**Rotina de 12 h** (decisão 11): mantém, igual para todas, com ou sem responsável; o responsável sai e a conversa
vai para Finalizadas.

**Profissional** (decisão 4): vê a conversa só enquanto ela está transferida a ele; finalizada, liberada (30 min) ou
transferida a outro, deixa de ver (inclusive o histórico).

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
| Recepção no app e no painel (coexistência) | Decisão 2: os dois juntos, sem configuração. O eco (`agent_reply`, agora com texto) entra no histórico marcado "Respondida pelo app do WhatsApp", sem usuário; pausa o bot; não muda o responsável. A mensagem automática do app (IS4) não conta |
| Mensagem editada ou apagada no app | `smb_message_echoes` com edição/`revoke`: atualiza a linha original (texto novo + "editada"; ou "Mensagem apagada", `body` nulo) **[criar]** |
| Fora da janela de 24 h | Decisão 7: caixa de texto trava com aviso e botão "Retomar conversa" (modelo de utilidade aprovado, pago); sem "Abrir no WhatsApp" (exceção: 8c) |
| Liberação em 30 min | Decisão 5 e R1: rotina por pg_cron; os 30 min contam **só no horário da clínica** (fora dele a espera não corre); `update` condicional (só se o paciente ainda espera e o responsável não mudou); evento `released`; **sem notificação** |
| Histórico importado na conexão | Decisão 10: gravado com a data original, **sem** chamar o bot, sem contar como não lida, sem reabrir atendimento nem mexer em `human_handoff` (ver 4.7) |
| Central desligada pelo Administrador | Seção 14: mensagens novas sem texto (como a D12); o guardado fica sem aparecer até religar |

---

## 4. Modelagem de dados (proposta, tudo aditivo)

### 4.1 `whatsapp_messages` [alterar]

| Coluna nova | Tipo | Por quê |
|---|---|---|
| `author` | text (`patient`, `bot`, `system`, `agent_app`, `agent_panel`) | Quem escreveu, sem depender do `message_type`; carga pelo tipo atual |
| `sent_by` | uuid → `auth.users` | Usuário do painel |
| `handoff_id` | uuid | Atendimento a que a mensagem pertence (métricas) |
| `wa_timestamp` | timestamptz | Hora da Meta (`timestamp` do evento) |
| `sort_at` | timestamptz, não nulo | Ordem do histórico: `coalesce(wa_timestamp, created_at)` gravado (o histórico importado chega hoje com data antiga; ordenar por `created_at` sairia fora de ordem) |
| `source` | text (`live`, `history`) | Mensagem importada do histórico na conexão (decisão 10): não aciona bot, não conta como não lida |
| `edited_at`, `revoked_at` | timestamptz | Edição/exclusão feita no app (`smb_message_echoes`) |
| `media_id` | uuid → `whatsapp_media` | Anexo |
| `client_key` | uuid, único por clínica | Idempotência do envio pelo painel (duplo clique, recarregar) |
| `body` | (existe) | Volta a guardar entrada e `agent_reply` **só nas clínicas com a Central ligada pelo Administrador** (D12 revista) |

Índice novo: `(clinic_id, contact_phone, sort_at desc, id)` **sem filtro de direção** (paginação do histórico por
cursor `sort_at,id`).

### 4.2 `whatsapp_media` [criar]

`id`, `clinic_id`, `message_id`, `direction`, `meta_media_id`, `mime_type`, `size_bytes`, `sha256`,
`file_name`, `storage_path` (único), `status` (`pending`, `stored`, `failed`, `too_large`, `deleted`),
`attempts`, `error`, `created_at`, `stored_at`, `deleted_at`. RLS por clínica; gravação só pelo serviço.

### 4.3 `conversation_state` [alterar]

`assigned_to` (uuid), `assigned_at`, `last_message_at`, `last_message_preview` (até 120 caracteres; só com a
Central ligada, mesma regra do `body`), `last_message_author`, `last_patient_at` (janela de 24 h e liberação de 30
min sem consulta extra). Índice `(clinic_id, human_handoff, last_message_at desc)` para a caixa de entrada. Mensagem
importada (`source = 'history'`) atualiza `last_message_at` só se for mais nova; não mexe em `human_handoff`.

### 4.4 Não lidas [criar] (decisão 6: por pessoa)

Tabela `conversation_reads (clinic_id, contact_phone, user_id, last_read_at)`; não lidas = mensagens do paciente
(`source = 'live'`) depois de `last_read_at`. Abrir a conversa zera só para quem abriu.

### 4.5 Auditoria [alterar] [criar]

- `handoff_events`: + `kind` (`status`, `assigned`, `transferred`, `released`, `finished`) e
  `assigned_from`/`assigned_to`; continua só por gatilho (o gatilho passa a olhar também `assigned_to`).
- Ligar/desligar a Central pelo Administrador: registro próprio (quem, quando), para saber em que período o texto
  foi guardado.
- `conversation_access_log` [criar]: quem abriu qual conversa e quem baixou qual anexo (exigência de LGPD para
  dado de saúde; o Suporte já tem leituras registradas pela D6).

### 4.6 Por que não `conversations` / `messages` novas

Já existem com outro nome; duplicar quebraria o bot, as Métricas, o reenvio e a anonimização, e exigiria migrar
o histórico. Uma conversa por telefone + `handoff_id` por atendimento cobre "conversa" e "atendimento".
`conversation_assignments` vira eventos `assigned`/`transferred` na `handoff_events`.

### 4.7 Histórico existente

Mensagens antes da Central não têm texto (apagado em 28/out, sem volta): a conversa mostra "Mensagem anterior à
Central de Atendimento" com tipo e hora. Carga do `author` pelo `message_type`/`direction` e do `sort_at` pelo
`created_at`.

**Histórico do app na conexão (decisão 10):** o webhook só grava o evento `history` bruto (tabela de entrada, com
`chunk_order` e `progress`); uma rotina processa depois, em lotes: grava cada mensagem com `source = 'history'`,
`wa_timestamp` original e o mesmo `wa_message_id` (o índice único evita duplicar com o eco ao vivo); mídias como
`media_placeholder` (baixa só as que a Meta ainda entrega, dos últimos 14 dias). Telefone sem linha em
`conversation_state`: **só guarda** (R3, 05/nov): não cria conversa nem entra em Finalizadas; o histórico aparece
quando o paciente escrever de novo (a conversa nasce nessa hora e já mostra o passado). Telefone que já tem
conversa: o histórico entra nela, sem mudar a situação. O prazo de guarda conta da data original.

---

## 5. Integração com a Meta

| Item | Situação | Ação |
|---|---|---|
| `whatsapp_business_messaging` (texto e mídia na janela) | Aprovada (acesso avançado) | Nenhuma nova permissão prevista; o texto da Verificação do acesso já diz "a recepção pode assumir a conversa" e "vê as respostas dos pacientes" |
| Uso diferente do vídeo da análise | A conferir | Ver na política da Meta se nova funcionalidade com a mesma permissão pede nova análise (em geral não) **[validar]** |
| Campos do webhook | `messages`, ecos, templates, `account_update` | Conferir no painel do app os campos assinados (inclui `history` e `smb_app_state_sync`) **[validar]** |
| Mídia recebida | Não baixada hoje | `GET /{media-id}` devolve URL temporária (minutos) que exige o token; baixar logo (rotina) **[validar prazos na doc atual]** |
| Mídia enviada | `uploadMedia` existe | Subir e enviar por `media_id`; limites de tamanho por tipo **[validar na doc atual]** |
| Janela de 24 h | Regra no envio (`CUSTOMER_SERVICE_WINDOW_MS`) | Fora dela, só template (decisão 7): modelo de utilidade "Retomar conversa", texto a aprovar pelo cliente no CN4; risco de a Meta classificar como marketing **[validar na aprovação]** |
| Token | Por clínica, no Vault, do Embedded Signup | Sem renovação nova; erro 190 já leva à desconexão |
| Histórico antigo | `requestCoexistenceSync('history')` pedido e descartado | A Meta só envia o histórico do app **uma vez, na conexão** (período limitado). Clínicas já conectadas perderam essa janela; para clínicas novas com a Central, guardar o que chega (decisão 10; 4.7). Não há API genérica para buscar mensagens antigas |
| Custo | Mensagem de serviço | Cobrada por mensagem desde 01/out/2026, com 1.000 grátis/mês por número (5.1; seção 14) |

### 5.1 Conferência na documentação da Meta (CN0, 05/nov/2026)

Páginas lidas em 05/nov: [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/),
[history webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/history),
[Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing),
[Non-template messages pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages),
[Media](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media/).

**Alertas que valem já para a produção (fora da Central):** decisão do cliente (05/nov): (1) sem medição (só a
clínica piloto na produção); o cliente confere a forma de pagamento da piloto no Gerenciador do WhatsApp;
(2) cadastro v3 → v4: primeiro o cliente pediu "já, antes da Central"; **revisto no mesmo dia: vai junto com a
Central** (abaixo; passo CV na seção 12).

**Cadastro v4: o que a Meta diz** ([Versions](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions),
[Version 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4),
[Implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/), lidas em 05/nov):
- v2 e v3 descontinuadas em 15/out/2026; pedidos v3 **são atendidos como v4** (não dão erro), e o que não existe na
  v4 deixa de valer. Já existe a v5 (20/out/2026), com a coexistência ligada por padrão.
- **A v4 se escolhe pela configuração do Facebook Login for Business** (novo `config_id` criado no painel do app,
  variação "Embedded Signup", produtos marcados), não pelo `sessionInfoVersion` (que não existe na v4). O painel tem
  "WhatsApp › Embedded Signup Builder › Check a launch config" para conferir.
- `featureType: "whatsapp_business_app_onboarding"` continua valendo na v4 (sem ele, número do app é recusado).
- Evento de fim da coexistência: o exemplo só traz `waba_id` (sem `phone_number_id`); o código vale 30 s; fechar na
  última tela conta como fim, sem código.
- Depois do fluxo: trocar o código, assinar o app na conta; **não registrar** número da coexistência; `waba_id` agora
  se chama "Messaging account ID", mesmo valor e formato.

**Nosso código** (`WhatsappSignupButton.astro`, `connection.ts`, config em `WHATSAPP_ES_CONFIG_ID`): já não registra na
coexistência, já confere a origem e trata desistência. **Mudar:** (a) tirar `sessionInfoVersion: "3"`; (b) se o
evento vier sem `phone_number_id`, buscar o número pela conta (`GET /{waba_id}/phone_numbers`) em vez de recusar
(hoje `META_ID.test(phoneNumberId)` recusa); (c) `account_update` com `ACCOUNT_RECONNECTED` (hoje ignorado).
**No painel da Meta (cliente):** criar a configuração v4 e trocar `WHATSAPP_ES_CONFIG_ID` na Vercel (staging e
produção); conferir os 4 campos do webhook (`account_update`, `history`, `smb_app_state_sync`, `smb_message_echoes`).
**Teste:** só com um número para conectar (o de testes do staging precisa ser desconectado e reconectado).
**Decisão do cliente (05/nov): a migração para a v4 vai junto com a Central** (mesma publicação), não antes. Risco
aceito: até lá, a conexão de uma clínica nova pode falhar (a Meta já serve a v3 como v4 desde 15/out).

**Pendência pós-implantação (cliente, 05/nov): acompanhar as mudanças da Meta.** Depois da Central (e da v4) na
produção: rotina agendada semanal (agente na nuvem, `/schedule`) que lê o changelog do WhatsApp, a página de versões
do cadastro e a de preços, compara com o que o RecepClinic usa (Graph API `v24.0` em `graph.ts`, versão do cadastro,
preços da seção 14) e avisa o cliente só quando algo nos afeta. Até lá: avisos por e-mail e Alertas do painel do app.

1. **Mensagens de serviço passaram a ser cobradas em 01/out/2026.** Toda mensagem fora de template dentro da janela
   (respostas do bot, listas, botões e, depois, a Central) é cobrada por mensagem; **1.000 grátis por mês por
   número** (não acumula). Preço no Brasil igual ao de utilidade (referência da Meta: US$ 0,0068 por mensagem em
   jul/2026; tabela em BRL não lida). Utilidade dentro da janela também passou a ser cobrada (antes grátis).
   **Sem forma de pagamento na conta da clínica, a Meta para de entregar depois das 1.000 do mês.** Impacto: custo
   do bot para as clínicas (contrato, venda) e risco de o bot parar numa clínica sem pagamento (o guia
   `/guia/pagamento-meta` da IS1 já pede a forma de pagamento; conferir as clínicas em produção).
2. **Embedded Signup v2 e v3 descontinuados em 15/out/2026** (a página manda migrar para a v4). O botão de conexão
   usa `sessionInfoVersion: "3"` (`src/components/admin/WhatsappSignupButton.astro:132`). Conexões já feitas não
   mudam; **conexões novas podem falhar**. Migração junto com a Central (decisão do cliente acima; risco aceito).

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
- **Tipos e limites (decisões 8b e 8c; 5.1):** recebe e mostra foto, documento/PDF (baixar, até 16 MB) e áudio
  (tocador); vídeo, figurinha e arquivo acima do limite: aviso só naquela mensagem, com "Abrir no WhatsApp" (sem
  coexistência: "peça ao paciente para enviar como foto ou PDF"), sem guardar o arquivo. Envia foto (JPEG/PNG) até
  **5 MB** (limite da Meta para imagem) e PDF até 10 MB.
- **Retenção (decisão 8):** prazo fixo, igual para todas: mídia 12 meses, texto 5 anos (advogado confirma). Rotina
  diária (pg_cron) apaga o vencido: arquivo removido e `whatsapp_media.status = 'deleted'`; texto com `body` nulo.
  Anonimização apaga na hora. "Salvar nos documentos do paciente": Etapa 2.
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
| Paginação (últimas 50, "carregar anteriores" por cursor `sort_at,id`) | Etapa 1 | **Sim** |
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

- **Base:** dado de saúde (art. 11). D12 revista (05/nov); exige atualizar **termo de tratamento, contrato e
  política de privacidade** (pendência com o advogado, como na D6).
- **Minimização:** guardar o texto **só nas clínicas com a Central ligada pelo Administrador**; as outras seguem a
  D12 como hoje.
- **Isolamento:** `clinic_id` em todas as tabelas novas, RLS por clínica, caminho do Storage começando pela
  clínica, cliente de serviço limitado à clínica (D1).
- **Leitura do texto:** continua **fechada** para o login direto pela API (`grant` por coluna da migração
  `20261028150000`); a tela lê por função `security definer` que confere papel, item da matriz e atribuição, e
  registra a leitura. Evita que um login leia tudo pela API do Supabase.
- **Perfis (decisão 4):** Administrador e Recepção: todas as conversas da clínica; Profissional: só as
  transferidas a ele, enquanto estiverem com ele; Suporte: todas, com registro (D6). Vale na função de leitura, no
  Storage e na tela.
- **Anexos:** URL assinada curta, gerada só após a checagem; sem URL pública.
- **Tokens:** seguem no Vault; nunca no navegador.
- **Webhook:** assinatura HMAC já conferida; nada muda.
- **Retenção e exclusão:** prazo fixo (texto 5 anos, mídia 12 meses); anonimização apaga texto e mídia; exclusão
  da clínica apaga a pasta dela no bucket.
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
| Coexistência: resposta dupla app + painel | Paciente confuso | Decisão 2: os dois juntos; eco aparece em segundos marcado "Respondida pelo app do WhatsApp"; Central de Ajuda explica os dois caminhos |
| Corrida bot × atendente | Mensagem do bot no meio do atendimento | Pausar antes de enviar; reler pausa antes do envio do bot |
| Webhook lento com mídia/volume | Meta reenvia, eventos duplicados | Mídia assíncrona; fila depois |
| Hora de chegada ≠ hora da Meta | Ordem errada | `wa_timestamp` |
| Custo de Storage | Fatura | Retenção, limites, só tipos aceitos |
| Profissional sem acesso hoje (D6) | Regra nova de visibilidade | Decisão explícita e teste de RLS |
| Nome "Atendimento" já usado (agenda e atendimento humano) | Confusão de tela | Decisão 12: a tela vira "Conversas" |
| Histórico importado grande (até 180 dias, milhares por evento) | Webhook lento, timeout | Gravar o evento bruto e processar por rotina, em lotes (4.7) |
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
   para "Sem responsável"; se estava com um Profissional, volta para a Recepção. Rotina por pg_cron (como a de
   12 h), evento `released` na `handoff_events`. Prazo ajustável por clínica: avaliar no CN4.
   **Revisto (R1, 05/nov):** os 30 min contam **só no horário de atendimento da clínica** (mensagem às 22h libera 30
   min depois da abertura) e a liberação **não envia notificação** (a conversa só muda na lista). Horário da clínica
   = algum horário de agenda aberto naquele dia e hora, fora dos feriados (`clinic_holidays`); a fonte exata se
   confirma no CN4.
6. **Não lidas:** **Decidido (05/nov): por pessoa** (tabela `conversation_reads`, 4.4): abrir a conversa zera só para
   quem abriu.
7. **Fora das 24 h:** **Decidido (05/nov).** A conversa continua "Aguardando a clínica" no fim de semana e no
   feriado (regra da CA, sem mudança). Passadas 24 h da última mensagem do paciente, a caixa de texto trava com o
   aviso e o botão **"Retomar conversa"**, que envia um modelo de utilidade aprovado pela Meta (pago por envio, na
   conta da clínica); a resposta do paciente reabre a janela. **A Central não tem o botão "Abrir no WhatsApp"**
   (cliente: gera confusão; exceção só na 8c); usar o app segue possível por conta da equipe. Padrão do mercado
   (caixas sobre a Cloud API): o mesmo. Criar o modelo (texto, classificação de utilidade) no CN4; texto a aprovar
   pelo cliente. **Texto aprovado (05/nov, opção A, sem botão; substituiu a opção C e o texto sem variáveis):** "Olá!
   Aqui é {{1}}. Vi que a nossa conversa de {{2}} ficou pendente. Quer continuar de onde paramos?" ({{1}} = "da Clínica
   X"; {{2}} = dia da última mensagem do paciente). Classificação como utilidade **[validar na aprovação]**.
8. **Retenção:** **Decidido (05/nov): texto 5 anos, mídias 12 meses**; vencido, uma rotina apaga (mídia: arquivo
   apagado e `whatsapp_media.status = 'deleted'`; texto: `body` nulo). Anonimização apaga na hora. Documento
   importante: botão "Salvar nos documentos do paciente" (Etapa 2), fora desse prazo. Advogado confirma o prazo.
   **Tipos de mídia (8b, decidido 05/nov):** recebe e mostra foto, PDF/documento (baixar) e áudio (tocador); vídeo e
   figurinha só com aviso, sem guardar o arquivo. Envia foto e PDF até 10 MB. Gravar áudio pelo painel: Etapa 2.
   **Fora do limite (8c, decidido 05/nov):** documento recebido até 16 MB é guardado; vídeo ou arquivo acima do
   limite mostra, **só naquela mensagem**, o aviso (ajuste da 5.1, 05/nov: foto enviada até **5 MB**, limite da
   Meta para imagem; PDF segue até 10 MB) "O paciente enviou um vídeo (35 MB). A Central não mostra
   vídeos: veja e responda esta mensagem pelo app do WhatsApp." **com o botão "Abrir no WhatsApp"** (única exceção
   à decisão 7; o app recebe tudo na coexistência). Clínica sem
   coexistência: "peça ao paciente para enviar como foto ou PDF", sem botão.
9. **Matriz (D11) e preço:** **Decidido (05/nov): item novo "Central de atendimento", liberado pelo Suporte,
   depende do bot** (só liga com o bot; desligar o bot desliga a Central). Central sem bot: avaliar na Etapa 2.
   A guarda do texto e das mídias (D12 revista) começa quando o **Administrador** liga a Central em Configurações,
   não ao liberar o item (seção 14, decidido depois). Preço/pacote: a decidir.
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

**Ainda pendentes:** preço/pacote do item (9); desenho das telas
(CN3, com as opções desenhadas); advogado (D12 revista, prazos da 8a); conferências da Meta (seção 5).

**Perguntas da revisão do plano (05/nov), uma por vez:**

- **R1.** ~~Liberação em 30 min fora do horário~~ **Decidido (05/nov): só no horário da clínica, sem notificação** (decisão 5).
- **R2.** **Decidido (05/nov): Transferir entra na Etapa 1, simples** (Administrador e Recepção passam a conversa
  para outra pessoa da equipe, inclusive Profissional; registra de quem para quem; sem motivo, que fica na Etapa 2).
- **R3.** **Decidido (05/nov): só guardar.** Histórico importado (decisão 10) de telefone sem conversa não cria
  conversa nem entra em Finalizadas; aparece quando o paciente escrever de novo (4.7).

**Técnicas, decidir na implementação:** o bot reler a pausa antes de cada envio (3.4, CN4); cópia do bucket
`whatsapp-media` (o Storage não entra no backup do banco) e PITR (7.2), antes da produção.

**Validações técnicas (sem decisão de negócio):** campos assinados do webhook no app da Meta; prazos e limites de
mídia e do histórico na documentação atual; preços da Meta e do Supabase; política de nova análise do app;
termo/contrato com advogado.

---

## 12. Plano de implementação (após aprovação)

Cada passo: staging, roteiro no `staging.md`, validação do cliente, depois produção. Tudo atrás do item da matriz.

**Etapa 1 — Central de Atendimento**

| Passo | Conteúdo | Migração |
|---|---|---|
Ordem única (revisão de 05/nov; inclui as etapas CU da seção 14 e o cadastro v4):

| Passo | Conteúdo | Migração |
|---|---|---|
| CN0 | Decisões da seção 11; termo/contrato; conferências da Meta | — (feito) |
| CU1 | Valores padrão da calculadora por estimativa (sem medição, seção 14) | — |
| CU2 | Tabela de preços da Meta com vigência e câmbio em Sistema (tela P1, página própria Sistema › Preços da Meta, cliente, 05/nov); contagem por categoria; texto da tela Uso. **Feito na branch (05/nov)**, migração `20261214120000` | Sim |
| CU3 | Aba da calculadora em Sistema › Vendas (atual, com a Central, total, os dois cenários de IA). **Feito na branch (05/nov)** | — |
| CN1 | Colunas novas (4.1, 4.3: `author`, `sent_by`, `handoff_id`, `wa_timestamp`, `sort_at`, `source`, `edited_at`/`revoked_at`, `client_key`, `media_id`, responsável), `whatsapp_media`, `conversation_reads`, `kind` na `handoff_events`, bucket, item da matriz, ligar/desligar pelo Administrador com registro, funções de leitura com registro e regra do Profissional, carga do `author` e do `sort_at` **Feito na branch (05/nov)**, migração `20261215120000` | Sim (aditiva) |
| CU4 | Configurações › WhatsApp: medição do mês (todas as clínicas) e ativação/desativação da Central com o custo da Meta. **Feito na branch (05/nov)**: cartões "Custo da Meta" (W2, com "Ver detalhes" por origem) e "Central de atendimento" (só com o item liberado; janelas L1 e Desligar; só o Administrador), rota `/api/admin/configuracoes/central`; captura `config-whatsapp` na fila | — |
| CN2 | Gravar texto (entrada e eco) e `wa_timestamp` só com a Central ligada; edição/exclusão pelo app; `last_message_at`/prévia por gatilho. **Feito na branch (05/nov)**, migração `20261216120000`: a guarda do texto fica num gatilho do banco (quem grava manda sempre; com a Central desligada não chega à tabela); eco `edit`/`revoke` (formato conferido na referência da Meta, `original_message_id`) muda a original sem pausar o bot; a última mensagem não mexe no `updated_at` da conversa (o bot mede o tempo parado por ele) | Sim |
| CN3 | Tela "Conversas": lista única (Abertas/Finalizadas, filtros, busca, ordem), conversa só leitura paginada, lugar no menu e das Notificações | — |
| CN3a | **Feito na branch (05/nov)**, migração `20261217120000`: tela `/admin/conversas` (Abertas/Finalizadas, busca, "Mostrar", não lidas por pessoa, conversa só leitura paginada de 50 em 50, "Finalizar atendimento"), item Conversas no menu com as que aguardam (M1; no celular no lugar do Relatório, que vai ao "Mais"), Meu dia sem contar conversas, Notificações num botão (N1), `/admin/atendimento` redireciona com a Central ligada; abertura registrada uma vez a cada 15 min (a tela recarrega a cada minuto) | Sim |
| CN3b | Painel do paciente (T1 opção C, T2, T3, T4, T5) e os eventos do atendimento na conversa. **Feito na branch (05/nov)**, migração `20261218120000` (`profile_name`, guardado só com a Central, fora da leitura direta; a lista o devolve): painel em 3 colunas a partir de 1280px, abaixo disso a faixa "Próxima" com "Ver paciente"; número sem cadastro com "Cadastrar paciente" (telefone e nome do WhatsApp preenchidos) e "É de um paciente já cadastrado" (busca, confirmação, muda o WhatsApp do contato); eventos (encaminhada com o assunto, assumiu, transferida, liberada, finalizada); Conversas entra nas telas de volta. **CN7:** a anonimização também apaga o `profile_name` | Sim |
| CN4 | Enviar texto (janela de 24 h, idempotência, pausa antes, falha com "Tentar de novo"); responder assume, assumir, transferir (R2, simples), finalizar; não lidas; modelo "Retomar conversa"; rotina de liberação em 30 min | Talvez |
| CN4a | **Feito na branch (05/nov)**, migração `20261219120000`: caixa de resposta na conversa (dentro das 24 h; Ctrl+Enter envia), mensagem gravada "enviando" antes de sair (chave da tela: o mesmo envio não sai duas vezes), "Não enviada · Tentar de novo"; responder assume e põe "Em atendimento" (com outra dona, confirma "Está com Ana. Responder e assumir?"; envio simultâneo: o segundo recebe "Ana assumiu agora" e o texto volta ao campo); responder em Finalizadas pausa o bot, como a resposta pelo app; Assumir e Transferir (Administrador e Recepção, para qualquer pessoa da equipe, inclusive Profissional); o responsável só muda pelas funções do banco (o login perdeu o update direto da coluna); o Profissional responde só na que está com ele | Sim |
| CN4b | **Feito na branch (05/nov)**, migração `20261220120000`: modelo `conversation_resume` (`rc_retomar_conversa_v1`, texto da decisão 7, com a clínica e o dia, sem texto próprio da clínica, só com a Central liberada); fora das 24 h, o botão "Retomar conversa" com o texto na confirmação e o aviso do custo; um por vez (enquanto o paciente não responde, não sai outro); sem o modelo aprovado, a tela pede o Suporte; "Tentar de novo" reenvia o mesmo pedido à Meta. Liberação em 30 min pela rotina de 5 em 5 min do atendimento humano (horário = união dos horários das agendas ativas, fuso da clínica, fora dos feriados; evento `released`, sem aviso). O bot relê a pausa antes de cada envio: se a equipe assumiu enquanto ele respondia, para. Jornada do bot atualizada. **Staging:** o Suporte cria o modelo na conta da clínica de testes | Sim |
| CN5 | Mídia recebida (rotina de download, visualização por URL assinada, avisos da 8c). **Feito na branch (05/nov)**, migração `20261221120000`: o webhook anota o anexo como pendente (o banco só grava com a Central valendo); a rotina `/api/cron/midias` (pg_cron, a cada minuto) consulta a mídia na Meta, baixa e guarda foto (até 5 MB), áudio e documento (até 16 MB) no bucket privado, com o hash, 3 tentativas; vídeo e figurinha só com o aviso; acima do limite, o aviso de arquivo grande; com coexistência, "Abrir no WhatsApp" (8c). Na conversa: a foto, o tocador de áudio e o documento para baixar (nome e tamanho), pela rota que confere o acesso, registra e manda para uma URL assinada de 5 min. Só os anexos do paciente (os do eco do app ficam para depois) | Sim |
| CN6 | Enviar foto (5 MB) e PDF (10 MB). **Feito na branch (05/nov)**, migração `20261222120000`: botão de clipe ao lado da caixa de resposta (dentro das 24 h) abre a janela "Enviar foto ou PDF" (arquivo e legenda opcional até 1.024 caracteres; com outra dona, avisa que quem envia assume). O navegador sobe direto ao bucket pelo link de uso único (`<clínica>/<telefone>/env-<chave>.<ext>`); o servidor confere o tipo pelo conteúdo (JPEG/PNG até 5 MB, PDF até 10 MB; fora disso apaga e avisa), grava pela `central_media_send_prepare` (mesmas regras do texto) e envia como foto ou documento. "Tentar de novo" sobe o arquivo à Meta de novo. A conversa mostra a foto ou o PDF enviados como os recebidos. Desenho padrão (sem rodada de telas); arquivo subido e não enviado fica para a limpeza do CN7 | Sim |
| CN7 | Retenção (rotina diária) e anonimização apagando texto e mídia. **Feito na branch (05/nov)**, migração `20261223120000`: rotina diária `guarda-conversas` (03h40) deixa nulo o texto com mais de 5 anos e marca "apagado" o anexo com mais de 12 meses (pela data original da mensagem), em todas as clínicas (mesmo com a Central desligada depois). A anonimização (gatilho no contato) marca os anexos do contato como apagados, tira as leituras e troca o telefone no registro de acesso e nos eventos do atendimento (o texto, a conversa e o `profile_name` já saíam). Os arquivos saem do bucket na rotina de cada minuto (`midias`), que também remove os enviados pela Central que não viraram mensagem em 1 hora. `midias` e `guarda-conversas` entram na /api/saude | Sim |
| CN8 | Histórico do app na conexão (evento bruto + rotina em lotes, 4.7) e cadastro v4 (CV: tirar `sessionInfoVersion`, número pela conta, `ACCOUNT_RECONNECTED`; cliente cria a configuração v4 e troca `WHATSAPP_ES_CONFIG_ID`). **Feito na branch (05/nov)**, migração `20261224120000`: o webhook guarda cada bloco do `history` (fase, ordem, progresso), a recusa (2593109) e os anexos que a Meta manda depois em `whatsapp_history_events` (só com a Central valendo); a rotina de cada minuto (`midias`) grava as mensagens com `source = history`, hora original e o mesmo `wa_message_id` (sem duplicar), sem criar conversa (R3) e sem contar no uso do mês; o paciente vira "Paciente", a clínica "Respondida pelo app"; anexo antigo aparece como "Anexo enviado antes da conexão (não disponível)"; o anexo dos últimos 14 dias vira pendente e baixa pela rotina do CN5. Os anexos do `history` não entram mais como mensagem nova (antes iriam ao bot). Evento bruto sai 7 dias depois (rotina de guarda). v4: botão sem `sessionInfoVersion`; sem `phone_number_id` no fim, busca o número na conta (um só; nenhum ou vários: recusa com aviso); `ACCOUNT_RECONNECTED` vai para o log (a conexão é refeita pela tela). **Falta (cliente):** criar a configuração v4 no painel da Meta, trocar `WHATSAPP_ES_CONFIG_ID` (staging e produção) e conferir os campos do webhook (`account_update`, `history`, `smb_app_state_sync`, `smb_message_echoes`) | Sim |
| CN9 | Ajuda, capturas pendentes, Jornada do bot, roteiro de staging | — |

O CN8 vai junto na mesma publicação da produção (decisão do v4); o teste do cadastro exige desconectar e
reconectar o número de testes do staging.

**Etapa 2 — Gestão:** motivo na transferência, notas internas (não vão ao paciente), respostas rápidas por
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
- Ordem por `sort_at` com eventos fora de ordem e com histórico importado.
- RLS: login de outra clínica não lê mensagem, mídia nem caminho do Storage; login direto pela API não lê `body`;
  Profissional só vê a conversa transferida a ele e perde o acesso ao ser finalizada, liberada ou transferida a outro.
- Responder com outra dona: confirma; envio simultâneo: só o primeiro sai.
- Liberação em 30 min: volta sem responsável, evento `released`, sem notificação; conta só no horário da clínica
  (mensagem à noite libera 30 min depois da abertura; feriado não conta); não libera se o responsável respondeu ou
  mudou no meio.
- Central desligada: mensagem nova sem texto; religada: histórico guardado volta a aparecer.
- Retenção: mídia de 12 meses e texto de 5 anos apagados pela rotina.
- Histórico importado: não chama o bot, não conta como não lida, não reabre atendimento; repetido não duplica.
- Edição e exclusão pelo app atualizam a mensagem original.
- Fora das 24 h: caixa travada; "Retomar conversa" envia o modelo.
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
   numa tela que mostra com clareza o valor cobrado pela Meta. **Decidido (05/nov): dois passos** — o Suporte libera
   o item na matriz (decisão 9, o que foi vendido) e a Central só começa quando o Administrador liga em
   Configurações, depois de ver o custo da Meta; ele pode desligar quando quiser. A guarda do texto (D12 revista)
   começa quando o Administrador liga. **Desligar (decidido, 05/nov):** para de guardar mensagens novas; o que já foi
   guardado fica pelo prazo (texto 5 anos, mídia 12 meses), sem aparecer; religando, o histórico volta (com o
   intervalo desligado sem texto). A tela avisa isso ao desligar.
2. **Medição em tempo real** nessa mesma tela: mensagens enviadas no mês (por tipo) e o valor estimado a ser cobrado
   pela Meta. **Decidido (05/nov): para todas as clínicas**, em Configurações › WhatsApp (avisos, bot e, com a
   Central, as respostas pela Central; resposta pelo app como grátis); a ativação da Central fica na mesma tela.
3. **Calculadora no Suporte:** Sistema › Vendas ganha uma aba (ao lado de Planos, Demonstração, Roteiro de vendas e
   Implantação) para estimar o valor médio pago à Meta por clínica. Campos: quantidade de profissionais, dias de
   atendimento por semana, média de atendimentos por dia. Resultado: valor médio das mensagens que o RecepClinic já
   envia hoje (avisos e bot), estimativa com o atendimento pelo RecepClinic (Central) e o total.

4. **Comparação com IA na calculadora** (cliente, 05/nov): a mesma aba mostra a estimativa do que a clínica pagaria
   com uma solução de atendimento por IA, para comparar com o RecepClinic. Base da Meta (seção 5.1): **IA de
   terceiros** pela API = a mesma cobrança por mensagem da Meta **mais** o custo do provedor de IA (por token), em
   geral com mais mensagens por conversa; **IA da Meta (Meta Business Agent)** = US$ 2,00 por milhão de tokens
   (a Meta estima ~4 a 5 centavos de dólar por mensagem). Parâmetros (mensagens por conversa com IA, tokens por
   mensagem, preço do provedor) editáveis pelo Suporte, com valor padrão e a fonte citada na tela. **[decidir:
   quais cenários de IA mostrar]**

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

**Etapas propostas (antes do CN3, porque a ativação depende delas; ordem final na seção 12):**

| Passo | Conteúdo |
|---|---|
| CU1 | ~~Medir a produção~~ (cliente, 05/nov: só a piloto, sem base para média). Valores padrão da calculadora por estimativa, editáveis pelo Suporte; recalibrar quando houver mais clínicas |
| CU2 | Tabela de preços da Meta e câmbio em Sistema; contagem por categoria; corrigir o texto da tela Uso |
| CU3 | Aba da calculadora em Sistema › Vendas (atual, com a Central, total e comparação com IA) |
| CU4 | Tela de ativação da Central pelo Administrador, com o valor da Meta e a medição do mês (junto com o CN1/CN3) |

**Decidido (05/nov): tabela de preços com histórico por vigência** (cada preço com data de início; mês passado
calculado com o preço daquele mês; registro de quem mudou). **Cenários de IA (item 4, decidido 05/nov): os dois**,
lado a lado com o RecepClinic: "IA de outra empresa" (Meta por mensagem + custo da empresa de IA) e "IA da Meta"
(Meta Business Agent, por volume de texto). Seção 14 sem decisões abertas.

---

## 15. Telas (desenho no canvas, cliente, 05/nov/2026)

Canvas: https://claude.ai/artifact/SiRBQtc2kSnQoMrgGnRn4y (tela Conversas no computador A/B/C, celular e painel do
paciente).

**Decidido (05/nov):**

- **T1. Layout no computador: opção C**: lista, conversa e **painel do paciente** lado a lado. Painel: paciente
  (convênio, "Abrir ficha"), próxima consulta com Remarcar e Marcar consulta, anotações, atendimentos anteriores.
  No celular: lista → conversa (com "Voltar"); fora das 24 h, aviso e "Retomar conversa" no lugar da caixa de texto.
- **T2. Responsável com 2 ou mais pacientes: C1, todos em lista**: no topo "Quem fala com a clínica" (nome, papel,
  "Abrir contato"); abaixo, um cartão por paciente com a próxima consulta e os botões (Remarcar ou Marcar consulta,
  Abrir ficha). Com um só paciente: o responsável no topo e o painel normal do paciente.
- **T3. Número sem cadastro**: "Cadastrar paciente" (cadastro com o telefone preenchido) e **"É de um paciente já
  cadastrado"**, que busca o paciente e liga o número a ele **com confirmação** ("O WhatsApp de Maria Souza muda de …
  para …"). Contato registrado pelo bot sem paciente: nome do contato + "Cadastrar paciente". Técnico: o telefone é do
  contato (`contacts.phone`); se o contato tiver outros pacientes, a confirmação diz que muda para todos.
- **T4. Nome do perfil do WhatsApp**: guardado e mostrado ("Nome no WhatsApp: Fernanda") **só nas clínicas com a
  Central ligada** (`conversation_state.profile_name`, do `contacts[].profile.name` do webhook; mesma regra de guarda
  do texto); usado para preencher o cadastro.

- **T5. Painel no celular: P2**: faixa fixa abaixo do topo da conversa com a próxima consulta ("Próxima: qui, 13/nov,
  10:00 · Dra. Ana Karina") e "Ver paciente", que abre o painel completo em tela própria (com "Voltar para a conversa").
  Responsável com vários pacientes: a faixa mostra a próxima consulta entre eles; o painel, a lista da T2.
- **T6. Menu: M1**: item **Conversas** logo abaixo do Meu dia, com o número das que aguardam a clínica; no celular, entra
  na barra de baixo no lugar de "Relatório", que vai para o "Mais" (no computador o Relatório do dia continua no menu).
  O número do Meu dia deixa de contar conversas. Item só aparece com a Central ligada; o Profissional vê o item com as
  conversas transferidas a ele. Muda capturas da Central de Ajuda (anotar no CN3).
- **T7. Notificações: N1**: botão "Notificações" no topo da tela Conversas abre a janela (ativar neste aparelho, lista
  de aparelhos, remover); sai a aba Notificações da tela de hoje.

- **T8. Configurações › WhatsApp: W2**: cartões Conexão, "Custo da Meta em <mês>" em resumo (valor do mês em
  destaque, barra das 1.000 mensagens de serviço grátis, 3 cartões: confirmações e lembretes; assistente, avisos e
  Central; pelo app, grátis) com "Ver detalhes" (tabela por tipo) e "Central de atendimento" (Ligada/Desligada, botão).
  Texto do cartão sem valor estimado: "Você pode acompanhar a evolução dos custos acima, em 'Custo da Meta'."
- **T9. Ligar a Central: L1, uma janela**: custo por mensagem da Meta e "Você pode acompanhar a evolução dos custos em
  Configurações › WhatsApp" (sem estimativa de valor, cliente, 05/nov), o que muda (guarda das conversas, quem vê, pode
  desligar), "Li e estou de acordo" e Ligar. Desligar: janela com o que acontece (some do menu, guardado fica pelo
  prazo, religar traz o histórico, assistente segue).
- **T10. Calculadora: K2**: aba "Custo da Meta" em Sistema › Vendas; campos à esquerda (profissionais, dias por semana,
  atendimentos por dia) e parâmetros recolhíveis do Suporte; à direita cartões Hoje, Central e Total e barras com IA de
  outra empresa e IA da Meta. **Abaixo dos gráficos, aviso de estimativa** (cliente, 05/nov): "Estes valores são uma
  estimativa, não uma medição", com as médias usadas (modelos e mensagens do assistente por atendimento, % para a
  recepção, respostas por atendimento, preço, câmbio, 1.000 grátis), que a Central supõe tudo respondido por ela (o app
  é grátis, o real tende a ser menor) e as premissas da comparação com IA; os números do aviso acompanham os parâmetros.
  **Valores padrão: conferir antes do CU1** (cliente, 05/nov): tabela oficial da Meta para o Brasil e preços de IA
  vigentes, cada valor com a fonte, para aprovação do cliente.

- **T11. Valores padrão da calculadora (conferidos e aprovados, cliente, 05/nov)**:

  | Parâmetro | Padrão | Fonte |
  |---|---|---|
  | Preço por mensagem (utilidade, autenticação, serviço; Brasil) | R$ 0,0350 (US$ 0,0068) | Meta, página de preços (USD, vigente desde 01/out/2026); BRL pela tabela "BRL list rates" da Meta, lida via terceiro (Vectalk), arquivo oficial não aberto: reconferir na implementação |
  | Serviço grátis | 1.000 por número por mês, sem acumular | Meta, desde 01/out/2026 |
  | Modelo de utilidade respondendo ao paciente | cobrado | Meta, desde 01/out/2026 |
  | Câmbio (só IA) | R$ 5,15 fixo | relação das tabelas da Meta (0,0350 ÷ 0,0068); Suporte altera |
  | IA da Meta (Meta Business Agent) | US$ 2 por milhão de tokens, 22.500 tokens por mensagem (≈ US$ 0,045); **sem** a tarifa de serviço (são excludentes) | Meta, desde 01/ago/2026 |
  | IA de outra empresa | tarifa de serviço da Meta + Claude Sonnet 5.5 (US$ 2 entrada / US$ 10 saída por milhão), 3.000 + 200 tokens por mensagem | Anthropic (preço); tokens: suposição |
  | Médias (suposição marcada) | 2 modelos e 4 mensagens do assistente por atendimento; 30% vão à recepção; 5 respostas; 12 mensagens por conversa com IA | sem dados de produção; recalibrar com mais clínicas |

  Exemplo (3 profissionais, 5 dias, 12/dia ≈ 780 atendimentos): hoje R$ 128,80; Central + R$ 40,95; total R$ 169,75;
  IA de outra empresa R$ 732,83; IA da Meta R$ 2.223,78. O aviso abaixo dos gráficos cita esses preços e médias.

**Desenho das telas concluído** (T1 a T11).
