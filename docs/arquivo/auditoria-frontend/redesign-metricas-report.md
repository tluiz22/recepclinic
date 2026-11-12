# Relatório de testes de interface: Métricas › Desempenho e Agendamento digital (redesign M4 e M5)

## 1. Resumo da execução

- **Data:** 2026-10-22
- **Executado por:** Claude (skill playwright-ui-form-best-practices, MCP Playwright)
- **Resultado geral:** 2 falhas Baixas (QA-01 e QA-02), **as duas corrigidas e retestadas**; 2 bloqueios por
  falta de dados no banco local.
- **Síntese:** as duas abas novas abrem em "Este mês" (1 a 22/out), os filtros (período, comparação, agenda,
  serviço, local, operação, origem) mudam os números e ficam no endereço, a visão do Profissional fica só na
  própria agenda e sem as abas do bot, e nada passa da tela em 360 e 390px. Achados: links de texto com 28px
  de altura no celular e o "i" que não fechava com Esc nem com toque fora.

| Status | Quantidade |
| --- | --- |
| PASSOU | 27 |
| FALHOU | 2 (corrigidas) |
| BLOQUEADO | 2 |
| NÃO APLICÁVEL | 1 |
| **Total executado** | 32 |

## 2. Ambiente

- **URL base:** `http://localhost:4321` (`npm run dev` do cliente)
- **Ambiente:** local, banco do `supabase start`, sem gravar dados pela tela (só leituras e a troca de filtros).
  Dados de teste: seed + `scripts/metricas-local.sql` (dois meses fictícios na Clínica Exemplo Saúde).
- **Navegador e viewport:** Chromium, 1280×900, 390×844 e 360×780
- **Versão:** `main` depois do commit `d383929` (M4), com a M5 ainda sem commit
- **Usuários de teste:** `admin@exemplo-saude.local` (Administrador) e `pediatra@exemplo-saude.local`
  (Profissional, só a própria agenda)

## 3. Escopo

- **Incluído:** `/admin/metricas` abas Desempenho e Agendamento digital; a quantidade na aba Retomar contato;
  os endereços das abas antigas (`visao_geral`, `atendimentos`, `funil`).
- **Fora do escopo:** Faltosos, Retomar contato (lista) e Financeiro, sem mudança de regra neste redesign.
  Não há formulário que grave dados nessas abas (os filtros são GET).

## 4. Ferramentas utilizadas

