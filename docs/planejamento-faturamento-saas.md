# Faturamento recorrente do SaaS (Asaas)

> **Estado atual (retomar daqui), 28/out/2026.** Planejamento aprovado pelo cliente (28/out). Nada implementado:
> sem tabela, rota, variável ou conta no Asaas. **Próximo passo:** as decisões pendentes da seção 11, uma de cada
> vez; depois a F12.1 do roadmap (seção 12).
>
> Decisões já respondidas (28/out): **11.1** (motivos registrados), **modo de cobrança manual** (seção 3) e **11.2**
> (pago = `CONFIRMED` ou `RECEIVED`) **11.3** (bloqueio no painel primeiro, banco depois) **11.4** (bot calado, link com aviso) **11.5** (Assinatura só para o Administrador) **11.6** (estorno marca e avisa o Suporte) **11.7** (novo valor no próximo ciclo, sem proporcional) **11.8** (implantação ao ativar, conta igual) **11.9** (cartão na página do Asaas). **11.10 fica pendente** (número do WhatsApp, decidir antes da F12.9).
> **11.11** (avisos do Asaas desligados, só os nossos) e **11.12** (cancelamento: cobra o devido, acesso até o
> fim do período pago). Próxima: 11.13.

## Como trabalhar nesta etapa

- Todo o código e a documentação do faturamento ficam na branch **`faturamento`** (criada da `main` em 28/out). A
  `main` fica livre para correções urgentes do piloto em produção (publica no staging a cada push; a `producao`
  publica na produção).
- **Começar ou voltar ao faturamento:** `git switch faturamento`, trazer o que mudou na `main` (`git merge main`) e
  retomar pelo bloco acima.
- **Parar e voltar à `main`:** commit e push do que estiver em andamento na `faturamento`, atualizar o bloco "Estado
  atual" deste arquivo e `git switch main`.
- Nada do faturamento vai para o staging ou a produção sem o OK do cliente; o caminho de publicação (merge na `main`
  ou ambiente próprio) é decidido antes da F12.1.

Marcas: **[Código]** conferido no repositório; **[Projeto]** registrado na documentação do projeto;
**[Asaas]**, **[Meta]**, **[Vercel]** documentação oficial (fontes no fim); **[Inferência]** conclusão técnica;
**[Recomendação]** proposta, aprovada só quando a decisão correspondente for respondida.

O faturamento do SaaS (o RecepClinic cobrando as clínicas) é diferente do **Financeiro F11** (a clínica recebendo dos
pacientes, com `payments` e NFS-e). Nomes com prefixo `billing_` para não colidir.

## 1. Resumo

- Módulo da plataforma (Suporte), no padrão de isolamento existente: `clinic_id`, RLS e gravação só por funções do
  banco.
- Suspensão por **motivos** registrados; `clinics.status = 'suspended'` é consequência. A reativação automática
  libera só o motivo "inadimplência".
- **[Código]** Hoje a situação "suspensa" quase não tem efeito (seção 2). Bloquear exige mexer no painel, nas páginas
  públicas, no bot, nas rotinas e nos envios.
- **[Asaas]** Webhooks "pelo menos uma vez" com `id` do evento; token no cabeçalho `asaas-access-token` (sem
  assinatura); fila interrompida após 15 falhas seguidas; eventos guardados por 14 dias. Conciliação por rotina é
  obrigatória.
- **[Inferência]** Pix Automático: o Asaas exige CNPJ ativo há 6 meses ou mais; o CNPJ do RecepClinic foi aberto em
  10/out/2026 **[Projeto]**, então a elegibilidade deve vir só por volta de abril/2027. Confirmar com o Asaas.
- **[Inferência]** WhatsApp financeiro exige conta (WABA) e número **do próprio RecepClinic**: a infraestrutura atual
  envia pelo número de cada clínica aos pacientes.

## 2. Arquitetura atual validada (28/out/2026)

