# Emissão de NFS-e pelo Asaas (substitui o emissor direto da F11)

> **Estado atual (retomar daqui), 29/out/2026.** **Planejamento concluído** (cliente, 29/out). Nada implementado.
> A implementação será feita numa branch **`faturamento`** recriada da `main` ao começar o código, só com a autorização
> do cliente, na ordem da seção 12.
> **N0 em andamento (29/out):** documentação conferida, nota de referência lida e **roteiro do Sandbox executado**
> (seção 13.6: emissão em Mossoró funciona ponta a ponta). **Asaas respondeu (13.7):** exige BaaS; chaves seguem
> válidas no BaaS. Decisões do cliente registradas; conta de produção aberta; avaliação BaaS e formulário de IP enviados.
> **30/out (13.8):** Asaas respondeu saldo negativo e e-mail da nota e mandou playbook, checklist e selos do BaaS.
> Decidido: reposição automática do saldo da subconta; e-mail real do tomador (entrega própria só pelo WhatsApp).
> Checklist = formulário do Google (13.9). Selo no staging validado e **formulário BaaS enviado (30/out)**: aguardando
> a análise do Asaas. Secretária respondida; contador em parte (CNAE e IBS/CBS, 30/out; faltam
> PIS/COFINS e certificado A1). Depois da
> N0: a F12.1, com o OK do cliente.

Marcas: **[Código]** conferido no repositório; **[Asaas]** documentação oficial do Asaas; **[Oficial]** prefeitura ou
governo; **[Cliente]** decisão ou informação do cliente; **[Hipótese]** conclusão técnica sem confirmação;
**[Pendência]** a confirmar (Asaas, contador, advogado).

Três domínios que **não se misturam**:
- **Faturamento do SaaS** (`billing_*`, [`planejamento-faturamento-saas.md`](planejamento-faturamento-saas.md)): o
  RecepClinic cobra as clínicas.
- **Financeiro dos pacientes** (`payments`, `*_finance`, DMED; F11.1, F11.2, F11.6): a clínica registra o que recebeu.
- **Emissão fiscal das clínicas** (`clinic_fiscal_settings`, `nfse_*`; F11.3 a F11.5): a clínica emite a NFS-e ao
  paciente. **É o escopo deste documento.**

A única ligação entre eles: o faturamento **lê** a contagem de notas autorizadas de cada clínica para cobrar o uso
(seção 3). A nota não sabe nada da fatura; a fatura não grava nada na nota.

## 1. Decisões do cliente (29/out/2026)

| Tema | Decisão |
|---|---|
| Emissor | **Substituir** a integração direta com a Sefin Nacional (F11.4) pelo Asaas. Sem dois emissores ativos e sem fallback para o antigo. Muda a decisão da F11 de 12/out ("integração direta, sem intermediário pago"). |
| Piloto | Mossoró/RN é atendido pelo Asaas (informado pelo cliente em 29/out). |
| Conta | **Uma subconta Asaas por clínica, criada pelo RecepClinic** a partir da conta principal. |
| Tarifa | O RecepClinic paga a tarifa do Asaas (R$ 0,49 por nota na tabela padrão) e **cobra da clínica um preço por nota** na fatura mensal, com margem (ex.: R$ 0,80). |
| Preço | **Preço padrão definido pelo Suporte**, copiado para o contrato da clínica e negociável ali; mudar o padrão não muda contrato em vigor. |
| Contagem | Entram as notas **autorizadas no mês** (pela data da autorização), **inclusive as canceladas depois** (o Asaas cobra na emissão). Recusadas e com erro não entram. |
| Pacote | **Franquia mensal** no contrato (quantidade ou ilimitada; ex.: Básico R$ 199 com 50 notas, Pro R$ 299 ilimitadas). Passou da franquia, cada nota a mais pelo preço do contrato. Sobra não acumula. |
| Quando cobra | As excedentes de um mês entram na **fatura do mês seguinte**, junto da mensalidade. O Administrador da clínica vê durante o mês quantas usou e quanto vai dar. |
| Transparência | O preço por nota e o detalhamento das cobranças ficam claros para o Administrador da clínica (tela Assinatura). |
| Tomador | E-mail e endereço completo de quem pagou no Financeiro (contato, paciente, outra pessoa), pedidos só ao emitir, como o CPF (29/out, depois do teste no Sandbox). |
| Ordem | Contrato com preço e franquia (F12.1/F12.2, sem Asaas) → base Asaas, subconta e emissão → detalhamento → cobrança automática (F12.4+). Até a cobrança automática, o Suporte cobra pelo modo manual com o mesmo detalhamento. |

## 2. Diagnóstico da implementação atual (F11, conferido em 29/out)

| Componente | Estado real |
|---|---|
| `clinic_fiscal_settings` | **[Código]** CNPJ (`app.is_valid_cnpj`), razão social, inscrição municipal, município (lista fixa: Mossoró 2408003), Simples (`not_optant`/`mei`/`me_epp`), regime especial, código de serviço, ISS 0–5%, regime e alíquota do Simples, ambiente `restricted`/`production`/`simulation` (só o Suporte troca, com trilha). Migrações `20261012140000`, `20261012160000`, `20261013120000`. |
| `service_fiscal_codes` | **[Código]** Código próprio por serviço (sem linha, vale o da clínica). |
| `clinic_fiscal_certificates` | **[Código]** Titular, CNPJ, validade, versão do termo e ponteiros do Vault (o .pfx e a senha ficam no Vault; revogar apaga). |
| `fiscal_audit_log` | **[Código]** Só inclusão: termo, certificado, ambiente, DMED, pedidos e resultados de emissão e cancelamento. |
| `nfse_dps_counters` | **[Código]** Numeração da DPS por clínica e ambiente, com trava. |
| `nfse_invoices` | **[Código]** `issuing`/`issued`/`rejected`/`canceling`/`canceled`; índice único **uma nota ativa por pagamento**; chave de 50 dígitos, número, XML, erro, motivo do cancelamento; pagamento com nota ativa não se exclui. Gravação só por `begin_/finish_nfse_issue` e `begin_/finish_nfse_cancel`. |
| `nfse_deliveries` | **[Código]** Envio por canal, destino, resultado, automático, quem pediu; a anonimização troca o destino. Migração `20261012170000`. |
| `src/lib/nfse/` | **[Código]** `dps.ts` (DPS 1.01), `sign.ts` (assinatura), `client.ts` (Sefin, TLS mútuo), `simulator.ts`, `danfse.ts` (PDF próprio, NT 008). |
| `src/lib/data/nfse.ts`, `nfseDelivery.ts` | **[Código]** Emitir, conferir, cancelar, conferência pela plataforma; envio por WhatsApp (`rc_nota_fiscal_v1`) e e-mail. |
| Rotina `notas-fiscais` | **[Código]** `pg_cron` às 6h30 UTC; confere na Sefin as `issuing`/`canceling` com mais de 10 minutos. **Não envia a nota encontrada** (falha conhecida). |
| Armazenamento | **[Código]** Bucket privado `nfse-xml`, pasta por clínica, link de 2 minutos; o PDF é gerado na hora a partir do XML. |
| Telas e rotas | **[Código]** `/admin/financeiro/pagamento/[id]` e `api/admin/financeiro/pagamentos/[id]`; `/admin/configuracoes/nota-fiscal` e a API; `api/admin/financeiro/notas/[id]`. |
| DMED | **[Código]** `src/lib/dmed.ts` e `src/lib/data/dmed.ts` usam **só `payments`** (nenhuma referência a `nfse`): **não é afetada**. |
| Testes | **[Código]** `src/lib/nfse/{nfse,simulator,danfse}.test.ts`; `tests/db/{emissao-nfse,envio-nfse,dados-fiscais,dmed,pagamentos,modulo-financeiro}.test.ts`. |
| Dados | **Staging:** 1 configuração, 1 certificado fictício, 1 nota `simulation:issued`, 1 envio (tudo teste). **Produção:** não conferido (leitura bloqueada no modo automático); **[Pendência]** conferir antes da N5. |

