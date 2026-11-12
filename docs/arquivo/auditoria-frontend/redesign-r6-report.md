# Relatório de testes de interface: R6 (Pacientes e Ficha)

## 1. Resumo da execução

- **Data:** 2026-10-16
- **Executado por:** Claude (skill `playwright-ui-form-best-practices`), a pedido do cliente
- **Resultado geral:** 3 falhas (todas Baixas), 4 bloqueios
- **Síntese:** os 11 "Voltar" testados levam à tela de origem, com a busca, a aba e a origem anterior
  preservadas. Nos 6 formulários testados com erro do servidor, nenhum campo se perdeu, e os cartões
  com "Editar" reabrem sozinhos no erro, com o foco no campo errado. O "Editar" funciona também sem
  JavaScript. As falhas são de acessibilidade:
  - no celular, o campo com erro recebe o foco, mas fica coberto pelas barras fixas;
  - no computador, os títulos dos cartões entram na ordem de tabulação sem fazer nada;
  - no Cadastrar, o erro do servidor fica no topo, sem marcar o campo (já era assim antes da R6).

| Status | Quantidade |
| --- | --- |
| PASSOU | 28 |
| FALHOU | 3 |
| BLOQUEADO | 4 |
| NÃO APLICÁVEL | 0 |
| **Total executado** | 31 (mais 4 bloqueados) |

## 2. Ambiente

- **URL base:** `http://localhost:4321` (servidor `npm run dev` do cliente)
- **Ambiente:** local, banco do seed (Supabase local). Gravação **autorizada pelo cliente** só no
  local, com limpeza no fim. Antes dos testes, foi feito um snapshot das tabelas `patients`,
  `contacts`, `patient_finance` e `contact_finance`. Depois da limpeza, as tabelas foram comparadas
  com o snapshot e ficaram iguais (fora as datas de atualização). Anonimizar e Bloquear no bot não
  foram executados.
- **Navegador e viewport:** Chromium (MCP Playwright), 1280×900 e 390×844, com e sem JavaScript
- **Versão/commit da aplicação:** `93c6520`
- **Usuários de teste:** Administrador, Recepção, Profissional (pediatra) e Suporte da "Clínica Exemplo
  Saúde"; Administrador da "Odonto Exemplo" (isolamento). Logins do seed, sem senhas neste relatório.

## 3. Escopo

- **Incluído:**
  - Pacientes (`/admin/pacientes`): lista, busca, "Mostrar desativados" e a aba Responsáveis;
  - a ficha (`/admin/pacientes/[id]`): abas, cartões com "Editar", "Mais" e selos;
  - Cadastrar (`/admin/pacientes/novo`);
  - a página do responsável (`/admin/pacientes/contato/[id]`);
  - celular, sem JavaScript e os perfis.
- **Fora do escopo:** Marcar, Pagamento e Trilha, a não ser como destino e origem do "Voltar".

## 4. Ferramentas utilizadas

- MCP Playwright (exploração, com `browser_run_code` para medir valores, foco e ordem de tabulação).
  O projeto não tem `@playwright/test`; não foram criadas specs.