| Tema | Conclusão | Onde |
|---|---|---|
| Stack | Astro 7 (servidor), TypeScript, Supabase, Vercel `gru1`, CI no GitHub Actions | `package.json`, `astro.config.mjs`, `vercel.json`, `.github/workflows/ci.yml` |
| Multi-clínica | `clinic_id` em cada linha, RLS por clínica (D1) | `supabase/migrations/20261004120000_nucleo.sql` |
| Papéis | `clinic_members.roles` (`admin`, `professional`, `reception`); Suporte em `platform_staff`; `app.is_clinic_member`, `app.has_clinic_role`, `app.is_platform_staff` | `nucleo.sql` |
| Painel | Middleware confere login, monta o `ClinicContext` (com `clinicStatus`), confere a rota e registra as leituras do Suporte | `src/middleware.ts`, `src/lib/clinicAccess.ts`, `src/lib/data/clinicContext.ts` |
| Situação da clínica | `active`, `suspended`, `onboarding`; só o Suporte muda (`app.guard_clinic_status`); `setClinicStatus` aceita só `active`/`onboarding` | `20261025140000_clinica_em_implantacao.sql`, `src/lib/data/onboarding.ts` |
| Credenciais | Login (`createUserClient`); credencial da clínica (`createClinicServiceClient`, papel `clinic_service`); service role só em `platform.ts` | `src/lib/data/clients.ts`, `clinicService.ts`, `platform.ts` |
| Rotinas | `pg_cron` → `app.call_system_route` → `/api/cron/*` com `Bearer CRON_SECRET`; `cronRoute()` por clínica, com heartbeat | `20261007170000_envios_automaticos.sql`, `src/lib/cron/route.ts`, `cron_heartbeats`, `/api/saude` |
| Webhook da Meta | HMAC com `timingSafeEqual`, 200 rápido, repetidos ignorados por `wa_message_id` | `src/pages/api/whatsapp/webhook.ts`, `src/lib/data/whatsapp/webhook.ts` |
| Integração externa com estado | NFS-e: `issuing` → `issued`/`rejected`, "uma ativa por pagamento", conferência por rotina, trilha só de inclusão | `20261012160000_emissao_nfse.sql`, `src/pages/api/cron/notas-fiscais.ts` |
| Auditoria | `platform_audit_log` (gravações do Suporte), `platform_access_log` (leituras), `fiscal_audit_log` | `nucleo.sql`, `20261004190000`, `20261012140000` |
| E-mail | SMTP (`smtpSender`, `EMAIL_FROM`); sem histórico genérico de envios | `src/lib/email.ts` |
| Avisos no painel | Faixa do `AdminLayout.astro`, avisos do Início, `push_subscriptions` | `src/layouts/AdminLayout.astro`, `20261027160000_notificacoes.sql` |
| WhatsApp | Por clínica: `whatsapp_connections` (token no Vault), `whatsapp_templates` e `whatsapp_messages` por `clinic_id`; o webhook resolve a clínica pelo `phone_number_id` | `20261004170000_whatsapp_e_rotinas.sql`, `src/lib/data/whatsapp/send.ts` |
| Planos | Tabela comercial no código, plano deduzido da matriz; nada gravado por clínica | `src/lib/plans.ts`, `src/components/admin/vendas/PlanosTab.astro` |
| Erros | `src/lib/log.ts` (sem dado pessoal) → `system_errors` → Better Stack via `/api/saude` | `20261009130000_erros_e_saude.sql` |

**[Código] Onde a situação "suspensa" é respeitada hoje:**

| Ponto | Clínica `suspended` |
|---|---|
| Painel (`src/middleware.ts`) | não barra |
| Páginas públicas (`/agendar`, `/formulario`, `/importar`, `/preparo`, `/orientacoes`) | não conferem |
| Bot e envios do painel (`createClinicSender`) | barra só `onboarding` |
| Rotinas com `list_active_clinics` (lembretes, resumo, lista de espera, reenvios, atendimento humano) | pulam (`status = 'active'`) |
| Rotina `series` (`list_clinics_in_service`) | pula (`status <> 'suspended'`) |
| `conversas-paradas`, `notas-fiscais` | listas próprias; conferir na implementação |
| RLS | não considera a situação |

**[Projeto]** Meta: Análise do App e Verificação do acesso aprovadas; RecepClinic Tech Provider desde 24/out
(`docs/README.md`). Não conferido na Meta.

## 3. Decisões de negócio já tomadas (cliente, 28/out/2026)

