# Relatório de testes de interface: Configurações › Horários em colunas (proposta 3B)

## 1. Resumo da execução

- **Data:** 2026-10-19
- **Executado por:** Claude (MCP Playwright)
- **Resultado geral:** 4 falhas encontradas na implementação nova (1 Alta, 3 Baixas), **todas corrigidas e
  retestadas** na mesma rodada; 1 ponto não verificado.
- **Síntese:** colunas a partir de 1280px e uma linha por dia abaixo disso, sem rolagem lateral de 360 a 1440px. O
  "Adicionar" de cada dia abre o formulário com o dia marcado; depois de um erro, todos os campos ficam; o "⋯"
  desativa, reativa e remove (com confirmação) mantendo "Mostrar desativados". O banco local voltou ao estado inicial.

| Status | Quantidade |
| --- | --- |
| PASSOU | 16 (4 deles depois da correção) |
| FALHOU | 0 em aberto (4 corrigidas) |
| BLOQUEADO | 0 |
| NÃO APLICÁVEL | 0 |
| **Total executado** | 16 |

## 2. Ambiente

- **URL base:** `http://localhost:4321/admin/configuracoes/horarios`
- **Ambiente:** local; gravações só no banco local (2 horários criados, desativados, reativados e removidos; a
  Quarta desativada e reativada); estado final igual ao inicial (3 horários ativos da Dra. Helena Costa).
- **Navegador e viewport:** Chromium; 360, 390, 768, 1024, 1280 e 1440px
- **Versão/commit da aplicação:** `30d9c0f` com a 3B ainda sem commit
- **Usuário de teste:** Administrador da Clínica Exemplo Saúde (seed)

## 3. Escopo

- **Incluído:** barra (agenda, "Mostrar desativados", total da semana), colunas (computador), lista por dia (celular e
  tablet), "⋯" de cada horário, "Adicionar"/"+" de cada dia, formulário "Novo horário".
- **Fora do escopo:** regras de sobreposição dos horários (não mudaram).

## 4. Ferramentas utilizadas

- MCP Playwright; `npm test` (534) e `npm run check` (0 erros).

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| V-01 | Colunas a partir de 1280px; lista por dia de 360 a 1024px; sem rolagem lateral em nenhuma largura | Larguras | Adicional | PASSOU | — |
| V-02 | Total por dia (4h, 3h, "desativado") e da semana ("11h por semana, em 3 dias") | Proposta 3B | Adicional | PASSOU | — |
| V-03 | Horário desativado: tracejado, com listras e o selo "Desativado"; dia só com desativado diz "desativado" | Proposta 3B | Adicional | PASSOU | — |
| NAV-01 | "Adicionar" da Terça (coluna) → `?agenda=…&dia=2#novo-horario`, só a Terça marcada, formulário na tela | Retorno/destino | Obrigatório | PASSOU | — |
| NAV-02 | "+" do Sábado (celular) → `…&dia=6#novo-horario`, Sábado marcado | Destino | Obrigatório | PASSOU | — |
| FORM-01 | Ter + Qui, 12:00 → 08:00, Consultório Centro: "O fim precisa ser depois do início"; `aria-invalid` e foco no Fim; dias, horários, local e serviço mantidos | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-02 | Corrigir só o Fim (13:00) e enviar: "2 horários adicionados.", Terça e Quinta com 12:00–13:00 | Reenvio | Obrigatório | PASSOU | — |
| V-04 | "Mostrar desativados" (caixa) recarrega com `todos=1` | Filtro | Adicional | PASSOU | — |
| V-05 | "⋯" → Desativar e Reativar: aviso certo e volta **com** `todos=1` (antes perdia o filtro) | Retorno ao estado | Adicional | PASSOU | — |
| V-06 | "⋯" → Remover: janela "Remover o horário? Terça-feira, 12:00–13:00…"; "Voltar" não remove; "Remover" remove ("Horário removido.") | Confirmação | Adicional | PASSOU | — |
| V-07 | Teclado: Enter no "⋯" abre o menu com o foco em "Desativar"; Esc fecha e devolve o foco ao "⋯" | Teclado | Adicional | PASSOU | — |
| V-08 | Contraste do texto do horário: 6,64:1 | Contraste | Adicional | PASSOU | — |
| QA-01 | "⋯" ao lado do horário na coluna estreita (101px) | Leiaute | Adicional | PASSOU após correção | Baixa |
| QA-02 | Selo "Desativado" cobria o "⋯" e impedia o clique (Reativar/Remover) no computador | Ação bloqueada | Adicional | PASSOU após correção | Alta |
| QA-03 | Local partido no meio da palavra ("Consult/ório") ao lado do "⋯" | Leiaute | Adicional | PASSOU após correção | Baixa |
| QA-04 | Celular: "⋯" com 32px (alvo de toque) e nome "Novo horário na sábado" | Toque e nome acessível | Adicional | PASSOU após correção | Baixa |

## 6. Achados

### 6.1 Defeitos confirmados (todos corrigidos na rodada)

#### QA-02 · O selo "Desativado" cobria o "⋯" na coluna

- **Severidade:** Alta (impedia reativar ou remover pelo computador)
- **Passos:** "Mostrar desativados" ligado, horário desativado, 1280px; clicar no "⋯".
- **Observado:** o clique caía no selo (`subtree intercepts pointer events`); o selo, sem quebra, é mais largo que o
  espaço ao lado do "⋯".
- **Correção:** o bloco da coluna ficou em três partes: o horário em cima; o local e o serviço na largura toda; embaixo,
  os selos à esquerda e o "⋯" à direita. Retestado: o centro de todos os "⋯" recebe o clique.

#### QA-01 e QA-03 · "⋯" e o local na coluna estreita

- **Observado:** a coluna tem 101px no computador; o "⋯" descia sozinho para a linha do meio e, quando ficou ao lado
  do local, as palavras se partiam ("Consult/ório", "Atendim/ento").
- **Correção:** a mesma da QA-02. Retestado: palavras inteiras e o "⋯" dentro do bloco.

#### QA-04 · Celular: alvo do "⋯" e nome do "+"

- **Observado:** "⋯" com 32px de altura; nome acessível "Novo horário na sábado"/"na domingo".
- **Correção:** "⋯" de 44px na lista do celular; "no sábado" e "no domingo". Retestado: todos os alvos com 44px.

### 6.2 Suspeitas

Nenhuma.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Horário só de um serviço (contorno verde, "só …") e "Vagas da turma" no bloco | Nenhum no seed para esta agenda; não criei um para não depender de serviço em turma |

## 7. Limitações

- Só Chromium; sem leitor de tela (nomes acessíveis conferidos pelos papéis).
- A captura `3b-form-erro-1280.jpg` é anterior às correções do bloco (o formulário não mudou).

## 8. Evidências

- **No repositório:** `docs/auditoria-frontend/evidencias/3b-colunas-1280.jpg`, `3b-colunas-desativado-1280.jpg`,
  `3b-lista-390.jpg`, `3b-form-erro-1280.jpg` (só dados fictícios do seed).
- **Dados sensíveis:** nenhum.

## 9. Recomendações

1. Na validação, conferir no staging um horário só de um serviço e um de turma.
