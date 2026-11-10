# RecepClinic

> **Comercial (09/nov): proposta para a Biomedical** (12 profissionais, 3 secretárias) pronta para envio:
> [`propostas/clinica-12-profissionais/`](propostas/clinica-12-profissionais/README.md) (3 PDFs, texto do e-mail,
> decisões P1 a P8). A proposta apresenta como prontos o portal, a agenda em colunas, o bot levando ao portal e as
> métricas: precisam estar no ar antes da implantação.
>
> **Frente ativa (08/nov): recepção digital integrada.** Retomar pelo bloco do
> [`proposta-recepcao-digital-integrada.md`](proposta-recepcao-digital-integrada.md).
> - **Feito:** Etapa 1 (proposta, RD1 a RD14) e Etapa 2 (design: portal P1 a P13, link do profissional, painel da
>   recepção R1 a R7), aprovadas; especificação em `especificacao-telas-portal-e-recepcao.md`. Nenhum código mudou.
> - **Fora desta entrega:** vários números de WhatsApp (F4, RD11), pendente.
> - **Etapa 3 (implementação):** plano em [`implementacao-recepcao-digital.md`](implementacao-recepcao-digital.md)
>   (seção 4.1: endereços e Turnstile). **F1 no staging, validada (08/nov)**; produção: não. **D4 aprovada.**
>   **F2a a F2d (portal: escolher, código, marcar, retorno e exames) na `main` e no staging (09/nov)**; migrações
>   `20270103120000` a `20270106120000` aplicadas no staging; produção: não. **Validação conjunta do cliente** pelos
>   roteiros 9.1 a 13.1 do plano (começa por preencher o apelido da clínica no Suporte; o modelo do código já está
>   aprovado na conta do RecepClinic).
>   **Validação parada no código (09/nov):** a Meta só cria o template do código em empresa verificada; decisão do
>   cliente: o código sai de um **número do RecepClinic** (+55 61 9656-4772, template já aprovado). Seção 14 do plano.
>   **Código pelo número do RecepClinic, aviso na tela do código e guia "Pagamento na Meta" na `main` e no staging
>   (09/nov, seção 14; a API já estava na v24.0)**. **F2 validada inteira (09/nov)**, com a correção do
>   "Adicionar à agenda" no iPhone (`802d700`). Produção: não.
>   **F3a a F3d (bot leva ao portal, Minhas consultas, Configurações › Portal) na `main` e no staging (10/nov, `207cf87`;
>   migração `20270107120000`)**; decisões F3-1 a F3-4 na seção 15.1. **Próximo: validação do cliente** pelo roteiro
>   15.3.1 (clínica `clinica-teste`). Depois: D5 + F3e (domiciliar e turma, desenho antes) e as capturas na fila.
>
> Frente da nota fiscal encerrada em 08/nov com a validação pendente (abaixo).
>
> **Duas frentes (cliente, 07/nov):**
> - **Validação do que está pendente:** [`frente-validacao.md`](frente-validacao.md) (multiprofissional ME, MC, MI, MB
>   e MS no staging; o ajuste `9b22e00` da Central; depois, produção com autorização).
> - **Nota fiscal:** bloco "Frente da nota fiscal" do [`planejamento-nfse-asaas.md`](planejamento-nfse-asaas.md).
>   N-P1 a N-P7 decididas; **N1 a N5 feitas na branch `nota-fiscal`** (só local, 7 migrações); roteiro de validação
>   na seção 15.2. **Pendente: validação do cliente** (tudo da N1 à N5) e a recaptura de `config-nota-fiscal` (fila da
>   branch). Depois: trazer a `main` para a branch, juntar na `main` e decidir staging/produção (N6 depende do Asaas,
>   contador e advogado).
>
> **Staging = produção = `main` (`64ec6b1`, 08/nov)**, com o bloco multiprofissional e a validação de 08/nov (itens 1 a 4,
> fotos, filtros), validados pelo cliente; 9 migrações na produção (`producao.md`). Capturas da ajuda: fila vazia.
>
> **BaaS do Asaas (07/nov):** ajustes pedidos pelo Asaas (cláusula nos termos e selo sem registro) no ar: site `beb9e1c`
> e app `305efd7` (staging e produção; migração `20261228140000` nos dois). **E-mail de reanálise enviado pelo cliente
> (07/nov)**, com o print da habilitação fiscal; aguardando o Asaas. Cliente valida o `9b22e00` da Central (foi junto).
>
> **Sessão anterior (07/nov):** **validados no staging (07/nov):** troca cartão ↔ Pix (com o Suporte, o
> celular do pagador antes do Checkout e a troca de cartão aberta descartada ao mudar para Pix), EC (mensagens que a
> Central não mostra, com a localização só por coordenadas e "Ver no mapa") e o item 5 (F8.1, F8.2, F8.2b, F8.3,
> ajuda contextual e menu lateral). **Na produção (07/nov, `47e086d`)**, com as 22 migrações; saúde `ok`. **Asaas de
> produção configurado (07/nov):** chave (conta aprovada), 3 variáveis na Vercel + Redeploy, webhook no painel (ativo,
> não sequencial, com token, 31 eventos; token certo 200, errado 401). Falta: **tokenização do cartão** (pedida por e-mail ao Asaas em 07/nov)
> pedida ao Asaas (sem ela, o cartão pago na implantação não liga à assinatura; Pix e cartão sem implantação já
> funcionam); liberada, o Claude confere antes do 1º contrato com implantação no cartão. Depois, "Pendências".
> **Staging = produção = `main` (`47e086d`, 07/nov)**, com o financeiro e a EC.
>
> **Faturamento na `main` e no staging (07/nov, `3919ca4`, a pedido do cliente):** branch `faturamento` juntada na
> `main` (F12.1 a F12.8, F12.2b a F12.2i) depois de trazer a `main` para ela; 1087 de unidade, 1034 de banco, check e
> build passando; Playwright nas telas do financeiro. 18 migrações da branch aplicadas no staging (`--include-all`,
> simuladas e conferidas); rotinas `faturamento-eventos`, `conciliacao-asaas` e `avisos-cobranca` chamadas, saúde `ok`.
> **Validado pelo cliente no staging (07/nov)**, com ajustes da validação no staging: contrato novo do cliente (13 seções,
> cobrança da Meta), cópia do contrato em PDF, CSP (impressão e Asaas), selo "em atraso", pendências por seção no
> celular, cobrança removida no Asaas, fim do contrato só pelo contrato novo (`20261227120000`) e endereço do pagador
> com busca pelo CEP (`20261227130000`). Pendentes do cliente: multa/juros no Asaas, trocar cartão → Pix e exportação
> em 60 dias (divergências do contrato, no plano); 13 capturas `config-*`/`equipe` na fila. Asaas sandbox no staging (07/nov): as 3
> variáveis na Vercel e o webhook no painel (token conferido: 200). Ignored Build Step corrigido nos dois projetos
> (cancelava todo Redeploy; `producao.md`). Produção:
> não; **atenção:** a próxima publicação da `main` leva o financeiro e as 18 migrações (`db push --include-all`).
> 13 capturas `config-*`/`equipe` na fila (item Assinatura no menu).
>
> **Próxima sessão (cliente, 06/nov):** o cliente traz melhorias para a versão da produção (`552019b`, com a Central).
> Para ligar a Central numa clínica: item na Matriz + o Administrador liga em Configurações › WhatsApp (já explicado ao
> cliente). Modelo "Retomar conversa", cópia do bucket/PITR, v4 e campos do webhook: feitos (cliente, 07/nov). Push na `main` só com autorização (regra da sessão de 06/nov).
>
> **NA, conversas que não são atendimento (07/nov):** NA1 a NA6 feitas, **no staging e na produção** (`d4aff65`,
> migrações `20261226120000`, `20261226130000` e `20261226140000` aplicadas nos dois). **Validada (07/nov)** pelo
> roteiro no fim do [`conversas-nao-atendimento.md`](conversas-nao-atendimento.md).
>
> **Ajuda desta tela (07/nov, `32df66f`):** no pé do menu lateral e, no celular, ícone "?" no cabeçalho. No staging e
> na produção (`d4aff65`). **Validada (07/nov).** As 28 capturas refeitas (fila vazia). **`faturamento` com a `main` até `d4aff65`** (merge
> só local, sem push; 1087 de unidade e 1034 de banco passando).
>
> **Áudio da Conversas (07/nov, `7e8613c`):** não tocava (CSP) e demorava (só a rotina de 1 min); corrigido, validado
> no staging e **na produção**. Detalhe no `producao.md`.
>
> **Produção (06/nov, `552019b`):** a `main` inteira, com a Central (12 migrações aplicadas; item `central_attendance`
> **ligado na clínica piloto, funcionando**, cliente, 07/nov) e todos os ajustes de 06/nov. Saúde `ok`. Modelo
> "Retomar conversa", cópia do bucket/PITR, v4 e webhook: feitos (07/nov). Detalhe no `producao.md`. **`faturamento` com a `main` até `552019b`** (merge `882427f`, migração própria
> `20261225130000` do bloqueio de suspensa nas tabelas da Central; 1086 de unidade e 1005 de banco passando).
>
> **C31 (04/nov):** apresentação do 1º menu do bot, descrições nas opções e botão "Ver opções". No **staging e na
> produção** (`d2744f9`, sem migração). **Validada (05/nov).**
>
> **CA, ciclo do atendimento humano (04/nov):** situação guardada, Finalizar atendimento sem mensagem, abas na tela
> Atendimento e encerramento silencioso em 12 h. No **staging e na produção** (`1bfd20f`, 05/nov; migração
> `20261211120000` aplicada nos dois). **Validada (05/nov).** Plano em [`ciclo-atendimento-humano.md`](ciclo-atendimento-humano.md).
>
> **Central de Atendimento Humano (05/nov):** planejamento em [`planejamento-central-atendimento.md`](planejamento-central-atendimento.md).
> Decisões 1 a 12 respondidas (D12 revista); CN0 feito. **Alertas para a produção (seção 5.1):** a Meta cobra as
> mensagens de serviço desde 01/out (1.000 grátis/mês por número; sem pagamento, para de entregar) e descontinuou o
> Embedded Signup v3 (o botão de conexão usa a v3) em 15/out. **Cliente (05/nov):** sem medição (só a clínica piloto na produção); o cliente confere a
> forma de pagamento da piloto na Meta; cadastro v3 → v4 vai junto com a Central (cliente, 05/nov).
> **Pós-implantação:** rotina semanal que acompanha as mudanças da Meta (plano, seção 5.1).
> Custo da Meta, ativação pelo Administrador e calculadora: seção 14 do plano (decidida).
> **Revisão do plano (05/nov):** R1 a R3 respondidas, telas T1 a T10 decididas, calculadora conferida (T11). Implementação abaixo.
>
> **FE, falhas de envio (05/nov):** conferência do número ao marcar/cadastrar, aviso de entrega na Agenda, "Corrigir
> número" no Início, reenvio do bot (30 s e 2 min), detalhes e "Descartar" na aba Envios. No **staging e na produção**
> (`ed2931d`; migração `20261213120000` aplicada nos dois). **Validada (05/nov).** Plano em
> [`falhas-de-envio.md`](falhas-de-envio.md).
>
> **Decisão pendente:** testes de tela automáticos (Playwright); conversar prós e contras com o cliente (`historico.md`, "C30").
>
> **Central de Atendimento (CU2 a CN9) na `main` e no staging (05/nov):** a branch `central-atendimento` foi juntada
> na `main`; migrações `20261214120000` a `20261224120000` aplicadas no staging (só lá). Parte **AA** do
> [`staging.md`](staging.md) **validada inteira (07/nov)**, com o cadastro v4: configuração `3784178581733719` no
> `WHATSAPP_ES_CONFIG_ID` do staging, número de testes reconectado e histórico do app importado. **Na produção também
> (07/nov, Redeploy, saúde `ok`)**, sem reconectar as clínicas; ID antigo no `producao.md` para voltar atrás. Capturas da Central feitas e no
> staging (06/nov, `55403e0`): `conversas` (nova), `config-whatsapp`, `config-mensagens`; `atendimento` mantida.
> Produção só com autorização. Detalhe na seção 12 do plano da Central.
> **Próxima sessão (cliente, 06/nov):** cliente traz ajustes. Etapas pedidas e ainda por fazer, uma por vez: (3) trazer a
> `main` para a `faturamento` (conflitos da forma recomendada); (4) todos os testes na `faturamento`, inclusive Playwright.
> Seguem pendentes: passos do cliente antes da parte AA, desenho do envio de foto/PDF (padrão), resposta que falha
> contando no uso do mês (CN4a), `ACCOUNT_RECONNECTED` só no log e produção da Central.
>
> Partes S a W do `staging.md` validadas (05/nov). A `faturamento` está com a `main` até a FE e as capturas (05/nov).
> Trabalhar na worktree `recepclinic-main` (a pasta `recepclinic` está na branch `faturamento`). Faturamento: ver o bloco
> do topo (07/nov, na `main`).
>
> **Próximo (cliente, 01/nov):** validado no staging: Base de Conhecimento, "Como funciona?" de Configurações e Central de
> Ajuda, com as **25 capturas reais de tela** (`public/ajuda/`, refazer quando a tela mudar) e o WhatsApp do suporte (05/nov). Detalhes em
> [`ajuda-contextual.md`](ajuda-contextual.md), fim. Cliente vai pedir novos ajustes.
>
> **Em produção (cliente, 04/nov):** a `main` inteira até a C30 (3ª leva, acima); antes, até a C21: PN1–PN2, IS1–IS5, C17–C20 e C21 (6 migrações,
> `20261201120000` a `20261206120000`), sobre o `1ceb6a4`. Validado (05/nov). Detalhe no [`producao.md`](producao.md) (Publicações).
>
> **Ambientes**
> - **Produção** (`app.recepclinic.com.br`, branch `producao`) = `main` em 05/nov (até a CA). Fluxo em [`producao.md`](producao.md).
> - **Staging** (`teste.recepclinic.com.br`, branch `main`): produção + redesign da Recepção (RX1 a RX9, sem migração) +
>   cartão do Asaas (`ASAAS_PREVIEW=1`) + Base de Conhecimento do bot (migração aplicada) + PN1, PN2, IS2 a IS5 (migrações aplicadas) + IS1 + C17 a C20 (03/nov; migração `20261206120000` aplicada) + C21 (04/nov) + **Central de Atendimento** (05/nov, 11 migrações aplicadas).
>   Roteiros em [`staging.md`](staging.md).
> - **Branch `faturamento`**: juntada na `main` em 07/nov (`3919ca4`) e **aposentada**: ajustes do financeiro vão direto
>   na `main` (cliente, 07/nov). Na produção, as 18 migrações dela são anteriores às de lá: `db push --include-all`.
>
> **Frentes**
> - **Ajustes da produção (C1–C16) e revisão da jornada do bot:** todos na produção. Decisões da
>   revisão no [`historico.md`](historico.md) (busca "Revisão da jornada do bot").
>   **2ª leva (03/nov; `historico.md`, "2ª leva"):** C17 Marcar com um só serviço, C18 busca por nome parecido, C19
>   cadastro com nomes parecidos e conferência (migração `20261206120000` nas duas) e C20 volta ao bot 12 h depois da
>   resposta da clínica (desfaz a C10). **No staging e na produção (03/nov)**; validada (05/nov).
>   **C21 (04/nov):** dúvida respondida fora de um fluxo mostra o menu (ou o submenu) de novo, sem "Isso resolve sua
>   dúvida?"; menu com "Escolha uma opção abaixo ou faça uma pergunta."; nas Métricas, resolvida sem recepção em 30 min.
>   **No staging e na produção (04/nov, sem migração)**; validada (05/nov).
> - **Evolução do assistente** ([`evolucao-assistente.md`](evolucao-assistente.md)): texto livre na entrada, motivo antes
>   da recepção e taxa de resolução sem a recepção. **Na produção (02/nov, `c9418ac`)**, migração aplicada no staging
>   e na produção. Próximo: acompanhar a taxa e as perguntas não reconhecidas da BC.
> - **Faturamento do SaaS:** F12.1 e F12.2 validadas; **F12.2b a F12.8 e F12.2c a F12.2h na `main` e no staging (07/nov),
>   cliente valida**. 03/nov: contrato com nota fiscal só com o Módulo financeiro (e nota só com contrato assinado), texto
>   aprovado (renovação automática, IPCA, arrependimento, cancelamento), Assinatura em passo a passo, cancelamento e
>   troca de cartão pelo Administrador, lembrete do IPCA. Revisar: textos dos e-mails. Fora do código: token e webhook do
>   Asaas, tokenização em produção, advogado. Depois: F12.11. Retomar pelo `planejamento-faturamento-saas.md`.
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
>   produção. **Central de Ajuda atualizada com o redesign (02/nov):** artigos e as 25 capturas refeitas, validadas (05/nov). Avisos técnicos só do Suporte; tela
>   de pendências do Suporte pendente em [`painel-suporte.md`](painel-suporte.md).
>
> **Clínicas de demonstração (02/nov):** as 4 demos do staging recarregadas com todos os cenários de 5 semanas, sem o
> Financeiro; Consultório da Dra. Ana Karina excluído do staging. Logins e senhas em Sistema › Vendas › Demonstração.
> Cliente valida. **Antes de cada apresentação:**
> `node --env-file=.env.staging scripts/demo-clinicas.mjs --confirmar` (plano, item 9b).
>
> **Pendências**
> - **Limpeza (item 4, 08/nov):** `clinic_settings.booking_horizon_days` e `consultation_age_limit_years` sem uso; migração
>   para tirar depois da produção.
> - **Fotos (cliente, 08/nov):** cadastradas no profissional e na pessoa da Equipe; onde mostrar fora do cadastro fica
>   para uma etapa posterior, a planejar ([`frente-validacao.md`](frente-validacao.md), registro).
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
- [`planejamento-multiprofissional.md`](planejamento-multiprofissional.md): especialidades, convênios e bot por
  profissional (ponto de retomada).
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