- **Modo de cobrança por clínica (cliente, 28/out):** **automático** (Asaas, avisos, atraso e reativação, como abaixo)
  ou **manual**: o Suporte marca que a clínica não entra na cobrança automática e cobra por fora. No manual o sistema
  guarda o contrato e os **pagamentos registrados à mão pelo Suporte** (histórico), mas a clínica **nunca consta em
  atraso**: sem cobrança no Asaas, sem avisos de atraso, sem reativação automática. Suspensão, se houver, é manual
  (com motivo) e liberada pelo Suporte. A marcação do modo registra quem e quando.

- Provedor Asaas; cartão, Pix Automático e Pix convencional.
- Valor mensal negociado e gravado por contrato; implantação avulsa, quando houver; preço de referência não muda
  contrato.
- Sem suspensão automática: suspensão manual do Suporte, com confirmação, responsável, data e motivo.
- Na suspensão: bloquear operação e automações; preservar o acesso administrativo para regularizar, o do Suporte e os
  dados.
- Avisos D+3 (atraso), D+7 (o Suporte pode avaliar a suspensão) e de pagamento reconhecido; idempotentes; os que
  ficarem indevidos são cancelados.
- Reativação automática só com **todas** as cobranças vencidas regularizadas, preservando outros motivos de suspensão.
- Estado local sincronizado; nada de consultar o Asaas a cada requisição.
- E-mail financeiro obrigatório; telefone financeiro e opção explícita de WhatsApp. Falha do WhatsApp não impede o
  e-mail; resultado de cada canal registrado.

## 4. Modelo de domínio (conceitual)

```mermaid
erDiagram
  clinics ||--|| billing_accounts : "conta de cobrança"
  clinics ||--o{ billing_contracts : "versões do contrato"
  billing_contracts ||--o{ billing_charges : "gera"
  billing_charges ||--o{ billing_notifications : "avisos"
  billing_notifications ||--o{ billing_notification_deliveries : "por canal"
  clinics ||--o{ clinic_suspensions : "motivos de suspensão"
  billing_provider_events }o--o| billing_charges : "eventos do Asaas"
  clinics ||--o{ billing_audit_log : "trilha"
```

| Conceito | Nome proposto | Conteúdo essencial | Por quê |
|---|---|---|---|
| Conta de cobrança (1 por clínica) | `billing_accounts` | Razão social/nome e CNPJ/CPF do pagador, e-mail financeiro (obrigatório), telefone financeiro, opt-in de WhatsApp (quando, por quem), `asaas_customer_id` (único), ambiente | Separada de `clinic_fiscal_settings` (emissor da NFS-e, só com o F11) e dos contatos de pacientes; fora da linha `clinics`, que o Administrador da clínica pode alterar |
| Contrato | `billing_contracts` | **Modo de cobrança (`asaas` ou `manual`)**, valor mensal, implantação (valor ou isenção), 1º vencimento, forma de pagamento, retrato do plano de referência (informativo), vigência, situação (`draft`, `active`, `ended`, `canceled`), `asaas_subscription_id`, `pix_automatic_authorization_id` | Mudança comercial = nova versão (`replaces_contract_id`) com data de início |
| Cobrança | `billing_charges` | Origem (`asaas` ou `manual`), `asaas_payment_id` (único, só no Asaas), tipo (`monthly`, `setup`, `other`), vencimento, valor, forma, situação local e a bruta do Asaas, `paid_at`, link da fatura, `last_synced_at`; no manual, quem registrou e quando | Espelho do Asaas e histórico dos pagamentos manuais num lugar só; atraso, avisos e reativação só olham a origem `asaas` |
| Evento recebido | `billing_provider_events` | `provider_event_id` (único), tipo, recurso, dados mínimos, recebido/processado em, situação, tentativas, erro | Idempotência e reprocessamento |
| Aviso | `billing_notifications` | Cobrança, tipo (`overdue_d3`, `overdue_d7`, `payment_confirmed`), programado para, situação; único por (cobrança, tipo) | Sem duplicidade; cancela os indevidos |
| Envio por canal | `billing_notification_deliveries` | Canal (`email`, `whatsapp`), tentativas, id no provedor, erro, enviado em | Um canal não trava o outro |
| Motivo de suspensão | `clinic_suspensions` (decisão 11.1; fora do prefixo `billing_` porque nem todo motivo é financeiro) | Motivo (`non_payment`, `administrative`, `contract_ended`), texto, criado por/em; liberado em/por (nulo = sistema), motivo da liberação | Distingue inadimplência de outros motivos |
| Trilha | `billing_audit_log` (só inclusão) | Ator (pessoa, sistema, webhook), ação, antes/depois, motivo | O `platform_audit_log` só pega o Suporte |