Achado: a F11 supôs emissão pela Sefin Nacional. **[Oficial]** O Decreto 7.497/2026 de Mossoró descreve a nota
"gerada e armazenada no sistema próprio" da Secretaria, no padrão nacional; **[Asaas]** as ME/EPP do Simples passam
a emitir só pelo Emissor Nacional a partir de 01/11/2026. O Asaas trata os dois caminhos pela configuração fiscal da
conta.

## 3. Cobrança das notas no faturamento (ampliação do faturamento, decidida em 29/out)

- **Parâmetro da plataforma:** preço padrão por nota (centavos), editado só pelo Suporte, com trilha
  (`billing_settings`, uma linha; ou coluna equivalente).
- **Contrato** (`billing_contracts`, nova versão para mudar): `invoice_unit_price_cents` (copiado do padrão),
  `invoice_monthly_allowance` (inteiro; nulo = ilimitado). O retrato do plano (ex.: Básico 50, Pro ilimitado) vem de
  `plans.ts` como sugestão.
- **Apuração mensal** (`billing_invoice_usage`, uma linha por clínica e mês, fechada no 1º dia do mês seguinte, fuso
  da clínica): notas autorizadas no mês (contagem lida de `nfse_invoices` por `authorized_at`, inclusive as canceladas
  depois), franquia, excedentes, preço unitário, valor, e a cobrança em que entrou. Mês aberto = cálculo ao vivo para a
  tela.
- **Detalhe da cobrança** (`billing_charge_items`): itens da fatura (`monthly`, `setup`, `invoice_overage`, `other`)
  com quantidade, preço unitário e total; as excedentes do mês formam uma cobrança própria (item `invoice_overage`), separada da mensalidade.
- **Asaas (cobrança automática, F12.4+):** **decidido (cliente, 29/out, recomendação do Asaas):** a cobrança da
  assinatura não muda; as excedentes do mês vão numa **cobrança avulsa separada**, com o mesmo vencimento da
  mensalidade seguinte. **Modo manual:** o Suporte vê o mesmo detalhamento e registra o pagamento.
- **Tela Assinatura** (Administrador da clínica, decisão 11.5): mensalidade, preço por nota, franquia, notas do mês
  até agora (incluídas, excedentes, valor previsto), histórico por mês e a lista das notas que entraram (data, número,
  situação; sem CPF).
- **Tarifa do Asaas na subconta:** **[Pendência]** como o RecepClinic cobre a tarifa descontada da subconta (que não
  recebe dinheiro pelo Asaas): cobrança direta na conta principal, transferência para a subconta ou condição de
  contrato. Define o custo real e a conciliação da margem.

## 4. Viabilidade fiscal e o que o Asaas oferece

| # | Tema | Resposta |
|---|---|---|
| 1 | Mossoró | **[Cliente]** Atendido. **[Asaas]** A conferência técnica é `GET /v3/fiscalInfo/municipalOptions`, que responde pelo município do CNPJ da conta: rodar na subconta da clínica piloto. |
| 2 | Habilitação | **[Oficial]** Cadastro prévio na Sefaz de Mossoró. **[Asaas]** Cadastro ativo no portal da prefeitura (MEI: Portal Nacional). |
| 3 | Regimes | **[Asaas]** `simplesNacional`; `specialTaxRegime` quando `usesSpecialTaxRegimes` (valores de `specialTaxRegimesList`). |
| 4 | Serviço e tributos | **[Asaas]** `municipalServiceId` (lista de `GET /v3/fiscalInfo/services`) ou `municipalServiceCode`; no Portal Nacional, só o código. `taxes` obrigatório por nota (`retainIss`, `iss`, `pis`, `cofins`, `csll`, `inss`, `ir`; opcionais `nbsCode` e os da reforma). |
| 5 | Prestador e tomador | **[Asaas]** `POST /v3/fiscalInfo`: `email`, `municipalInscription`, `simplesNacional`, `cnae`, `rpsSerie`, `rpsNumber` e as credenciais. Tomador = `customer` da subconta. |
| 6 | Credenciais | **[Asaas]** `authenticationType`: `USER_AND_PASSWORD` (`username`, `password`), `TOKEN` (`accessToken`) ou `CERTIFICATE` (`certificateFile`, `certificatePassword`). Portal Nacional: **A1 e-CNPJ (.pfx/.p12)**; usuário e senha aceitos, com instabilidade relatada pelo Asaas. **O certificado continua necessário.** |
| 7 | Quem emite | **[Asaas]** A conta onde a nota é agendada (a subconta da clínica). |
| 8 | Várias clínicas | **[Asaas]** `POST /v3/accounts` (só conta principal PJ); resposta com `apiKey` (só na criação) e `walletId`; configuração fiscal **na própria subconta**; `webhooks` na criação. Sandbox: 20 subcontas por dia. Produção: período de avaliação (10 subcontas, R$ 2.000 em cobranças por subconta, 60 dias) até a homologação; marca Asaas nos pontos de contato; tarifa de criação possível. |
| 9 | Operações | **[Asaas]** `POST /v3/invoices` (agenda; origem `payment`, `installment` ou **`customer`** para nota avulsa; `externalReference`; `effectiveDate`), `POST /v3/invoices/{id}/authorize`, `GET /v3/invoices/{id}`, `PUT` só em `SCHEDULED`/`ERROR`, `POST /v3/invoices/{id}/cancel` (onde `supportsCancellation`). |
| 10 | PDF e XML | **[Asaas]** `pdfUrl` e `xmlUrl` depois de `AUTHORIZED`; também `number` e `validationCode`. |
| 11 | Estados e webhooks | **[Asaas]** `SCHEDULED`, `AUTHORIZED`, `PROCESSING_CANCELLATION`, `CANCELED`, `CANCELLATION_DENIED`, `ERROR`. Eventos `INVOICE_CREATED`, `_UPDATED`, `_SYNCHRONIZED`, `_AUTHORIZED`, `_PROCESSING_CANCELLATION`, `_CANCELED`, `_CANCELLATION_DENIED`, `_ERROR`. "Pelo menos uma vez" (deduplicar pelo `id`), token `asaas-access-token` (sem assinatura), fila pausada após 15 falhas, eventos por 14 dias, `SEQUENTIALLY`/`NON_SEQUENTIALLY`, campos novos podem aparecer. **Agendar não é emitir.** |
| 12 | Tarifas | **[Asaas]** R$ 0,49 por nota emitida (tabela padrão; o contrato pode diferir). |
| 13 | DMED e contador | **[Código]** A DMED sai de `payments`. **[Pendência]** O contador informa regime, CNAE, código de serviço, NBS e o número inicial (`rpsNumber`), para a numeração continuar. |
| — | API | **[Asaas]** Sandbox `https://api-sandbox.asaas.com/v3`, Produção `https://api.asaas.com/v3`; cabeçalho `access_token`; contas e chaves independentes por ambiente. |

