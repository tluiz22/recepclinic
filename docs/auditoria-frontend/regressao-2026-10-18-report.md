# Relatório de testes de interface: regressão do painel e das páginas do paciente (18/out/2026)

> Auditoria de regressão depois das correções da auditoria de 14/out (F-01 a F-09, A-01 a A-05), do
> redesign R0 a R11 e dos ajustes de 17/out (S-01/S-02, "Outra data", confirmações, busca por
> nascimento, "Já marcado", U-08, QA-09 e a regra do telefone). Feita com a skill
> `playwright-ui-form-best-practices`. **Só auditoria: nenhum código da aplicação foi alterado.**
> Referências: [auditoria inicial](frontend-audit-report.md) (mantida como está), [cobertura](frontend-test-coverage.md),
> relatórios do redesign (`redesign-*.md`) e as decisões do redesign no [plano](../plano.md).

## 1. Resumo da execução

- **Data:** 2026-10-18
- **Executado por:** Claude (MCP Playwright, Chromium)
- **Resultado geral:** 4 falhas (1 Média, 3 Baixas), 8 bloqueios, 1 suspeita. Nenhum defeito
  corrigido antes voltou.
- **Síntese:** todos os defeitos já corrigidos continuam resolvidos: 30 cenários de retorno, 18 de
  preservação dos campos e as correções de R0 a R11 conferidas uma a uma. Os quatro defeitos novos são
  de **largura de tela intermediária**, que nenhuma rodada anterior mediu (as anteriores usaram 1280,
  1440, 390 e 360px), e da **borda vermelha** do campo com erro. O mais relevante: em tablet (640 a
  820px), a barra de filtros da Agenda passa da tela e a página rola de lado (REG-01, Média).

| Status | Quantidade |
| --- | --- |
| PASSOU | 94 |
| FALHOU | 4 |
| BLOQUEADO | 8 |
| NÃO APLICÁVEL | 1 |
| **Total executado** | 107 |

Além dos 107 cenários, a varredura abriu **105 endereços** em 1280 e 390px (210 cargas) e, numa
segunda passada, 71 telas do Administrador em 1024, 768, 700, 640 e 360px.

## 2. Ambiente

- **URL base:** `http://localhost:4321` (`npm run dev`, já em execução na máquina do cliente)
- **Ambiente:** local, Supabase local com os dados fictícios do `seed.sql` (mais as clínicas
  "Clínica do teste …" que os testes de banco deixam). Operações permitidas: navegar e enviar
  formulários **com erro** (o servidor recusa e nada é gravado). Nenhum envio válido foi feito.
- **Navegador e viewport:** Chromium do MCP Playwright. Computador: 1280×900, 1024, 768, 700 e
  640px. Celular: 390×844 e 360. Emulação de aparelho com toque e barra de rolagem sobreposta
  (`isMobile`): 360×780, 390×844, 640×360, 768×1024, 820×1180 e 1024×768.
- **Versão/commit da aplicação:** `0fbb35a` (árvore limpa)
- **Usuários de teste:** Administrador, Recepção, Recepção restrita e Profissional da Clínica Exemplo
  Saúde; Administrador da Odonto Exemplo; Suporte (senha local do seed, não registrada aqui).
- **Banco:** contagem exata das 54 tabelas de dados (fora os dois registros de acesso e de auditoria)
  **igual antes, no meio e depois** dos testes.

## 3. Escopo

- **Incluído:** as 65 páginas (painel, Sistema, acesso e páginas do paciente); os 23 cenários de
  retorno e os 12 de formulário da auditoria inicial; os defeitos e as correções de cada relatório
  do redesign (R0–R4, R5, R6, R7, R8, R9, R10, R11, S-01/S-02); os ajustes de 17/out; permissões e
  isolamento; teclado; larguras; console e HTTP; as decisões de design medíveis do plano.
- **Fora do escopo:** envios que gravam (marcar, remarcar, cancelar, pagar, emitir nota, salvar
  configurações, convidar, confirmar no `/agendar`), staging e produção, leitor de tela real, Safari
  e iPhone reais.