Sem duplicar: `clinic_usage_monthly` (uso), `plans.ts` (referência), `clinics.status` (sinal das rotinas),
`system_errors`, `cron_heartbeats`.

## 5. Integração com o Asaas

**Fatos [Asaas]:**

- API: cabeçalho `access_token`; `api-sandbox.asaas.com/v3` e `api.asaas.com/v3`; contas e chaves separadas por
  ambiente; chave expira de vez após 6 meses sem uso; restrição por IP disponível.
- Assinaturas: o Asaas gera as cobranças futuras uma a uma; criar a assinatura não confirma pagamento; cada cobrança
  traz `subscription`. Cartão validado na criação, ciclos seguintes podem falhar; tokenização precisa ser liberada na
  produção.
- Pix Automático: autorização (`POST /v3/pix/automatic/authorizations`) com QR Code do 1º pagamento e consentimento;
  `ACTIVE` após o 1º pagamento e a confirmação do banco do pagador; modo `SUBSCRIPTION` (o Asaas gera) ou `MANUAL`
  (instrução entre 2 e 10 dias úteis antes do vencimento); retentativa no mesmo dia pelo banco do pagador e, com
  `retryPolicy = ALLOW_THREE_IN_SEVEN_DAYS`, até três em sete dias; elegibilidade: conta PJ aprovada, sem pendências,
  CNPJ ativo há 6 meses ou mais, sem restrição de Pix (evento `PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED`).
- Webhooks: "pelo menos uma vez" com `id`; token `asaas-access-token` (não usar a chave da API); persistir, responder 200
  e processar depois; fila `SEQUENTIALLY` ou `NON_SEQUENTIALLY`; interrompida após 15 falhas; eventos por 14 dias; IPs
  oficiais publicados (mudam).
- Eventos de cobrança: `PAYMENT_CREATED`, `PAYMENT_UPDATED`, `PAYMENT_CONFIRMED` (pago, saldo ainda indisponível),
  `PAYMENT_RECEIVED` (saldo disponível), `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `PAYMENT_RESTORED`,
  `PAYMENT_AWAITING_RISK_ANALYSIS` e aprovado/reprovado, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`, `PAYMENT_REFUNDED`,
  `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_CHARGEBACK_REQUESTED`, `…_DISPUTE`,
  `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`. Cartão: CONFIRMED e, cerca de 32 dias depois, RECEIVED; Pix: RECEIVED.
- Assinatura: `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_UPDATED`, `SUBSCRIPTION_INACTIVATED`, `SUBSCRIPTION_DELETED`.
- Pedidos: timeout mínimo de 60 s; não repetir sem conferir a resposta anterior.

**[Recomendação]**

1. Cliente criado pelo Suporte ao ativar a conta de cobrança; guardar `asaas_customer_id`; referência externa = id da
   clínica (nome do campo a confirmar); procurar pelo CNPJ/CPF antes de criar.
2. Cartão e Pix convencional por **assinatura** do Asaas; Pix Automático por autorização em modo `SUBSCRIPTION`;
   implantação por cobrança avulsa (`POST /v3/payments`).
3. Cartão sem dado de cartão no RecepClinic: página de fatura do Asaas (a confirmar na referência).
4. Webhook: rota pública fora de `/admin`; token em tempo constante (e IPs oficiais, se aprovado); grava em
   `billing_provider_events` com `on conflict do nothing`; responde 200; processa com `waitUntil` e rotina de
   recuperação; **consulta a cobrança na API antes de dar como paga**; fila `NON_SEQUENTIALLY`, regras que não dependem
   da ordem.
5. Conciliação diária e de recuperação: cobranças não finais ou recentes conferidas na API; listagem dos últimos N dias
   por cliente para achar o que não chegou; divergências na trilha e na tela do Suporte.
6. Credenciais da plataforma em variáveis de ambiente por ambiente (ex.: `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`,
   `ASAAS_ENV`); processamento por funções estreitas com service role em `platform.ts` chamando funções security
   definer liberadas só à `service_role`; `clinic_service` sem acesso ao faturamento.
