# Relatório de testes de interface: R8 (Financeiro e DMED)

## 1. Resumo da execução

- **Data:** 2026-10-17
- **Executado por:** Claude (skill `playwright-ui-form-best-practices`), a pedido do cliente
- **Resultado geral:** 2 falhas Baixas (1 da R8 e 1 anterior a ela, do `EditCard`); 2 bloqueios
- **Síntese:** as abas, o filtro "Falta CPF" junto com a busca e o "Voltar" da ficha funcionam e
  guardam o estado no endereço. O formulário "Responsáveis da declaração" mantém todos os campos em
  todos os erros testados, marca o campo e põe o foco nele; o "Antes de baixar" mostra os três
  estados (em ordem, atenção e falta) e o botão só habilita sem pendência que impeça. O defeito da
  R8 é de texto: com "Falta CPF" e uma busca sem resultado, a tela diz "Ninguém encontrado… confira
  a grafia", embora a pessoa exista (só já tem CPF). O estado "Ficam de fora" não foi testado: o
  banco do seed não tem pagamento sem CPF, e a alteração temporária no banco foi negada.

| Status | Quantidade |
| --- | --- |
| PASSOU | 29 |
| FALHOU | 2 |
| BLOQUEADO | 2 |
| NÃO APLICÁVEL | 0 |
| **Total executado** | 31 (mais 2 bloqueados) |

## 2. Ambiente

- **URL base:** `http://localhost:4321` (servidor `npm run dev` do cliente)
- **Ambiente:** local, banco do seed (Supabase local), com a migração `20261017120000_falta_cpf.sql`
  já presente. **Gravação:** só os "Responsáveis da declaração" da Clínica Exemplo Saúde, salvos
  com dados `Teste QA 01` no FORM-02 e **devolvidos aos valores do seed** logo em seguida
  (conferido na tela). Na Odonto Exemplo só houve envios com erro (nada gravado). O download da
  DMED só lê.
- **Navegador e viewport:** Chromium (MCP Playwright), 1280×900 e 390×844, com e sem JavaScript
- **Versão/commit da aplicação:** `5043048` (R8, só na `main` local, sem push)
- **Usuários de teste:** Administrador, Recepção, Recepção restrita, Profissional (pediatra) e
  Suporte da "Clínica Exemplo Saúde"; Administrador da "Odonto Exemplo". Logins do seed, sem senhas
  neste relatório.

## 3. Escopo

- **Incluído:**
  - Financeiro › Quem paga (`/admin/financeiro`): abas, busca, filtro "Todos | Falta CPF (n)",
    linhas (computador) e cartões (celular), ida à ficha no cartão Financeiro e o "Voltar";
  - Financeiro › DMED (`/admin/financeiro/dmed`): ano em botões, declarante, 4 indicadores,
    "Antes de baixar", download, "Responsáveis da declaração" (leitura, Editar, Cancelar, erros) e
    "Quem pagou";
  - celular, teclado, sem JavaScript e os perfis.
- **Fora do escopo:** a ficha do paciente e Configurações › Nota fiscal, a não ser como destino e
  origem do "Voltar"; o conteúdo do arquivo da DMED além dos registros (já coberto pelos testes de
  banco e pelo teste de importação no PGD Dmed, do contador).

## 4. Ferramentas utilizadas