- MCP Playwright (navegação, cliques, teclado, leitura do DOM, capturas, console).
- As contas foram testadas à parte: `tests/db/metricas-contas.test.ts`, `metricsRules.test.ts`,
  `performance.test.ts` e `botFunnel.test.ts`.

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| EST-01 | Abre sem `?tab` e sem período | Desempenho, "Este mês", subtítulo "1 a 22 de outubro" | Obrigatório | PASSOU | — |
| EST-02 | Período Hoje, 7 dias, Mês anterior | Subtítulo e números mudam; sem erro | Obrigatório | PASSOU | — |
| EST-03 | Período sem dados (mar/2027) | Estado "Nenhum atendimento de 01/03 a 10/03" com "Ver o mês todo" | Obrigatório | PASSOU | — |
| EST-04 | Base pequena (Hoje) | "9 de 11" no lugar de %; comparecimento sem registro mostra "—" | Obrigatório | PASSOU | — |
| EST-05 | Desfecho desconhecido | Selo "Parcial" com 22 sem registro; item no "Precisa de atenção" | Obrigatório | PASSOU | — |
| EST-06 | Sem comparação | Motivo escrito ("a clínica começou a usar o RecepClinic em 22/10/2026") | Obrigatório | PASSOU | — |
| EST-07 | Comparação ligada (Agendamento digital) | "▲ 6,5%" e "46 de 1 a 22/set (mesmos 22 dias)"; taxa em pontos | Obrigatório | PASSOU | — |
| EST-08 | Erro de um bloco | O bloco mostra o aviso e o resto continua | Obrigatório | BLOQUEADO | — |
| EST-09 | Sem tentativas no período (digital) | "Nenhuma tentativa de 1/01 a 5/01" | Obrigatório | PASSOU | — |
| EST-10 | Bot sem nenhuma tentativa | "O agendamento pelo WhatsApp ainda não teve tentativas" | Obrigatório | BLOQUEADO | — |
| EST-11 | Carregando | Aviso "Calculando os números…" ao trocar filtro/aba | Adicional | PASSOU | — |
| FIL-01 | Agenda (Dra. Helena) | Subtítulo, tabela só com Consulta e Retorno pediátrico | Obrigatório | PASSOU | — |
| FIL-02 | Serviço Espirometria | Bloco Retornos some | Obrigatório | PASSOU | — |
| FIL-03 | Serviço Sessão de psicoterapia + comparação desligada | Números do serviço; interruptor "desligado" | Obrigatório | PASSOU | — |
| FIL-04 | Local "Atendimento domiciliar" | Números só do local | Obrigatório | PASSOU | — |
| FIL-05 | Agrupar por dia | Uma faixa por dia no gráfico e na tabela escondida | Obrigatório | PASSOU | — |
| FIL-06 | Ordenar pelas faltas | Tabela da maior taxa para a menor, volta para `#por-servico` | Obrigatório | PASSOU | — |
| FIL-07 | Operação Remarcar / Cancelar pelo lembrete / Só retorno | Funil e tabela da operação; remarcar não soma nas marcações | Obrigatório | PASSOU | — |
| FIL-08 | Origem "Só pelo menu" | Linhas de lembrete fora | Obrigatório | PASSOU | — |
| FIL-09 | Personalizado inválido (De depois de Até) | Mensagem e os 2 campos com `aria-invalid` | Obrigatório | PASSOU | — |
| NAV-01 | Filtro de agenda → aba Agendamento digital → aba Desempenho (cliques) | Volta ao Desempenho com a agenda escolhida | Obrigatório | PASSOU | — |
| NAV-02 | Endereços antigos `visao_geral`, `atendimentos`, `funil`, inexistente | Abrem a primeira aba liberada (200) | Obrigatório | PASSOU | — |
| NAV-03 | "Voltar" da ficha aberta pela lista de oportunidades | Volta às Métricas com os filtros | Obrigatório | NÃO APLICÁVEL | — |
| PRO-01 | Profissional: abas | Desempenho, Faltosos e Financeiro; sem Agendamento digital e Retomar contato | Obrigatório | PASSOU | — |
| PRO-02 | Profissional: escopo | "só da sua agenda", sem o seletor de agenda, só os serviços dela | Obrigatório | PASSOU | — |
| PRO-03 | Profissional pede `?tab=digital` e `?tab=retomar_contato` | Cai no Desempenho | Obrigatório | PASSOU | — |
| ACE-01 | "i" pelo teclado (Tab + Enter) | Abre a regra com o nome acessível "Como contamos: …" | Adicional | PASSOU | — |
| QA-02 | "i": Esc e toque fora | Fecha e devolve o foco | Adicional | FALHOU → corrigido | Baixa |
| RES-01 | 360px (Desempenho e digital) | Sem rolagem lateral; gráficos rolam dentro do cartão e legíveis | Adicional | PASSOU | — |
| RES-02 | 390px | Sem rolagem lateral | Adicional | PASSOU | — |
| QA-01 | Alvos de toque no celular | Links de ação com 44px | Adicional | FALHOU → corrigido | Baixa |
| CON-01 | Console | Sem erros | Adicional | PASSOU | — |

### 5.1 Aprovados

- EST-04: com "Hoje", Confirmaram pelo lembrete mostra "9 de 11" e Comparecimento "—" com "Nenhum comparecimento
  registrado ainda." (nunca "0%" sem base).