## 4. Ferramentas utilizadas

- MCP Playwright: navegação, roteiros de varredura e de cenários (`browser_run_code`), capturas,
  contextos separados por perfil, emulação de aparelho e contexto **sem JavaScript**.
- `npm test` (Vitest): **524 de 524** testes passando. `npm run check` (`astro check`): 0 erros,
  0 avisos. Servem de apoio; o resultado vem do que foi observado no navegador.
- `psql` no banco local: só leitura (IDs e contagens).

## 5. Cenários executados

### 5.1 Controles de retorno (regra obrigatória)

Cada cenário: origem aberta, ida por clique, retorno pelo controle da tela; conferidos a URL com os
parâmetros, o título e o estado (data no campo, busca, filtro).

| ID | Cenário | Status |
| --- | --- | --- |
| NAV-01 a NAV-05 | Agenda 23/10 › Marcar / Remarcar / Mais › Pagamento / Mais › Trilha / Ficha › Voltar: volta a `?date=2026-10-23`, data no campo | PASSOU (5) |
| NAV-06, NAV-07 | Semana › Bloquear; Mês › Bloqueios › Voltar | PASSOU (2) |
| NAV-08, NAV-23 | Semana › Bloqueios › Editar › Voltar › Voltar (dois níveis) | PASSOU (2) |
| NAV-09 | Pacientes (busca "Ana") › Ficha › Voltar: busca mantida | PASSOU |
| NAV-10 a NAV-14 | Pacientes › Cadastrar; Financeiro › Ficha; Início › Contato; Ficha › Trilha; Ficha › Marcar | PASSOU (5) |
| NAV-15 (F-06) | Marcar (busca "Ana") › Cadastrar paciente novo › "‹ Marcar": volta com `busca=Ana` no campo | PASSOU |
| NAV-15b | … › Voltar até a Agenda 23/10 | PASSOU |
| NAV-16, NAV-18 | Profissionais › Novo › Cancelar; Equipe › pessoa › Cancelar | PASSOU (2) |
| NAV-19 | Resumo do Dia (Registradas) › Ficha › Voltar | PASSOU |
| NAV-20 | Métricas › Faltosos › paciente | BLOQUEADO: sem faltosos no seed |
| NAV-21 | Financeiro › DMED › "‹ Destino" | NÃO APLICÁVEL: na R8 a DMED virou aba do Financeiro ("Quem paga" e "DMED"), sem "Voltar" |
| R4-NAV-07 | Mês 19/11 › busca "João" › Voltar: Mês 19/11; Dia, Semana e Mês da busca em 19/11 | PASSOU |
| R4-NAV-08 | Resumo do Dia 21/10 › aba Lembretes: continua em 21/10 | PASSOU |
| R5-NAV-03 | Agenda › Pagamento › Paciente › Voltar: Pagamento; Voltar: Agenda 23/10 | PASSOU |
| R9-NAV-06 | Serviços, Profissionais, Locais, Agendas e Convênios em "Todos" › cadastro › "‹ lista" e Cancelar: voltam com `?todos=1` | PASSOU |
| R10-NAV-06 | Clínica › Matriz de acesso (`de=clinica`) › "‹ Clínica Exemplo Saúde"; vinda da lista: "Todas as clínicas" e "Ver a clínica ›" | PASSOU (2) |
| R9 decisão 7 | Nota fiscal aberta pelo Início: "Voltar para o Início"; aberta pelo menu: sem "Voltar" | PASSOU |
| F-05 | Suporte › "Trocar" leva a Escolher a clínica | PASSOU |

### 5.2 Preservação dos campos após erro (regra obrigatória)

Um campo inválido por cenário, valores efetivos lidos antes e depois (texto, seleção, `checked`).