- MCP Playwright (exploração, com `browser_run_code` para ler valores efetivos, foco, ordem de
  tabulação, larguras, requisições e o arquivo baixado). O projeto não tem `@playwright/test`; não
  foram criadas specs.

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| NAV-01 | Quem paga (Falta CPF + busca) › nome › ficha › Voltar | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-02 | Quem paga › seta da linha › ficha › voltar do navegador | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-03 | Abas Quem paga ↔ DMED | Destino e aba ativa | Obrigatório | PASSOU | — |
| NAV-04 | DMED: troca do ano; ano mantido depois de salvar e de erro | Estado no endereço | Obrigatório | PASSOU | — |
| NAV-05 | "Antes de baixar" › Configurações › Nota fiscal | Destino certo | Obrigatório | PASSOU | — (ver S-01) |
| NAV-06 | "Ver quais ›" e "Abrir o pagamento" › Voltar | Retorno à página anterior | Obrigatório | BLOQUEADO | — |
| FIL-01 | Filtro "Falta CPF" | Lista e contador certos | Obrigatório | PASSOU | — |
| FIL-02 | Busca com filtro; "Todos" e "Limpar" | Um não desfaz o outro | Obrigatório | PASSOU | — |
| FIL-04 | "Falta CPF" + busca por telefone (staging) | Busca com o filtro | Obrigatório | FALHOU (corrigido) | Alta |
| FIL-03 | "Falta CPF" + busca de quem já tem CPF | Mensagem do estado vazio | Adicional | FALHOU | Baixa |
| FORM-01 | Responsáveis: CPF perante o CNPJ inválido | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-02 | Corrigir só esse campo e salvar | Novo envio sem redigitar | Obrigatório | PASSOU | — |
| FORM-03 | CPF do preenchimento inválido | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-04 | DDD com 1 dígito | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-05 | Telefone curto | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-06 | CNES com letras | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-07 | Nome só com espaços | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-08 | E-mail incompleto | Validação do navegador | Obrigatório | PASSOU | — |
| FORM-09 | Nada salvo (Odonto): formulário aberto; erro | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-10 | "Cancelar" depois de editar | Fecha e desfaz | Obrigatório | PASSOU | — |
| QA-01 | "Antes de baixar": em ordem, atenção e falta | Proposta aprovada | Adicional | PASSOU | — |
| QA-02 | Baixar o arquivo | Arquivo e botão de volta | Adicional | PASSOU | — |
| QA-03 | "Ficam de fora": indicador âmbar, "Ver ›", tabela | Proposta aprovada | Adicional | BLOQUEADO | — |
| QA-04 | Duplo clique em "Salvar" | Envio único | Adicional | PASSOU | — |
| QA-05 | Teclado nas duas abas | Ordem de tabulação | Adicional | PASSOU | — |
| QA-06 | Celular: Quem paga em cartões | Larguras | Adicional | PASSOU | — |
| QA-07 | Celular: DMED (cartões recolhidos, barra fixa) | Larguras | Adicional | PASSOU | — |
| QA-08 | Sem JavaScript: busca, filtro, cartões abertos | Funciona sem JS | Adicional | PASSOU | — |
| QA-09 | Sem JavaScript: erro nos Responsáveis | Preservação dos campos | Adicional | FALHOU | Baixa (anterior à R8) |
| QA-10 | Recepção | Sem abas; DMED negada | Adicional | PASSOU | — |
| QA-11 | Recepção restrita | Contador = lista | Adicional | PASSOU | — |
| QA-12 | Suporte | Duas abas, sem baixar nem editar | Adicional | PASSOU | — |
| QA-13 | Profissional | Sem Financeiro | Adicional | PASSOU | — |
| QA-14 | Console e HTTP | Sem erros nem 5xx | Adicional | PASSOU | — |

### 5.1 Aprovados

- **NAV-01:** em `/admin/financeiro?falta=1&q=Júlia`, o nome leva a
  `/admin/pacientes/…?volta=%2Fadmin%2Ffinanceiro%3Ffalta%3D1%26q%3D…#financeiro`; a ficha abre
  rolada até o cartão Financeiro (rolagem no máximo da página, cartão aberto e visível). "Voltar"
  devolve exatamente ao endereço de origem, com "Júlia" na busca e "Falta CPF" ativo.
- **NAV-02:** a seta (`Abrir a ficha de Júlia Ramos`) leva ao mesmo destino; o voltar do navegador
  devolve ao filtro com a busca.
- **NAV-03:** abas com `aria-current="page"` na ativa ("Abas do Financeiro"); a DMED abre no ano
  passado (2025), como antes.
- **NAV-04:** os 6 anos (2021 a 2026) em botões com `aria-current` no ano; `?ano=2026` fica depois
  de salvar, de erro e de baixar.
- **NAV-05:** na Odonto (sem dados fiscais), "Configurações › Nota fiscal ›" abre
  `/admin/configuracoes/nota-fiscal`; o voltar do navegador devolve à DMED do mesmo ano. A tela de
  destino não tem "Voltar" (ver S-01).
- **FIL-01:** "Falta CPF 2" lista Carlos Pereira e Júlia Ramos (os dois com "Falta CPF" em
  "Todos"); a linha de status diz "2 sem o CPF de quem paga".
- **FIL-02:** busca com o filtro → `?falta=1&q=Júlia` (1 resultado); "Todos" mantém a busca
  (`?q=Ana`); "Limpar" mantém o filtro (`?falta=1`).