7. Indisponibilidade: nada do painel depende do Asaas em tempo real; webhook parado coberto pela conciliação;
   heartbeat próprio na `/api/saude`.

## 6. Fluxos

```mermaid
sequenceDiagram
  participant A as Asaas
  participant W as Webhook (rota pública)
  participant DB as Supabase
  participant P as Processador (waitUntil + rotina)
  A->>W: POST evento (asaas-access-token)
  W->>W: confere token (tempo constante) e IP
  W->>DB: insere billing_provider_events (id único; repetido = ignora)
  W-->>A: 200
  P->>DB: pega eventos pendentes (trava por linha)
  P->>A: GET /payments/{id} (estado real)
  P->>DB: atualiza billing_charges + trilha (função security definer)
  P->>DB: cancela avisos indevidos; tenta reativar a clínica
```

```mermaid
stateDiagram-v2
  [*] --> Ativa
  Ativa --> Suspensa: Suporte confirma (motivo non_payment ou outro)
  Suspensa --> Suspensa: ainda há vencidas em aberto ou outro motivo ativo
  Suspensa --> Ativa: sem vencidas em aberto e sem outro motivo (automático)
  Suspensa --> Ativa: Suporte libera motivo administrativo (manual)
```

0. **Modo manual:** o Suporte marca o contrato como `manual`; não cria cliente nem assinatura no Asaas; registra cada
   pagamento recebido (valor, data, forma, observação), que fica no histórico; nenhuma rotina de atraso ou aviso olha
   essa clínica; suspensão e liberação só pelo Suporte.
1. **Contratação:** o Suporte abre "Faturamento" na clínica, preenche a conta de cobrança (ou o Administrador da
   clínica, os contatos) e o contrato em rascunho; ao ativar, cria ou associa o cliente no Asaas; tudo na trilha.
2. **Preço negociado:** fixo no contrato; mudança = nova versão com data de início (decisão 11.7).
3. **Implantação:** cobrança avulsa `setup`, se não isenta (decisão 11.8).
4. **Assinatura:** criada com valor, forma e 1º vencimento; cobranças entram no espelho por `PAYMENT_CREATED` e pela
   conciliação.
5. **Pagamento:** evento → consulta na API → cobrança paga (decisão 11.2) → aviso de reconhecido → tentativa de
   reativação.
6. **Avisos de atraso:** rotina diária cria `overdue_d3` e `overdue_d7` (únicos); na hora de enviar, confere de novo e
   cancela se pago; e-mail sempre e WhatsApp com opt-in, cada canal registrado; aviso atrasado sai uma vez só.
7. **Suspensão manual:** o Suporte vê as vencidas e confirma "Suspender por inadimplência" com motivo; a função do
   banco trava a clínica, grava o motivo `non_payment`, põe `clinics.status = 'suspended'` (guardando a situação
   anterior) e registra.
8. **Acesso na suspensão:** Administrador da clínica só na tela "Assinatura"; outros papéis com aviso; Suporte com
   acesso total registrado; páginas públicas e bot indisponíveis (decisão 11.4); rotinas já pulam; dados preservados.
9. **Regularização:** cada pagamento atualiza a cobrança; continua suspensa enquanto houver qualquer vencida em aberto.
10. **Reativação automática:** na mesma trava; sem vencidas em aberto, libera `non_payment` (pelo sistema, com o
    pagamento que fechou a conta); sem outro motivo ativo, volta à situação anterior.
11. **Falha de webhook:** conciliação corrige o espelho e segue o fluxo 5; fila parada vira alerta.
12. **Cancelamento:** o Suporte encerra o contrato e cancela a assinatura no Asaas (decisão 11.12).
13. **Duplicado, estorno, chargeback:** duplicado sinalizado ao Suporte, que estorna; `PAYMENT_REFUNDED` e
    `PAYMENT_CHARGEBACK_*` marcam a cobrança como revertida, sem suspensão automática (decisão 11.6); estorno parcial
    sinalizado.
14. **E-mail ou WhatsApp fora do ar:** retentativa com limite por canal; um não bloqueia o outro; sem nenhum, aviso
    `failed` visível ao Suporte e a faixa do painel continua.

## 7. Segurança, consistência e LGPD