## 5. Arquitetura

```
Recepção registra pagamento ──► payments (sem mudança)
        │ "Emitir nota" (só com a emissão habilitada na clínica)
        ▼
begin_nfse_issue (banco: papel, item, CPF, habilitação; nota "issuing")
        ▼
servidor (chave da subconta, do Vault): customer do tomador ──► POST /v3/invoices
        (externalReference = id da nota local) ──► POST /v3/invoices/{id}/authorize
        ▼
nota local "issuing" + asaas_invoice_id        (pedido aceito ≠ nota emitida)
        ▼
webhook /api/asaas/notas (token da subconta) ─► nfse_provider_events (id único) ─► 200
        ▼   processamento assíncrono: GET /v3/invoices/{id} confirma o estado
AUTHORIZED → issued (PDF e XML copiados para o bucket) │ ERROR → rejected
        ▼
saída de entregas (pendente) ──► rotina envia WhatsApp/e-mail, idempotente, com novas tentativas
        ▲
rotina notas-fiscais: conciliação das pendentes no Asaas + entregas atrasadas + saúde
```

- **Base Asaas compartilhada com o faturamento:** `src/lib/asaas/` (cliente HTTP, ambiente, timeout de 60 s, erros,
  logs sem chave). Separados: chaves (a da conta principal cria subcontas e cobra as clínicas; a de cada subconta só
  emite notas), rotas de webhook, tabelas de eventos (`nfse_provider_events` × `billing_provider_events`) e trilhas
  (`fiscal_audit_log` × `billing_audit_log`). A clínica é `customer` na conta principal (faturamento) e subconta
  (notas): registros diferentes, sem ligação.
- **Vínculo clínica ↔ subconta:** `asaas_account_id`, `asaas_wallet_id` e a chave da subconta no **Vault** (como o
  token do WhatsApp). O webhook identifica a clínica pelo `account.id` do evento e confere o token daquela subconta.
- **Tomador:** `customer` por CPF de quem pagou, criado na subconta na primeira nota e reaproveitado (vínculo local
  clínica + CPF → `customer_id`). **[Pendência]** desligar as notificações do Asaas ao paciente.
- **Duplicidade:** índice "uma nota ativa por pagamento" + `asaas_invoice_id` único + `externalReference`. Timeout no
  agendamento: procurar a nota antes de repetir. **[Pendência]** filtro por `externalReference` na listagem; sem ele,
  procurar pelo `customer` e a data.
- **Cancelamento:** `begin_nfse_cancel` → `POST /cancel` → `canceling`; webhook ou conciliação levam a `canceled` ou de
  volta a `issued` (`CANCELLATION_DENIED`). Sem `supportsCancellation`: o botão some e a tela orienta a cancelar no
  portal da prefeitura.
- **Entrega (corrige a falha conhecida):** a passagem para `issued` (pela resposta, pelo webhook ou pela conciliação)
  marca a entrega automática como pendente; a rotina envia e registra; índice único por (nota, canal, destino) no
  envio automático; falha técnica volta para nova tentativa; tudo visível na tela do pagamento.
- **Ambientes:** staging = Sandbox do Asaas; produção = Produção. O ambiente `simulation` sai.

## 6. Configuração fiscal por clínica

`clinic_fiscal_settings` é **adaptada** (sem tabela nova):
- `issuing_enabled` (só liga com os pré-requisitos: subconta criada, configuração fiscal salva e conferida, código de
  serviço, certificado ou credencial aceito pelo Asaas); desligada, o pagamento funciona normalmente e nenhuma chamada
  ao Asaas acontece;
- `asaas_account_id`, `asaas_wallet_id`, `api_key_secret_id` (Vault), `fiscal_info_status`
  (`pending`/`configured`/`error`) e a mensagem, `municipal_options` (retrato do `municipalOptions`), `cnae`,
  `nbs_code`, série e número inicial;
- ambiente `sandbox`/`production` no lugar de `restricted`/`production`/`simulation`.

Permissões: o **Suporte** cria a subconta e acompanha a aprovação; o **Administrador** preenche os dados fiscais,
envia o certificado (que passa pelo servidor direto ao `POST /v3/fiscalInfo`, sem ficar no Vault) e liga a emissão; a
**Recepção** emite; só o Administrador cancela. Toda mudança na `fiscal_audit_log`.

## 7. Destino de cada componente

| Componente | Ação | Por quê |
|---|---|---|
| `dps.ts`, `sign.ts`, `client.ts` | Desativar → Remover | O Asaas monta, assina e transmite. |
| Vault do .pfx, `get_fiscal_certificate_secret`, `set/revoke_fiscal_certificate` | Desativar → Remover (os metadados do certificado ficam para o aviso de vencimento) | O certificado fica com o Asaas. |
| `nfse_dps_counters` | Desativar → Remover | Numeração no Asaas. |
| `simulator.ts`, ambiente `simulation`, `NFSE_SIMULATION` | Manter temporariamente → Remover | Só serve ao emissor antigo; o Sandbox substitui. |
| `danfse.ts` | Manter temporariamente | Notas novas usam o PDF do Asaas; o gerador só atende as antigas. |
| `issueNfse`/`checkNfse`/`cancelNfse` | Adaptar | Mesma interface para a tela; por dentro, Asaas. |
| `begin_/finish_*` | Adaptar | Mesmas regras de papel, CPF e trava, sem DPS. |
| Rotina `notas-fiscais` | Adaptar | Conciliação no Asaas, entregas e saúde; mais de uma vez por dia. |
| `nfseDelivery.ts`, `rc_nota_fiscal_v1` | Preservar / Adaptar | PDF do bucket; saída de entregas. |
| `fiscal_audit_log` | Preservar (eventos novos: `asaas_account_created`, `fiscal_info_saved`, `issuing_enabled`, `issuing_disabled`) | Auditoria. |
| `payments`, `*_finance`, DMED | Preservar | Não dependem da nota. |
| `service_fiscal_codes` | Preservar | Vira o `municipalServiceCode` por serviço. |
| `nfse_invoices`, `nfse_deliveries`, bucket | Adaptar (colunas novas; as da DPS ficam para o histórico) | Histórico e novas regras. |
| Telas `nota-fiscal` e `pagamento/[id]` | Adaptar | Habilitação, situação no Asaas, cancelamento condicional. |
| Testes do emissor | Adaptar / Remover junto com o código | Asaas falso nos testes de banco. |
| Migrações antigas | Preservar | Mudança só por migração nova. |

