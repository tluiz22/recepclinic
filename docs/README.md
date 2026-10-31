# RecepClinic

> **Estado atual (retomar daqui), 30/out/2026.** Histórico completo em [`historico.md`](historico.md) (não ler
> na retomada; buscar por data, fase ou commit quando precisar).
>
> **Produção = `main` em 30/out (`71cbbec`):** DMED removida (migração aplicada), cartão do Asaas escondido, Vendas ›
> Implantação e Tecnologia › Jornada do bot.
>
> **Próxima sessão (cliente, 30/out): menu lateral, na `main`** ([`menu-lateral.md`](menu-lateral.md); ler o bloco de
> retomada dele): L1–L3 no staging, aguarda a validação do cliente; depois, a produção. Em seguida,
> revisão da jornada do bot ([`jornada-do-bot.md`](jornada-do-bot.md), temporário). O faturamento fica parado na branch
> `faturamento` (abaixo).
>
> **N0 do Asaas (30/out):** NFS-e pelo Asaas, N0 (seções 13.8 e 13.9 do `planejamento-nfse-asaas.md`; ler o bloco de
> retomada dele). Cartão do selo do Asaas na `main` (`13ebeab`), visível só com `ASAAS_PREVIEW=1` (staging).
> Validado no staging e **formulário BaaS enviado (30/out)**. Aguardando a análise do Asaas (até 3 dias úteis) e o
> contador (falta PIS/COFINS; e-CNPJ A1 a providenciar; seção 13.5). **DMED removida** (cliente, 30/out; staging e `main`,
> `73d703b`; a produção não usa o Financeiro).
> **Regra (cliente, 30/out):** todo código do financeiro vai na branch `faturamento`.
>
> **Ambientes**
> - **Produção** (`app.recepclinic.com.br`, branch `producao`): no ar desde 26/out; publicações de 28/out: **CRM**
>   (Relacionamento, B0, P1–P3) e as correções **C1 Exame em paralelo**, **C2 Outro horário**, **C3 Horário de exame**,
>   **C4 Alterar atendimento**, **C5 Horário em local que o serviço não usa** e **C6 Escolha do serviço no Marcar**; em 29/out, **C7 Arquivo no preparo do
>   exame** (C7.1–C7.7) e **C8 Escolha do serviço em Horários** (`5ef2be6`); em 30/out, DMED removida, Implantação e Jornada do bot (`71cbbec`). Fluxo e registro em [`producao.md`](producao.md).
> - **Staging** (`teste.recepclinic.com.br`, branch `main`): igual à produção; o cartão do Asaas só aparece aqui
>   (`ASAAS_PREVIEW=1`). Roteiros em [`staging.md`](staging.md).
> - **Branches:** `main` = `producao` em 30/out; `CRM` e `faturamento` excluídas em 30/out (tudo delas na `main`).
>
> **Frentes em andamento**
> - **Ajustes da produção, na `main`:** C1–C13 validados e na produção (C1–C6 em 28/out; C7–C8 em 29/out; C9–C10 em
>   30/out, `a7e077a`, com a limpeza das conversas gravadas pelo piloto em implantação; C11–C13b em 30/out, `b9dc41a`; C14 "Alterar" no "Mais" do cartão, no staging em 31/out; C15 Retomar contato sem alerta e "Retirar da lista", com
>   migração, commit local aguardando a migração no staging).
>   Detalhes no [`historico.md`](historico.md) (busca "C9" a "C13"). Clínica com exames: "Criar na Meta" (Suporte) para
>   `rc_preparo_exame_v3` e `rc_preparo_arquivo_v3`. Próximo: nada pendente nesta frente; aguarda o cliente.
> - **CRM concluído** (28/out; [`crm.md`](crm.md)): validado no staging e na produção desde 28/out.
> - **Faturamento do SaaS** (código na branch **`faturamento`, só local, sem push** a pedido do cliente; retomar pelo
>   bloco de retomada do `planejamento-faturamento-saas.md` **na branch**): **F12.1** (conta de cobrança) e **F12.2**
>   (contrato com versões) feitas e **validadas no local (30/out)**. Ordem decidida: cobrança antes da nota fiscal, só
>   com e-mail, até cobrar a clínica piloto em produção. Parecer do advogado recebido e decisões registradas (itens 18 a
>   27 da seção 11 do plano, na branch). **Próximo: F12.2b** (aceite do contrato na tela e aviso de 30 dias); pedir ao
>   advogado o texto completo do contrato.
> - **NFS-e pelo Asaas** (`planejamento-nfse-asaas.md`; volta depois da cobrança no ar). **N0 em andamento (29/out):** Sandbox testado em Mossoró; Asaas respondeu (exige BaaS; avaliação
>   pedida); aguardando Asaas (BaaS, saldo negativo, IP) e contador (CNAE, IBS/CBS, PIS/COFINS, **certificado A1**,
>   exigido em Mossoró). Retomar pela seção 13 do plano; depois a F12.1. Cada etapa com o OK do cliente.
> - **Piloto** (etapas no [plano](plano.md), F10): **A** feita (roteiros do WhatsApp Business: [único](https://claude.ai/artifact/8AXZMSLcEq8SMWFpYHaraq),
>   [iPhone](https://claude.ai/artifact/C8E3xDoshuXE3M91qeDDHq), [Android](https://claude.ai/artifact/78hQ2cXQph4wvXHKPXexnm));
>   coexistência no staging feita (parte P do [`staging.md`](staging.md)), falta o **lembrete com botões** quando a
>   Meta aprovar os 18 templates da conta nova; depois **B** (clínica de testes permanente na produção, 2º número do
>   cliente; valida F8.1, F8.2b e F8.3) e **C** (piloto com a Dra. Ana Karina). **Revisto em 29/out: piloto direto**
>   (B depois); roteiro no plano (F10, item 7). **Clínica piloto criada e WhatsApp conectado na produção
>   (29/out, cliente).** Conferido pelo Claude: conexão por coexistência, as duas sincronizações,
>   forma de pagamento conferida, 14 templates (catálogo completo) em análise na Meta, eco da recepção chegando.
>   Próximo: templates aprovados; configuração; ativação em Sistema › Clínicas › clínica › Situação; testes do bot.
> - **Meta:** Análise do App e Verificação do acesso aprovadas; o RecepClinic é Tech Provider (24/out).
>
> **Pendências**
> - **Validação do cliente no staging (no fim, como pedido):** F8.1, F8.2, F8.2b, F8.3 e a ajuda contextual.
> - **F11 (financeiro):** testes do roteiro a partir do T3.1; fora do sistema, teste real na Produção Restrita
>   (e-CNPJ A1), template `rc_nota_fiscal_v1` na Meta e termo com o advogado; melhorias
>   no processo da nota numa sessão própria (o cliente traz a lista).
> - **Operação:** conferir o 1º backup diário da produção (*Database › Backups* do `recepclinic-producao`); investigar
>   a sessão do painel que caiu durante a janela da Meta (parte P do [`staging.md`](staging.md)).
> - **Do cliente:** advogado (páginas legais e [política de pedidos de autoridades](politica-pedidos-de-autoridades.md)),
>   contrato com as clínicas e termo de tratamento de dados; número do app antigo da Meta como 2ª clínica de testes do
>   staging (quando o aparelho estiver com ele).
>
> **Como trabalhar** (detalhes em [`staging.md`](staging.md) e [`producao.md`](producao.md))
> - **Migrações:** staging com `supabase db push` na ordem simulação → aplicar → conferir no banco → push do código;
>   produção só com autorização explícita, pelo fluxo de `producao.md` (`git push origin main:producao`).
> - **Local:** OrbStack, `npm run db:start`, `npm run dev`; testes `npm test` e `npm run test:db` (o shell precisa de
>   `/opt/homebrew/bin` no PATH). Variável nova na Vercel só vale depois de um Redeploy.
> - **WhatsApp de testes:** `+55 61 9903-3143`, na "Consultorio de Teste" do staging, em coexistência.
> - **Frentes paralelas:** site em [`site-plano.md`](site-plano.md) (pasta `recepclinic-site`, nunca aqui);
>   comercial no Suporte › Vendas; triagem do piloto em [`triagem-piloto.md`](triagem-piloto.md).

> **RecepClinic — a recepção inteligente da sua clínica.**

Plataforma SaaS para automatizar a recepção de clínicas: atendimento inicial pelo WhatsApp,
identificação da necessidade do paciente, agendamento, confirmação, cancelamento, remarcação,
lembretes, recuperação de pacientes, follow-ups e organização da agenda. Não é só um chatbot: é
uma recepção automatizada.

## Origem

Este repositório nasceu de uma cópia do sistema de gestão do consultório da Dra. Ana Karina
(repositório `tluiz22/site-dra-ana-karina`, branch `feature/gestao-consultorio`), no commit
`aad94dd`, marcado aqui com a tag **`piloto-base`**. O histórico anterior foi mantido para permitir
comparar as duas linhas.

## Duas linhas em paralelo

| | Projeto atual (piloto) | RecepClinic |
|---|---|---|
| Repositório | `tluiz22/site-dra-ana-karina` | `tluiz22/recepclinic` (este) |
| Papel | estabilidade, testes finais, possível produção e primeiro piloto | evolução para SaaS multi-clínica, nova arquitetura, possível piloto |
| Clínicas | uma (Dra. Ana Karina) | várias, com dados isolados |

Qualquer uma das duas pode virar o primeiro piloto. Nenhum dos dois cenários está descartado.

## Regras

1. **Sem merge cego.** O piloto é o remoto `piloto`, só leitura (`push` desativado). Nenhuma
   mudança dele entra aqui por merge ou cherry-pick automático. Cada uma é avaliada e registrada em
   [`triagem-piloto.md`](triagem-piloto.md).
2. **Classificação** de cada mudança do piloto:
   - **A — correção específica:** fica só no piloto.
   - **B — regra de negócio geral:** avaliar e implementar aqui do jeito da nova arquitetura.
   - **C — funcionalidade descoberta no piloto:** avaliar antes de incorporar.
   - **D — mudança arquitetural:** não copiar; analisar a necessidade aqui.
3. **Entender antes de mudar.** A sequência é: diagnóstico → limites e problemas → arquitetura alvo →
   plano de evolução → implementação aos poucos, com validação a cada etapa. Nenhuma mudança
   arquitetural grande antes de apresentar a análise e a estratégia.
4. **Sem generalizar antes da hora.** Nada de billing completo, planos complexos, marketplace ou
   dezenas de configurações antes de validar com uso real.
5. **Isolamento por clínica** em todos os níveis: banco, RLS, backend, APIs, autenticação,
   autorização, jobs, webhooks e integrações.
6. **O site da médica é externo.** O site institucional sai do produto e passa a ser um cliente dele.
7. **O piloto vem primeiro.** Nunca arriscar o piloto para acelerar o RecepClinic, nem limitar o
   RecepClinic só para preservar decisões do piloto.

## Infraestrutura

Banco (Supabase), Vercel e app da Meta próprios: staging em [`staging.md`](staging.md) e produção em
[`producao.md`](producao.md). Os segredos ficam fora do git (`.env` local e `.env.staging`); nunca usar as
credenciais do piloto (banco, agendador e Vault do Supabase, número e app da Meta, segredos).

## Documentos

- [`historico.md`](historico.md): andamento completo, sessão a sessão (arquivo; só por busca).
- [`crm.md`](crm.md): etapa paralela do CRM (ponto de retomada); plano ativo em
  [`analises/plano-evolucao-relacionamento.md`](analises/plano-evolucao-relacionamento.md) e o que já foi feito em
  [`analises/crm-arquivo.md`](analises/crm-arquivo.md).
- [`planejamento-faturamento-saas.md`](planejamento-faturamento-saas.md): faturamento do SaaS pelo Asaas (planejamento,
  decisões pendentes e roadmap F12).
- [`producao.md`](producao.md): produção (`app.`), fluxo de publicação e registro.
- [`triagem-piloto.md`](triagem-piloto.md): registro das mudanças do piloto depois da cópia.
- [`diagnostico.md`](diagnostico.md): diagnóstico da arquitetura atual (etapa 1).
- [`limites.md`](limites.md): limites e problemas para várias clínicas (etapa 2).
- [`arquitetura.md`](arquitetura.md): decisões da arquitetura alvo (etapa 3).
- [`plano.md`](plano.md): plano de evolução em fases (etapa 4).
- [`site-plano.md`](site-plano.md): plano do site `www.recepclinic.com.br` (frente paralela).
- [`staging.md`](staging.md): roteiro do staging na nuvem (F5.5).
- [`meta-tech-provider.md`](meta-tech-provider.md): Análise do App e Tech Provider na Meta (textos e respostas).
- [`politica-pedidos-de-autoridades.md`](politica-pedidos-de-autoridades.md): pedidos de autoridades
  sobre dados (adotada na verificação da Meta; a revisar pelo advogado).
