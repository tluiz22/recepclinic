# Relatório de testes de interface: Configurações › Horários, o tipo como título (ajuste da 3B, proposta A)

## 1. Resumo da execução

- **Data:** 2026-10-19
- **Executado por:** Claude (MCP Playwright)
- **Resultado geral:** 1 falha da implementação (Baixa), corrigida e retestada na mesma rodada.
- **Síntese:** cada horário abre com a faixa do tipo (como na Agenda), depois o horário e o local. O horário de todos
  os serviços diz "Consulta e Retorno" na agenda da Dra. Helena Costa; a turma da agenda Exames diz "Exame ·
  Espirometria" com as vagas. O "⋯" segue recebendo o clique em todos os blocos, e nada passa da tela de 360 a 1440px.

| Status | Quantidade |
| --- | --- |
| PASSOU | 9 (1 depois da correção) |
| FALHOU | 0 em aberto (1 corrigida) |
| BLOQUEADO | 0 |
| NÃO APLICÁVEL | 1 |
| **Total executado** | 10 |

## 2. Ambiente

- **URL base:** `http://localhost:4321/admin/configuracoes/horarios`
- **Ambiente:** local. Para ver os tipos, 2 horários criados por SQL no banco local na agenda da Dra. Helena Costa
  (Terça, 08:00–12:00, só Retorno pediátrico; Quinta, 14:00–17:00, só Consulta pediátrica, desativado) e **apagados no
  fim**; estado final igual ao inicial (3 horários ativos).
- **Navegador e viewport:** Chromium; 360, 390, 768, 1024, 1280 e 1440px
- **Versão/commit da aplicação:** `bde2852` com o ajuste ainda sem commit
- **Usuário de teste:** Administrador da Clínica Exemplo Saúde (seed)

## 3. Escopo

- **Incluído:** o bloco de cada horário nas colunas (computador) e na lista por dia (celular e tablet).
- **Fora do escopo:** o formulário "Novo horário" e as ações do "⋯" (não mudaram; testados na 3B).

## 4. Ferramentas utilizadas

- MCP Playwright; `npm test` (536, 2 novos em `categoryStyle.test.ts`) e `npm run check` (0 erros).

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| V-01 | Ordem do bloco: faixa do tipo, horário, local (e vagas) | Proposta A | Adicional | PASSOU | — |
| V-02 | Horário de todos os serviços (Dra. Helena Costa, Consulta pediátrica e Retorno pediátrico): "Consulta e Retorno", faixa verde-clara | Decisão do cliente | Adicional | PASSOU | — |
| V-03 | Horário só de Retorno: faixa roxa "Retorno" com "Retorno pediátrico" abaixo | Proposta A | Adicional | PASSOU | — |
| V-04 | Horário desativado (Consulta): faixa e bloco tracejados, com listras, selo "Desativado" | Proposta A | Adicional | PASSOU | — |
| V-05 | Turma da agenda Exames: "Exame", "Espirometria", 07:00–08:00, Consultório Centro, "4 vagas" | Proposta A | Adicional | PASSOU | — |
| V-06 | Larguras 360, 768, 1024, 1280 e 1440px: sem rolagem lateral | Larguras | Adicional | PASSOU | — |
| V-07 | O centro dos 5 "⋯" das colunas recebe o clique; o menu abre com Desativar e Remover | Ação | Adicional | PASSOU | — |
| V-08 | Contraste do tipo: verde `#0A5C4A` sobre `#DCEFE8` e roxo `#5A3E9E` sobre `#F1ECFA` (acima de 6,5:1) | Contraste | Adicional | PASSOU | — |
| QA-01 | Coluna de ~100px: o tipo partido no meio da palavra ("Consul-ta e Retor-no") | Leiaute | Adicional | PASSOU após correção | Baixa |
| FORM-01 | Preservação dos campos após erro | Preservação dos campos | Obrigatório | NÃO APLICÁVEL | — |

### 5.4 Não aplicáveis

- FORM-01: o ajuste muda só o bloco; o formulário não mudou.

## 6. Achados

### 6.1 Defeitos confirmados (corrigido na rodada)

#### QA-01 · Tipo partido na coluna estreita

- **Severidade:** Baixa
- **Observado:** com o ícone ao lado, o tipo tinha ~60px e era hifenizado ("Consul-ta", "Retor-no"); sem a hifenização,
  a palavra inteira ainda não cabia.
- **Correção:** na coluna, o ícone fica acima do tipo e o tipo usa a largura toda, quebrando só entre palavras
  ("Consulta e / Retorno"). No celular, o ícone continua ao lado. Retestado em 1280 e 1440px.

### 6.2 Suspeitas

Nenhuma.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Agenda de um tipo só com horário de todos os serviços (faixa do tipo, sem verde) | Nenhuma no seed com horário geral; a agenda Exames só tem o horário da turma |

## 7. Limitações

- Só Chromium; sem leitor de tela (ícones com `aria-hidden`; o tipo é texto).

## 8. Evidências

- **No repositório:** `docs/auditoria-frontend/evidencias/3c-colunas-1280.png`, `3c-lista-390.png` (dados fictícios do
  seed).
- **Dados sensíveis:** nenhum.

## 9. Recomendações

1. Na validação, conferir no staging uma agenda com Exame entre os serviços ("Consulta, Retorno e Exame").