**Desligamento do emissor antigo (fase N5):** sem `sendDps`, `findNfseByDps`, `httpsTransport` nem
`get_fiscal_certificate_secret` em rotas e rotinas; `EXECUTE` revogado; teste que falha se uma rota importar
`src/lib/nfse/client.ts`; `pg_cron` com a rotina adaptada só. Dados: as notas `simulation` e os certificados
fictícios do staging são de teste; a produção é conferida antes (seção 2).

## 8. Segurança e LGPD

- Webhook: token próprio por subconta (`authToken`, nunca a chave da API), comparado em tempo constante; evento gravado
  antes do 200; processamento assíncrono; `NON_SEQUENTIALLY` com confirmação por `GET`; campos desconhecidos ignorados;
  fila pausada e eventos parados na `/api/saude`.
- Segredos: chaves das subcontas no Vault, lidas só no servidor; `log.ts` mascara CPF, CNPJ e chaves.
- RLS por clínica como na F11; a contagem para a fatura é lida por função da plataforma, sem CPF.
- **[Pendência — advogado]** O Asaas passa a ser operador dos dados de quem paga (nome, CPF) e da clínica: termo
  clínica–RecepClinic, aceite dos termos do Asaas pela clínica (titular da subconta), política de privacidade, termo
  fiscal (hoje provisório), prazo de guarda. A anonimização apaga o cadastro; nota e tomador no Asaas ficam
  (obrigação legal).
- Responsabilidades: **clínica** (emissora; regime e tributação com o contador; cadastro municipal), **Asaas**
  (transmissão, numeração, PDF e XML), **RecepClinic** (dados enviados, conciliação, cópias, entrega, DMED, cobrança do
  uso).

## 9. Testes e critérios de aceite

- **Automatizados (Asaas falso):** habilitação só com pré-requisitos; emissão até `AUTHORIZED` pelo webhook e pela
  conciliação; `ERROR`; cancelamento e cancelamento negado; município sem cancelamento; timeout sem segunda nota;
  webhook repetido, fora de ordem e com token errado; entrega automática uma vez só (inclusive pela conciliação) e nova
  tentativa depois de falha; isolamento; quatro perfis; clínica não habilitada sem chamada ao Asaas; DMED igual antes e
  depois; contagem do mês (autorizadas, canceladas contam, recusadas não), franquia, excedente e preço do contrato;
  emissor antigo não acionado.
- **Sandbox (staging):** subconta, `municipalOptions`, `fiscalInfo`, nota avulsa com `customer`, webhooks reais, PDF e
  XML, detalhamento na tela Assinatura.
- **Real (com autorização do cliente e do contador):** subconta da clínica piloto de Mossoró, uma nota de valor
  simbólico, cancelamento se o município permitir, conferência no portal.

## 10. Arquivos afetados

`supabase/migrations/` (novas); `src/lib/nfse/*`; `src/lib/asaas/` (novo); `src/lib/data/{nfse,nfseDelivery,fiscal,
platform}.ts`; `src/pages/api/cron/notas-fiscais.ts`; `src/pages/api/asaas/notas.ts` (novo);
`src/pages/api/admin/financeiro/{pagamentos,notas}/[id].ts`; `src/pages/api/admin/configuracoes/nota-fiscal.ts`;
`src/pages/admin/configuracoes/nota-fiscal.astro`; `src/pages/admin/financeiro/pagamento/[id].astro`;
`src/lib/fiscalTerms.ts`; `src/lib/log.ts`; `src/lib/env.ts`; `src/lib/plans.ts` (franquia de referência); tela
Assinatura e aba Faturamento do Suporte (faturamento); `tests/db/{emissao-nfse,envio-nfse,dados-fiscais}.test.ts`.

## 11. Pendências (fase N0)

**Com o Asaas (dá para testar no Sandbox):**
1. Como a tarifa da nota da subconta é cobrada do RecepClinic.
2. Se a subconta precisa estar aprovada (documentos) para emitir nota.
3. Validade e acesso dos links `pdfUrl`/`xmlUrl`.
4. Como desligar as notificações do Asaas ao tomador.
5. Filtro por `externalReference` na listagem de notas.
6. ~~Como somar as excedentes à cobrança da assinatura~~: cobrança avulsa separada (13.7).
7. `municipalOptions` da clínica piloto (autenticação, cancelamento, regime).

**Com o contador:** regime da clínica piloto, CNAE, código de serviço, NBS, número inicial da série, data do Simples
no Emissor Nacional. **Com o advogado:** termos e prazo de guarda (seção 8). **Operação:** conferir que a produção não
tem dados fiscais antes da N5.

## 12. Fases (na branch `faturamento` recriada ao começar o código, cada uma com a autorização e a validação do cliente)

| Fase | Entrega | Depende de |
|---|---|---|
| N0 | Pendências da seção 11 respondidas; conta Sandbox do Asaas | cliente, Asaas, contador |
| F12.1 / F12.2 | Conta de cobrança; contrato com **preço por nota e franquia** e o preço padrão do Suporte (sem Asaas) | planejamento do faturamento |
| N1 | Base Asaas (`src/lib/asaas/`) | N0 |
| N2 | Subconta, Vault da chave, configuração fiscal e habilitação | N1 |
| N3 | Emissão, cancelamento, webhook, eventos e conciliação | N2 |
| N4 | PDF e XML no bucket; saída de entregas idempotente | N3 |
| N4b | Apuração mensal e **detalhamento** na tela Assinatura e na aba do Suporte (cobrança manual) | F12.2, N3 |
| N5 | Desligar e remover o emissor antigo | N3, N4, produção conferida |
| N6 | Nota real em Mossoró e produção | autorização do cliente e do contador |
| F12.3+ | Restante do faturamento; na F12.4+, as excedentes viram cobrança avulsa automática | planejamento do faturamento |

## 13. Fase N0 (29/out/2026)

### 13.1 Respondido pela documentação do Asaas

| Pendência | Resposta |
|---|---|
| Buscar nota pela referência (item 5) | **Sim.** `GET /v3/invoices` filtra por `externalReference`, `customer`, `payment`, `status` e `effectiveDate[Ge]`/`[Le]` (até 100 por página). Timeout ao agendar: procurar pelo `externalReference` antes de repetir. |
| Tomador sem duplicar | `GET /v3/customers` filtra por `cpfCnpj` e `externalReference`; procurar antes de criar. |
| Avisos ao paciente (item 4) | `POST /v3/customers` aceita `notificationDisabled: true` ("desabilitar o envio de notificações de cobrança"). **Falta confirmar** se cobre o e-mail da nota fiscal. |
| Excedentes na fatura (item 6) | `PUT /v3/payments/{id}` altera o valor de cobrança `PENDING` ou `OVERDUE` (envia `billingType`, `value`, `dueDate`; gera `PAYMENT_UPDATED`). **Falta confirmar** para cobranças geradas por assinatura. |
| Chaves das subcontas | **Ponto crítico novo:** a chave da subconta "fica disponível somente durante o Período de Avaliação"; continuar usando exige **adequação ao BaaS** (alinhada com o gerente de contas) ou subcontas de filiais (mesmo prefixo de CNPJ, não é o caso). O gerenciamento de chaves de subconta (`/v3/accounts/{id}/accessTokens`) exige liberação temporária de 2 h na interface e **lista de IPs autorizados** (a Vercel não tem IP fixo; decisão 11.15). |
| Período de avaliação | Começa na 1ª subconta criada em produção; até 10 subcontas, R$ 2.000 em cobranças por subconta, 60 dias; depois, bloqueio de novas subcontas até a **homologação regulatória**, que pode ser pedida a qualquer momento. Subcontas do Sandbox não vão para a produção. |
| Tarifa da subconta (item 1) | Só documentado o `isFeePayer` da Conta Escrow (quem paga a mensalidade dela). Nada sobre a tarifa da nota: **pergunta ao Asaas**. |