- `psql` e `pg_dump` no contêiner do banco local, para conferir o que foi gravado, limpar e comparar.

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| NAV-01 | Pacientes (busca "Souza") › ficha › Voltar | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-02 | Ficha › aba "Anteriores e cancelados" › Voltar | Retorno à lista (as abas não prendem o Voltar) | Obrigatório | PASSOU | — |
| NAV-03 | Ficha (aba Anteriores) › Trilha › Voltar | Volta à ficha na mesma aba | Obrigatório | PASSOU | — |
| NAV-04 | Ficha › responsável (link no cabeçalho) › Voltar | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-05 | Responsável › paciente › Voltar | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-06 | Responsável › Cadastrar outro › Voltar | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-07 | Responsável › Mais › Bloquear no bot… › Cancelar › Voltar | Cartão fecha; Voltar mantém a origem | Obrigatório | PASSOU | — |
| NAV-08 | Pacientes (busca) › Cadastrar paciente › Voltar | Busca preservada | Obrigatório | PASSOU | — |
| NAV-09 | Ficha › Marcar › Voltar | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-10 | Ficha › pagamento (cartão Pagamentos) › Voltar | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-11 | Ficha › Abrir na Agenda | Abre a Agenda no dia do atendimento | Obrigatório | PASSOU | — |
| FORM-01 | Ficha › Financeiro: CPF de "Outra pessoa" inválido | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-02 | Ficha › Dados: nome só com espaços | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-03 | Responsável › Dados: WhatsApp "123" | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-04 | Responsável › Financeiro: CPF inválido | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-05 | Cadastrar: WhatsApp "123", com os 9 campos preenchidos | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-06 | Cadastrar: "O próprio paciente" com 11 anos | Preservação dos campos | Obrigatório | PASSOU | — |
| QA-01 | Envio duplo no Cadastrar (3 cliques seguidos) | Prevenção de duplicidade | Adicional | PASSOU | — |
| QA-02 | Celular: o campo com erro fica à vista? | Foco no campo inválido | Adicional | FALHOU | Baixa |
| QA-03 | Cadastrar: o erro do servidor marca o campo? | Associação mensagem↔campo | Adicional | FALHOU | Baixa |
| QA-04 | Mais › Desativar (com confirmação) e Reativar | Ação e aviso | Adicional | PASSOU | — |
| QA-05 | Mais › Anonimizar: só o diálogo, depois "Voltar" | Confirmação antes da ação | Adicional | PASSOU | — |
| QA-06 | Computador: ordem de tabulação na ficha | Teclado | Adicional | FALHOU | Baixa |
| QA-07 | "Editar" pelo teclado (Enter) e "Cancelar" | Teclado e foco | Adicional | PASSOU | — |
| QA-08 | Sem JavaScript: Editar, Salvar, Cancelar; celular | Funciona sem JS | Adicional | PASSOU | — |
| QA-09 | Plano: passar para Particular | Envio válido | Adicional | PASSOU | — |
| QA-10 | Selos "Pago" e "Nota nº" (João Souza) | Dados novos da R6 | Adicional | PASSOU | — |
| QA-11 | Lista: busca sem resultado; "Mostrar desativados" | Estados da lista | Adicional | PASSOU | — |
| QA-12 | Celular: cartões recolhidos, "Marcar" só na barra, sem rolagem lateral | Larguras de tela | Adicional | PASSOU | — |
| QA-13 | Perfis (Recepção, Profissional, Suporte) e outra clínica | Permissões e isolamento | Adicional | PASSOU | — |
| QA-14 | Console e respostas HTTP no fluxo | Sem erros e sem 5xx | Adicional | PASSOU | — |

### 5.1 Aprovados

- **NAV-01 a NAV-11:** cada "Voltar" leva à URL de origem exata, com a busca (`q=Souza`), a aba
  (`atendimentos=anteriores`) e a origem anterior (`volta` aninhado) preservadas. Em cada caso,
  conferi também o título da tela. O "Cancelar" do bloqueio fecha o cartão e mantém o "Voltar".
- **FORM-01:**
  - Valores conferidos antes e depois: CPF do paciente, "Outra pessoa", nome, CPF de quem paga,
    CPF do responsável, outro WhatsApp, e-mail e "Enviar sempre": todos iguais.
  - O cartão reabriu no modo "Editar", o campo errado ficou com `aria-invalid` e
    `aria-describedby`, e o foco foi para ele.
  - Corrigido só o CPF, o novo envio salvou ("Dados financeiros salvos.") e o cartão voltou ao
    modo leitura, já com os dados novos.
  - Evidência: [`R6-FORM-01.png`](evidencias/R6-FORM-01.png).
- **FORM-02 a FORM-04:** o mesmo comportamento: valores iguais, cartão reaberto, campo marcado, foco
  nele e o novo envio salvo corrigindo só o campo errado.
- **FORM-05 e FORM-06:**
  - Os 9 campos foram preservados: nome, nascimento, observações, "Um responsável", nome do
    responsável, WhatsApp, plano, carteirinha e validade.
  - No FORM-06, "O próprio paciente" continuou marcado e o nome do responsável escondido.
  - Corrigido só o WhatsApp, o paciente foi cadastrado e a tela abriu a ficha dele. O "Voltar" da
    ficha levou à busca de origem.