| ID | Formulário · campo inválido | Mensagem | Perdidos | Marca e foco | Status |
| --- | --- | --- | --- | --- | --- |
| FORM-01 | Cadastrar paciente · WhatsApp "123" | embaixo do campo | 0 de 10 | `aria-invalid`, foco no campo | PASSOU |
| FORM-01b | Cadastrar paciente · celular sem o último dígito "(61) 99864-549" (regra de 17/out) | idem | 0 de 10 | idem | PASSOU |
| FORM-02 | Cadastrar paciente · o próprio paciente com 6 anos | embaixo de "Quem fala" | 0 de 10 | foco no rádio marcado | PASSOU |
| FORM-03 | Novo profissional · WhatsApp "12" | "Telefone inválido: informe DDD + número, ex.: (84) 98188-0777." (U-08) | 0 de 8 | `aria-invalid`, foco | PASSOU |
| FORM-04 | Novo contato da equipe · WhatsApp "12" | idem | 0 de 4 | idem | PASSOU |
| FORM-05 | Novo serviço · valor "abc" | "Valor inválido" | 0 de 18 | idem | PASSOU |
| FORM-06 | Bloquear agenda · fim antes do início | "O fim precisa ser depois do início." | 0 de 10 | foco na mensagem | PASSOU |
| FORM-07 | Pagamento · Dinheiro, "Outra pessoa", CPF, valor "abc" | "Informe o valor em reais, ex.: 150,00." | 0 de 13 | `aria-invalid`, foco no valor | PASSOU |
| FORM-08 | Novo plano · nome só com espaços | "Informe o nome do plano" | 0 de 6 | idem | PASSOU |
| FORM-09 | Editar profissional · especialidade alterada + WhatsApp "12" | U-08 | 0 de 8 | idem | PASSOU |
| FORM-10 | Editar serviço · duração alterada + valor "abc" | "Valor inválido" | 0 de 17 | idem | PASSOU |
| FORM-12 | Novo local · nome só com espaços | "Informe o nome do local" | 0 de 3 | idem | PASSOU |
| R5-QA-01 | Pagamento · "Outra pessoa" com CPF inválido | "CPF inválido: confira os 11 dígitos." | 0 de 13 | no CPF **à vista**, foco nele | PASSOU |
| R6-QA-02 | Ficha › Financeiro no celular (390) · CPF inválido | no cartão | 0 | foco no CPF a 325–369px de 844px (fora das barras fixas) | PASSOU |
| R7-FORM-01/02 | Métricas › Personalizado · De depois de Até; mais de 366 dias | "A data De é depois da data Até. Os números mostram hoje." / "O período passa de 366 dias. …" | 0 (as datas ficam como digitadas) | De e Até marcados, foco no De | PASSOU |
| R9-QA-01 | Clínica › Limites do bot · campo vazio (1280 e 390) | no bloco, à vista | 0 | borda vermelha, foco | PASSOU |
| R10-FORM-09 | Matriz de acesso · 2 itens desmarcados + limite 0 | "O limite de profissionais precisa ser de pelo menos 1. Nada foi salvo." | 0 de 16 | limite marcado, foco | PASSOU |
| R8-QA-09 | DMED › Responsáveis **sem JavaScript** · DDD "9" | "DDD com 2 dígitos." | cartão volta aberto com o valor salvo (decisão de 17/out) | `aria-invalid` | PASSOU |
| REENVIO | Corrigir só o campo inválido e enviar de novo (formulários que gravam) | — | — | — | BLOQUEADO: gravaria; só o período das Métricas (GET) foi reenviado: 10/10 a 15/10 aplicado |
| R11-FORM-04 | `/formulario` · nome da clínica apagado | — | — | — | BLOQUEADO: o envio grava o rascunho do pedido do seed |

### 5.3 Funções, regras de negócio e estados

