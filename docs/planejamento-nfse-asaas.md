# Emissão de NFS-e pelo Asaas (substitui o emissor direto da F11)

> **Estado atual (retomar daqui), 29/out/2026.** **Planejamento concluído** (cliente, 29/out). Nada implementado.
> A implementação será feita na branch **`faturamento`**, só com a autorização do cliente, na ordem da seção 12.
> **Próximo passo:** a fase **N0** (perguntas ao Asaas e ao contador, testes na conta Sandbox), sem código.

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
  com quantidade, preço unitário e total; a mensalidade do mês seguinte leva o item das excedentes.
- **Asaas (cobrança automática, F12.4+):** somar o item ao valor da cobrança do mês antes do vencimento.
  **[Pendência]** confirmar a forma com a assinatura (alterar o valor da cobrança pendente gerada pela assinatura ou
  cobrança avulsa no mesmo vencimento). **Modo manual:** o Suporte vê o mesmo detalhamento e registra o pagamento.
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
6. Como somar as excedentes à cobrança do mês gerada pela assinatura.
7. `municipalOptions` da clínica piloto (autenticação, cancelamento, regime).

**Com o contador:** regime da clínica piloto, CNAE, código de serviço, NBS, número inicial da série, data do Simples
no Emissor Nacional. **Com o advogado:** termos e prazo de guarda (seção 8). **Operação:** conferir que a produção não
tem dados fiscais antes da N5.

## 12. Fases (na branch `faturamento`, cada uma com a autorização e a validação do cliente)

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
| F12.3+ | Restante do faturamento; na F12.4+, as excedentes entram na cobrança automática | planejamento do faturamento |

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
  [Mudanças na NFS-e em 2026](https://blog.asaas.com/release/mudancas-na-nfs-e-no-asaas/).
- [Prefeitura de Mossoró: Decreto 7.497/2026](https://prefeiturademossoro.com.br/noticias/decreto-regulamenta-instituicao-da-nota-fiscal-de-servicos-eletronica-de-padrao-nacional-em-mossoro/15551);
  [Resolução CGSN 189/2026](https://www.legisweb.com.br/legislacao/?id=494855).