- RLS em todas as `billing_*`; leitura do Suporte e do Administrador da própria clínica (o necessário); gravação pela
  API revogada; mudanças só por funções com `app.is_platform_staff()` ou pela `service_role`; `revoke` explícito de
  `clinic_service`, `anon` e `authenticated` (o `nucleo.sql` dá permissão padrão em tabela nova).
- Valores e situação fora da linha `clinics`, salvo `clinics.status`, já protegida por `guard_clinic_status`.
- Telas do Suporte em `/admin/sistema/*` (middleware já restringe) e conferência de novo no banco.
- Webhook: token em tempo constante, IPs oficiais (opcional), consulta na API antes de efeitos de pagamento, limite de
  tamanho do corpo. Aproveitar para trocar o `!==` do `CRON_SECRET` por comparação em tempo constante.
- Idempotência: id único do evento; aviso único por (cobrança, tipo); cobrança única por `asaas_payment_id`; criação no
  Asaas com referência externa e consulta antes de repetir.
- Concorrência: suspender, confirmar pagamento e reativar usam a mesma trava (`select … for update` na conta de
  cobrança), como `check_professional_limit`; pagamentos simultâneos ficam em série; suspender recalcula na hora.
- Motivos independentes: a reativação automática só libera `non_payment`.
- Trilha `billing_audit_log` só de inclusão, mais o `platform_audit_log`.
- LGPD: Asaas como operador; opt-in do WhatsApp com o nome do RecepClinic e a finalidade **[Meta]**; prazo de guarda
  dos dados financeiros; dados de pacientes fora do faturamento. Validação jurídica: termo de tratamento, contrato,
  política de privacidade.

## 8. Interface administrativa (proposta)

- **Suporte:** aba "Faturamento" em `src/pages/admin/sistema/clinicas/[id].astro`: contrato e versões, conta de
  cobrança e contatos, situação financeira, cobranças com o estado do Asaas e "Sincronizar agora", avisos e envios por
  canal, "Suspender por inadimplência" (confirmação e motivo), "Liberar motivo administrativo", trilha, divergências.
  Na visão geral: clínicas com vencidas e saúde do webhook.
- **Administrador da clínica:** tela "Assinatura": valor contratado, próximas e vencidas com o link de pagamento,
  contatos financeiros e opt-in (com trilha). Na suspensão, é a única tela liberada, com a faixa explicando.

## 9. Testes e implantação

- **Unidade:** mapa de estados do Asaas, regra "sem vencidas em aberto", D+3/D+7, escolha de canais, conferência do
  token.
- **Banco (`tests/db`):** RLS por clínica; Administrador sem mudar valor ou situação; `clinic_service` sem acesso;
  suspender/liberar/reativar; concorrência (dois pagamentos, pagamento contra suspensão); motivos diferentes; aviso
  único; cancelamento de aviso indevido.
- **Webhook:** repetido, atrasado, fora de ordem, token errado, malformado; API divergente do evento; fila parada
  recuperada pela conciliação.
- **Rotinas:** falha no meio e nova execução sem duplicar; e-mail fora; WhatsApp fora.
- **Regressão:** ativa e em implantação sem mudança; suspensa bloqueada no painel, páginas públicas, bot e rotinas,
  Assinatura e Suporte liberados; `npm test`, `npm run test:db`, `astro check`.
- **Sandbox do Asaas** (conta própria; e-mails e SMS do sandbox saem de verdade): cliente, assinatura Pix, implantação,
  confirmação simulada, webhook no staging, estorno; cartão e Pix Automático conforme o sandbox permitir.
- **Homologação no staging:** uma clínica de teste no ciclo completo (vence, D+3, D+7, suspende, paga, reativa) e outra
  com motivo administrativo que não reativa sozinha.
- **Produção:** testes passando, ciclo validado pelo cliente, chave e webhook da produção configurados pelo cliente,
  termo jurídico revisado, plano de volta escrito.
- **Volta:** reverter o commit da `producao`; migrações só de inclusão e `cron.unschedule` das rotinas novas sem apagar
  dados; liberar os motivos pelo Suporte; desativar o webhook no Asaas.

## 10. Riscos, dependências e limitações