- **QA-01:** três cliques seguidos em "Cadastrar paciente" gravaram 1 paciente (conferido no banco).
- **QA-04 e QA-05:**
  - "Desativar" pede confirmação. Depois de desativar, a ficha mostra o selo "Desativado" e o
    "Marcar" some; "Reativar" volta ao normal.
  - O diálogo de Anonimizar mostra o texto completo (o que será apagado, que não dá para desfazer)
    e fecha com "Voltar", sem gravar.
- **QA-07:** Enter no "Editar" abre o formulário, e o Tab seguinte vai para "Nome". "Cancelar" desfaz
  o que foi digitado, fecha o formulário e devolve o foco ao "Editar".
- **QA-08:**
  - Sem JavaScript: "Editar" abre o formulário, "Salvar" grava e "Cancelar" (um link) recarrega a
    tela fechada.
  - No celular, sem JavaScript, os cartões ficam abertos.
- **QA-10:**
  - Atendimentos anteriores: "Cancelado" e "Compareceu" com o selo "Pago".
  - Pagamentos: "R$ 300,00 · Pix", com o selo "Nota nº 1".
- **QA-11:**
  - Busca sem resultado: "Ninguém encontrado para "Zeca"", com "Limpar a busca" e "Cadastrar
    paciente".
  - "Mostrar desativados" vale assim que é marcado, mantém a busca e sai da URL ao desmarcar.
- **QA-12:**
  - No celular, os 4 cartões começam recolhidos e o "Marcar" aparece só na barra fixa.
  - A página não rola de lado (`scrollWidth` igual à largura).
  - Um erro reabre só o cartão dele.
- **QA-13:**
  - **Recepção:** "Editar" em Dados, Plano e Financeiro; "Mais" só com Desativar (sem Anonimizar);
    no responsável, sem Liberar e sem Bloquear.
  - **Profissional:** sem Financeiro e sem Pagamentos; vê só os atendimentos da própria agenda (2
    de 3).
  - **Suporte:** Financeiro sem "Editar"; Anonimizar, Liberar e Bloquear no "Mais".
  - **Administrador da outra clínica:** a ficha e o responsável voltam para a lista (isolamento).
- **QA-14:** nenhum erro no console e nenhuma resposta 5xx nas telas e nos envios testados.

### 5.2 Falhas

Ver a seção 6.

### 5.3 Bloqueios

- **BLQ-01 · Anonimizar (executar):** não dá para desfazer. Só o diálogo foi conferido (QA-05).
- **BLQ-02 · Bloquear no bot (executar):** cancela os atendimentos futuros do seed. O cartão, o
  motivo, a opção de cancelar e o "Cancelar" foram conferidos (NAV-07).
- **BLQ-03 · "Revisado" e o aviso "Para revisar":** nenhum contato do seed atingiu um limite do bot.
- **BLQ-04 · Telas de anonimizado e de bloqueado:** o seed não tem paciente anonimizado nem contato
  bloqueado.

### 5.4 Não aplicáveis

- Nenhum.

## 6. Achados

### 6.1 Defeitos confirmados

#### QA-02 · Celular: o campo com erro recebe o foco, mas fica atrás das barras fixas

- **Severidade:** Baixa
- **Página ou fluxo:** ficha do paciente, cartão Financeiro, no celular (390×844)
- **URL:** `/admin/pacientes/[id]?volta=…`
- **Critério avaliado:** qualidade adicional (foco no campo inválido)
- **Pré-condições:** paciente ativo (a barra "Marcar" aparece embaixo, sobre o menu do celular)
- **Passos executados:**
  1. Abrir o cartão Financeiro, tocar em "Editar" e digitar o CPF `000.000.000-01`.
  2. Tocar em "Salvar dados financeiros".
- **Resultado esperado:** a tela volta com o erro e o campo do CPF à vista, com o foco nele.
- **Resultado observado:**
  - O foco foi para o CPF (`fin_cpf`), mas a página ficou no alto (`scrollY = 0`).
  - O campo ficou a 799px do topo, numa tela de 844px: atrás da barra do "Marcar" e do menu de
    baixo, que juntos ocupam uns 130px.
  - O navegador não rolou porque, para ele, o campo já estava na tela. Ao digitar, a pessoa não vê
    o campo.
  - No computador, o campo ficou à vista (677px de 900px).