- **FORM-01:** com os 8 campos preenchidos (`Teste QA 01`) e o CPF perante o CNPJ inválido, os 8
  valores voltam iguais; o formulário volta aberto; o campo tem `aria-invalid="true"` e
  `aria-describedby` com a dica e a mensagem "CPF do responsável perante o CNPJ inválido."; o foco
  vai para ele.
- **FORM-02:** corrigido só esse campo, "Salvar" grava ("Responsáveis da DMED salvos."), o cartão
  volta ao modo leitura com os dados novos (CPF mascarado, telefone com ramal, CNES). Depois, os
  valores do seed foram devolvidos pela mesma tela.
- **FORM-03 a FORM-07:** um campo inválido por vez (CPF do preenchimento, DDD "8", telefone "12",
  CNES "12ab", nome só com espaços): nenhum outro campo muda, o inválido fica com o que foi
  digitado, recebe `aria-invalid` e o foco, e a mensagem é clara ("DDD com 2 dígitos.",
  "Telefone com 8 ou 9 dígitos, sem o DDD.", "CNES: 7 dígitos." etc.).
- **FORM-08:** "qa01@" é barrado pelo navegador (campo `type="email"`), sem envio.
- **FORM-09:** na Odonto, sem nada salvo, o cartão já vem com o formulário aberto e sem
  "Cancelar"; com o CPF do preenchimento inválido, os 8 campos voltam iguais e o ano (`?ano=2024`)
  fica.
- **FORM-10:** "Cancelar" fecha o formulário, desfaz o que foi digitado e devolve o foco ao
  "Editar".
- **QA-01:** Clínica Exemplo 2025: tudo em ordem; 2026: "2026 ainda não terminou · O arquivo fica
  parcial." em âmbar, botão habilitado; Odonto: "Faltam os dados fiscais" e "Faltam os
  responsáveis" em vermelho, os dois botões (computador e barra fixa) desabilitados e "Resolva os
  itens em vermelho para baixar.". Cada ícone tem o texto para leitor de tela ("Em ordem:",
  "Atenção:", "Falta:").
- **QA-02:** "Baixar o arquivo da DMED de 2026" baixa `DMED_2026_11222333000181.txt` com quebra de
  linha do Windows e os registros Dmed, RESPO, DECPJ, PSS, RPPSS, BRPPSS e FIMDmed; a página fica
  e o botão volta a habilitar.
- **QA-04:** duplo clique em "Salvar" gera um único POST.
- **QA-05:** Quem paga: Quem paga › DMED › busca › Buscar › Todos › Falta CPF › nome › seta…; DMED:
  abas › 6 anos › Baixar › Editar. A tabela "Quem pagou" cabe e não entra no Tab.
- **QA-06:** 390px: cartões com nome, "Paga: …", o tipo e o selo; "Todos | Falta CPF" na largura
  toda (alvos de 38px); sem rolagem lateral em "Todos" e em "Falta CPF".
- **QA-07:** 390px: "Responsáveis" e "Quem pagou" começam recolhidos e abrem no toque; "Baixar a
  DMED de 2026" na barra fixa (acima do menu de baixo, sem cobrir o fim da página); anos numa
  linha; sem rolagem lateral.
- **QA-08:** sem JavaScript, a busca e o filtro funcionam pelo endereço e os cartões da DMED ficam
  abertos.
- **QA-10:** Recepção vê "Quem paga" sem a barra de abas; `/admin/financeiro/dmed` volta para o
  Financeiro com "A DMED é só do Administrador da clínica."; um POST direto de "gerar" é recusado
  (403).
- **QA-11:** Recepção restrita: "Falta CPF 2" e a lista do filtro com os mesmos 2.
- **QA-12:** Suporte vê as duas abas; na DMED, sem "Baixar", sem "Editar" e sem barra fixa, com
  "Só o Administrador da clínica baixa o arquivo."
- **QA-13:** Profissional não tem "Financeiro" no menu; o endereço leva ao Início com acesso negado.
- **QA-14:** nenhum erro ou aviso no console; os POSTs da DMED responderam 200.

### 5.2 Falhas

Ver a seção 6.

### 5.3 Bloqueios

- **NAV-06 e QA-03:** o seed não tem pagamento sem CPF de quem pagou, então o indicador "Ficam de
  fora" em âmbar com "Ver ›", o item "Ver quais ›", a tabela, o "Abrir o pagamento" com o "Voltar"
  e, no celular, o "Ver ›" que abre o cartão recolhido não aparecem. Tirar o CPF de um pagamento por
  alguns segundos no banco local (como na implementação) foi **negado pela proteção do ambiente**.
  Para executar: liberar essa alteração temporária no banco local (ou o cliente registrar, no
  ambiente local, um pagamento sem CPF pela tela do pagamento).