- Pix Automático depende da elegibilidade (CNPJ com 6 meses, conta PJ aprovada) **[Asaas]**: lançar sem ele.
- WhatsApp financeiro exige WABA e número do RecepClinic, templates de utilidade aprovados, opt-in e histórico próprio;
  o webhook atual não reconhece número da plataforma (`resolveClinicByPhoneNumberId` devolve nulo, vira
  `unknownNumbers`) **[Código]**; a Meta pode reclassificar utilidade como marketing **[Meta]**. Não reaproveitar o
  `+55 61 9903-3143` (clínica de testes do staging) nem o número do app antigo sem avaliar.
- Restrição da chave por IP: a Vercel sai por IP variável; IP fixo = "Static IPs", US$ 100/mês por projeto no Pro
  **[Vercel]**.
- Bloqueio só no código: com o login, a pessoa pode chamar a API do Supabase direto (decisão 11.3).
- O Asaas pode avisar o cliente por conta própria e duplicar os avisos; opção de desligar a confirmar.
- Limitações: referência completa das APIs não lida (`externalReference`, mudança de valor de assinatura, página de
  fatura, `notificationDisabled`); banco da produção não consultado.

## 11. Decisões pendentes (uma de cada vez, com recomendação)

1. **Modelo da suspensão.** **Decidido (cliente, 28/out):** motivos registrados (`clinic_suspensions`: inadimplência ou
   administrativo, com quem, quando e texto); a clínica fica suspensa enquanto houver algum motivo ativo; o pagamento
   libera só o de inadimplência; `clinics.status = 'suspended'` continua sendo o sinal para o resto do sistema.
2. **O que conta como pago** para reativar e avisar. **Decidido (cliente, 28/out):** `CONFIRMED` ou `RECEIVED`
   (também o recebimento em dinheiro registrado no Asaas, se houver); análise de risco não conta.
3. **Onde fica o bloqueio.** **Decidido (cliente, 28/out):** primeiro no código (painel, páginas públicas, bot,
   rotinas e envios), na F12.3; depois, numa fase própria (F12.3b), o banco também recusa gravações operacionais da
   clínica suspensa, com testes próprios.
4. **O que o paciente vê na suspensão.** **Decidido (cliente, 28/out):** o bot não responde (a mensagem chega no app
   do WhatsApp da clínica); os links públicos mostram "Agendamento indisponível no momento. Fale com a clínica.";
   nada fala de cobrança ou suspensão para o paciente.
5. **Quem vê a tela Assinatura.** **Decidido (cliente, 28/out):** só o Administrador da clínica; Recepção e
   Profissional não veem e, na suspensão, veem só "Clínica suspensa: fale com o Administrador".
6. **Estorno ou chargeback depois do pagamento.** **Decidido (cliente, 28/out):** a cobrança fica marcada como
   revertida e em destaque para o Suporte, que decide; nada muda sozinho no acesso e não sai aviso automático para a
   clínica.
7. **Mudança de valor no meio do ciclo.** **Decidido (cliente, 28/out):** vale a partir do próximo ciclo, sem
   proporcional; a cobrança já gerada não muda; o Suporte registra a nova versão do contrato com a data de início.
8. **Implantação.** **Decidido (cliente, 28/out):** a cobrança avulsa é gerada quando o Suporte ativa o contrato,
   com o vencimento que ele informar; vencida, segue as regras da mensalidade (avisos D+3 e D+7, pesa na suspensão,
   precisa estar paga para reativar).
9. **Captura do cartão.** **Decidido (cliente, 28/out):** na página de pagamento do Asaas (link na tela Assinatura e
   no e-mail); nenhum dado de cartão no RecepClinic. Confirmar na referência do Asaas como a página trata a
   assinatura no cartão nos ciclos seguintes.
10. **Número de WhatsApp do RecepClinic.** **Pendente a pedido do cliente (28/out), decidir antes da implementação da
    F12.9.** Precisa ser um número do RecepClinic (não o da clínica, que fala com os pacientes). Opções levantadas:
    o número do RecepClinic hoje usado nos testes (tiraria dos testes), o número pessoal do cliente (em coexistência;
    o nome exibido vira "RecepClinic" para todos os contatos, as respostas das clínicas caem nas conversas pessoais e
    o número fica ligado à conta do RecepClinic na Meta) ou um chip dedicado (recomendado). Junto, decidir se a
    cobrança entra no ar só com e-mail até o WhatsApp estar aprovado (recomendado).