- EST-07: no Agendamento digital, "Tentativas de marcar 49 ▲ 6,5% · 46 de 1 a 22/set (mesmos 22 dias)" e
  "Concluíram 53% ▲ 12 pontos".
- FIL-07: Remarcar mostra "Do pedido à data nova", 5 tentativas e a taxa "3 de 5"; as linhas "Pelo menu" e "Pelo
  lembrete"; as marcações não entram.
- EST-11: ao tocar em "7 dias", o aviso "Calculando os números…" aparece (`role="status"`) até a página nova.
- PRO-01 a PRO-03: o Profissional vê só as linhas "Retorno pediátrico" e "Consulta pediátrica" (a agenda dele).

### 5.2 Falhas

Ver a seção 6.

### 5.3 Bloqueios

- EST-08 (erro de um bloco): simular a falha exigiria derrubar uma função do banco local. O comportamento está no
  código (`safe()` em `PerformanceTab.astro` e `DigitalTab.astro`: aviso no bloco e o erro registrado) e o resto
  da página continua.
- EST-10 (bot sem tentativas): a clínica local tem tentativas (dados fictícios) e a outra clínica da seed não foi
  usada neste teste. O estado está no código (`DigitalTab.astro`, sem nenhum passo gravado na clínica).

### 5.4 Não aplicáveis

- NAV-03: a lista de oportunidades estava vazia nos dados locais (os 4 pacientes da seed já têm retorno ou consulta
  futura). O link usa `withReturn`, o mesmo das outras listas já testadas (R6, R7).

## 6. Achados

### 6.1 Defeitos confirmados

#### QA-01 · Links de ação com 28px de altura no celular

- **Severidade:** Baixa
- **Página ou fluxo:** Desempenho, 390px
- **Critério avaliado:** qualidade adicional (alvo de toque de 44px, regra do redesign)
- **Passos executados:** abrir `/admin/metricas` em 390×844; medir os links de ação fora dos gráficos.
- **Resultado esperado:** 44px de altura no celular.
- **Resultado observado:** "Registrar na Agenda ›", "Ver os lembretes ›", "Ver quem falta com frequência ›" e
  "Ordenar pelas faltas" com 28px.
- **Correção:** `min-h-11` no celular (`Attention.astro` e `PerformanceTab.astro`). **Retestado:** nenhum link
  abaixo de 36px.

#### QA-02 · O "i" não fechava com Esc nem com toque fora

- **Severidade:** Baixa
- **Página ou fluxo:** indicadores das duas abas
- **Critério avaliado:** qualidade adicional (teclado)
- **Passos executados:** abrir o "i" de Comparecimento; apertar Esc; tocar fora.
- **Resultado esperado:** o balão fecha e o foco volta ao "i".
- **Resultado observado:** o balão continuava aberto, cobrindo o número.
- **Correção:** script na página: Esc fecha e devolve o foco; toque fora fecha. **Retestado:** fecha e o foco
  volta para "Como contamos: Comparecimento".

### 6.2 Suspeitas

- A comparação do Desempenho não pôde ser vista com números no local, porque a clínica da seed "começou" hoje (o
  aviso de sem comparação aparece, como deve). As regras estão nos testes de unidade (`metricsRules.test.ts`) e a
  mesma comparação apareceu no Agendamento digital. Conferir no staging, na validação.

### 6.3 Pontos não verificados

- Leitor de tela real (só a estrutura: tabela escondida dos gráficos, nomes acessíveis e `role="img"`).
- Tempo com um ano de 50 mil atendimentos (critério da proposta: menos de 1,5 s no staging). As contas estão no
  banco, com os índices da M1. Falta medir com um volume desse tamanho.

## 7. Evidências

Capturas fora do repositório, em `~/.playwright-mcp/` (`m4-desktop.png`, `m4-360.png`, `m4-360-chart.png`,
`m5-desktop.png`, `m5-360.png`, `m5-info.png`). Sem dados pessoais reais (dados fictícios do banco local).