- **Campos perdidos:** nenhum.
- **Impacto:** quem corrige o erro no celular precisa rolar para achar o campo. O aviso no alto diz
  qual é o erro.
- **Evidência:** [`R6-QA-02.png`](evidencias/R6-QA-02.png) (o aviso no alto, o campo coberto)
- **Recomendação:** reservar o espaço das barras na rolagem do celular, com `scroll-padding-bottom`
  no `html` (por volta de 150px abaixo de 640px), ou rolar o campo até o meio da tela
  (`scrollIntoView({ block: "center" })`) antes do foco em `pointToError`. Isso vale para todo
  formulário de tela com a barra fixa (o Pagamento também tem uma).

#### QA-06 · Computador: os títulos dos cartões entram na ordem de tabulação sem fazer nada

- **Severidade:** Baixa
- **Página ou fluxo:** ficha do paciente e página do responsável, no computador (1280px)
- **Critério avaliado:** qualidade adicional (teclado e ordem de tabulação)
- **Passos executados:**
  1. Pôr o foco em "Marcar" e apertar Tab 8 vezes.
- **Resultado esperado:** o Tab passa pelos controles que fazem algo: "Editar" de cada cartão.
- **Resultado observado:**
  - A sequência foi: Próximos, Anteriores e cancelados, **Dados**, Editar: Dados, **Plano de
    saúde**, Editar: Plano de saúde, **Financeiro**, Editar: Financeiro.
  - O título de cada cartão é o `<summary>` que recolhe o cartão no celular. No computador, o
    clique nele é anulado, mas ele continua recebendo o foco (`tabIndex 0`) e é lido como um botão
    que abre e fecha.
  - São 4 paradas a mais na ficha e 3 na página do responsável.
- **Impacto:** quem usa o teclado ou um leitor de tela passa por paradas que não fazem nada.
- **Evidência:** a sequência acima (medida com `document.activeElement` a cada Tab)
- **Recomendação:** no computador, tirar o título da tabulação (`tabindex="-1"` posto pelo script do
  `EditCard` quando a tela tem 1024px ou mais, e devolvido abaixo disso), ou usar um botão próprio
  para recolher no celular, deixando o título como texto.

#### QA-03 · Cadastrar: o erro do servidor fica no topo, sem marcar o campo

- **Severidade:** Baixa (já era assim antes da R6; limitação registrada na auditoria, A-02)
- **Página ou fluxo:** Cadastrar paciente
- **URL:** `/admin/pacientes/novo?volta=…`
- **Critério avaliado:** qualidade adicional (associação mensagem↔campo)
- **Passos executados:**
  1. Preencher todos os campos, com o WhatsApp `123`, e tocar em "Cadastrar paciente".
- **Resultado esperado:** o campo WhatsApp marcado (`aria-invalid`, ligado à mensagem) e o foco nele,
  como nos cartões da ficha e no aviso do número já cadastrado (que a R6 pôs junto do campo).
- **Resultado observado:**
  - A mensagem "Telefone inválido: informe DDD + número." aparece no topo da tela.
  - Nenhum campo ficou com `aria-invalid`, e o foco foi para a mensagem.
  - O mesmo vale para "Paciente menor de 18 anos precisa de um responsável" (FORM-06).
  - Os valores foram todos preservados.
- **Impacto:** em formulário longo, a mensagem fica longe do campo. É inconsistente com o resto da
  R6.
- **Evidência:** [`R6-FORM-05.png`](evidencias/R6-FORM-05.png)
- **Recomendação:** como a tela recebe o próprio envio, usar os campos do `DataError` (os mesmos que
  as rotas `/api/admin/...` mandam) para marcar o campo no servidor:
  - pôr `aria-invalid` e `aria-describedby` no campo;
  - mostrar a mensagem embaixo dele, como o aviso do número já cadastrado;
  - pôr `data-fields` na mensagem, para o `keepFormValues` pôr o foco no campo.