### 13.2 Perguntas ao Asaas (texto para o cliente enviar ao gerente de contas ou ao suporte)

> Somos o RecepClinic, um sistema (SaaS) para clínicas médicas. Queremos que cada clínica cliente emita NFS-e aos
> seus pacientes pelo Asaas, com uma subconta por clínica criada pela nossa conta principal via API. A subconta seria
> usada só para emitir notas (os pacientes pagam a clínica fora do Asaas). Piloto em Mossoró/RN.
>
> 1. Esse uso exige o modelo BaaS ou a subconta padrão atende? Se exigir BaaS, quais são as condições e os custos?
> 2. A documentação diz que a chave de API da subconta só fica disponível durante o período de avaliação. Depois da
>    homologação, as chaves das subcontas continuam válidas? Qual é o caminho para o nosso caso?
> 3. O gerenciamento de chaves de subconta exige lista de IPs autorizados, e nossa hospedagem não tem IP fixo. Há
>    alternativa?
> 4. A tarifa por nota emitida (R$ 0,49 na tabela) é debitada da subconta que emite? Nossa conta principal pode pagar
>    as tarifas das subcontas (débito direto na principal, `isFeePayer` ou transferência)? Se a subconta estiver sem
>    saldo, a nota é emitida?
> 5. Há tarifa de criação ou mensalidade por subconta no nosso contrato? Quais valores?
> 6. A subconta precisa estar aprovada (documentos do titular) para configurar as informações fiscais e emitir nota?
>    O que a clínica precisa enviar?
> 7. O titular da subconta recebe e-mails do Asaas e precisa acessar o painel? O `notificationDisabled` do cliente
>    também impede o e-mail da nota fiscal ao tomador (o paciente)?
> 8. Os links `pdfUrl` e `xmlUrl` são públicos? Expiram? Podemos baixar e guardar uma cópia?
> 9. Mossoró/RN: confirmam a emissão (a) para ME/EPP do Simples pelo Portal Nacional, com certificado A1, e (b) para
>    empresa fora do Simples pelo sistema da prefeitura? O cancelamento automático é suportado lá?
> 10. Na nossa cobrança mensal às clínicas (assinatura na conta principal), podemos alterar o valor da cobrança
>     pendente gerada pela assinatura (`PUT /v3/payments/{id}`) para somar as notas excedentes do mês? Ou recomendam
>     cobrança avulsa no mesmo vencimento?
> 11. Homologação regulatória: o que é exigido para o nosso caso? Podemos iniciar antes de criar a primeira subconta
>     em produção?
> 12. Webhooks: podemos usar um só endereço para todas as subcontas, com um token diferente por subconta, configurado
>     no campo `webhooks` da criação?
> 13. Onde precisamos exibir a marca do Asaas, já que não haverá cobrança ao paciente pela subconta?

### 13.3 Perguntas ao contador da clínica piloto

> 1. Regime da clínica: Simples Nacional (ME/EPP), Lucro Presumido ou outro? Há regime especial (ex.: sociedade de
>    profissionais)?
> 2. Se for do Simples: a clínica já emite pelo Emissor Nacional? Qual a data em que passa a ser obrigatório
>    (01/11/2026?)?
> 3. CNAE usado nas notas.
> 4. Código de serviço da lista nacional e código de tributação nacional; código NBS.
> 5. Alíquota de ISS e retenções (ISS retido, PIS, COFINS, CSLL, IR, INSS) para nota a pessoa física.
> 6. Série e número da última nota (ou DPS) emitida, para a numeração continuar.
> 7. Inscrição municipal e cadastro na Sefaz Digital de Mossoró ativos? A clínica tem certificado A1 (e-CNPJ)?
> 8. A descrição "Consulta. Paciente: Nome. Atendimento em dd/mm/aaaa." está adequada?
> 9. Prazo para cancelar uma nota em Mossoró ou no Emissor Nacional.
> 10. A DMED continua sendo gerada pelo RecepClinic a partir dos pagamentos registrados: alguma ressalva?

### 13.5 Dados fiscais da clínica piloto (nota emitida em 24/09/2026, conferida em 29/out)

Só os dados da clínica (o arquivo e os dados do tomador não ficam no projeto):
- **Emissão pelo sistema próprio da Prefeitura de Mossoró** ("Ambiente Gerador: Sistema Próprio do Município"), no
  padrão nacional (DANFSe v2.0, chave de 50 dígitos, consulta no portal nacional).
- **Não optante do Simples Nacional:** a regra de 01/11/2026 (Simples só pelo Emissor Nacional) não se aplica; o
  piloto é o caso **(b)** da pergunta 9 ao Asaas (fora do Simples, sistema da prefeitura). O emissor direto atual
  (Sefin Nacional) provavelmente não atenderia esse caso.
- Regime especial: nenhum. Código de tributação nacional **04.01.01** (Medicina), sem código municipal. NBS
  **1.2301.22.00**. ISS **5%**, tributável em Mossoró, **não retido**. Sem retenções federais.
- IBS/CBS: CST **200**, cClassTrib **200029**, indicador de operação **100301**, redução de 60% (equivalem a
  `taxSituationCode`, `taxClassificationCode` e `operationIndicatorCode` do Asaas).
- DPS série **2026**, número no formato 26000000000xx (para o `rpsSerie`/`rpsNumber` na implantação).
- Descrição usada hoje: "REFERENTE A CONSULTA DE [paciente]", com o responsável como tomador (o modelo do plano).
- **Contador (30/out):** CNAE **86.30-5-03** (atividade médica ambulatorial restrita a consultas). IBS/CBS: manter
  CST **200** e cClassTrib **200029**, mas o **indicador de operação correto é 030101** (as notas de hoje saem com
  100301). Na implantação, usar 030101.
- **Secretária (29/out; site em 30/out):** emite na **Sefaz Digital de Mossoró** (portal Tinus,
  `https://www.tinus.com.br/csp/mossoro/portal/index.csp`, área restrita do contribuinte), com **usuário e senha**. **Atenção:** pelo Asaas, Mossoró
  exige **certificado A1** (`authenticationType: CERTIFICATE`, seção 13.6); usuário e senha não servem. **[Pendência]**
  a clínica tem A1 de pessoa jurídica (o contador costuma ter)? Se não tiver, precisa comprar antes da N6.
- Falta (**contador**): PIS/COFINS e o certificado A1 (a clínica tem e-CNPJ A1?); as demais perguntas da 13.3
  (série e última nota, prazo de cancelamento, descrição, DMED) quando ele puder.

### 13.4 Roteiro no Sandbox (depois que o cliente criar a conta e a chave)