| ID | Verificação | Status |
| --- | --- | --- |
| F-01 | Marcar: cabeçalho com "Sair" no carregamento, com horário escolhido e com a série; o botão do formulário vira "Marcar a série" | PASSOU |
| R4-QA-07 | Marcar e Remarcar desabilitados sem horário, habilitados depois de escolher | PASSOU |
| Confirmações (17/out) | Marcar: "Ana Souza: Avaliação inicial, terça-feira, 20/10 às 08:00, com Rafael Lima (Consultório Centro)."; série: "toda semana às terças, 08:00, … a partir de 20/10, sem data para terminar (…3 meses)" e a frase do feriado; Remarcar: "Carlos Pereira sai de terça-feira, 20/10 às 09:00 e vai para …". Fechados com "Voltar", nada gravado | PASSOU |
| "Já marcado" (17/out) | Selo na busca, os futuros no cartão; serviço já marcado: aviso vermelho e "Remarcar esse atendimento", sem horários | PASSOU |
| Busca (17/out) | "19/04/2025" acha Ana Souza; "0001" acha os dois pacientes do telefone; resultados com "nasc." | PASSOU |
| S-01 | Faixa de dias em 390 e 360: 7 dias à vista sem arrastar (41 e 37px), setas na linha "Escolha o dia" | PASSOU |
| S-02 | Dia sem agenda (quarta, Rafael Lima): "Não existe agenda aberta para esse dia. Mostrando a partir de terça-feira, 27/10 …"; no `/agendar`, o mesmo aviso | PASSOU |
| S02-08 | `/agendar` com 20/11 (depois do prazo): aviso e faixa com 7 dias livres, sem "Não encontramos horários" | PASSOU |
| "Outra data" | Campo já vem com o dia escolhido (2026-10-20; 2026-10-27) | PASSOU (Chromium; iPhone real não testado) |
| FIL-03 / FIL-04 | "Falta CPF" com "Ana": "Ninguém sem o CPF de quem paga para "Ana"" e "Buscar em Todos" (`?q=Ana`); com "0003", "84988880003", "(84) 98888-0003" e "9999": 200 e o número certo | PASSOU |
| R9-QA-02 | Aviso de erro do Novo profissional não reaparece em Feriados, Horários e Início | PASSOU |
| R10-QA-10 | Selos "3 de 3", "7 de 7", "2 de 2" | PASSOU |
| R10-S-01 | "Abrir a clínica para configurar" (Odonto) abre Configurações › Clínica com "Odonto Exemplo" no cabeçalho | PASSOU |
| F-08 / R4-QA-10 | "Sexta-feira, 23 de outubro de 2026", "Outubro de 2026", "Segunda 19/10/2026 às 08:00" | PASSOU |
| R4-QA-08 | Células do Mês com nome ("21 de outubro, 2 atendimentos, bloqueio"); hoje com `aria-current="date"` | PASSOU |
| R4-QA-09 | Semana e busca com o selo de texto ("Não confirmado") | PASSOU |
| U-10 | "Emitir a nota fiscal agora" desmarcado no Pagamento | PASSOU |
| Envio duplo (R5) | Três cliques seguidos em "Cadastrar" (resposta atrasada 1,5s): 1 envio | PASSOU |
| PERM-01 | Recepção (Métricas, Configurações, Sistema) e Profissional (Financeiro, Configurações, Sistema): Início com aviso de acesso | PASSOU |
| PERM-02 | Admin da Odonto não abre paciente, pagamento nem trilha da Clínica Exemplo | PASSOU |
| PERM-03 | Recepção restrita: pagamento de agenda que não é dela vai para a Agenda | PASSOU |
| F-09 | `/agendar`, `/formulario`, `/preparo` e `/orientacoes` inválidos e páginas inexistentes: 404 | PASSOU |
| Telefone (17/out) | Exibição sem o +55 em todo o painel e no `/agendar` ("(84) 98888-0001") | PASSOU |
| Estados vazios | "Ninguém encontrado para "zzzz"", "Nenhum paciente com faltas frequentes.", "Ninguém aguardando remarcação.", "Nenhum atendimento.", "Nenhum paciente encontrado." | PASSOU |
| Carregamento | "Abrindo…" e barra ao trocar de seção em Configurações no celular | BLOQUEADO: a página já vem pré-carregada (prefetch do Astro) e abre na hora; o estado não fica visível |
| Sucesso | Avisos "… salvo." | BLOQUEADO: exigiria gravar |
| R11-QA-02 | Título da aba do link já usado ou cancelado | BLOQUEADO: nenhum link usado no seed |
| Preparo | Link para `/preparo` a partir da confirmação do `/agendar` | BLOQUEADO: só aparece depois de confirmar (gravaria). A página `/preparo` em si foi aberta |
| Acesso | `/admin/nova-senha` com link e `/orientacoes` com conteúdo | BLOQUEADO: dependem de e-mail ou de texto que o seed não tem |

