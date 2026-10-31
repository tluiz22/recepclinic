# Menu lateral (redesign do menu superior)

> **Retomar daqui (31/out/2026):** L1, L2 e L3 feitas e publicadas no staging (sem migração); **aguarda a
> validação do cliente** (no fim, a pedido dele). Depois do menu: revisão da jornada do bot
> ([`jornada-do-bot.md`](jornada-do-bot.md), temporário).

## Por quê

O menu no topo chegou a 9 itens da clínica + o botão "Sistema" e quebra em duas linhas no computador; cada item novo
piora. O cliente pediu levar os itens para a lateral esquerda, como em Configurações (30/out).

Propostas: [página de propostas](https://claude.ai/artifact/43h7JwJQhXYhjr8pLXi1pe) e
[canvas com as opções](https://claude.ai/artifact/R1PZNpNe6ZUsTwvNtSBvKB) (opção 1, fileira de cima).

## Decisões (cliente, 30/out/2026)

- **M1. Opção 1, lateral clara por tarefa.** Coluna branca à esquerda (~256px), nomes inteiros, ícone em cada item,
  título pequeno em cada grupo, contadores em pílula vermelha. Recusadas: coluna verde (opção 2) e trilho + painel
  (opção 3).
- **M2. Grupos por tarefa.** Hoje: Início, Agenda, Resumo do Dia. Pacientes: Pacientes, Atendimento, Relacionamento.
  Gestão: Métricas, Financeiro, Configurações. Sistema · só o Suporte: Clínicas, Matriz de acesso, Vendas, Uso, Erros,
  Tecnologia. Itens sem acesso somem, como hoje.
- **M3. Sem barra no topo.** A clínica (com "Trocar clínica") fica no alto da lateral; a pessoa, o papel e o "Sair",
  no pé. A faixa amarela do Suporte e o aviso de implantação ficam no alto do conteúdo.
- **M4. Abas ficam na tela (X).** Agenda (Dia/Semana/Mês), Resumo do Dia, Relacionamento, Métricas, Pacientes, ficha
  do paciente, Vendas e Tecnologia continuam com as abas dentro da tela. Recusado: abas como subitens da lateral (Y).
- **M5. Configurações dentro da lateral.** Ao abrir Configurações, a lateral troca o menu principal pelas seções
  (grupos A clínica, Atendimento, Mensagens, Financeiro), com "‹ Menu principal" no alto; some a lista de seções
  própria de Configurações no computador. Recusado: duas colunas.
- **M6. Celular igual a hoje na barra inferior** (Início, Agenda, Pacientes, Resumo do Dia, Mais); o "Mais" mostra os
  grupos da lateral em cartões, com o total de Atendimento + Relacionamento no botão. Configurações no celular segue
  com o botão "Seção: …" de hoje.
- **M7. Administração do sistema** (sem clínica aberta): a lateral mostra só os itens do Sistema.

Padrões técnicos (sem decisão de negócio): a lateral aparece a partir de 1024px (`lg`, o mesmo ponto de
Configurações), abaixo vale o modelo do celular; a lateral fica parada enquanto o conteúdo rola.

## Etapas

- **L1. Moldura nova** no `AdminLayout.astro`: lateral com grupos (M1–M3, M7), sem barra do topo; celular com o "Mais"
  em grupos (M6). Testes e conferência no navegador local (1280px e 1440px, Agenda com 4 colunas, Suporte e
  Administrador, celular).
  **Feita em 31/out (local):** lateral de 240px (`w-60`); para caber a Agenda em 1280px, as colunas do Dia passaram
  de no mínimo 250px para 230px (4 colunas sem rolar de lado). De 640px a 1023px (tablet) vale a barra inferior;
  antes, o tablet tinha o menu no topo. O "Mais" mostra Pacientes (Atendimento e Relacionamento), Gestão e Sistema,
  com a soma das pendências no botão. Conferido: Administrador e Suporte em 1280px e 1440px, Administração do
  sistema, Configurações (lista de seções ainda ao lado até a L2), tablet 900px e celular 390px; `npm test` e
  `npm run check` sem erros.
- **L2. Configurações na lateral** (M5): o `ConfigShell` passa as seções para a lateral; "‹ Menu principal";
  "Voltar" para a origem continua como hoje.
  **Feita em 31/out:** o `AdminLayout` ganhou o slot `side` (com `sideTitle`): as seções aparecem no lugar do menu
  principal, com "‹ Menu principal" no alto; o menu principal (com Configurações marcada) tem no alto "Seções de
  Configurações ›" para voltar. A troca é na própria tela, sem recarregar (script no `AdminLayout`). No celular e no
  tablet, o botão "Seção: …" de sempre. Conferido em 1280px (Suporte) e 390px; `npm test` e `npm run check` sem erros.
- **L3. Teste de interface** (Playwright) e publicação no staging; validação do cliente.
  **Feita em 31/out:** [relatório](auditoria-frontend/menu-lateral-report.md), 19 cenários; 2 falhas Baixas
  corrigidas e retestadas (QA-01: só os itens da lateral rolam, com a clínica e o "Sair" fixos; QA-02: a lateral rola
  até o item aberto). Falta a validação do cliente no staging (Safari e iPhone).