Chave em `.env.asaas-sandbox` (fora do git), nunca no chat. Só o Sandbox; nada na produção.
1. `GET /v3/myAccount` (a chave funciona).
2. `POST /v3/accounts`: subconta fictícia com endereço de Mossoró; guardar `apiKey` e `walletId` só no arquivo local.
3. Na subconta: `GET /v3/fiscalInfo/municipalOptions` (autenticação, cancelamento, regime).
4. `POST /v3/fiscalInfo` com dados de teste; `GET /v3/fiscalInfo`.
5. `POST /v3/customers` com `notificationDisabled: true`; `GET /v3/customers?cpfCnpj=`.
6. `POST /v3/invoices` (origem `customer`, `externalReference`) e `POST /v3/invoices/{id}/authorize`.
7. `GET /v3/invoices/{id}` (estado, `pdfUrl`, `xmlUrl`) e `GET /v3/invoices?externalReference=`.
8. Baixar o PDF e o XML (acesso e validade dos links).
9. `POST /v3/invoices/{id}/cancel`, se o município de teste permitir.
10. Extrato da subconta e da principal: onde a tarifa da nota foi debitada.

### 13.6 Resultado do roteiro no Sandbox (29/out/2026)

Conta principal do Sandbox (PJ) e uma subconta fictícia com endereço em Mossoró (IBGE 2408003); chaves em
`.env.asaas-sandbox` e `.env.asaas-sandbox-sub` (fora do git); scripts descartáveis, fora do repositório.

| Passo | Resultado |
|---|---|
| Chave e conta | `GET /v3/myAccount` 200. |
| Subconta | `POST /v3/accounts` 200 (`apiKey` e `walletId` na resposta). Recusas úteis: CEP genérico inválido; CNPJ já usado por outra conta do Sandbox. Situação inicial: `general: PENDING`. |
| Regras de Mossoró | `authenticationType: CERTIFICATE` (**A1 obrigatório**), `supportsCancellation: true`, `usesSpecialTaxRegimes: true` (lista "-", Microempresa Municipal, Estimativa, Sociedade de Profissionais, Cooperativa, MEI, ME/EPP), `usesServiceListItem: true` (ex.: "04.01"), `usesNbs: true`, `usesStateInscription: false`. |
| Configuração fiscal | `POST /v3/fiscalInfo` (multipart) aceito com `simplesNacional=false`, inscrição, CNAE, `specialTaxRegime=0`, `serviceListItem=04.01`, NBS **formatado** (`1.2301.22.00`; sem pontos é recusado), série e número, certificado A1 de teste. Volta `useNationalPortal: false` (**emissão pelo sistema da prefeitura**). |
| Aprovação | **Sem o cadastro geral aprovado a nota não sai:** "Você precisa ter seu cadastro geral aprovado para emitir notas fiscais." No Sandbox, `POST /v3/sandbox/myAccount/approve`; na produção, documentos do titular (a clínica). |
| Tomador | `POST /v3/customers` com `notificationDisabled: true`; `GET /v3/customers?cpfCnpj=` encontra. **Para autorizar, o tomador precisa de e-mail e endereço completo com CEP válido** (recusa: "E-mail do cliente incompleto; Endereço do cliente incompleto; CEP do cliente é inválido"). |
| Nota | `POST /v3/invoices` com `customer`, `externalReference`, `municipalServiceCode=04.01.01`, `municipalServiceName`, `taxes` (ISS 5%, não retido; CST 200, cClassTrib 200029, indicador 100301) **e `pisCofinsTaxStatus`** (obrigatório; teste com `NONE`). IBS/CBS calculados pelo Asaas **iguais aos da nota real** (IBS estadual 0,04% = R$ 0,17; CBS 0,36% = R$ 1,54). `GET /v3/invoices?externalReference=` encontra a nota. |
| Autorização | `POST /authorize` respondeu `SYNCHRONIZED` (**estado fora da lista documentada**: o código deve aceitar estados desconhecidos); `AUTHORIZED` em cerca de 5 s, com número, `pdfUrl` e `xmlUrl`. |
| PDF e XML | Links em `sandbox.asaas.com/000/file/…`, **abertos sem login** (200, PDF de 16 KB e XML de 4 KB): tratar como confidenciais, copiar para o bucket privado e nunca mostrar o link à clínica. Validade não informada. |
| Cancelamento | `POST /cancel` → `PROCESSING_CANCELLATION` → `CANCELED` em poucos segundos. |
| Tarifa | **R$ 0,49 debitado da subconta** (`INVOICE_FEE`, "Taxa de emissão da nota fiscal de serviço nr. …"), que ficou com **saldo negativo** (−0,49); a conta principal não foi cobrada; **a tarifa não volta no cancelamento** (confirma a contagem das canceladas). A emissão não foi barrada pelo saldo zero (no Sandbox). |
| Webhooks | Não testados (precisam de endereço público): ficam para a N3, no staging. |

**Consequências para o plano:**
1. **Dados do tomador (decisão de negócio):** a nota exige e-mail e endereço completo de quem pagou; hoje o
   Financeiro guarda CPF e nome (e o e-mail para envio da nota, opcional). O Financeiro do contato e do paciente
   precisa passar a guardar o endereço e o e-mail de quem paga (só no módulo, como o CPF). **Decidido (cliente,
   29/out):** e-mail e endereço (CEP, rua, número, bairro; o CEP preenche a rua) no cartão Financeiro do contato e do
   paciente e na pessoa "outra" que paga; não obrigatórios para registrar o pagamento, pedidos só ao emitir a nota,
   como o CPF; gravados também no pagamento (como nome e CPF), para a nota não mudar se o cadastro mudar.
2. **Tarifa:** cai na subconta, que não recebe dinheiro; o RecepClinic precisa cobrir o saldo negativo (transferência
   da conta principal ou condição do Asaas). Pergunta 4 ao Asaas continua: o que acontece com saldo negativo
   prolongado.
3. **Aprovação da subconta** entra no fluxo de habilitação (Suporte acompanha `GET /v3/myAccount/status` e o
   webhook de aprovação); a clínica envia os documentos.
4. **Contador:** confirmar o `pisCofinsTaxStatus` correto (o teste usou `NONE`, como na nota de referência, sem PIS
   e COFINS) e o CNAE (o teste usou 8630503, sem confirmação).

### 13.7 Resposta do Asaas (suporte, 29/out/2026)

