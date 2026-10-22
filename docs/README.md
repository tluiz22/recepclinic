# RecepClinic

> **Estado atual (retomar daqui), 22/out/2026**
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
>     login quando a análise terminar). **Conferido em 17/out: "Análise em andamento"** (as 4 permissões; a Meta fala em até 20 dias, ou seja, até ~29/out). Falta a **Verificação do acesso** (textos prontos em
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
>     páginas do paciente: o logo da clínica, sem logo nenhum (cliente, 14/out). **Revisão com o
>     cliente em 17/out:** envio duplo e U-01 a U-12 resolvidos ou fechados (U-08 corrigido; U-05 e U-12 sem mudança) e o
>     QA-09 da R8 corrigido; implementado, conferido no local, publicado no staging em 17/out (sem migração, commit `9d01b21`) e validado pelo cliente. Na validação, o cliente achou o telefone curto aceito e exibido com o +55: **regra do telefone corrigida** (celular com 9 dígitos, fixo com 8; exibição sem o +55), conferida no local e publicada no staging em 17/out (sem migração, commit `dfd146b`) e **validada pelo cliente em 17/out** (detalhes no [plano](plano.md) e na seção 12.3
>     do relatório).
>   - **Regressão do frontend (18/out):** [relatório](auditoria-frontend/regressao-2026-10-18-report.md),
>     no local e sem gravar dados: 107 cenários (94 passaram, 4 falharam, 8 bloqueados, 1 não
>     aplicável) e 105 endereços varridos. Nenhum defeito corrigido voltou. Defeitos novos, **abertos e
>     aguardando o cliente**: REG-01 (Média: barra de filtros da Agenda passa da tela entre 640 e
>     820px), REG-02 (abas rolam 8px em telas médias), REG-03 (Pagamento em 360px) e REG-04 (borda
>     vermelha do Cadastrar só com foco); suspeita S-01 (ficha e Pagamento sem borda vermelha).
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
>     envio único em todo o painel; detalhes no [plano](plano.md)). **R6 (Pacientes e Ficha): proposta
>     aprovada (7 decisões no [plano](plano.md)) e implementada em 16/out**, testada no navegador local
>     (computador e celular, sem gravar dados); [teste de interface](auditoria-frontend/redesign-r6-report.md)
>     com 3 falhas Baixas (QA-02, QA-03, QA-06), já corrigidas e retestadas; **publicada no staging em 16/out** (commit `06dbf90`, a
>     pedido do cliente), **R6 validada pelo cliente em 16/out.** **R7 (Início e Métricas): proposta aprovada em 16/out
>     (8 decisões no [plano](plano.md), com a nova ordem das abas das Métricas); implementada e testada no navegador local em 16/out; [teste de interface](auditoria-frontend/redesign-r7-report.md) com 3 defeitos (1 Médio, 2 Baixos), já corrigidos e retestados; **publicada no staging em 16/out** (commit `9e02dc5`, sem migração), R7 validada pelo cliente em 17/out.** **R8 (Financeiro e DMED): proposta aprovada em 17/out (6 decisões no [plano](plano.md), com o filtro novo "Falta CPF") e implementada e testada no navegador local em 17/out. [Teste de interface](auditoria-frontend/redesign-r8-report.md) em 17/out: 2 falhas Baixas (FIL-03, mensagem do "Falta CPF" com busca sem resultado, **corrigida e retestada** com o texto aprovado: "Buscar em Todos"; QA-09, erro sem JavaScript no `EditCard`, anterior à R8, só registrada) e "Ficam de fora" não testado (sem pagamento sem CPF no seed). Migração `20261017120000_falta_cpf.sql` aplicada no staging pelo cliente (função conferida no banco) e **R8 publicada no staging em 17/out** (commit `979a294`). No staging, o cliente achou o erro 500 da busca por telefone com o filtro "Falta CPF" (FIL-04), corrigido e publicado (commit `16d5553`). **R8 validada pelo cliente em 17/out** (a DMED continua abrindo no ano passado, decisão do cliente). **R9 (Configurações): proposta aprovada em 17/out** (7 decisões no [plano](plano.md), com o salvar por bloco na Clínica e o "Voltar" para a origem, que resolve o S-01 da R8). **R9 implementada e testada no navegador local em 17/out** (sem commit: aguarda a validação do cliente; depois, o teste de interface e a publicação no staging, sem migração). [Teste de interface da R9](auditoria-frontend/redesign-r9-report.md) em 17/out: 3 falhas (QA-02, Média: o aviso não é apagado em 14 telas de Configurações e reaparece nas seguintes; QA-01, Média: erro de um bloco de baixo da Clínica fora da tela e sem marca no campo; NAV-06, Baixa e anterior à R9: "‹ lista" perde o filtro "Todos"), **as 3 corrigidas e retestadas em 17/out** a pedido do cliente. **R9 publicada no staging em 17/out** (commit `8a06541`, sem migração), a pedido do cliente, que valida depois. Na validação pelo celular, o cliente achou o menu de seções confuso (grupo × seção) e a troca de seção sem retorno ao toque: **proposta de revisão aprovada no canvas e implementada em 17/out** (grupos em cartões, "Abrindo…" na linha, barra de carregamento abaixo da barra de status do iPhone; detalhes no [plano](plano.md)), testada no navegador local e **publicada no staging em 17/out** a pedido do cliente (sem migração). **R10 (Sistema e Acesso): proposta aprovada em 17/out** (7 decisões no [plano](plano.md), com "Mostrar" na senha, a busca de clínica acima de 6, "Abrir" na lista de Clínicas e o filtro e o total do Uso). **R10 implementada e testada no navegador local em 17/out**. [Teste de interface da R10](auditoria-frontend/redesign-r10-report.md) em 17/out: 3 falhas Baixas (NAV-06: a Matriz aberta pela tela da clínica volta para a lista; QA-10: "3de 3" no contador dos grupos da Matriz; FORM-09, anterior à R10: a Matriz perde as marcações quando volta com erro) **as 3 corrigidas e retestadas em 17/out** a pedido do cliente; e, por decisão do cliente (S-01), "Abrir a clínica para configurar" abre Configurações. **R10 publicada no staging em 17/out** a pedido do cliente (sem migração) e **R10 validada pelo cliente em 17/out** (ajustes que aparecerem nos testes dele entram depois). **R11 (páginas do paciente: `/agendar`, `/preparo`, `/orientacoes`, o `/formulario` da clínica e a 404): proposta aprovada em 17/out** (8 decisões no [plano](plano.md), com o botão "Falar com a clínica no WhatsApp" nos avisos do link e o verde `#0B7A62` como cor padrão da clínica sem cor). **R11 implementada e testada no navegador local em 17/out** (sem commit do código: aguarda a validação do cliente; depois, o teste de interface e a publicação no staging, sem migração). [Teste de interface da R11](auditoria-frontend/redesign-r11-report.md) em 17/out: 3 falhas Baixas (QA-01, da R11: horário escolhido com contraste abaixo de 4,5:1, inclusive no verde padrão; QA-02, anterior: aba "Atendimento marcado" no aviso de cancelado e de link já usado; FORM-04, anterior: no `/formulario`, o nome da clínica apagado volta preenchido junto com o erro) e 2 suspeitas de usabilidade (S-01: a faixa de dias no celular mostra 4 dias e a seta pula 7; S-02: dia sem horário no endereço vira o seguinte sem aviso), a decidir com o cliente. **As 3 falhas corrigidas e retestadas em 17/out** a pedido do cliente (seção 10 do relatório); banco local de volta ao seed. **R11 publicada no staging em 17/out** a pedido do cliente (sem migração), que valida depois pelo celular. **R11 validada pelo cliente em 17/out.** **S-01 do teste da R11 decidida e implementada em 17/out** (setas na linha do título no celular, no `/agendar` e no Marcar e Remarcar do painel; os 7 dias sem arrastar), conferida no local (sem commit do código: aguarda a validação do cliente; depois, a publicação no staging, sem migração). **S-02 decidida e implementada em 17/out** (no `/agendar`, o dia pedido sem horário mostra "Não existe agenda aberta para esse dia." ou "… não tem mais horário livre. Mostramos o próximo dia com horário."; o mesmo no Marcar e no Remarcar do painel), conferida no local, também sem commit. O cliente valida a S-01 e a S-02 juntas no fim (17/out). [Teste de interface da S-01 e da S-02](auditoria-frontend/redesign-r11-s01-s02-report.md) em 17/out: 15 cenários aprovados; 2 falhas Baixas anteriores (S02-08: no `/agendar`, dia pedido depois do último dia livre some com a faixa e diz "Não encontramos horários livres"; QA-01, fora do escopo: cabeçalho do painel passa 4px em 360px) e 1 suspeita (dia sozinho na última página fica esticado). **Decididas pelo cliente, corrigidas e retestadas em 17/out** (seção 10 do relatório): aviso + faixa a partir do primeiro dia livre; cada dia com no máximo 1/7 da faixa; abaixo de 380px o "Administrador" sai do cabeçalho. Publicadas junto com a S-01 e a S-02. **S-01, S-02 e as correções do teste publicadas no staging em 17/out** a pedido do cliente (sem migração). **Correção do "Outra data" no iPhone** (abria e fechava o calendário no Marcar e no Remarcar; o campo agora vem com o dia escolhido; detalhes no [plano](plano.md)), feita e conferida no local e publicada no staging em 17/out (sem migração, commit `30088ce`) e **validada pelo cliente no iPhone em 17/out**. S-01 e S-02 validadas pelo cliente em 17/out. **Retomar daqui (próxima sessão, 17/out):** tudo publicado e validado (S-01/S-02, "Outra data" no iPhone, texto das confirmações, busca por nascimento e "Já marcado", U-08, QA-09 e a regra do telefone). **Telefones gravados antes da regra nova (17/out):** levantados no staging (pacientes, profissionais, avisos, nota, links, bot e mensagens); só 5 fora da regra, todos fictícios da clínica de demonstração da Meta (Paciente Exemplo 1 a 4 e Dra. Exemplo), corrigidos com o 9 depois do DDD a pedido do cliente e conferidos no banco. **Testes da F11 pelo roteiro (do T3.1) ficam pendentes** (cliente, 18/out): `WHATSAPP_APP_ID` e `NFSE_SIMULATION=1` já configurados na Vercel pelo cliente (conferir que houve o Redeploy: o botão "Passar para Simulação" aparece para o Suporte); ao retomar, "Criar na Meta" do `rc_nota_fiscal_v1`, Teste 3 com os certificados fictícios, Simulação e Testes 4 a 7. Enquanto isso, aguardar a Meta (Análise do App até ~29/out; depois Verificação do acesso e Tech Provider, que destravam a F8 e a F10). **CI (17/out):** o job `db` falhava desde a F5.1 (06/out) porque o CI subia o Supabase sem o Storage (logo e XML da nota); corrigido no commit `369ea5e` e o CI voltou a passar. Migração registrada no histórico pelo cliente (`migration repair`, 17/out); conferido: staging em dia. **Largura única (16/out):** Agenda e Resumo do Dia na largura das outras telas (1152px), aprovada pelo cliente e publicada no staging (decisão no [plano](plano.md)). **Revisão da Agenda na largura única (17/out):** barra numa linha, 4 colunas sem corte, cartão da turma e selo da Semana como na proposta aprovada; validada pelo cliente e publicada no staging. **Texto das confirmações (S-01 do teste da R0 a R4) decidido em 17/out:** Marcar, série e Remarcar dizem o horário (e, na série, a frequência, o começo e até quando); implementado, conferido no local e publicado no staging em 17/out (sem migração); commit `e02cf3e`, **validado pelo cliente pelo celular em 17/out** (detalhes no [plano](plano.md)). **Ajustes da validação (17/out), decididos pelo cliente:** busca de paciente por nome (com números), telefone ou nascimento (dd/mm/aaaa), com o nascimento nos resultados; e, no Marcar, o "Já marcado" na busca e no cartão do paciente e a trava conferida ao escolher o serviço (aviso com "Remarcar esse atendimento"). Implementados, conferidos no local e publicados no staging em 17/out (sem migração, commit `67d0297`) e **validados pelo cliente em 17/out**.
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
> - **Correções dos testes do cliente (18/out):** 1) bot sem "Marcar retorno": a "Consultorio de Teste" não tinha
>   serviço de Retorno (falta cadastrar no staging); aviso novo em Configurações › Serviços, validado e publicado no
>   staging em 18/out (sem migração; detalhes no [plano](plano.md)). 2) link do WhatsApp copiado como chave Pix (o
>   UUID no fim do endereço): links do paciente com o id em 22 caracteres, validado e publicado no staging em 18/out
>   (sem migração). 3) trilha com o nome interno das mensagens: todos os tipos com nome em português, validado e
>   publicado no staging em 18/out (sem migração). 4) Métricas: "Marcados por" pelo dia da marcação, validado e
>   publicado no staging em 18/out (sem migração). 5) lista de espera: vaga em oferta não conta como "livre antes" e
>   vaga com horário livre antes fica aberta e é reconferida, publicado no staging em 19/out (sem migração; detalhes
>   no [plano](plano.md)). **Retomar daqui (próxima sessão):** o cliente traz os próximos erros dos testes. A vaga do
>   Retorno de 19/10 às 11:45 foi reaberta no staging (19/out, 08:06 da clínica), mas 10:30 e 10:45 ficaram livres (uma
>   Consulta cancelada às 07:28), então pela regra ela espera e, sem ocupar esses horários, fecha às 09:45 (2h antes);
>   explicado ao cliente em 19/out. **Fila por serviço decidida (cliente, 19/out):** a vaga continua indo só para quem
>   está na fila **do mesmo serviço** (registrado na D2 da [arquitetura](arquitetura.md)). Banco local
>   limpo em 19/out (8 clínicas e 16 logins de uma rodada de testes interrompida, com o OK do cliente): `npm run test:db`
>   com os 516 passando. **REG-01 a REG-04 e S-01 da regressão de 18/out decididos e corrigidos em 19/out** (barra
>   da Agenda em duas linhas de 640 a 1279px; borda vermelha em todo campo com erro do painel), conferidos no local
>   (seção 10 do [relatório](auditoria-frontend/regressao-2026-10-18-report.md)), **validados pelo cliente e publicados
>   no staging em 19/out** (sem migração). **Redesign de 19/out:** propostas no [canvas](https://claude.ai/artifact/8x8Zi8osZZLypbMkGRiPbQ) e
>   decisões do cliente (1C tipo como título do cartão na Agenda; 2B seções com ícone em Configurações, com ícones também
>   no celular; 3B Horários em colunas, em lista) no [plano](plano.md). **1C implementada e testada no local** ([teste](auditoria-frontend/redesign-1c-report.md),
>   turma com a faixa a pedido do cliente); publicada no staging em 19/out (sem migração); **1C validada pelo cliente em 19/out.** **2B implementada, testada
>   ([teste](auditoria-frontend/redesign-2b-report.md)) e publicada no staging em 19/out** (sem migração); o cliente valida
>   em paralelo. **3B implementada e testada no local** ([teste](auditoria-frontend/redesign-3b-report.md)), publicada
>   no staging em 19/out (sem migração); **2B e 3B validadas pelo cliente em 19/out.** **Ajuste da 3B (19/out), proposta A
>   do [canvas](https://claude.ai/artifact/J3gdVmShr3aJACVsgcr7Fe):** em Horários, o bloco ganha a faixa do tipo no alto,
>   como na Agenda; o horário de todos os serviços leva no título os tipos da agenda ("Consulta e Retorno"). Implementado
>   e testado no local ([teste](auditoria-frontend/redesign-3b-tipo-report.md)) e publicado no staging em 19/out a pedido do
>   cliente (sem migração), que valida lá. **Cor de cada serviço (19/out, decisões no [plano](plano.md)):** automática pela
>   ordem de criação, Retorno sempre roxo, em Horários e na Agenda; implementada e testada no local
>   ([teste](auditoria-frontend/cor-servico-report.md)), publicada no staging e **validada pelo cliente em 19/out**.
>   **Resumo do Dia com a etiqueta do tipo na cor do serviço** (proposta A do
>   [canvas](https://claude.ai/artifact/QmFLaNUcC74FLSnaFu2nyw), também em Lembretes, Lista de espera, Aguardando
>   remarcação e Envios): implementada e testada no local ([teste](auditoria-frontend/resumo-tipo-report.md)) e
>   publicada no staging em 19/out a pedido do cliente (sem migração) e **validada pelo cliente em 19/out**.
>   **"Marcar retorno" na Consulta realizada e apta** (cliente, 19/out; 7 regras no [plano](plano.md)): implementado e
>   conferido no local e publicado no staging em 19/out a pedido do cliente (sem migração); ajustado para aparecer a partir
>   do horário de início da Consulta (sem esperar o "Compareceu"), publicado de novo em 19/out (commit `39a8843`) e
>   **validado pelo cliente em 19/out**.
>   **F11 toda validada pelo cliente em 19/out** (Testes 0 a 7 do roteiro, no staging, com os certificados fictícios e
>   a Simulação; detalhes no [plano](plano.md)). Fora do sistema seguem o teste real na Produção Restrita (e-CNPJ A1),
>   a DMED no PGD Dmed pelo contador, o template `rc_nota_fiscal_v1` na Meta e o termo com o advogado.
>   **F10.1 (importação da agenda na implantação) decidida em 19/out:** planilha modelo (.xlsx ou .csv) importada
>   só pelo Suporte, com pacientes e consultas de hoje em diante, **sem o aviso de marcação** (os lembretes saem);
>   9 decisões no [plano](plano.md). **OK do cliente para implementar na próxima sessão** (19/out).
>   **F10.1 revista pelo cliente em 20/out:** no lugar da planilha, um **link de preenchimento** (sem login, 15
>   dias) para a clínica, com o Suporte conferindo e autorizando a carga; planilha dentro do link fica para depois
>   do 1º piloto (decisões no [plano](plano.md)). **F10.1a (pedido, e-mail e o link com rascunho e envio)
>   implementada e publicada no staging em 20/out** (migração aplicada antes; commit `c16c69b`); o cliente valida lá.
>   **F10.1b (conferência do Suporte e "Devolver à clínica" com comentário) decidida e implementada em 20/out**,
>   testada no local e publicada no staging em 20/out (sem migração); o cliente valida tudo no fim (20/out). **F10.1c (autorizar e gravar a carga) decidida, implementada e publicada no staging
>   em 20/out** (migração `20261020130000_carga_da_agenda.sql`). **F10.1d (desfazer a carga, com prévia do que sai
>   e do que fica) implementada e publicada no staging em 20/out** (migração `20261020140000_desfazer_carga.sql`).
>   **F10.1 toda implementada e publicada; o cliente valida tudo no fim** (roteiro: pedir pelo cartão "Agenda atual"
>   da clínica, preencher o link, conferir, devolver, autorizar a carga e desfazer).
>   **F10.1 toda validada pelo cliente em 21/out** (roteiro T1 a T8 no staging: pedido, link, link novo, avisos e envio,
>   conferência, devolução, carga e desfazer); **etapa entregue**. Erro do CI resolvido em 20/out (o job `db` falhava desde
>   a F10.1a porque os tipos foram gerados com o Supabase CLI 2.121.0 do computador, que escreve `ComputedFields: never`, e
>   o CI estava na 2.119.0; CI passado para a 2.121.0, commit `dde5d7e`).
>   **Retomar daqui (próxima sessão, depois de 21/out):** o cliente traz novos itens para corrigir ou melhorar. Em
>   paralelo, aguardar a Meta (Análise do App até ~29/out). As melhorias no processo da nota fiscal continuam para uma
>   sessão própria.
>   **Jornada de configuração revista (cliente, 21/out):** Profissional → Local → Agenda → Serviços → Horários, sem
>   pular o Local (5 itens aprovados; detalhes no [plano](plano.md)). Implementada e testada no navegador local em
>   21/out, **validada pelo cliente em 21/out** e publicada no staging (sem migração).
>   **Horários: "Editar" no "⋯" e Local e Serviço obrigatórios, sem valor padrão (cliente, 21/out):** implementado e
>   conferido no local (detalhes no [plano](plano.md)); sem migração; **publicado no staging em 21/out a pedido do cliente e validado pelo cliente em 21/out** (sem ajustes).
>   **Agendas: uma por profissional e "Nova agenda" só quando houver o que criar (cliente, 21/out):** implementado e
>   publicado no staging em 21/out (commit `0b1a32a`). **Revisto na validação (21/out): agenda da equipe** (uma por
>   clínica, só com Exames, "Equipe" no "De quem", só serviços de exame), com a migração
>   `20261021120000_agenda_da_equipe.sql`; publicado no staging em 21/out. **Ajustes da validação (21/out):** nome sempre "Exames" (migração
>   `20261021130000_agenda_da_equipe_nome.sql`), "Abrir para reativar" e "Ativos | Desativados" nas 5 listas de
>   Configurações; publicados no staging em 21/out (migração aplicada antes) e **validados pelo cliente em 21/out**.
>   **Serviço sem horário conta em Serviços** (menu e guia, cliente 21/out): publicado no staging em 21/out (sem
>   migração); **validado pelo cliente em 21/out**.
>   **Métricas › Visão geral › "Marcados por" sem a linha "Link de agendamento"** (cliente, 21/out): ficava sempre em
>   0, porque quem marca pelo link do bot já conta como "WhatsApp (bot)"; publicado no staging em 21/out (sem migração);
>   **validado pelo cliente em 22/out**.
>   **Link de criar a senha (cliente, 22/out):** o 1º link do convite dava "venceu" em menos de 24h e caía no login.
>   Causas: o staging nunca recebeu o `otp_expiry = 86400` do `config.toml` (padrão do Supabase: 1 hora) e abrir o link já
>   gastava o código (leitor de e-mail, antivírus, prévia do WhatsApp). Correção: o link abre `/admin/confirmar-link`, e o
>   código só é conferido no botão "Criar minha senha"; vencido ou já usado abre `/admin/link-vencido`, com "Receber um
>   novo link" (no lugar do login). Publicado no staging em 22/out (sem migração). Validade do link: **86400 no staging em 22/out**
>   (o cliente rodou o PATCH `mailer_otp_exp` da API do Supabase com o login da CLI, porque o painel estava fora por um
>   incidente); **na produção, o mesmo ajuste**. Envio da recuperação conferido (e-mail chegou, 22/out). Para testar
>   convites: e-mail com "+" (`nome+teste1@gmail.com`). **Validado pelo cliente em 22/out** (recuperação e convite).
>   **Funil do bot descrito (22/out):** objetivo, dados e forma de apresentação no
>   [documento](https://claude.ai/artifact/6Rf7vVEpV2u7tZE8jU1BZx), a pedido do cliente.
>   **Redesign das Métricas (22/out):** o pedido cresceu do Funil do bot para as Métricas inteiras. Proposta no
>   [canvas](https://claude.ai/artifact/XSZcqear3D3aBb2K2EVeyS) (abas Desempenho e Agendamento digital, estados,
>   22 indicadores, plano M1 a M5); **direção e as 10 decisões aprovadas pelo cliente em 22/out** (seção "Redesign das
>   Métricas" do [plano](plano.md)). **Instruções novas do cliente recebidas em 22/out:** implementar o redesign
>   inteiro, **M1 a M5 sem parar**, cada etapa publicada no staging ao terminar; o cliente **valida tudo no fim**.
>   **M1 (trilha na mesma transação, por gatilho, e índices) implementada e publicada no staging em 22/out**
>   (migração `20261022120000_metricas_trilha.sql`; `origin_appointment_id` conferido: confiável). **M2 e M3 (contas
>   no banco e dados novos do bot) implementadas e publicadas no staging em 22/out** (migração
>   `20261022130000_metricas_contas.sql`). **Retomar daqui:** M4 (aba Desempenho), depois M5 (Agendamento digital). Em paralelo, aguardar a Meta (Análise do App até ~29/out).
>   **App antigo da Meta (cliente, 20/out):** o piloto está desativado e o número do app "Consultório Dra. Ana Karina" é
>   do cliente; o app antigo foi excluído pelo cliente (20/out) e o número entra no portfólio RecepClinic para uma 2ª clínica de
>   testes do staging quando o aparelho estiver com ele (precisa do SMS). Regra revista no `CLAUDE.md`.
>   **Antes (19/out):** implementar a F10.1 (já aprovada). As **melhorias no
>   processo da nota fiscal** ficam para uma sessão própria (cliente, 19/out: ele traz a lista do que planejar). Em
>   paralelo, aguardar a Meta (Análise do App até ~29/out).
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