11. **Avisos do próprio Asaas.** **Decidido (cliente, 28/out):** desligar os avisos do Asaas ao pagador; a clínica
    recebe só os do RecepClinic. Confirmar na referência do Asaas se e como dá para desligar; se não der, voltar ao
    cliente antes da F12.7.
12. **Cancelamento do contrato.** **Decidido (cliente, 28/out):** a assinatura no Asaas é cancelada e as mensalidades
    futuras deixam de ser geradas; as já vencidas continuam em aberto para cobrar; a clínica usa até o fim do período
    já pago e então fica suspensa com o motivo `contract_ended` (liberado só pelo Suporte); dados preservados para
    exportação ou devolução conforme o contrato (prazo e forma com o advogado, item 16).
13. **D+3 e D+7:** dias corridos ou úteis, e o horário. Recomendo corridos, às 9h de Brasília.
14. **Nota fiscal das mensalidades:** pelo Asaas ou fora do sistema.
15. **IP fixo na Vercel** para restringir a chave (custo).
16. **Jurídico:** Asaas como operador, texto do opt-in, prazo de guarda.
17. **Troca de modo** (manual ↔ automático) com o contrato em andamento: o que acontece com a assinatura e as cobranças
    em aberto no Asaas. Recomendo: só por nova versão do contrato, com data de início; ao ir para o manual, cancelar a
    assinatura no Asaas e marcar as cobranças em aberto como canceladas (com trilha).

## 12. Roadmap

Cada fase vai ao staging e depende da validação do cliente.

| Fase | Entrega | Depende de |
|---|---|---|
| F12.0 | Este documento e as decisões 1 a 3 | cliente |
| F12.1 | Conta de cobrança: contatos financeiros, opt-in, trilha (sem Asaas) | F12.0 |
| F12.2 | Contrato e versões, valor negociado e implantação (sem Asaas) | F12.1 |
| F12.3 | Suspensão manual por motivos e bloqueio no painel, páginas públicas, bot e rotinas | decisões 1, 3, 4 |
| F12.3b | Bloqueio no banco: gravações operacionais recusadas para a clínica suspensa (a tela Assinatura e o Suporte seguem) | F12.3 |
| F12.4 | Cliente e cobranças no Asaas (sandbox): assinatura Pix convencional, implantação, espelho local | conta de testes |
| F12.5 | Webhook, fila de eventos, processamento idempotente, conciliação, saúde | F12.4 |
| F12.6 | Reativação automática com trava | F12.3, F12.5, decisão 2 |
| F12.7 | Avisos D+3, D+7 e de reconhecido por e-mail, com cancelamento dos indevidos | F12.5 |
| F12.8 | Cartão pela página do Asaas | decisão 9 |
| F12.9 | WhatsApp financeiro (número, templates, opt-in, histórico) | decisão 10, Meta |
| F12.10 | Pix Automático | elegibilidade no Asaas |
| F12.11 | Homologação completa e produção | critérios da seção 9 |

## Fontes (consultadas em 28/out/2026)

- Asaas: [Sobre os webhooks](https://docs.asaas.com/docs/sobre-os-webhooks),
  [Tipos de envio](https://docs.asaas.com/docs/tipos-de-envio),
  [Eventos para cobranças](https://docs.asaas.com/docs/webhook-para-cobrancas),
  [Eventos para assinaturas](https://docs.asaas.com/docs/eventos-para-assinaturas),
  [Assinaturas](https://docs.asaas.com/docs/assinaturas),
  [Assinatura com cartão](https://docs.asaas.com/docs/criando-assinatura-com-cartao-de-credito),
  [Pix Automático: implementação](https://docs.asaas.com/docs/pix-automatico-implementacao),
  [FAQ do Pix Automático](https://docs.asaas.com/docs/faq-2),
  [Chaves de API](https://docs.asaas.com/docs/chaves-de-api),
  [Autenticação](https://docs.asaas.com/docs/autentica%C3%A7%C3%A3o-1),
  [Sandbox](https://docs.asaas.com/docs/sandbox),
  [IPs oficiais](https://docs.asaas.com/docs/ips-oficiais-do-asaas),
  [FAQ de webhooks](https://docs.asaas.com/docs/faq-de-webhooks).
- Meta: [Categorização de templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization),
  [Opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in).
- Vercel: [Static IPs](https://vercel.com/docs/networking/static-ips).