### 5.4 Não aplicáveis

- Nenhum. A paginação (20 por página) não aparece com os 4 pacientes do seed; o código não mudou
  nessa parte, então fica como não verificada (seção 6.3).

## 6. Achados

### 6.1 Defeitos confirmados

#### FIL-03 · "Falta CPF" com busca sem resultado diz "confira a grafia"

- **Severidade:** Baixa
- **Página ou fluxo:** Financeiro › Quem paga, filtro "Falta CPF" com busca
- **URL:** `/admin/financeiro?falta=1&q=Ana`
- **Critério avaliado:** qualidade adicional: clareza da mensagem do estado vazio
- **Pré-condições:** Administrador da Clínica Exemplo Saúde; Ana Souza tem o CPF de quem paga.
- **Passos executados:**
  1. Abrir Financeiro e tocar em "Falta CPF".
  2. Buscar "Ana".
- **Resultado esperado:** dizer que ninguém **sem CPF** foi encontrado para "Ana" e oferecer ver em
  "Todos" (onde ela aparece).
- **Resultado observado:** "0 sem o CPF de quem paga para "Ana"" e, embaixo, "Ninguém encontrado
  para "Ana" · Confira a grafia ou busque pelos 4 últimos dígitos do telefone." com "Limpar a
  busca", que mantém o filtro e não mostra a Ana. A pessoa existe; a mensagem leva a procurar um
  erro de digitação que não há.
- **Impacto:** baixo; a recepção pode achar que o paciente não está cadastrado.
- **Evidência:** `evidencias/r8-falta-cpf-busca-vazia-1280.png`
- **Recomendação:** com o filtro ligado, mostrar "Ninguém sem o CPF de quem paga para "Ana"" e o
  botão "Buscar em Todos" (`?q=Ana`).
- **Status (17/out):** **corrigido** com o texto aprovado pelo cliente: "Ninguém sem o CPF de quem
  paga para "Ana"", "Quem já tem o CPF aparece em "Todos"." e o botão "Buscar em Todos", que leva a
  `?q=Ana` (1 encontrado). Retestado: sem o filtro, a mensagem antiga continua ("Confira a grafia…");
  com o filtro e resultado, a lista normal. Evidência: `evidencias/r8-falta-cpf-busca-vazia-corrigido-1280.png`.

#### QA-09 · Sem JavaScript, o erro dos Responsáveis volta com o formulário fechado e os valores salvos

- **Severidade:** Baixa (anterior à R8: vale para todo `EditCard`, desde a R6)
- **Página ou fluxo:** Financeiro › DMED › Responsáveis da declaração, sem JavaScript
- **URL:** `/admin/financeiro/dmed?ano=2026`
- **Critério avaliado:** preservação dos campos após erro de validação
- **Pré-condições:** navegador com JavaScript desligado; Responsáveis já salvos.
- **Passos executados:**
  1. "Editar", mudar o DDD para "9" e "Salvar".
- **Resultado esperado:** o formulário volta aberto com o que foi digitado e o erro no campo.
- **Resultado observado:** a mensagem "DDD com 2 dígitos." aparece, mas o formulário volta fechado
  e, ao abrir, os campos têm os valores salvos ("84"); o que foi digitado se perde. Com JavaScript
  (o caso real do painel), tudo é preservado (FORM-01 a FORM-09).
- **Campos perdidos:** todos os editados (aqui, o DDD).
- **Impacto:** muito baixo; o painel é usado com JavaScript.
- **Evidência:** leitura dos valores efetivos no contexto sem JavaScript (390×844).
- **Recomendação:** nenhuma correção agora; registrar como limitação conhecida do `EditCard`. Se o
  cliente quiser, devolver os valores pelo servidor no futuro, para todo o painel.

#### FIL-04 · "Falta CPF" com busca por telefone dá erro 500 (achado do cliente no staging)

