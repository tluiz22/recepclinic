# RecepClinic

> **Estado atual (retomar daqui), 16/out/2026**
>
> - **Etapas 0 a 4 concluídas**: cópia isolada, [diagnóstico](diagnostico.md), [limites](limites.md),
>   [arquitetura](arquitetura.md) (decisões D1–D11) e [plano](plano.md) (fases F0–F10).
> - **Produto:**
>   - **F0 a F5 concluídas e validadas** (base, testes das regras do piloto, schema multi-clínica,
>     camada de dados, painel completo, páginas públicas e staging). Detalhes no [plano](plano.md).
>   - **F6 (WhatsApp por clínica e bot) toda implementada.** F6.1 validada em 07/out; F6.3 (bot I:
>     marcar) e F6.3b (jornada de configuração) validadas em 08/out; F6.4 (bot II: cancelar,
>     remarcar, encaixe) validada em 08/out, com o ajuste do encaixe (até 3 horários livres antes
>     da lista, também para quem já está nela), com os botões do lembrete; F6.2 (envio e templates
>     padrão) validada em 08/out, menos o preparo do exame (template em análise); F6.6 (aba
>     Mensagens) validada em 08/out, com os ajustes do dia (combo bot/Meta, item da matriz dividido
>     em dois e as orientações gerais da consulta, template `rc_orientacoes_consulta_v1`).
>     F6.7 (Funil do bot e Retomar contato) e F6.5 (cancelamento pela clínica, com o template
>     aprovado) validadas em 08/out; saiu o "Cancelar selecionados" da Agenda (cliente: cancelar
>     vários é pelo "Bloquear e cancelar"). **F6 toda validada**, menos as conferências que
>     dependem de templates em análise (preparo do exame e orientações gerais fora das 24h).
>   - **F7 (envios automáticos) validada em 09/out** com os templates aprovados: rotinas no
>     `pg_cron` e Configurações › **Lembretes** (um lembrete por público: paciente, profissional e
>     equipe, na véspera ou no dia, das 6h às 20h). O cliente segue testando em paralelo e traz os
>     ajustes; resumo do dia e oferta de vaga a conferir quando a Meta aprovar os templates.
>   - **Templates na Meta (conferido em 12/out): todos aprovados**, inclusive os 2 resumos de
>     amanhã (`rc_resumo_consultas_amanha_v1` e `rc_resumo_exames_amanha_v1`), reenviados pelo
>     cliente em 10/out. Os 3 antigos sem uso já não existem na conta.
>   - **F9 (operação e segurança) validada em 09/out**, em 5 subetapas (detalhes no [plano](plano.md)):
>     cabeçalhos de segurança, CSP e `robots.txt`; logs sem dados pessoais; erros em tabela própria
>     (Administração › Erros) e monitor externo **Better Stack** (4 monitores, alerta por e-mail);
>     anonimização de paciente a pedido (LGPD); contadores de uso (Administração › Uso).
>   - **Meta:** análise do app **enviada em 09/out** (clínica demo do analista no staging: "Clínica
>     Demonstração RecepClinic", `analista.meta@recepclinic.com.br`, dados fictícios; desativar o
>     login quando a análise terminar). Falta a **Verificação do acesso** (textos prontos em
>     [`meta-tech-provider.md`](meta-tech-provider.md); antes, os dados da empresa no rodapé do site).
>   - **F9.6 (proteção contra abuso no bot) validada em 10/out**: F9.6a (limites por contato,
>     "Revisado", liberar contato dos limites) e F9.6b (bloquear contato). **F9 concluída.**
>   - **E-mail de verdade validado em 10/out**: Resend como SMTP do painel e do Supabase, remetente
>     `nao-responda@recepclinic.com.br` (parte L do [`staging.md`](staging.md)).
>   - **Rodada de ajustes dos testes do cliente (antes da F8a) concluída e validada em 11/out**:
>     itens 1 a 9 na seção "Ajustes dos testes do cliente" do [plano](plano.md). A página antiga do
>     roteiro no claude.ai (`R3VCJ9t1ebygPzjJhyvdJf`) **fica** (cliente, 11/out).
>   - **F8a (templates pela API) validada em 12/out**: F8a.1 "Reenviar à Meta" do padrão recusado
>     e F8a.2 "Excluir da Meta" dos templates do RecepClinic sem uso (detalhes no [plano](plano.md)).
>     **F11 (Módulo financeiro: pagamentos e nota fiscal no CPF do responsável, NFS-e nacional
>     da clínica com CNPJ, em Mossoró/RN, e arquivo da DMED para o IR)** pedida e **antecipada
>     pelo cliente em 12/out**; plano, segurança e decisões no [plano](plano.md). **F11.1
>     implementada em 12/out** (item na matriz, menu "Financeiro", CPF e responsável só dentro do
>     módulo; migração aplicada no staging). O cliente pediu para seguir e **validar tudo no fim**
>     (12/out). **F11.2 implementada em 12/out** (pagamentos do atendimento: botão "Pagamento" na
>     Agenda, tela própria, selos "Pago" e "Pago em parte", cartão "Pagamentos" do paciente;
>     decisões no [plano](plano.md)); migração aplicada no staging e código publicado (12/out). **F11.3 implementada em 12/out**
>     (Configurações › Nota fiscal: dados fiscais, código por serviço e certificado A1 no Vault,
>     com termo **provisório** e "Revogar"; aviso de vencimento no Início); migração aplicada no
>     staging e código publicado. **F11.6 implementada em 12/out** (Financeiro › DMED: responsáveis
>     guardados, resumo do ano, "Ficam de fora" e o arquivo no leiaute do ADE Cofis 34/2024);
>     migração aplicada no staging e código publicado. **F11.4 implementada em 12/out** (emissão e
>     cancelamento da NFS-e nacional pela tela do pagamento, na Produção Restrita até o Suporte
>     trocar; DPS validada contra o XSD oficial, Receita simulada nos testes), **sem o teste real**:
>     falta o e-CNPJ A1 de uma clínica de Mossoró. **F11.5 implementada em 12/out** (PDF da nota no modelo da NT 008, porque a API oficial do
>     DANFSe foi suspensa; envio pelo WhatsApp do contato, outro número e e-mail; destinos
>     guardados no Financeiro; automático ao emitir em Produção). **Toda a F11 implementada.**
>     **F11.4b implementada em 13/out** (cliente: sem e-CNPJ para os Testes 4 e 5): ambiente
>     **"Simulação"** da nota, só o Suporte liga e só com `NFSE_SIMULATION=1` na Vercel (staging);
>     a nota sai do próprio servidor, sem a Receita, com o selo "simulada". Para o Teste 3, três
>     certificados fictícios (senha `teste123`) na Área de Trabalho do cliente, pasta
>     `certificados-teste-recepclinic`; no T3.1, CNPJ fictício 11.222.333/0001-81. Detalhes no
>     [plano](plano.md) e na parte M do [`staging.md`](staging.md). Migração aplicada no staging
>     e código publicado (13/out). **Fim da sessão de 13/out:** o cliente segue o roteiro **a
>     partir do T3.1** na próxima sessão (T0 a T2 já feitos); antes, pôr `NFSE_SIMULATION=1` (e
>     `WHATSAPP_APP_ID`) na Vercel e fazer um Redeploy.
>     **Retomar daqui:** o cliente está testando a F11 inteira pelo roteiro no claude.ai
>     ([Roteiro de testes do Módulo financeiro](https://claude.ai/code/artifact/f7a032e3-c6f4-4e13-8fa1-f6d6e61afbcb),
>     passos T0.1 a T7.3 e folha de anotações) e traz os pontos para correção. Pelo roteiro: a F11.4
>     com o teste real na Produção Restrita (e-CNPJ A1 de uma clínica de Mossoró), a DMED com um
>     teste de importação no PGD Dmed pelo contador e, para o WhatsApp da nota, pôr
>     `WHATSAPP_APP_ID` na Vercel (Redeploy) e usar "Criar na Meta" para o `rc_nota_fiscal_v1`; para
>     os Testes 4 e 5 sem e-CNPJ, `NFSE_SIMULATION=1` na Vercel (mesmo Redeploy) e o Suporte passa
>     a clínica de teste para Simulação. **Prioridade (cliente, 12/out):
>     quando a Meta aprovar** (Análise do App, Verificação do acesso, Tech Provider), a F11
>     **pausa** e o trabalho **volta às fases anteriores** (F8 e F10) para terminar e iniciar o
>     piloto; a F11 continua depois. Em paralelo, aguardar a
>     Meta (Análise do App; depois, a Verificação do acesso); a F10 (produção, com custo mensal)
>     segue como opção. A F8 completa depende da Meta (análise do app e Tech
>     Provider) e a F10 depende da F8.
>   - **Auditoria de frontend (14/out):** [relatório](auditoria-frontend/frontend-audit-report.md)
>     e [cobertura](auditoria-frontend/frontend-test-coverage.md). Todos os defeitos confirmados
>     foram corrigidos, revalidados no navegador e publicados: Alta (F-01 a F-03), Média (F-04,
>     F-05, A-02) e Baixa (F-06, F-08, F-09, A-01, A-03, A-05); F-07 não se reproduziu (era a barra
>     do Astro no `npm run dev`). Status de cada achado na seção 12 do relatório. Ícone da aba nas
>     páginas do paciente: o logo da clínica, sem logo nenhum (cliente, 14/out). **Ficam abertos:**
>     a suspeita de envio duplo e as recomendações de UX (U-01 a U-12, a avaliar com o cliente).
>   - **Redesign do painel (15/out):** avaliação global, identidade visual e proposta da Agenda no
>     [canvas](https://claude.ai/artifact/AUajFVHWJNscFp5w5Pvqn4); plano R0 a R11 e as 4 decisões
>     do cliente na seção "Redesign do painel" do [plano](plano.md). **R0, R1 (parcial) e R2
>     implementadas em 15/out**, testadas no navegador, aprovadas pelo cliente e **publicadas no
>     staging** (commit `a1066ca`). Correção do "confirmo" do lembrete e **R3 (Resumo do Dia)
>     implementadas em 15/out**, aprovadas pelo cliente e publicadas no staging. Depois, a correção
>     de "Não responderam" para quem remarcou pelo lembrete (commit `317dd72`, publicada e
>     conferida pelo cliente no staging).
>     **R4 (Marcar e Remarcar) implementada e publicada no staging em 15/out** (proposta aprovada
>     no canvas; U-09: vindo de um dia da Agenda, os horários começam nesse dia; detalhes no
>     [plano](plano.md)). Ajustes do teste (o "De" sem risco no Remarcar; no Marcar, o
>     paciente primeiro) publicados e **R4 validada pelo cliente em 16/out**. **Retomar daqui:** R5
>     (Pagamento): proposta no canvas → aprovação → implementação. **Menu do Suporte agrupado
>     (pendência da R1, U-07) validado e publicado no staging em 16/out: R1 concluída.**
>     **Teste de interface da R0 a R4 (16/out)**: [relatório](auditoria-frontend/redesign-r0-r4-report.md);
>     as 6 falhas foram corrigidas, validadas e publicadas. **R5 (Pagamento): proposta aprovada, implementada, testada
>     ([relatório](auditoria-frontend/redesign-r5-report.md), 3 falhas e 1 suspeita corrigidas),
>     validada pelo cliente e publicada no staging em 16/out** ("Emitir a nota agora" desmarcado e
>     envio único em todo o painel; detalhes no [plano](plano.md)). **Próxima sessão: R6 (Pacientes
>     e Ficha) pela proposta no canvas.** A decidir com o cliente: o texto da confirmação da série (S-01).
>   - **Migrações no staging:** o Claude aplica com `supabase db push` (permissão liberada em
>     09/out), sempre na ordem simulação → aplicar → conferir no banco → só então o push do código.
>   - **WhatsApp de testes:** `+55 61 9903-3143`, na Cloud API do app RecepClinic, ligado à
>     clínica de teste "Consultorio de Teste" no staging (nome conferido em 12/out). **Nunca verificar esse número em app
>     nenhum** (sairia da API). Roteiro na parte E do [`staging.md`](staging.md).
>   - **Staging:** `https://app.recepclinic.com.br` (Vercel publica a cada push na `main`);
>     migrações novas vão com `supabase db push` antes do push (repositório ligado ao projeto
>     `recepclinic-staging`; a senha do banco está em `SUPABASE_DB_PASSWORD` no `.env.staging`);
>     agendador ligado (`scripts/agendador.mjs`); variáveis no `.env.staging` (fora do git). E-mail pelo
>     Resend (10/out); `scripts/link-de-senha.mjs` fica de reserva. Variável nova na Vercel só vale
>     depois de um **Redeploy**.
>   - **Para rodar:** abrir o OrbStack, `npm run db:start`, `npm run db:reset` (dados de teste) e
>     `npm run dev` com o `.env` local (ver "Painel local" no README da raiz); testes com `npm test`
>     e `npm run test:db`.
> - **Frente paralela, o site** `www.recepclinic.com.br`: [`site-plano.md`](site-plano.md), feito numa
>   **sessão separada, na pasta `~/Documents/Desenvolvimento/recepclinic-site`** (nunca nesta pasta).
>   **No ar** (conferido em 05/out), com `/privacidade` e `/termos`; DNS de `recepclinic.com.br` já
>   na Cloudflare.
> - **Comercial (11/out)**: tudo no Suporte › **Vendas** (nunca no site público): **Planos** (tabela e
>   simulação da negociação), **Demonstração** (3 clínicas fictícias por plano, logins e o script
>   `scripts/demo-clinicas.mjs`) e **Roteiro de vendas** (mensagens prontas, imagens, objeções e
>   calculadora de ganho). Item 9 dos ajustes no [plano](plano.md).
> - **Meta**: verificação da empresa aprovada e app RecepClinic criado (06/out); faltam a análise
>   do app e o Tech Provider (destravam a F8). Ver "Frentes paralelas" no plano.
> - **Pendências do cliente**:
>   - ~~abrir o CNPJ~~ **aberto** (cliente, 10/out); ~~Resend na política de privacidade do site~~
>     **incluído** (cliente, 10/out);
>   - advogado para revisar as páginas legais e a [política de pedidos de autoridades](politica-pedidos-de-autoridades.md)
>     (antes do 1º piloto);
>   - ~~dados da empresa no rodapé do site~~ **no ar** (conferido em 12/out); falta a
>     **Verificação do acesso** na Meta, que só aparece depois da aprovação da Análise do App
>     (textos e onde fica em [`meta-tech-provider.md`](meta-tech-provider.md));
>   - contrato com as clínicas e termo de tratamento de dados (antes da F10).
>   - antes da F11.4: confirmar com o contador das clínicas de Mossoró se a NFS-e já sai pelo
>     portal nacional (`nfse.gov.br`), e uma clínica piloto com certificado A1 para os testes;
>     com o advogado e o contador, o prazo de guarda fiscal e o texto do termo de autorização da F11.
>   - ~~excluir na Meta os 3 templates antigos sem uso~~ **feito** (conferido em 12/out).
> - **Triagem do piloto**: nenhum commit novo do piloto desde `aad94dd` até 06/out/2026 (início da F6).

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

Ainda **não há** banco, projeto na Vercel nem app na Meta próprios. Eles serão criados quando a
implementação precisar rodar o sistema. **Este repositório não tem `.env`** e nunca deve usar as
credenciais do piloto (banco, agendador e Vault do Supabase, número e app da Meta, segredos).

## Documentos

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