| # | Resposta **[Asaas]** |
|---|---|
| 1 | **Exige BaaS**, alinhado e habilitado antes. Sem custo de implantação. Avaliação: 10 subcontas, R$ 2.000 por subconta ou 60 dias. |
| 2 | **No BaaS, as chaves das subcontas continuam válidas** depois da avaliação. A principal pode criar chave nova pela API. **Expiram após 6 meses sem uso.** |
| 3 | Gerenciar chaves exige **lista de IPs**. Sem IP fixo: mandar os detalhes pelo formulário para o time de Produto avaliar alternativa. |
| 4 | R$ 0,49 por nota, emitida em nome da subconta. **Não responderam** quem paga nem o que acontece com saldo negativo. |
| 5 | **R$ 12,90 por subconta, uma vez, descontado da principal.** Sem mensalidade da subconta. |
| 6 | Subconta aprovada e configuração fiscal antes de emitir. Documentos pelo `onboardingUrl` ou pela API. |
| 7 | No BaaS a clínica não usa o painel do Asaas. **`notificationDisabled` não confirmado** para o e-mail da nota: validar antes. |
| 8 | Pode guardar cópia. Validade dos links não informada (já previsto: cópia no bucket). |
| 9 | Ler sempre `municipalOptions` (já previsto). **Simples Nacional sai do sistema da prefeitura para o Portal Nacional em 01/11/2026**; autenticação por A1 ou CNPJ e senha do Portal Nacional. Piloto fora do Simples: segue o teste (prefeitura). |
| 10 | **Recomendam não alterar a cobrança da assinatura: cobrança avulsa separada para as excedentes.** |
| 11 | Homologação pode ser pedida já, no processo de avaliação BaaS (checklist, documentos, adequações). |
| 12 | Um só endereço de webhook para todas as subcontas, com `authToken` (já previsto). |
| 13 | **Marca, links e textos de responsabilidade do Asaas** nas telas, comprovantes, onboarding e contratos com a clínica; conferidos na homologação. |

**Consequências para o plano:**
1. **Ação do cliente:** pedir a avaliação BaaS ao Asaas e apresentar a arquitetura (seções 5 e 8). Sem isso, nada vai
   para a produção (N2 em diante só no Sandbox).
2. **Custo novo:** R$ 12,90 por clínica habilitada, na conta principal. **Decidido (cliente, 29/out):** o RecepClinic
   absorve; não aparece na fatura da clínica (pode ser considerado no preço da implantação).
3. **Excedentes:** **decidido (cliente, 29/out):** cobrança avulsa separada, mesmo vencimento; a da assinatura não
   muda (seção 3).