### 5.4 Acessibilidade e teclado

| ID | Verificação | Status |
| --- | --- | --- |
| A-01 | Nenhum campo visível sem rótulo acessível nos 105 endereços, em 1280 e 390px | PASSOU |
| A-02 | `aria-invalid` + `aria-describedby` + foco no campo em todos os FORM acima; mensagem com `role="alert"` | PASSOU |
| A-03 | 1º Tab mostra "Pular para o conteúdo"; Enter e Tab caem em "Marcar" | PASSOU |
| KB-02 | "Confirmar presença" e "Marcar" pelo teclado: diálogo com foco em "Voltar", Esc fecha e devolve o foco ao botão | PASSOU |
| R5-QA-07 | "Mais" › Cancelar nota › Fechar: foco volta a "Mais ações do pagamento de R$ 300,00"; `aria-controls` no item | PASSOU |
| R6-QA-06 | Ficha no computador: o Tab não para nos títulos dos cartões | PASSOU |
| R7-QA-06 | Tabelas das Métricas fora do Tab em 1280px (sem `tabindex`) | PASSOU |
| R11-QA-01 | Horário escolhido no `/agendar` (cor do seed `#0F766E`): contraste 4,50:1 | PASSOU (só a cor do seed; trocar a cor gravaria) |
| REG-04 | Borda vermelha do campo com erro no Cadastrar paciente | **FALHOU** (Baixa) |

### 5.5 Larguras de tela, console e HTTP

| ID | Verificação | Status |
| --- | --- | --- |
| CON-01 | 105 endereços × 2 larguras: nenhum erro de JavaScript, nenhuma resposta 5xx; só os 404 esperados | PASSOU |
| A-05 | Sem 404 do ícone da aba e sem o aviso do Chrome | PASSOU |
| SWP-390 | Nenhuma rolagem lateral em 390px, nas 71 telas do Administrador, também com emulação de aparelho | PASSOU |
| F-04 | Configurações › Clínica sem rolagem lateral em 360 e 390px | PASSOU |
| S0102-QA-01 | Cabeçalho em 360px: "Administrador" sai, "Sair" termina em 344px, sem rolagem; em 380 e 390px o papel continua | PASSOU |
| F-05 | "Trocar" visível e clicável para o Suporte em 1280, 768 e 390px | PASSOU |
| REG-01 | Agenda (Dia, Semana, Mês) entre 640 e 820px | **FALHOU** (Média) |
| REG-02 | Abas de Pacientes, Resumo do Dia, Métricas e Financeiro entre 640 e 1024px | **FALHOU** (Baixa) |
| REG-03 | Pagamento em 360px | **FALHOU** (Baixa) |

### 5.6 Correspondência com o design aprovado

