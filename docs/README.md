# RecepClinic

> **Estado atual (retomar daqui), 04/nov/2026.** Detalhes e datas no [`historico.md`](historico.md) (só por busca).
>
> **Próxima sessão (cliente, 04/nov):** melhorias na `main` para implantar na produção (cliente traz os pedidos).
> Trabalhar na worktree `recepclinic-main` (a pasta `recepclinic` está na branch `faturamento`). Pendente da branch: o
> cliente valida no local o faturamento **F12.2b a F12.2h** pelo `roteiro-validacao-faturamento.md` **da branch**.
>
> **Próximo (cliente, 01/nov):** validado no staging: Base de Conhecimento, "Como funciona?" de Configurações e Central de
> Ajuda. No staging para validar: **25 capturas reais de tela** nos artigos da Central (`public/ajuda/`, refazer quando a
> tela mudar). Falta informar o WhatsApp do suporte (Sistema › Suporte), se ainda não foi. Detalhes em
> [`ajuda-contextual.md`](ajuda-contextual.md), fim. Cliente vai pedir novos ajustes.
>
> **Em produção (cliente, 04/nov):** a `main` inteira até a C21: PN1–PN2, IS1–IS5, C17–C20 e C21 (6 migrações,
> `20261201120000` a `20261206120000`), sobre o `1ceb6a4`. Cliente valida no uso. Detalhe no [`producao.md`](producao.md) (Publicações).
>
> **Ambientes**
> - **Produção** (`app.recepclinic.com.br`, branch `producao`) = `main` em 04/nov (até a C21). Fluxo em [`producao.md`](producao.md).
> - **Staging** (`teste.recepclinic.com.br`, branch `main`): produção + redesign da Recepção (RX1 a RX9, sem migração) +
>   cartão do Asaas (`ASAAS_PREVIEW=1`) + Base de Conhecimento do bot (migração aplicada) + PN1, PN2, IS2 a IS5 (migrações aplicadas) + IS1 + C17 a C20 (03/nov; migração `20261206120000` aplicada) + C21 (04/nov).
>   Roteiros em [`staging.md`](staging.md).
> - **Branch `faturamento`** (só local, sem push): todo código do financeiro, até a F12.2h; com a `main` até `e7c4f1d`
>   (a produção com a C21, 04/nov; merge `47b93ce`, 982 testes de unidade e 909 de banco passando; migração nova `20261207120000`).
>   Na publicação, as migrações da branch são anteriores às da produção: `db push --include-all`. Atualizar só quando o cliente pedir.
>
> **Frentes**
> - **Ajustes da produção (C1–C16) e revisão da jornada do bot:** todos na produção. Decisões da
>   revisão no [`historico.md`](historico.md) (busca "Revisão da jornada do bot").
>   **2ª leva (03/nov; `historico.md`, "2ª leva"):** C17 Marcar com um só serviço, C18 busca por nome parecido, C19
>   cadastro com nomes parecidos e conferência (migração `20261206120000` nas duas) e C20 volta ao bot 12 h depois da
>   resposta da clínica (desfaz a C10). **No staging e na produção (03/nov)**; cliente valida (roteiro em `staging.md`, parte "2ª leva").
>   **C21 (04/nov):** dúvida respondida fora de um fluxo mostra o menu (ou o submenu) de novo, sem "Isso resolve sua
>   dúvida?"; menu com "Escolha uma opção abaixo ou faça uma pergunta."; nas Métricas, resolvida sem recepção em 30 min.
>   **No staging e na produção (04/nov, sem migração)**; cliente valida (`staging.md`, parte S, item 7).
> - **Evolução do assistente** ([`evolucao-assistente.md`](evolucao-assistente.md)): texto livre na entrada, motivo antes
>   da recepção e taxa de resolução sem a recepção. **Na produção (02/nov, `c9418ac`)**, migração aplicada no staging
>   e na produção. Próximo: acompanhar a taxa e as perguntas não reconhecidas da BC.
> - **Faturamento do SaaS:** F12.1 e F12.2 validadas; **F12.2b a F12.8 e F12.2c a F12.2h feitas na branch, cliente valida
>   no fim**. 03/nov: contrato com nota fiscal só com o Módulo financeiro (e nota só com contrato assinado), texto
>   aprovado (renovação automática, IPCA, arrependimento, cancelamento), Assinatura em passo a passo, cancelamento e
>   troca de cartão pelo Administrador, lembrete do IPCA. Revisar: textos dos e-mails. Fora do código: token e webhook do
>   Asaas, tokenização em produção, advogado. Depois: F12.11. Retomar pelo `planejamento-faturamento-saas.md` **na branch**.
> - **Implantação segura do WhatsApp** ([`implantacao-segura.md`](implantacao-segura.md)), após os incidentes de 03/nov
>   na clínica piloto (erro 131042 de pagamento na Meta; mensagem automática do app pausando o bot): guias públicos
>   para o dono da clínica, mensagem de teste exigida para ativar, checklist de implantação, aviso de mensagem
>   automática e Sistema › Problemas conhecidos. **IS1 no staging (03/nov, sem migração)**: guias públicos
>   `/guia/antes-de-conectar` e `/guia/pagamento-meta` e envio ao Administrador. **IS2 no staging (03/nov,
>   migração `20261203120000`)**: mensagem de teste com o motivo da falha; ativação só com teste entregue. Cliente
>   valida; nas clínicas existentes, "Enviar à Meta as que faltam" antes do teste. **IS3 a IS5 (03/nov)**: checklist
>   de implantação (migração `20261204120000`), mensagem automática do app sem pausar o bot e Sistema › Problemas
>   conhecidos (migração `20261205120000`). Na produção em 03/nov (cliente pediu, sem validar antes no staging).
> - **Pedido não concluído** ([`pedido-nao-concluido.md`](pedido-nao-concluido.md)), após o caso de 03/nov (tocou em
>   Remarcar no lembrete e não concluiu): mensagem padrão com Novo link / Falar com a recepção / Desistir quando o link
>   vence ou o cancelamento fica sem resposta; lembrete só muda com a ação concluída; grupo "Não concluiu".
>   **PN1 e PN2 no staging (03/nov; migrações `20261201120000` e `20261202120000` aplicadas)**: grupo "Não concluíram"
>   no Relatório do dia e nas Métricas; mensagem "Não concluímos…" quando o link vence ou o cancelamento fica sem
>   resposta. Na produção em 03/nov (cliente pediu, sem validar antes no staging).
> - **NFS-e pelo Asaas** (`planejamento-nfse-asaas.md`, seção 13): N0; formulário BaaS enviado (30/out). Aguarda
>   Asaas e contador (PIS/COFINS, e-CNPJ A1).
> - **Piloto (F10, [plano](plano.md)):** clínica piloto criada na produção, WhatsApp conectado, templates em análise
>   na Meta. Próximo: templates aprovados → configuração → ativação → testes do bot. Depois: lembrete com botões no
>   staging e etapa B.
> - **Redesign da Recepção (UX)** ([`redesign-recepcao.md`](redesign-recepcao.md)): RX1 a RX9 e os ajustes da validação
>   (Meu dia, Agenda opção B, Pacientes/ficha A, Relatório do dia opção C) **na `main` e no staging (02/nov)**, sem
>   produção. **Central de Ajuda atualizada com o redesign (02/nov):** artigos e as 25 capturas refeitas, no staging após o push; falta o cliente validar. Avisos técnicos só do Suporte; tela
>   de pendências do Suporte pendente em [`painel-suporte.md`](painel-suporte.md).
>
> **Clínicas de demonstração (02/nov):** as 4 demos do staging recarregadas com todos os cenários de 5 semanas, sem o
> Financeiro; Consultório da Dra. Ana Karina excluído do staging. Logins e senhas em Sistema › Vendas › Demonstração.
> Cliente valida. **Antes de cada apresentação:**
> `node --env-file=.env.staging scripts/demo-clinicas.mjs --confirmar` (plano, item 9b).
>
> **Pendências**
> - **Cliente valida no staging (no fim):** F8.1, F8.2, F8.2b, F8.3, ajuda contextual e menu lateral.
> - **F11:** roteiro a partir do T3.1; Produção Restrita (A1), template `rc_nota_fiscal_v1`, termo com o advogado.
> - **Operação:** 1º backup diário da produção; sessão do painel que caiu (parte P do `staging.md`).
> - **Clínica piloto (03/nov):** conferir os lembretes de hoje (1º lote depois do cartão na Meta); verificação da
>   empresa na Meta não iniciada.
> - **Do cliente:** advogado (páginas legais, [pedidos de autoridades](politica-pedidos-de-autoridades.md), contrato,
>   termo de dados); número do app antigo como 2ª clínica de testes do staging.
>
> **Como trabalhar**
> - **Migrações:** staging com `supabase db push` (simular → aplicar → conferir → push do código); produção só com
>   autorização, pelo `producao.md` (`git push origin main:producao`).
> - **Local:** OrbStack, `npm run db:start`, `npm run dev`; `npm test`, `npm run test:db` (PATH com `/opt/homebrew/bin`).
> - **WhatsApp de testes:** `+55 61 9903-3143` ("Consultorio de Teste", staging).
> - **Outras:** site em [`site-plano.md`](site-plano.md) (pasta `recepclinic-site`); triagem em
>   [`triagem-piloto.md`](triagem-piloto.md).

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
