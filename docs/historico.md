# Histórico do projeto (arquivo)

Registro completo do andamento, sessão a sessão, como estava no bloco "Estado atual" do
[`README.md`](README.md) até 28/out/2026. **Só se acrescenta; não é lido na retomada** (o ponto de
retomada fica no README). Para achar algo, buscar por data (ex.: `27/out`), fase (ex.: `F8.5`) ou commit.

> **Estado atual (retomar daqui), 27/out/2026**
>
> **Fim da sessão de 27/out. Retomar daqui (próxima sessão):**
> - **Feito em 27/out:** etapa A (roteiros do WhatsApp Business: único, iPhone e Android); **coexistência no staging**
>   (o `+55 61 9903-3143` na Consultorio de Teste, portfólio próprio "Consultório de teste", eco, pausa e `#bot`
>   validados; parte P do [`staging.md`](staging.md)); **F8.5 Atendimento humano** toda validada no staging e
>   **publicada na produção** (`af0902d`): tela Atendimento, Horário da recepção, notificações no celular (Web Push),
>   bot que não entende (4ª vez vai para a clínica). Detalhes no [plano](plano.md) (seção F8.5) e em
>   [`producao.md`](producao.md) (Publicações).
> - **Próximo, à escolha do cliente:** (1) **lembrete com botões** da coexistência no staging, último item da parte P,
>   quando a Meta aprovar os 18 templates da conta nova (conferir pelo "Atualizar situação"); (2) **etapa B**, a clínica
>   de testes permanente na produção com o 2º número do cliente; (3) **etapa C**, o piloto com a Dra. Ana Karina.
> - **Pendências pequenas:** conferir o 1º backup diário da produção (*Database › Backups* do `recepclinic-producao`);
>   investigar por que a sessão do painel caiu durante a janela da Meta (suspeita: login do Suporte em duas janelas,
>   parte P do [`staging.md`](staging.md)); a proposta da frase de encerramento no lugar do `#bot` foi recusada (fica o
>   `#bot` ou o "Devolver ao bot").
> - **Etapa paralela CRM (cliente, 27/out):** desenvolvida na branch **`CRM`**, separada da `main`, para poder parar a
>   qualquer momento e voltar às etapas do piloto (B e C). O planejamento e o ponto de retomada do CRM ficam em
>   `docs/crm.md`. Para trocar: `git switch CRM` / `git switch main`. A `main` segue sendo a
>   única que publica no staging (e a `producao` na produção); o CRM só entra na `main` com a aprovação do cliente.
>   **27/out: a central "Relacionamento" (A1 e A2) entrou na `main` e no staging** com o OK do cliente (migração
>   `20261028120000` aplicada; o item é liberado por clínica na Matriz). **Não está na produção.**
>   **Validado pelo cliente no staging em 27/out.**
>   **28/out: CRM B0 na `main` e no staging** (decisão D12: o texto das conversas fica no app do WhatsApp; o
>   RecepClinic não guarda o que o paciente escreve nem o que a recepção responde, e o texto já guardado foi apagado
>   no staging; B1 e B2 saíram do plano). **Não está na produção** (a migração 2 apaga para sempre o texto guardado:
>   só com autorização explícita). B0 validada no staging. A etapa C (registro do contato) foi feita e desfeita a pedido do cliente;
>   no lugar, **documentos, anotações e lembretes do paciente**: **P1 Documentos** (foto ou PDF na aba "Documentos" da
>   ficha; para todas as clínicas) e **P2 Anotações** (aba "Anotações" no lugar das Observações) **no staging em
>   28/out**. **Não está na produção.** Próximo do CRM: validação da P2 no staging e a P3 Lembretes, por `docs/crm.md`.
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
>     clínica de teste "Consultorio de Teste" no staging (nome conferido em 12/out). ~~Nunca verificar esse número em app
>     nenhum~~ **(revisto pelo cliente em 27/out: o número passa para o app WhatsApp Business e volta por coexistência,
>     parte P do [`staging.md`](staging.md))**. Roteiro antigo na parte E.
>   - **Staging:** `https://teste.recepclinic.com.br` desde a F10 (`app.` é a produção; ver [`producao.md`](producao.md)) (Vercel publica a cada push na `main`);
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
>   `20261022130000_metricas_contas.sql`). **M4 (aba Desempenho, filtros de serviço e local, matriz com um item só)
>   implementada e publicada no staging em 22/out** (migração `20261022140000_metricas_matriz.sql`). **M5 (Agendamento digital,
>   estados, celular, quantidade em Retomar contato) implementada, testada
>   ([relatório](auditoria-frontend/redesign-metricas-report.md), 2 falhas Baixas corrigidas) e publicada no staging
>   em 22/out** (sem migração). **Redesign das Métricas todo implementado e dado como validado pelo cliente em 22/out**
>   (ele confere no staging e traz os ajustes, se houver). **Fim da sessão de 22/out. Retomar daqui (próxima sessão):**
>   o cliente passa um novo ajuste. Pendentes do redesign: ajustes que vierem da conferência no staging (limitações no
>   [plano](plano.md)). **Limpeza das Métricas feita e publicada no staging em 22/out** (itens antigos da matriz fora
>   do banco, migração `20261023120000_metricas_limpeza.sql`, e as funções antigas de `metrics.ts` fora do código);
>   **validada pelo cliente em 22/out**. **Tempo das Métricas medido e corrigido em 22/out** (66 mil atendimentos no
>   ano no local): RLS linha a linha e o corte de 1000 linhas da API; contas com o acesso conferido na entrada (decisão
>   do cliente), Financeiro e Faltosos também no banco; com o ano inteiro, todas as abas abaixo de 0,6 s (Desempenho
>   era 8 s, Financeiro 107 s); migração `20261023130000_metricas_acesso_na_entrada.sql` aplicada e **publicado no
>   staging em 22/out** e **validado pelo cliente em 22/out** (detalhes no [plano](plano.md)).
>   **Auditoria do limite de 1000 linhas no painel (22/out):** Agenda (Dia, Semana, Mês), horários livres, turmas, selo
>   de faltas, Envios e carga da agenda leem em páginas; achado e corrigido o erro 500 da Agenda do Dia com ~200
>   pacientes (ids em lotes); sobras do agendador do piloto apagadas. Conferido com volume no local e **publicado no
>   staging em 22/out** (sem migração) e **validada pelo cliente em 22/out** (detalhes no [plano](plano.md)).
>   **Comparação do Desempenho conferida em 22/out** (última pendência do redesign): no staging só aparece a partir de
>   meados de novembro (clínicas criadas em outubro); no local, os números do período anterior e as variações batem com
>   o banco e a regra do "Sem comparação" está certa (detalhes no [plano](plano.md)). Sem mudança de código.
>   **Revisão do Roteiro de vendas (cliente, 22/out):** proposta aprovada (sem o Financeiro) e implementada,
>   conferida no local em 1280 e 360px (detalhes no item 9c do [plano](plano.md)), **validada pelo cliente e
>   publicada no staging em 23/out** (sem migração). **Fim da sessão de 23/out. Retomar daqui (próxima
>   sessão):** o cliente traz novos ajustes. Seguem em aberto, para quando ele escolher: a Agenda do
>   Mês mais rápida numa clínica muito cheia e a sessão da nota fiscal.
  **Ajustes de 23/out:** "Sem lembrete" fora do cartão "Faltas pela resposta ao lembrete" (publicado no staging em
  23/out, sem migração). **Reenvio automático de envios com falha técnica:** 5 decisões do cliente no
  [plano](plano.md) (todos os automáticos, 10 e 30 minutos, falha tardia também, sem aviso extra); mais 2 decisões em 23/out
  (avisos, preparo e orientações também, bot fora; a vaga fica reservada durante as tentativas). **Implementado,
  testado, migração `20261023140000_reenvio_automatico.sql` aplicada e conferida no staging, publicado e dado como
  validado pelo cliente em 23/out.** **Fim da sessão de 23/out (2ª). Retomar daqui (próxima sessão):** o cliente
  traz novos ajustes; seguem em aberto a Agenda do Mês mais rápida numa clínica muito cheia e a sessão da nota fiscal.
  **Links na legenda do funil (cliente, 23/out):** em Métricas › Agendamento digital, "x barradas pela regra" e "x por
  horário ocupado" sublinhados, com link para os cartões "Barradas pelas regras" e "Erros técnicos"; os destinos das
  Métricas param abaixo da barra de abas fixa (no celular, ela cobria o título). Publicado no staging em 23/out (sem
  migração) e **validado pelo cliente em 23/out**.
  **Ajuda contextual em toda a aplicação (pedido do cliente, 23/out):** Etapas 1 a 6 feitas e aprovadas em 23/out
  (diagnóstico, padrão dos 5 tipos, componentes, [inventário](https://claude.ai/artifact/SXkvcsAALCLhDeDApcyxnk) com
  56 pontos e a [proposta visual](https://claude.ai/artifact/MjDsWH1x5HugKCcxZeUsP1)); tudo em
  [`ajuda-contextual.md`](ajuda-contextual.md). **Fim da sessão de 23/out (3ª). Retomar daqui (próxima sessão):**
  Etapa 7, implementação aprovada pelo cliente: primeiro os componentes compartilhados (`HelpTip`, `Field`,
  `HowItWorks`, `EmptyState`, `scripts/helpTips.ts`) e as mensagens genéricas de `formAction.ts`; depois os pontos de
  prioridade Alta, módulo a módulo, cada parte testada no navegador e publicada no staging. Os 21 textos marcados
  "conferir na implementação" só vão para a tela depois de conferidos no arquivo indicado.
  **Etapa 7a (componentes e catálogo) implementada e testada no local em 23/out**, com os pilotos no Tipo
  de Serviços e na Lista de espera (detalhes em [`ajuda-contextual.md`](ajuda-contextual.md)); publicada no staging
  (sem migração). **O cliente valida a Etapa 7 inteira no fim** (23/out): 7b e 7c seguem sem parar, cada parte
  publicada no staging. **7b (mensagens do sistema e o erro embaixo de cada
  campo) implementada e publicada no staging em 23/out** (sem migração). **7c (os 22 pontos de prioridade Alta: Agenda,
  Configurações, Pacientes, Financeiro e Métricas) implementada, conferida no local e publicada no staging em
  23/out** (sem migração; detalhes e as correções feitas na conferência em [`ajuda-contextual.md`](ajuda-contextual.md)).
  **Etapa 7 toda publicada. Pontos de prioridade Média (pedido do cliente, 23/out) também publicados no staging em
  23/out** (sem migração; um commit por módulo; detalhes em [`ajuda-contextual.md`](ajuda-contextual.md)).
  **Pontos de prioridade Baixa (pedido do cliente, 23/out) publicados no staging em 23/out** (sem migração); o
  inventário fica todo atendido (a tela WhatsApp do Suporte ficou sem mudança, como o inventário previa).
  **Retomar daqui:** o cliente valida a ajuda contextual inteira (Alta, Média e Baixa) no staging e traz os ajustes.
  Na próxima sessão o cliente também traz um pedido novo (23/out).
  **Entrada do bot com atendimento marcado (especificação do cliente, 23/out):** depois das boas-vindas, com
  atendimento marcado no número, pergunta se é sobre ele; data de nascimento antes de qualquer detalhe; ações do
  atendimento escolhido. Implementada e testada no local (sem migração; detalhes e 4 pendências na seção "Entrada do
  bot com atendimento marcado" do [plano](plano.md)); **publicada no staging em 23/out** (commit `078521a`, sem migração); o cliente valida lá. No teste, a lista das
  ações não chegou (erro 131000 da Meta) e um toque na lista antiga virou "Remarcar": corrigido (opções em texto quando
  a Meta recusa; toque de outro passo não vale) e publicado no staging em 23/out. Depois, "Confirmar presença" da
  entrada dava "não está mais ativo" sem lembrete enviado: corrigido e publicado no staging em 23/out. Regra nova do
  cliente (23/out): toque numa lista ou botões de uma mensagem anterior responde "Não entendi" e o menu inicial, em
  todo o bot; publicado no staging em 23/out (commit `26e5107`). **Entrada do bot validada pelo cliente em 24/out.**
  **4 pendências da entrada do bot decididas pelo cliente em 24/out** (seção do [plano](plano.md)): data de nascimento
  sempre também em Consultas/Exames › Remarcar, Cancelar e Encaixe; menu, textos e lembrete ficam como estão. E, na data
  errada (entrada e menu), sem bloqueio: "Não encontramos agendamentos para essa data de nascimento. Deseja falar com a
  recepção?" com Falar com a recepção, Tentar outra data e Voltar ao menu (sem coexistência, sem a recepção).
  Implementado, testado no local e publicado no staging em 24/out (sem migração, commit `b26f823`). **Retomar daqui:** o
  cliente deu o ok em 24/out (o Remarcar com um atendimento só fica sem o "é esse?").
  **Meta aprovou a Análise do App e a Verificação do acesso (cliente, 24/out): RecepClinic é Tech Provider.** A F11
  pausa; volta a F8 (depois a F10). Subetapas F8.0 a F8.4 e 4 decisões do cliente na F8 do [plano](plano.md)
  (Administrador conecta com o Suporte junto; coexistência e número novo; sem guardar o histórico; Suporte marca a
  forma de pagamento). **Fim da sessão de 24/out. Retomar daqui (próxima sessão):** F8.0, começando por conferir
  na documentação atual da Meta as telas e os parâmetros do Embedded Signup com coexistência e, depois, o roteiro da
  configuração na Meta para o cliente. **F8.0 (25/out):** documentação da Meta conferida (resumo na F8 do
  [plano](plano.md)) e roteiro do cliente na parte N do [`staging.md`](staging.md); **passos 1 a 4 feitos pelo cliente em
  25/out** (configuração com token sem validade, domínio, 4 campos novos do webhook, `WHATSAPP_ES_CONFIG_ID` na
  Vercel e Redeploy). Login do analista da Meta bloqueado em 25/out (com o OK do cliente; parte N do
  [`staging.md`](staging.md)). **F8.0 concluída.** **F8.1 (Conectar WhatsApp pela janela da Meta) decidida (2 decisões no
  [plano](plano.md)), implementada e testada no local em 25/out** e **publicada no staging em 25/out** (migração
  `20261025120000_conexao_embedded_signup.sql` aplicada e conferida no banco antes do push, commit `472fdbf`). O cliente
  pediu para seguir sem parar e validar a F8 inteira no fim (25/out). **F8.2 (templates na conexão) decidida (aviso no
  Início do Administrador e no cartão Conexão; [plano](plano.md)), implementada, testada no local e publicada no staging
  em 25/out (sem migração).** **F8.2b (clínica em implantação: nada sai para os pacientes até o Suporte ativar; clínica
  nova nasce assim) decidida (3 decisões no [plano](plano.md)), implementada, testada no local e publicada no staging em
  25/out** (migração `20261025140000_clinica_em_implantacao.sql`). **F8.3 (forma de pagamento conferida pelo Suporte,
  "Desconectar WhatsApp" para o Administrador e o Suporte, aviso da Meta de desconexão no Início e em Erros) decidida,
  implementada, testada no local e publicada no staging em 25/out** (migração
  `20261025160000_desconexao_e_pagamento.sql`). **Produção e testes com o WhatsApp decididos em 25/out** (5 decisões no
  [plano](plano.md), F10: produção em `app.`, staging em `teste.`, um app da Meta com desvio da conta de testes, conta no
  portfólio da clínica numa sessão com o Suporte, e o teste da coexistência na implantação do piloto, no lugar da F8.4).
  **F10.0a (código do desvio da conta de testes e textos `app.`/`teste.`) implementada, testada e publicada no staging
  em 25/out** (sem migração; detalhes no [plano](plano.md)); sem a variável `WHATSAPP_WEBHOOK_OVERRIDE_URL` na Vercel, nada
  muda. **F10.0b (staging para `teste.`):** `app.` fica no staging até a F10.0c (cliente, 25/out);
  roteiro na parte O do [`staging.md`](staging.md). **F10.0b concluída em 25/out** pelo cliente (passos 1 a 9 e 11;
  Better Stack sem mudança, staging sem monitor externo, decisão do cliente): `teste.` no ar, desvio ligado pelo
  "Testar conexão" e conferido com o bot respondendo, e-mail de senha e link de remarcação do bot em `teste.`;
  conferido pelo Claude (saúde, webhook, 7 rotinas em dia). **F10.0c (produção) decidida em 26/out** (3 decisões no
  [plano](plano.md): branch `producao`, time Pro na Vercel com os dois projetos, Supabase Pro em organização nova);
  roteiro em [`producao.md`](producao.md) (passos 1 a 11, cliente e Claude). **Retomar daqui:** o cliente segue o
  roteiro da produção; o Claude faz os passos 4 (migrações) e 6 (branch) e confere no fim. Andamento (26/out): passo 1.1 (time Pro
  `RecepClinic` na Vercel) e 1.2 (projeto do staging transferido para o time) feitos; 1.3 e 1.4 (publicação no time
  conferida, trava `main` no staging); passo 2 (organização `RecepClinic Produção` Pro, projeto
  `recepclinic-producao` em São Paulo, com Legacy JWT Secret; `.env.production` conferido); passo 3 (chave
  `producao-smtp`, login no SMTP conferido); passo 4 (63 migrações aplicadas, sem seed; estrutura igual à do staging:
  57 tabelas, 205 políticas, 9 rotinas, 2 buckets; banco vazio). Passos 5 a 11 feitos em 26/out: Auth da produção (cadastro
  fechado, conferido pela API), branch `producao` (commit `1a4f09e`), projeto `recepclinic-producao` na Vercel (só
  Production, publica a `producao`), agendador, `app.` passado para a produção (TXT `_vercel` de verificação),
  `app.` tirado do Supabase do staging, login do Suporte e e-mail de senha conferidos. **F10.0c concluída em 26/out.**
  **Retomar daqui:** conferir o 1º backup da produção (27/out, *Database › Backups*); depois, o piloto (clínica do
  consultório pela "Nova clínica" na produção, configuração, agenda atual, sessão de conexão com o Suporte, forma de
  pagamento, templates, coexistência e ativação). Seguem pendentes de validação no staging: F8.1, F8.2, F8.2b, F8.3 e
  a ajuda contextual. **Publicar na produção:** validado no staging, migrações novas na produção (simulação → aplicar
  → conferir) e `git push origin main:producao`. **Piloto (decisões de 26/out no [plano](plano.md)):** primeiro uma clínica de
  testes **permanente e ativa** na produção, com um 2º número de testes do cliente (já no WhatsApp Business); depois,
  a Dra. Ana Karina; e um roteiro compartilhável para as clínicas passarem o WhatsApp comum para o Business.
  **Etapa A feita em 27/out:** roteiro [Como passar o seu WhatsApp para o WhatsApp Business](https://claude.ai/artifact/8AXZMSLcEq8SMWFpYHaraq)
  (documento compartilhável no claude.ai: antes de começar, Android, iPhone, perfil da clínica, o que muda com a
  coexistência, cuidados e perguntas frequentes); a pedido do cliente (27/out), também **um roteiro por aparelho**:
  [iPhone](https://claude.ai/artifact/C8E3xDoshuXE3M91qeDDHq) e [Android](https://claude.ai/artifact/78hQ2cXQph4wvXHKPXexnm);
  **aguardam a revisão do cliente.** **Ordem nova (cliente, 27/out):**
  depois da A, **coexistência no staging** com o número de testes que está lá hoje; só com o staging ok na
  coexistência, a etapa **B**. **Meta (cliente, 27/out): Análise do App e Verificação do acesso aprovadas; o
  RecepClinic é Tech Provider.** **Coexistência no staging (27/out):** volta para a **Consultorio de Teste** (cliente),
  num portfólio próprio da clínica de teste; roteiro na parte P do [`staging.md`](staging.md). **Conectada e testada em 27/out** (eco, pausa,
  `#bot`, forma de pagamento); falta o lembrete com botões quando a Meta aprovar os 18 templates da conta nova; depois,
  a etapa **B**. **F8.5 Atendimento humano** (cliente, 27/out: manter a coexistência e acompanhar pelo RecepClinic o que
  precisa da clínica; decisões e subetapas no [plano](plano.md), [canvas](https://claude.ai/artifact/TGSF8DVMczXShqMpCuVjDw)):
  **F8.5a validada em 27/out**; **F8.5b (Horário da recepção) validada em 27/out**; alerta no Início das conversas que não
  voltaram ao bot validado em 27/out; **F8.5c (notificações) validada no staging em 27/out** (iPhone, com o app na Tela de
  Início sem o "X"). **F8.5a a F8.5c publicadas na produção em 27/out** (`793587f`, 3 migrações; registro em
  [`producao.md`](producao.md)); chaves de notificação da produção na Vercel (cliente, 27/out); **F8.5d (bot que não
  entende) e o ajuste da notificação (abre a tela Atendimento e o WhatsApp pelo aplicativo) validados no staging em
  27/out: F8.5 toda validada**; **F8.5 toda publicada na produção em 27/out** (`af0902d`; registro em
  [`producao.md`](producao.md)); depois F8.5c (notificações) e F8.5d (bot que não entende). Depois, **B** (clínica de testes na produção com o 2º número do cliente, já no WhatsApp Business; valida F8.1, F8.2b e
  F8.3) e **C** (piloto real com a Dra. Ana Karina). Também: conferir o 1º backup da produção (27/out). **Pendente de validação do cliente no staging (no fim, como pedido):** F8.1, F8.2, F8.2b
  e F8.3. Seguem também a validação da ajuda contextual (Alta, Média e Baixa).
>   Banco local com os dados fictícios das Métricas (`npm run db:reset` limpa). Em paralelo,
>   aguardar a Meta (Análise do App até ~29/out).
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

## Correções antes da produção (28/out/2026)

- **C1 Exame em paralelo** (cliente, 28/out): não dava para marcar consulta ou retorno no horário de um exame.
  Regra do cliente: exame fica em paralelo com qualquer serviço, até com outro exame (decidido pelo cliente na
  mesma data); bloqueios e feriados valem para todos. Causa: a trava `appointments_no_overlap` só deixava de fora a
  turma de exame, e `loadBusy` contava todo atendimento como ocupado. Migração `20261030120000_exame_em_paralelo`
  (coluna `is_exam` copiada da categoria do serviço, preenchida nos atendimentos antigos sem gatilhos; trava sem os
  exames); `loadBusy` sem exames e, para marcar exame, só bloqueios; importação da agenda igual. Staging: migração
  aplicada e conferida (18 exames marcados) em 28/out.
- **C2 Outro horário** (cliente, 28/out): a equipe da clínica marca e remarca em qualquer dia e hora, pelo
  "Outro horário" abaixo da lista de sugestões (Marcar e Remarcar). Decisões do cliente: liberados fora do horário de
  atendimento, fora da sequência de horários (aviso de buraco na agenda), retorno fora das 4 sugestões, sem o
  intervalo da agenda e feriado, todos com aviso e confirmação ("Marcar assim mesmo"); continuam travados horário
  passado, bloqueio, outro atendimento no mesmo horário (exame em paralelo), duplicidade e vaga da turma. Bot e link
  público seguem só com a lista. `checkFreeTime` (slots.ts), `anyTime`/`acceptedWarnings` em `bookAppointment` e
  `rescheduleAppointment` (só a rota da equipe passa), componente `OtherTime.astro`. Série já aceitava qualquer
  horário (só pula feriado, bloqueio e conflito). Sem migração. Staging em 28/out.
- **C3 Horário de exame** (cliente, 28/out, achado na produção): em Configurações › Horários, um horário de exame
  era recusado por cruzar com uma turma ("Cruza com um horário de turma"). Decisão do cliente: horário de exame
  (individual ou turma) cruza com qualquer outro da agenda, até o geral; só não cruza com outro do mesmo serviço.
  `findWindowConflict` recebe os exames da clínica. Sem migração. Publicada no staging e na produção de uma vez, a
  pedido do cliente (validar direto na produção).
  **Validada pelo cliente na produção em 28/out.**
- **C4 Alterar atendimento** (cliente, 28/out, achado na produção: o primeiro usuário marcou o serviço errado e não
  conseguia corrigir). Decisões do cliente: nova ação **Alterar** no cartão (o Remarcar continua só para data e hora),
  que abre o Marcar preenchido (paciente fixo) e muda serviço, agenda, local, convênio, endereço, data e hora; vale para
  qualquer atendimento menos o cancelado; WhatsApp ao paciente (e lembrete e presença zerados) só se mudar data, hora,
  agenda ou local; valor recalculado e mostrado antes ("R$ 300 → R$ 250"), pagamentos registrados não mudam (aviso se
  ficarem acima ou abaixo); série pergunta "só esta" ou "esta e as próximas"; Marcar e Alterar com janela de
  confirmação com todos os dados ("antes → depois" no que muda no Alterar) e o aviso "O paciente receberá uma mensagem
  no WhatsApp informando a marcação/alteração da consulta/exame", escondido na clínica em implantação. Assumido (cliente
  pode mudar): aviso também escondido sem WhatsApp conectado; no atendimento passado, data e hora mudam sem conferir
  horário nem mandar mensagem; nota fiscal emitida não muda; toda alteração na Trilha.
  Etapas: **C4.1** confirmação completa no Marcar; **C4.2** Alterar futuro avulso (função no banco, valor, aviso,
  Trilha); **C4.3** Alterar passado (aviso de pagamento); **C4.4** série "esta e as próximas"; **C4.5** ajuda e testes;
  **C4.6** produção (com autorização).
  - **C4.1** (28/out): janela de confirmação (`ConfirmDeleteDialog` + `confirmDelete.ts`) com lista de dados
    (`data-confirm-details`, com "antes → depois" pronto para o C4.2) e aviso (`data-confirm-notice`); no Marcar:
    paciente, serviço, com quem, local, quando (na série, frequência e fim), endereço domiciliar e convênio ou valor
    (preço do local, `servicePriceAt`). `whatsappNoticeText` e `sendsPatientMessages` em `confirmText.ts`. Sem migração.
    **Validada pelo cliente no staging em 28/out.**
  - **C4.2** (28/out): ação **Alterar** no cartão (à vista, depois do Remarcar) → `marcar.astro?alterar=<id>`
    (paciente fixo; serviço, com quem, data e hora; convênio no resumo; "Manter o horário atual" escolhido de início).
    `changeAppointment` (appointments.ts): só ativo e futuro; trava de duplicidade só se mudar serviço ou agenda (o
    atendimento já em duplicidade, ex. consulta e retorno na mesma agenda, ainda pode ser corrigido); horário conferido
    como no Marcar da equipe, sem contar o próprio; endereço exigido no domiciliar; retorno religado à consulta; valor
    pelo gatilho; mudou data, hora, agenda ou local: lembrete e presença zerados e o aviso de remarcação ao paciente.
    Confirmação com "antes → depois" (`appointmentChanges.ts`). Migração `20261031120000_alterar_atendimento`: evento
    `changed` da trilha (com o que mudou; substitui o `rescheduled` quando a mudança vem do Alterar) e
    `change_group_session` (turma: vaga conferida com a janela travada). Staging: simulação → aplicação → conferência
    (função responde) em 28/out. Observação: a mudança de horário pelo Alterar não conta como "remarcado" nas Métricas.
  - **Data passada no Marcar e no Alterar** (cliente, 28/out; entra junto da **C4.3**): só pelo "Outro horário",
    até **90 dias** para trás; vira aviso na confirmação ("essa data e horário já passaram", botão "assim mesmo"), sem
    mensagem ao paciente; fica **Marcado**, com Compareceu/Faltou (pendência no Resumo do Dia); o **Remarcar** segue só
    futuro; **série** só começa no futuro ("Repetir" escondido com data passada). Continuam travados: horário ocupado,
    bloqueio e turma lotada. **Revisto pelo cliente (28/out):** a duplicidade só trava data futura (o lançamento
    no passado passa mesmo com consulta futura na mesma agenda).
  - **C4.2 validada pelo cliente no staging em 28/out.**
  - **C4.3** (28/out): `checkFreeTime` com `pastFrom` (data passada vira o aviso `PAST_WARNING`; mais de
    `PAST_LIMIT_DAYS` = 90 dias, recusada); `pastLimit` no Marcar (rota) e no Alterar (até 90 dias ou até o horário
    atual, se mais antigo). Outro horário aceita data passada no Marcar e no Alterar (o Remarcar, não), e continua
    aparecendo quando o paciente tem atendimento futuro na agenda (a duplicidade só vale no futuro, também em
    `bookAppointment` e `changeAppointment`). Série com data passada: "Repetir" some e a rota recusa. Aviso do WhatsApp
    some com data passada. Alterar vale para tudo menos o cancelado (botão no "Mais" do que já passou); com
    comparecimento registrado, a data fica no passado; lembrete e presença só zeram no ativo. Pagamento registrado com
    valor novo: a confirmação diz quanto falta ou quanto foi pago a mais (`paymentChangeNote`). Migração
    `20261101120000_alterar_passado` (`change_group_session` aceita o atendimento registrado). Staging: simulação →
    aplicação → conferência em 28/out.
    **Validada pelo cliente no staging em 28/out.**
  - **C4.4** (28/out): no Alterar de sessão de série ainda por vir, "Só esta sessão" ou "Esta e as próximas" (como no
    Remarcar). Mesmo horário: `changeSeriesDetailsFrom` (series.ts) muda a série e cada sessão ativa dali em diante no
    lugar, conferindo antes todas (com alguma ocupada, nada muda e a tela diz as datas); outro dia ou horário:
    `changeSeriesFrom` com serviço, agenda, local, endereço e convênio novos (encerra e recomeça, como no Remarcar).
    Aviso ao paciente só da primeira sessão e só se mudar dia, hora, agenda ou local. Sem migração.
    **Validada pelo cliente no staging em 28/out.**
  - **C4.5** (28/out): "Como funciona?" do Alterar (`ajuda/agenda.ts`, `comoFunciona.alterar`, no topo da tela) e a
    série citando o alterar; confirmação sem mudança mostra só "Nada foi mudado". Conferido no local em 1470 e 360px.
    Sem migração.
  - Confirmação da marcação no staging não chegou (28/out): `skipped_no_template`, os 18 templates da conta nova
    ainda em análise na Meta (não é falha da C4). Decisão do cliente: a janela de confirmação continua dizendo que o
    paciente recebe a mensagem mesmo com o template não aprovado (o aviso de salvo, depois, diz que não saiu).
  - **C4.6** (28/out): migrações `20261031120000` e `20261101120000` na produção (simulação → aplicação → conferência)
    e `main` → `producao` (`3ec78dc`). **Validada pelo cliente na produção em 28/out.**
- **C5 Horário em local que o serviço não usa** (cliente, 28/out, achado na produção: Prick test para aeroalérgenos
  com o alerta "sem horário de atendimento" tendo horário cadastrado). Causa confirmada pelo cliente: o horário do
  serviço estava num local que o serviço não usa; a tela de Horários conferia a agenda do serviço, mas não o local
  (`availability.ts`, `checkWindowService`), e o horário ficava sem valer (o bot e o link também não o ofereciam).
  Decisões do cliente: (1) horário de um serviço num local que ele não usa **salva e marca o local no serviço** (valor
  do serviço), com o aviso de salvo dizendo isso; (2) tirar do serviço um local com horário dele **avisa e pede
  confirmação**, e o horário fica **desativado** (não apagado); (3) o alerta **diz o motivo** (agenda ou local que o
  serviço não usa). Achado no caminho: na turma, o alerta aceitava horário geral, e o bot só o da turma; o alerta passa
  a seguir o bot (`setup.ts`, `fits`). Sem migração. Staging em 28/out.
  **Validada pelo cliente no staging em 28/out**; produção depois da próxima funcionalidade (pedido do cliente).
- **C6 Escolha do serviço no Marcar** (cliente, 28/out: com lista grande, fácil escolher o serviço errado). Protótipos
  A, B e C no canvas https://claude.ai/artifact/Y7spM4gyT7yvaWjuUjaqWZ; escolhida a **B**: botões do tipo (Consulta ·
  N | Retorno · N | Exame · N) e, do tipo aberto, os serviços em cartões com nome e duração ("turma" quando for).
  Decisões do cliente: **nenhum tipo vem escolhido** (com o serviço já definido, abre no tipo dele); **sem valor** no
  cartão. Busca dentro do tipo com mais de 8 serviços (filtra no navegador). `ServicePicker.astro` e
  `lib/servicePicker.ts`; parâmetro `tipo` no endereço do Marcar (vale também no Alterar). Sem migração. Staging em 28/out.
  **Validada pelo cliente no staging em 28/out.** C5 e C6 na produção em 28/out (`da2a6fc`), **validadas pelo cliente na produção**.
- **C7 Arquivo no preparo do exame** (cliente, 28/out). Decisões do cliente: o preparo continua como hoje (texto com a
  conversa aberta; modelo `rc_preparo_exame_v2` com o link, fechada); quando o exame tem arquivo, sai **depois** uma
  mensagem só com o arquivo (aberta: documento direto; fechada: **modelo novo com o arquivo**), enviada quando a Meta
  confirma a entrega do preparo; o Administrador escreve o texto (ex.: "Segue orientações para o exame:"), que passa a
  ser **obrigatório com arquivo**; **PDF, JPG ou PNG até 10 MB**; texto do modelo mínimo ("Orientações de preparo do
  exame {exame} em anexo.", a Meta exige texto e recusa variável no fim); **prévia com os dois balões** (o arquivo
  aparece ao escolher). Etapas: **C7.1** cadastro e prévia; **C7.2** envio e reenvio; **C7.3** modelo na lista do
  Suporte e Trilha; produção no fim, com autorização.
  - **C7.1** (28/out): migração `20261102120000_arquivo_do_preparo` (colunas `preparation_file_*` no serviço, com o
    texto obrigatório no banco; bucket privado `service-files` "<clínica>/preparo/<id>.<ext>"; Administrador grava e
    apaga, a equipe vê; `clinic_service` só lê o da própria clínica, com o `usage`/`select` do storage e o `execute` de
    `app.storage_folder_clinic`). `preparationFile.ts`; rota `servicos/arquivo` (link de envio de uso único: o arquivo
    sobe ao escolher, sem passar pela Vercel); `PreparationField` com o campo, "Abrir", "Tirar o arquivo" e o segundo
    balão da prévia. Staging: simulação → aplicação → conferência (colunas e bucket) em 28/out.
    **Validada pelo cliente no staging em 28/out.**
  - **C7.2** (28/out): envio do arquivo depois da entrega do preparo (`sendPreparationFileAfterDelivery`, chamado no
    webhook quando o `exam_preparation` chega ao celular; uma vez por atendimento); janela aberta: documento com a
    legenda; fechada: modelo `exam_preparation_file` / `rc_preparo_arquivo_v1` ("Orientações de preparo do exame {{1}}
    em anexo.", arquivo no topo, PDF de exemplo `preparationSamplePdf.ts` para a Meta, não personalizável). O arquivo
    sai do armazenamento com a credencial da clínica e sobe à Meta (`uploadDocument` com o tipo do arquivo; imagem vai
    como documento). "Reenviar preparo" cobre o preparo (o arquivo vem depois) ou só o arquivo que não chegou; reenvio
    automático e Trilha ("Arquivo do preparo do exame"). Migração `20261103120000_modelo_arquivo_do_preparo` (o modelo
    na lista aceita). Registro do modelo (antes previsto na C7.3) trazido para cá: sem ele a conversa fechada não envia.
    Staging: simulação → aplicação → conferência em 28/out. Observação: no staging os modelos da conta nova ainda estão
    em análise na Meta (nem a confirmação sai), então o envio real só dá para ver depois da aprovação.
    **Validada pelo cliente no staging em 28/out** (a parte que dá para ver sem a Meta).
  - **C7.3** (28/out): "i" do campo do arquivo (`configuracoes.dicas.servicoPreparoArquivo`): sai logo depois que o
    texto do preparo chega, uma vez; conversa fechada pelo modelo com o arquivo (aprovação da Meta); "Reenviar preparo".
    Sem migração. Staging em 28/out. Próximo: produção (migrações `20261102120000` e `20261103120000`), com autorização;
    na produção, o Suporte cria o `rc_preparo_arquivo_v1` na Meta para cada clínica com exames.
  - Correção (28/out, achado do cliente no staging): o envio do arquivo era bloqueado pela política de segurança (CSP,
    `default-src 'self'`); a tela do serviço passa a liberar o `connect-src` do Supabase, como a ficha do paciente; a
    prévia de imagem recém-escolhida usa `data:` (o `img-src` não libera `blob:`). O `npm run dev` não aplica o CSP.
  - **C7.4 Preparo sem link** (cliente, 28/out): o preparo sai logo depois da confirmação, então sem saudação e sem
    link. Mensagem (decisão do cliente): "Segue orientações para a realização do exame {exame}:" + as instruções +
    "Qualquer dúvida, responda esta mensagem." Conversa aberta: texto com as quebras de linha; fechada: modelo novo
    `rc_preparo_exame_v3` ({{1}} exame, {{2}} instruções numa linha, quebras viram " · "). Campo "Instruções de
    preparo" limitado a **700 caracteres** (contador; o modelo da Meta tem ~1.000 no total); texto antigo maior é cortado
    com "…" só no modelo. Quem ainda só tem a v2 aprovada (ou versão personalizada dela, 4 campos) segue com ela e o link
    (`isLegacyPreparation`, `LEGACY_PREPARATION_BODY`); ao criar a v3, ela substitui a v2 e, em análise, o preparo da
    conversa fechada fica "não enviado" (Reenviar depois). Marcadores da personalização: {exame}, {instrucoes}. Botão
    "Ver o preparo do exame" tirado da tela "Atendimento confirmado" do link de agendamento. Prévia do cadastro mostra a
    mensagem completa. `src/lib/preparationMessage.ts`. Sem migração. Staging em 28/out. Pendente de decisão: o menu de
    informações do bot ("preparo de exames") ainda manda o texto com o link.
  - **Plano revisto pelo cliente (28/out)**, depois de a Meta reclassificar o `rc_preparo_arquivo_v1` como marketing.
    Decisões: sai **uma** mensagem de preparo só: com arquivo, o modelo do arquivo **`rc_preparo_arquivo_v2`** (nome
    novo, análise nova; texto "Segue orientações para a realização do exame {exame}:" + "Estamos à disposição para
    qualquer dúvida.", o arquivo no topo, regra do WhatsApp); sem arquivo, o `rc_preparo_exame_v3` com o final "Estamos
    à disposição para qualquer dúvida."; conversa aberta com arquivo manda a mesma mensagem (documento com legenda). No
    cadastro: arquivo acima das instruções; com arquivo, as instruções ficam desabilitadas (o texto fica guardado, não é
    enviado) e a prévia mostra a mensagem exata; "Tirar o arquivo" reabilita. "i" do arquivo e das instruções sem falar
    de conversa aberta/fechada nem de link. Bot ("preparo de exames"): sem o link, manda como na confirmação. Horários:
    escolha do serviço como no Marcar (tipo e cartões), na própria tela. Etapas: **C7.5** envio único e modelos
    (migração: sai a regra "arquivo exige texto"); **C7.6** cadastro e ajudas; **C8** Horários. Implementação só com a
    autorização do cliente.
  - **C7.5 Envio único do preparo** (29/out): uma mensagem de preparo só. Com arquivo: o arquivo com "Segue orientações
    para a realização do exame {exame}:" + "Estamos à disposição para qualquer dúvida.", sem as instruções (conversa
    aberta: documento com legenda; fechada: modelo novo `rc_preparo_arquivo_v2`, que substitui a v1 na linha do modelo
    ao "Criar na Meta"; sem ele aprovado, "não enviado" e Reenviar depois, não cai no modelo do texto). Sem arquivo: o
    `rc_preparo_exame_v3` com o final "Estamos à disposição para qualquer dúvida." (a v3 ainda não existia na Meta do
    staging). Tudo como `exam_preparation` (o segundo envio `exam_preparation_file` e o `sendPreparationFileAfterDelivery`
    saíram); "Reenviar preparo" e o reenvio automático cobrem o arquivo. Bot ("preparo de exames"): sem o link, manda
    como na confirmação (o arquivo, ou o texto); exame só com arquivo também aparece. Migração
    `20261104120000_preparo_arquivo_sem_texto` (sai `services_preparation_file_needs_text`) e a mesma regra tirada da
    tela do serviço. Staging: simulação → aplicação → conferência em 29/out. As ajudas ("i") ficam para a C7.6. **Validada pelo cliente no
    staging em 29/out.**
  - **C7.6 Cadastro e ajudas** (29/out): na tela do exame, o arquivo vem acima das "Instruções de preparo". Com arquivo,
    as instruções ficam só leitura e acinzentadas (`readonly`, não `disabled`: o texto continua guardado ao salvar),
    com o aviso "Com arquivo, as instruções não são enviadas…"; a prévia mostra só o arquivo com o início e o final
    (`preparationFileCaption`). "Tirar o arquivo" reabilita na hora e a prévia volta ao texto. "i" das instruções e do
    arquivo reescritos sem conversa aberta/fechada nem link (o bot também manda). `PreparationField.astro`,
    `ajuda/configuracoes.ts`. Sem migração. Conferida no local (escolher, salvar, texto guardado, tirar); publicada no
    staging em 29/out. **Validada pelo cliente no staging em 29/out.**
- **C8 Escolha do serviço em Horários** (29/out): como no Marcar (C6), tipo e cartões, mas na própria tela, sem
  recarregar (o formulário já tem dias e horas). "Qualquer serviço" (valor `todos`) é o primeiro botão da fila dos tipos
  (decisão do cliente, 29/out) e esconde os cartões; trocar de tipo tira a escolha de fora dele, como no Marcar. Nenhum
  tipo vem aberto; na edição e no "Cadastrar os horários" do serviço, abre no tipo dele. Busca com mais de 8 serviços;
  "turma" e "desativado" no cartão; as vagas aparecem com o cartão de turma. `config/ServiceChoice.astro`; estilos do
  botão e do cartão em `lib/servicePicker.ts` (os dois usam). Sem migração. Conferida no local (escolher, Qualquer
  serviço, salvar, editar); publicada no staging em 29/out.