| ID | Decisão (plano, seção "Redesign do painel") | Observado | Status |
| --- | --- | --- | --- |
| D-01 | Verde `#0B7A62`, Bricolage Grotesque nos títulos e Source Sans 3 no texto | botão `rgb(11,122,98)`; h1 em Bricolage; corpo em Source Sans 3 | PASSOU |
| D-02 | Largura única de 1152px (16/out) | 1152px na Agenda, Resumo do Dia, Pacientes, Configurações, Financeiro, Métricas e Início | PASSOU |
| D-03 | Dia com colunas de no mínimo 250px; 4 agendas sem rolagem (17/out) | 4 colunas de 268px em 1280px, sem rolagem | PASSOU |
| D-04 | Cartão: ação do momento cheia, frequentes à vista, raras no "Mais", Cancelar em vermelho à direita | "Confirmar presença" cheio, Remarcar, Mais, Cancelar; com Compareceu, Pagamento à vista | PASSOU |
| D-05 | Celular com "Todas as agendas": lista única por horário, com o nome da agenda | 21/10: 07:00 (turma), 09:00, 10:00 (bloqueio), cada um com a agenda | PASSOU |
| D-06 | Abas sublinhadas iguais; ordem das Métricas: Visão geral, Atendimentos, Funil do bot, Faltosos, Retomar contato, Financeiro | mesmo componente nas 4 telas; ordem certa | PASSOU |
| D-07 | Configurações: menu agrupado (A clínica, Atendimento, Mensagens, Financeiro); "Configurações" pequeno acima do título | conferido em 390px e 1280px | PASSOU |
| D-08 | Financeiro: a Recepção vê só "Quem paga", sem a barra de abas | só o filtro "Todos / Falta CPF" | PASSOU |
| D-09 | Login: e-mail mantido depois da senha errada, senha vazia; "Mostrar" vira "Ocultar" | conferido | PASSOU |
| D-10 | Escolher a clínica com busca quando há mais de 6 clínicas | "Buscar" com 10 clínicas | PASSOU |

A barra da Agenda "numa linha só" (revisão de 17/out) foi conferida no plano só em 1440, 1280 e
390px; entre 640 e 820px ela não cabe (REG-01).

## 6. Achados

### 6.1 Defeitos confirmados

#### REG-01 · Agenda em tablet: a barra de filtros passa da tela e a página rola de lado

- **Severidade:** Média
- **Página ou fluxo:** Agenda › Dia, Semana e Mês (barra com visualização, data, "Hoje", agenda e
  busca)
- **URL:** `/admin/agenda?date=2026-10-23`, `/admin/agenda/semana?date=2026-10-19`, `/admin/agenda/mes?date=2026-10-19`
- **Critério avaliado:** larguras de tela (qualidade adicional)
- **Pré-condições:** Administrador (o mesmo com o Suporte dentro da clínica); tela entre 640 e 820px
- **Passos executados:**
  1. Abrir a Agenda num aparelho de 768×1024 (emulação com toque) ou numa janela de 768px.
  2. Olhar a barra de filtros e rolar a página para o lado.