4. **Chaves:** guardar a chave da criação no Vault (já previsto). Clínica 6 meses sem nota perde a chave; recriar
   exige IP fixo (decisão 11.15: "não por agora"). **Decidido (cliente, 29/out):** mantém a 11.15; pedir alternativa
   ao time de Produto do Asaas pelo [formulário](https://forms.gle/UzvzStNa9Fdhr1X68) (indicado em "Whitelist de IPs" da documentação), junto com a avaliação BaaS. Até a resposta, o Suporte acompanha as
   clínicas sem nota há muito tempo.
   **Enviado (cliente, 29/out):** formulário de IP; resposta ao suporte pedindo a avaliação BaaS e reperguntando
   saldo negativo e e-mail da nota ao tomador. Conta principal de produção aberta (sem subconta e sem chave de API).
5. **Marca do Asaas** nas telas de habilitação fiscal e no contrato com a clínica: entra na N2 e nos termos.
6. **Reperguntar ao Asaas:** saldo negativo da subconta (a nota continua saindo? como a principal cobre?).
7. ~~**Teste na N3 (staging):** tomador com `notificationDisabled: true` e e-mail nosso; conferir se chega e-mail da
   nota.~~ Respondido pelo Asaas (13.8): o e-mail sempre chega.

### 13.8 Segunda resposta do Asaas e playbook do BaaS (30/out/2026)

**Saldo negativo da subconta [Asaas]:** a nota continua saindo, com travas: até **10 notas avulsas** (sem cobrança do
Asaas, que é o nosso caso) ou 150 ligadas a cobranças do Asaas; acima de **−R$ 20,00** acumulados, novas emissões
são bloqueadas e a subconta entra em recuperação de saldo devedor. A tarifa é debitada da subconta (prestadora da
nota perante o fisco); **não há débito automático na principal**. Recomendado: a principal transfere para a subconta
de forma preventiva ou periódica (`POST /v3/transfers` com o `walletId` da subconta; na hora e sem tarifa).
- **Consequência:** a reposição do saldo da subconta é obrigatória e entra na N2/N3 (rotina e conferência antes de
  emitir). A conta principal precisa de saldo para isso (depósito do RecepClinic). **Decidido (cliente, 30/out):
  reposição automática:** antes de emitir, o sistema confere o saldo da subconta e, se estiver abaixo do alvo
  (ex.: R$ 10, cerca de 20 notas), transfere da principal até o alvo; uma rotina diária faz o mesmo. O Suporte
  acompanha o saldo da conta principal.

**E-mail da nota ao tomador [Asaas]:** `notificationDisabled` só desliga a régua de cobrança. **Toda nota autorizada
é enviada pelo Asaas ao e-mail do tomador**, sem opção de desligar (a prefeitura ou o Portal Nacional também podem
enviar). Alternativa indicada: cadastrar no tomador um e-mail controlado pela plataforma.
- **Consequência:** o teste do item 7 da 13.7 deixa de ser necessário. Escolher entre o e-mail real de quem pagou
  (o paciente recebe o e-mail do Asaas) e um e-mail da plataforma (a nota sai com esse e-mail; efeito fiscal a
  confirmar com o contador). **Decidido (cliente, 30/out): e-mail real de quem pagou.** O e-mail da nota fica com o
  Asaas; a saída de entregas do RecepClinic (N4) envia **só pelo WhatsApp** (`rc_nota_fiscal_v1`), sem e-mail
  próprio, para não duplicar. `notificationDisabled: true` continua no tomador (desliga a régua de cobrança).

**Avaliação BaaS [Asaas]:** enviaram o **playbook** (`docs/Playbook de BaaS para clientes Asaas.pdf`), o **checklist
de informações** para habilitar subcontas (não está no repositório) e os **selos** do RecepClinic:
- Positivo: `https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-Positivo.svg?id=77d97322-c59c-4983-bbb1-e0dbe253d4c3`
- Negativo preto: `https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-Negativo-Preto.svg?id=77d97322-c59c-4983-bbb1-e0dbe253d4c3`
- Negativo branco: `https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-Negativo-Branco.svg?id=77d97322-c59c-4983-bbb1-e0dbe253d4c3`

Passos pedidos: ler o playbook, **incluir o selo no código**, depois preencher o
[formulário](https://docs.google.com/forms/d/e/1FAIpQLSc6wr8qBnncEo68bAW1SwIE589v2JemGyzZQhJA71v075QdzQ/viewform) e
informar ao Asaas o e-mail usado. Depois: análise em até 3 dias úteis, contrato BaaS, checklist de Segurança da
Informação e liberação das subcontas pela API.

**Regras do playbook que afetam o RecepClinic [Asaas]** (Resolução Conjunta nº 16/2025 do Banco Central):
1. O selo vai em toda tela de produto que envolva o serviço do Asaas (no nosso caso, a **habilitação fiscal da
   clínica**, que cria a subconta), com link para `https://asaas.com` (`target="_blank" rel="noopener noreferrer"`) e
   **sem** política `no-referrer` na imagem (o Asaas confere o carregamento do selo pelo Referer). **[Código]**
   `src/lib/securityHeaders.ts` usa `strict-origin-when-cross-origin` (envia a origem): compatível.
2. Contrato e termos com a clínica: cláusula-modelo do Asaas ("os serviços financeiros e de pagamentos [...] são
   prestados pelo ASAAS GESTÃO FINANCEIRA INSTITUIÇÃO DE PAGAMENTOS S.A. [...]"); vai para o advogado.
3. Canais de suporte do Asaas visíveis ao cliente final (0800 009 0037; contato@asaas.com.br).
4. Vedado: nome que sugira instituição financeira (Bank, Pay, Wallet...), usar outro provedor BaaS, cobrar tarifa
   financeira como se fosse o prestador. **O preço por nota da fatura** (D13) é cobrança da plataforma: deixar claro
   na fatura e no contrato que a nota é emitida pelo Asaas (conferir na avaliação).
5. Não alterar nem criar documentos legais sobre o processamento financeiro.

**Selos no repositório:** cópias em `docs/selos_Asaas/` só como referência. **No código, usar as URLs acima** (o
Asaas confere o carregamento do selo pela URL com o `id`); nunca servir a cópia local.

### 13.9 Formulário "Asaas | Checklist BAAS" (rascunho das respostas, 30/out/2026)

O checklist é o próprio formulário do Google. **Exige print da tela de criação da subconta com o selo** (e as URLs
onde o selo aparece): a tela precisa existir antes do envio. **Decidido (cliente, 30/out): antecipar a parte visual da
habilitação fiscal** (Configurações › Nota fiscal) na branch `faturamento` recriada da `main`, no staging: selo com
link, texto de que a nota é emitida pelo Asaas, canais de suporte do Asaas e botão desativado ("aguardando
liberação"), sem chamar o Asaas. O cliente tira o print e envia o formulário; a N2 completa a tela. **Feito (30/out,
`src/lib/asaas/brand.ts`):** o cartão só aparece com a variável **`ASAAS_PREVIEW=1`** (só na Vercel do staging;
a produção não tem a variável e não mostra nada, a pedido do cliente). **Validado pelo cliente no staging (30/out)**
(a tela exige o Módulo financeiro na Matriz da clínica).
**Formulário enviado pelo cliente (30/out)** com o e-mail `tluiz22projetos@gmail.com`; 13 e 14 sem estimativa
(produto em fase inicial; até 10 subcontas no 1º ano como referência). Aguardando a análise do Asaas (até 3 dias
úteis), depois contrato BaaS e checklist de Segurança da Informação. Respostas propostas (**[Cliente]** = o cliente informa):

| # | Pergunta (resumo) | Resposta proposta |
|---|---|---|
| — | E-mail; empresa/CNPJ | **[Cliente]** (informar ao Asaas o e-mail usado) |
| 01 | Nome com Bank, Pay, Financeira... | Não |
| 02 | Asaas é o prestador do serviço financeiro; a empresa é só plataforma | Sim (evidências na 06: selo na tela e cláusula no contrato) |
| 03 | Fica claro ao cliente final que o serviço é do Asaas | Sim (selo na habilitação fiscal; cláusula nos termos) |
| 04 | Clientes revendem os serviços do Asaas | Não |
| 05 | Estrutura | (a) Direta Tomador: o RecepClinic usa a chave da subconta em nome da clínica |
| 06 | Marca Asaas visível | Sim; URL e print da tela de habilitação fiscal (Configurações › Nota fiscal) |
| 07 | Só o Asaas como provedor BaaS | Sim |
| 08 | Cobra tarifa financeira (Pix, boleto...) em nome próprio | Não (o preço por nota da fatura é do software; explicar nos comentários) |
| 09 | Apresenta-se como instituição financeira | Não |
| 10 | Modelo de negócio | SaaS de recepção para clínicas (WhatsApp, agenda, financeiro). O Asaas é usado **só para a emissão de NFS-e**: uma subconta BaaS por clínica (prestadora da nota), criada pela API; o RecepClinic emite, cancela e consulta as notas pela chave da subconta e transfere da conta principal o saldo das tarifas. Sem cobrança, Pix ou boleto aos pacientes. |
| 11 | Links públicos | **[Cliente]** site (`recepclinic.com.br`?) e redes |
| 12 | Canais | Painel web `app.recepclinic.com.br` (área logada da clínica) |
| 13 | Volume de subcontas | **[Cliente]** estimativa (ex.: 1 no piloto; N em 12 meses) |
| 14 | Volume financeiro mensal | Só as transferências de tarifa (R$ 0,49 por nota): **[Cliente]** estimativa (ex.: < R$ 500) |
| 15 | Funcionários | **[Cliente]** |
| 16 | Faturamento do último ano | **[Cliente]** |
| 17 | Avalia o atendimento | **[Cliente]** |
| 18 | Modelo de subconta | Subcontas BaaS (documentos pela URL dedicada, sem painel do Asaas) |
| — | Comentários | Uso restrito à NFS-e; preço por nota cobrado pela plataforma como parte do software; sem IP fixo (formulário de IP enviado em 29/out). |

## Fontes (consultadas em 29/out/2026)

- Asaas: [Notas fiscais](https://docs.asaas.com/docs/notas-fiscais), [FAQ](https://docs.asaas.com/docs/faq-de-notas-fiscais),
  [Configurar informações fiscais](https://docs.asaas.com/docs/configurar-informacoes-fiscais),
  [Agendar nota fiscal](https://docs.asaas.com/reference/agendar-nota-fiscal.md),
  [Webhook de notas](https://docs.asaas.com/docs/webhook-para-notas-fiscais),
  [Sobre os webhooks](https://docs.asaas.com/docs/sobre-os-webhooks), [Tipos de envio](https://docs.asaas.com/docs/tipos-de-envio),
  [Criação de subcontas](https://docs.asaas.com/docs/criacao-de-subcontas),
  [Aprovação de subcontas](https://docs.asaas.com/docs/detalhamento-do-fluxo-de-aprova%C3%A7%C3%A3o-de-subcontas),
  [Preços e taxas](https://www.asaas.com/precos-e-taxas),
  [Portal Nacional (blog, 23/out/2026)](https://blog.asaas.com/emissao-de-nota-fiscal-pelo-portal-nacional/),
  [Mudanças na NFS-e em 2026](https://blog.asaas.com/release/mudancas-na-nfs-e-no-asaas/),
  [Listar notas fiscais](https://docs.asaas.com/reference/listar-notas-fiscais.md),
  [Criar cliente](https://docs.asaas.com/reference/criar-novo-cliente.md), [Listar clientes](https://docs.asaas.com/reference/listar-clientes.md),
  [Atualizar cobrança](https://docs.asaas.com/reference/atualizar-cobranca-existente.md),
  [Chaves de API de subcontas](https://docs.asaas.com/docs/gerenciamento-de-chaves-de-api-de-subcontas),
  [FAQ do período de avaliação](https://docs.asaas.com/docs/faq-periodo-de-avaliacao), [BaaS](https://docs.asaas.com/docs/sobre-baas),
  [Taxa por subconta (Escrow)](https://docs.asaas.com/docs/cobran%C3%A7a-da-taxa-por-subconta-configurada).
- [Prefeitura de Mossoró: Decreto 7.497/2026](https://prefeiturademossoro.com.br/noticias/decreto-regulamenta-instituicao-da-nota-fiscal-de-servicos-eletronica-de-padrao-nacional-em-mossoro/15551);
  [Resolução CGSN 189/2026](https://www.legisweb.com.br/legislacao/?id=494855).