### 6.2 Suspeitas

- Nenhuma.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Anonimizar (executar) | Irreversível (BLQ-01) |
| Bloquear no bot (executar) e Desbloquear | Cancela atendimentos do seed (BLQ-02) |
| "Revisado", "Liberar dos limites" (executar) e o aviso "Para revisar" | Sem contato com limite atingido no seed (BLQ-03); "Liberar" mudaria a regra do bot para o contato |
| Ficha de anonimizado e responsável bloqueado | Sem esses dados no seed (BLQ-04) |
| Paginação da lista (mais de 20) | O seed tem 4 pacientes; os links "Anterior" e "Próxima" não aparecem |
| Leitor de tela real | Só a árvore de acessibilidade do navegador e os atributos |

## 7. Limitações

- Testes no ambiente local com o seed, não no staging.
- Um erro do servidor só foi provocado com os dados que o servidor recusa (CPF, telefone, nome vazio,
  menor sem responsável). O navegador barra os campos obrigatórios vazios antes do envio.
- O teste de "Mostrar desativados" não teve paciente desativado no momento (só a URL e a busca foram
  conferidas). O selo "Desativado" foi visto na ficha (QA-04).

## 8. Evidências

- **Local:** `docs/auditoria-frontend/evidencias/` (como nos relatórios anteriores)
- **Arquivos:** `R6-FORM-01.png`, `R6-FORM-05.png`, `R6-QA-02.png`
- **Dados sensíveis:** só dados fictícios do seed e de teste ("Teste QA 05", "Resp QA 05",
  `qa01@teste.local`, CPFs de teste). Nenhuma senha, token ou cookie nas capturas. Os pacientes, os
  contatos e os dados financeiros de teste foram apagados do banco local, e os dados alterados
  voltaram ao valor do seed.

## 9. Recomendações

1. **QA-02:** reservar o espaço das barras fixas na rolagem do celular, para que o campo com erro
   fique à vista. Vale também para o Pagamento.
2. **QA-06:** tirar os títulos dos cartões da tabulação no computador.
3. **QA-03:** mostrar os erros do Cadastrar junto do campo, como no resto da R6.

## 10. Correções (16/out, a pedido do cliente)

As 3 falhas foram corrigidas e retestadas no navegador local, sem gravar dados (os dois envios do
Cadastrar foram recusados pelo servidor, como esperado).

| Achado | O que mudou | Arquivos | Reteste |
| --- | --- | --- | --- |
| QA-02 | O campo com erro rola até o meio da tela antes de receber o foco. No celular, a rolagem (Tab, foco, âncora) reserva 150px embaixo para as barras fixas (`scroll-padding-bottom`). | `src/scripts/keepFormValues.ts`, `src/styles/global.css` | PASSOU: CPF com erro entre 325px e 369px numa tela de 844px, com o foco nele ([`R6-QA-02-depois.png`](evidencias/R6-QA-02-depois.png)); no Cadastrar pelo celular, o WhatsApp ficou entre 318px e 362px. |
| QA-06 | No computador, o título do cartão sai da tabulação (`tabindex="-1"`, posto pelo script do `EditCard` e tirado de novo abaixo de 1024px). | `src/components/admin/ui/EditCard.astro` | PASSOU: Tab depois de "Marcar": Próximos, Anteriores e cancelados, Abrir na Agenda, Trilha… No celular, o título continua no Tab (é o botão de abrir). |
| QA-03 | O Cadastrar mostra cada erro do servidor embaixo do campo dele (`aria-invalid`, `aria-describedby`, borda vermelha), e o primeiro campo com erro recebe o foco (`autofocus`). O aviso do alto fica só para o erro sem campo. "Menor de 18 como o próprio paciente" aparece embaixo da escolha "Quem fala". | `src/pages/admin/pacientes/novo.astro` | PASSOU: WhatsApp "123" com o erro embaixo e o foco no campo, sem aviso no alto ([`R6-QA-03-depois.png`](evidencias/R6-QA-03-depois.png)); o menor como o próprio paciente com o erro embaixo da escolha e o foco no botão marcado. Os valores continuam preservados. |