- **Resultado esperado:** a barra quebra em linhas e cabe na tela, como em 390px (onde vira "Todas as
  agendas · buscar paciente") e em 1280px.
- **Resultado observado:** o seletor "Todas as agendas", a busca ("Nome, telef…") e o botão
  "Buscar" passam da borda do painel; a página rola de lado. Medido com aparelho emulado:
  768×1024: Dia +70px, Semana +94px; 820×1180: Dia +18px, Semana +42px; 640×360 (celular deitado):
  Mês +101px. Em janela comum: 700px, Dia +153px e Mês +56px.
- **Impacto:** em tablet ou celular deitado, a busca de paciente da Agenda fica cortada e a página
  "escorrega" de lado. Contorno: girar o aparelho ou usar o computador.
- **Evidência:** `evidencias/reg-01-agenda-768-filtros.jpg` (aparelho 768×1024),
  `evidencias/reg-01-agenda-768-rolagem.jpg` (janela 768px, barra de rolagem lateral embaixo).
- **Causa provável:** a revisão de 17/out pôs a barra numa linha só a partir de `sm` (640px); ela só
  cabe a partir de ~840px.
- **Recomendação:** manter a barra em duas linhas (ou recolhida, como no celular) abaixo de `lg`,
  e conferir 640, 768, 820 e 1024px.

#### REG-02 · Abas sublinhadas fazem a página rolar 8px para o lado em telas médias

- **Severidade:** Baixa
- **Página ou fluxo:** Pacientes, Resumo do Dia, Métricas e Financeiro (a barra de abas fixa no alto)
- **Critério avaliado:** larguras de tela
- **Passos executados:** abrir `/admin/consultas` em 640, 700, 768 ou 1024px; rolar a página para o
  lado.
- **Resultado esperado:** sem rolagem lateral.
- **Resultado observado:** a página rola 8px (`scrollX = 8`); a barra de rolagem lateral aparece no
  pé da janela. A barra de abas usa `-mx-4 sm:-mx-6` e passa da margem do conteúdo. Em 1280 e
  390px não acontece. Confirmado também com aparelho emulado (640, 768, 820 e 1024px).
- **Impacto:** pequeno: a tela "balança" 8px ao arrastar no tablet.
- **Evidência:** `evidencias/reg-02-abas-768-rolagem.jpg`.
- **Recomendação:** igualar a margem negativa da barra ao recuo do conteúdo em cada largura (ou
  trocar por `w-full` com o fundo esticado de outro jeito).

#### REG-03 · Pagamento em 360px: Valor e Data passam da borda do cartão

- **Severidade:** Baixa
- **Página ou fluxo:** Financeiro › Pagamento, celular de 360px
- **URL:** `/admin/financeiro/pagamento/f1ab32bd-…`
- **Critério avaliado:** larguras de tela
- **Passos executados:** abrir o Pagamento num aparelho de 360×780 (emulação com toque).
- **Resultado esperado:** os campos cabem no cartão "Registrar pagamento".
- **Resultado observado:** "Valor" e "Data do pagamento" vão até 369px numa tela de 360px; a
  página rola 9px de lado e a borda direita dos dois campos fica cortada. Em 390px, tudo cabe.
- **Impacto:** pequeno, em celulares estreitos (Android de 360px).
- **Evidência:** `evidencias/reg-03-pagamento-360.jpg`.
- **Recomendação:** `min-w-0`/`w-full` nos dois campos (o de data tem largura mínima própria no
  navegador).

#### REG-04 · Cadastrar paciente: a borda vermelha do campo com erro some ao sair do campo

- **Severidade:** Baixa
- **Página ou fluxo:** Pacientes › Cadastrar paciente, erro do servidor (ex.: WhatsApp "123")
- **Critério avaliado:** indicação visual do erro (correção da R6, QA-03: "borda vermelha")
- **Passos executados:**
  1. Preencher o cadastro com o WhatsApp "123" e tocar em "Cadastrar paciente".
  2. Com o erro na tela, sair do campo (Tab ou toque fora).
- **Resultado esperado:** o campo continua com a borda vermelha até ser corrigido, como em
  Configurações (Novo profissional, Clínica).
- **Resultado observado:** com o foco, a borda é vermelha (`rgb(163,38,28)`); sem o foco, volta a
  cinza (`rgb(197,211,206)`). O campo tem as classes `border-line-strong` e `border-danger` ao mesmo
  tempo, e a cinza vence. A mensagem embaixo do campo e o `aria-invalid` continuam certos.
- **Impacto:** pequeno: quem sai do campo deixa de ver qual está errado (a mensagem continua
  embaixo dele).
- **Evidência:** `evidencias/reg-04-cadastrar-telefone-sem-foco.png`; classes e cores lidas no
  navegador.
- **Recomendação:** trocar a classe da borda (e não somar) quando houver erro, como faz o
  `formStyles.ts`.

### 6.2 Suspeitas

#### S-01 · Ficha e Pagamento sem borda vermelha no campo com erro

- **Observado:** no cartão Financeiro da ficha (CPF inválido) e no Valor do Pagamento, o campo fica
  com `aria-invalid`, foco e a mensagem logo acima, mas sem borda vermelha (cinza; verde com o
  foco). Em Configurações e na Clínica, a borda é vermelha.
- **Por que é suspeita:** a borda vermelha no Pagamento ficou para decisão do cliente no relatório
  da R5 (recomendação 5); a correção da R9 deu a borda só aos campos do padrão novo (`formStyles.ts`).
  Não é regressão, mas o painel mostra o erro de dois jeitos.
- **O que falta para confirmar:** o cliente decidir se todo campo com erro ganha a borda vermelha.
- **Evidência:** `evidencias/reg-s01-ficha-cpf-390.jpg`.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Reenvio depois de corrigir só o campo (cadastros, pagamento, configurações) | Gravaria dados |
| Avisos de sucesso ("… salvo.") e ações da Agenda até o fim | Gravariam dados ou enviariam WhatsApp |
| `/formulario` com o nome apagado (R11 FORM-04) | O envio grava o rascunho do pedido do seed |
| Título da aba de link usado ou cancelado (R11 QA-02) | Nenhum link usado no seed |
| Contraste do horário escolhido com o verde padrão e as cores quentes (R11 QA-01) | Trocar a cor da clínica gravaria; só a cor do seed foi medida |
| "Abrindo…" e barra de carregamento em Configurações no celular | Prefetch do Astro abre a seção na hora |
| "Outra data" no iPhone | Sem Safari/iPhone real; no Chromium o campo vem preenchido |
| Métricas › Faltosos com dados; `/admin/nova-senha` com link; `/orientacoes` com texto | Sem dado no seed |

## 7. Limitações

- Ambiente local de desenvolvimento: a barra de ferramentas do Astro aparece em algumas capturas;
  o CSP do build não foi exercitado.
- A primeira varredura (1280 e 390px) comparava a largura da página com a da janela, que inclui a
  barra de rolagem de 15px do Chromium de teste; por isso a segunda passada usou a largura útil e a
  emulação de aparelho, que é a medida que vale para os achados de largura.
- Sem leitor de tela: foram conferidos atributos, foco e ordem de tabulação, não a fala.
- Só Chromium. Safari e Firefox não testados.
- Navegar como Suporte dentro de uma clínica grava o registro de acesso que o sistema mantém, e o
  "Abrir a clínica para configurar" troca a clínica ativa da sessão do Suporte; as tabelas de dados
  ficaram iguais.

## 8. Evidências

- **No repositório** (como nas rodadas anteriores; só dados fictícios do seed):
  `docs/auditoria-frontend/evidencias/reg-*.jpg|png`. Defeitos: `reg-01-agenda-768-filtros.jpg`,
  `reg-01-agenda-768-rolagem.jpg`, `reg-02-abas-768-rolagem.jpg`, `reg-03-pagamento-360.jpg`,
  `reg-04-cadastrar-telefone-sem-foco.png`, `reg-s01-ficha-cpf-390.jpg`. Aprovados:
  `reg-ok-marcar-faixa-390.jpg`, `reg-ok-marcar-serie-1280.jpg`,
  `reg-ok-clinica-erro-limites-1280.jpg`, `reg-ok-suporte-trocar-1280.jpg`,
  `reg-ok-semjs-dmed-390.jpg`, `reg-ok-agenda-lista-390.jpg`.
- **Fora do repositório:** as 237 capturas da varredura e os roteiros em
  `~/.playwright-mcp/regressao/` (pasta do MCP, fora do git).
- **Dados sensíveis:** só dados fictícios do seed; a senha local não aparece em nenhum arquivo do
  relatório; nenhum token, cookie ou cabeçalho registrado.

## 9. Recomendações

1. **REG-01 (Média):** barra de filtros da Agenda em duas linhas abaixo de `lg`; incluir 640, 768,
   820 e 1024px no teste de toda tela nova.
2. **REG-02 e REG-03 (Baixas):** margem da barra de abas e largura dos campos do Pagamento.
3. **REG-04 (Baixa) e S-01:** decidir um padrão único de campo com erro (borda vermelha em todo o
   painel) e aplicar no Cadastrar paciente, nos cartões da ficha e no Pagamento.
4. Antes do 1º piloto, repetir o caminho de sucesso (reenvio depois do erro, avisos de "salvo") num
   banco descartável, para fechar os BLOQUEADOS desta rodada.