- **Severidade:** Alta (a tela quebra; contorno: buscar pelo nome ou tirar o filtro)
- **Página ou fluxo:** Financeiro › Quem paga, filtro "Falta CPF" com busca por telefone
- **URL:** `/admin/financeiro?q=61998645490&falta=1` (staging, 17/out)
- **Critério avaliado:** busca junto com o filtro
- **Passos executados:** ligar "Falta CPF" e buscar um telefone (4 dígitos ou mais).
- **Resultado esperado:** a lista de quem não tem CPF com aquele telefone.
- **Resultado observado:** erro 500 (`DataError`). O PostgREST não filtra pelo contato embutido no
  resultado da função `finance_patients_missing_payer_cpf` ("column pgrst_call.phone does not
  exist"). O teste da seção 5 só buscou por nome (FIL-02), por isso não pegou.
- **Status (17/out):** **corrigido** em `listPatientsPage` (`src/lib/data/patients.ts`), sem
  migração: com o filtro e busca por telefone, primeiro os contatos da clínica com o telefone,
  depois a função pelo `contact_id`. Retestado no local (Administrador e Recepção): "0003",
  "84988880003", "(84) 98888-0003", "8888" (2), sem resultado ("9999") e quem tem CPF ("0001"),
  pelo endereço e pelo formulário; a busca por nome e a busca por telefone sem o filtro continuam
  iguais. `astro check` sem erros e `npm test` (497) passando.

### 6.2 Suspeitas

#### S-01 · Configurações › Nota fiscal não tem "Voltar" para a DMED

- **Severidade:** Baixa (se confirmada)
- **Fluxo:** DMED (Odonto, sem dados fiscais) › "Configurações › Nota fiscal ›"
- **Observado:** o destino é certo, mas a tela de Nota fiscal é uma aba de Configurações, sem
  "Voltar"; depois de salvar os dados fiscais, a volta à DMED é pelo menu (Financeiro › DMED, que
  abre no ano padrão) ou pelo voltar do navegador. O aviso do Início ("Abrir Nota fiscal", R7) leva
  à mesma tela do mesmo jeito.
- **O que falta para confirmar:** decisão do cliente: as abas de Configurações devem ganhar um
  "Voltar" quando abertas de outra tela (`?volta=`), como a ficha e o pagamento?

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| "Ficam de fora" (indicador, "Ver ›", tabela, "Abrir o pagamento" › Voltar) | Sem pagamento sem CPF no seed; alteração temporária no banco negada |
| Paginação com o filtro "Falta CPF" | Só 4 pacientes no seed (menos de 20) |
| Download no celular (barra fixa) | Só conferidos a presença, o rótulo e o estado; o download foi testado no computador |
| Arquivo da DMED no PGD Dmed | Fora do escopo (teste de importação do contador) |

## 7. Limitações

- Um único conjunto de dados (seed); 2026 com um pagamento e 2025 sem nenhum.
- O POST direto da Recepção foi recusado com 403 sem cabeçalho `Origin`; a recusa pode ter vindo
  da proteção de origem, antes da conferência do papel (o código confere o papel nos dois casos).
- Sem leitor de tela; acessibilidade conferida pelos atributos e pela ordem de tabulação.

## 8. Evidências

- **Local:** `docs/auditoria-frontend/evidencias/` (como nos relatórios anteriores)
- **Arquivos:** `r8-dmed-1280.png`, `r8-dmed-2026-1280.png`, `r8-dmed-odonto-1280.png`,
  `r8-form01-depois-1280.png`, `r8-ficha-financeiro-1280.png`,
  `r8-falta-cpf-busca-vazia-1280.png`, `r8-falta-cpf-busca-vazia-corrigido-1280.png`,
  `r8-quem-paga-390.png`, `r8-falta-cpf-390.png`,
  `r8-dmed-390.png`, `r8-dmed-390-fim.png`
- **Dados sensíveis:** só dados fictícios do seed (CPFs mascarados na tela); nenhuma senha, token
  ou cookie nas capturas.

## 9. Recomendações

1. ~~Corrigir a mensagem do estado vazio do "Falta CPF" com busca (FIL-03)~~ **corrigido e
   retestado em 17/out**.
2. Executar NAV-06 e QA-03 com um pagamento sem CPF no banco local, antes de publicar a R8.
3. Decidir com o cliente o "Voltar" nas abas de Configurações abertas de outra tela (S-01).
4. Registrar QA-09 como limitação conhecida do `EditCard` (sem correção agora).
   **Corrigido em 17/out/2026** (cliente: "só abrir o cartão"): sem JavaScript, o `EditCard` com erro volta com o
   formulário aberto, o campo marcado (`aria-invalid`) e o aviso; os campos mostram o que estava salvo (o digitado não
   volta, para não guardar dados pessoais num cookie). Conferido sem JavaScript no Responsável (telefone) e na DMED
   (DDD); com JavaScript, igual a antes.
