# Relatório de testes de interface: S-01 e S-02 do teste da R11

## 1. Resumo da execução

- **Data:** 2026-10-17
- **Executado por:** Claude (skill `playwright-ui-form-best-practices`), a pedido do cliente
- **Resultado geral:** 2 falhas Baixas (as duas anteriores à S-01 e à S-02), nenhuma Alta ou
  Média; 1 suspeita visual; 15 cenários aprovados. **As 2 falhas e a suspeita corrigidas e
  retestadas em 17/out**, com as decisões do cliente (seção 10)
- **Síntese:** a S-01 funciona como foi decidido: no celular, os 7 dias cabem sem arrastar (46px
  por dia em 390px e 41px em 360px no `/agendar`; 41px e 37px no Marcar e no Remarcar) e as
  setas ficam na linha do "Escolha o dia". No computador, nada mudou. A S-02 mostra o aviso
  certo em todos os casos testados ("Não existe agenda aberta para esse dia." para dia sem
  atendimento, passado, domingo, feriado e depois do prazo do link; "… não tem mais horário
  livre." para o dia ocupado), no `/agendar`, no Marcar e no Remarcar. As falhas: no `/agendar`,
  um dia pedido **depois do último dia livre** some com a faixa e diz "Não encontramos horários
  livres nos próximos dias", mesmo com dias livres antes (S02-08); e, fora do escopo, o
  cabeçalho do painel passa 4px da tela em 360px (QA-01).

| Status | Quantidade |
| --- | --- |
| PASSOU | 15 |
| FALHOU | 2 |
| BLOQUEADO | 0 |
| NÃO APLICÁVEL | 0 |
| **Total executado** | 17 |

## 2. Ambiente

- **URL base:** `http://localhost:4321` (servidor `npm run dev` já no ar)
- **Ambiente:** local, banco do seed (Supabase local). Para o dia ocupado, **um atendimento de
  teste** com o Rafael Lima em 27/10, das 08:00 às 12:00 (id `0a0e9999-…-0000000000aa`),
  **apagado no fim e conferido no banco** (nenhum bloqueio criado). Nenhuma marcação nem
  remarcação confirmada; nenhum WhatsApp nem e-mail enviado.
- **Navegador e viewport:** Chromium (MCP Playwright), 390×844, 360×780 e 1280×900
- **Versão/commit da aplicação:** `a9d7370` mais a S-01 e a S-02 sem commit (árvore de trabalho)
- **Usuários de teste:** link 1 do seed no `/agendar` (Júlia Ramos, Avaliação inicial, sem
  login); Administrador da Clínica Exemplo Saúde no painel (login do seed, sem senha neste
  relatório)

## 3. Escopo

- **Incluído:** faixa de dias no celular e no computador (`/agendar`, Marcar e Remarcar do
  painel), setas, "Voltar" do Remarcar depois das setas, teclado; aviso do dia pedido sem
  horário (pelo endereço no `/agendar` e pelo "Outra data" no painel).
- **Fora do escopo:** confirmar uma marcação ou remarcação (grava o atendimento e manda o
  WhatsApp).

## 4. Ferramentas utilizadas

- MCP Playwright (exploração, com `browser_run_code` para ler larguras, rolagem, URL, atributos
  ARIA, foco e textos dos avisos). O projeto não tem `@playwright/test`; não foram criadas specs.
- `psql` no banco local para criar e apagar o atendimento de teste.

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| S01-01 | `/agendar` em 390px: 7 dias sem rolagem, setas na linha do título | Decisão S-01 | Obrigatório | PASSOU | — |
| S01-02 | `/agendar` em 360px | Decisão S-01 | Obrigatório | PASSOU | — |
| S01-03 | `/agendar` em 1280px: setas dos lados, as do título ocultas | Decisão S-01 | Obrigatório | PASSOU | — |
| S01-04 | `/agendar`: "Próximos dias" → "Dias anteriores" | Retorno/estado | Obrigatório | PASSOU | — |
| S01-05 | Marcar em 390px e 360px: 7 dias, setas no título, "Outra data" sozinho embaixo | Decisão S-01 | Obrigatório | PASSOU | — |
| S01-06 | Remarcar (aberto pela Agenda de 20/10): setas e depois "Voltar" | Retorno | Obrigatório | PASSOU | — |
| S01-07 | Teclado: Enter na seta do celular | Qualidade adicional | Adicional | PASSOU | — |
| S02-01 | `/agendar` sem agenda: 21/10 (qua), 10/10 (passado), 17/10 (hoje, sábado), 25/10 (domingo), 02/11 (Finados) | Decisão S-02 | Obrigatório | PASSOU | — |
| S02-02 | `/agendar` depois do prazo do link: 20/11, 31/12, 01/03/2027 (aviso) | Decisão S-02 | Obrigatório | PASSOU | — |
| S02-03 | `/agendar` com o dia 27/10 ocupado | Decisão S-02 | Obrigatório | PASSOU | — |
| S02-04 | Tocar noutro dia tira o aviso | Decisão S-02 | Obrigatório | PASSOU | — |
| S02-05 | Data inválida no endereço (`abc`, `2026-02-30`) | Robustez | Adicional | PASSOU | — |
| S02-06 | Marcar, "Outra data": 27/10 ocupado, 21/10, 02/11, Rafael 27/10 e 28/10, 30/12 | Decisão S-02 | Obrigatório | PASSOU | — |
| S02-07 | Remarcar, "Outra data": 27/10 ocupado, 28/10 sem agenda | Decisão S-02 | Obrigatório | PASSOU | — |
| S02-08 | `/agendar` com dia pedido depois do último dia livre | Faixa depois do aviso | Obrigatório | FALHOU | Baixa |
| QA-01 | Largura do painel em 360px (cabeçalho) | Qualidade adicional | Adicional | FALHOU | Baixa |
| QA-02 | Console do navegador | Qualidade adicional | Adicional | PASSOU | — |

### 5.1 Aprovados

- **S01-01:** em 390px, os 7 dias de 19/10 a 03/11 com 46px cada, sem rolagem na faixa nem na
  página; a seta "‹" desligada e a "›" (44×44px) na linha do "Escolha o dia".
- **S01-02:** em 360px, 41px por dia, sem rolagem.
- **S01-03:** em 1280px, as setas do título ficam ocultas (fora da árvore de acessibilidade) e
  as dos lados aparecem; 62px por dia, como antes.
- **S01-04:** "›" leva a `?date=2026-11-05&start=2026-11-05` (05/11 marcado) e "‹" volta a
  `?date=2026-10-19&start=2026-10-19` com os mesmos 7 dias do começo; sem recarregar a página.
- **S01-05:** Marcar com Júlia Ramos e Avaliação inicial: 41px por dia em 390px e 37px em 360px,
  sem cortar o texto; só a "›" (habilitada) na linha do título; o "Outra data" ocupa a linha de
  baixo sozinho.
- **S01-06:** "‹" e "›" do Remarcar mudam a faixa (20/10 a 08/12, depois 15/12) e o "Voltar"
  leva a `/admin/agenda?date=2026-10-20` (a Agenda de onde veio).
- **S01-07:** depois do Enter na "›" o foco vai para o corpo da página (a faixa é trocada sem
  recarregar, como já era antes), mas o próximo Tab continua na faixa nova (10/11) e o Shift+Tab
  volta para 09/11: quem usa teclado não volta para o topo.
- **S02-01:** os 5 dias mostram "Não existe agenda aberta para esse dia." acima da faixa, que
  abre no primeiro dia livre seguinte (22/10, 19/10, 19/10, 26/10 e 03/11).
- **S02-02:** o aviso "Não existe agenda aberta para esse dia." aparece (o link vence em 11/11).
  Ver S02-08 para o que vem abaixo dele.
- **S02-03:** "Terça-feira, 27/10 não tem mais horário livre. Mostramos o próximo dia com
  horário.", com 29/10 marcado e o 27/10 fora da faixa.
- **S02-04:** tocar em 26/10 troca a escolha sem recarregar, e o aviso some.
- **S02-05:** sem aviso; abre no primeiro dia livre (19/10).
- **S02-06:** 27/10 "Terça-feira, 27/10 não tem mais horário livre para Avaliação inicial."; com
  o Rafael Lima escolhido, "… com Rafael Lima para Avaliação inicial."; 21/10, 02/11, Rafael
  28/10 e 30/12 "Não existe agenda aberta para esse dia."; o "Mostrando a partir de …" (ou "Não
  há dia livre depois dele …" no 30/12) continua.
- **S02-07:** 27/10 "Terça-feira, 27/10 não tem mais horário livre. Mostrando a partir de
  terça-feira, 03/11 …"; 28/10 "Não existe agenda aberta para esse dia. …".
- **QA-02:** nenhum erro nem aviso no console.

### 5.2 Falhas

Ver a seção 6.

### 5.3 Bloqueios

Nenhum.

### 5.4 Não aplicáveis

Nenhum.

## 6. Achados

### 6.1 Defeitos confirmados

#### S02-08 · `/agendar`: dia pedido depois do último dia livre esconde os dias livres

- **Severidade:** Baixa
- **Página ou fluxo:** `/agendar` (paciente)
- **URL:** `/agendar/0a0e0000-0000-4000-8000-000000000001?date=2026-11-20`
- **Critério avaliado:** a faixa depois do aviso da S-02
- **Pré-condições:** link 1 do seed (vence em 11/11; dias livres de 19/10 a 10/11)
- **Passos executados:**
  1. Abrir o link com `?date=2026-11-20` (também com 31/12/2026 e 01/03/2027).
- **Resultado esperado:** o aviso "Não existe agenda aberta para esse dia." e a faixa com os dias
  livres que o link tem, para a pessoa escolher outro.
- **Resultado observado:** o aviso, **sem a faixa** e com o quadro "Não encontramos horários
  livres nos próximos dias. Fale com a clínica pelo WhatsApp.", embora o link tenha 15 dias
  livres. O "Confirmar" fica desligado.
- **Impacto:** a pessoa acha que não há horário e procura a clínica sem precisar. Só acontece com
  endereço montado à mão, ou com um endereço guardado de uma troca de dia anterior quando os
  dias seguintes deixaram de ter horário. A causa é anterior à S-02 (`buildDayStrip` só
  procura um dia livre **depois** do pedido); a S-02 só pôs o aviso em cima.
- **Evidência:** `evidencias/s0102-agendar-depois-do-prazo-390.png`
- **Recomendação:** no `/agendar`, quando não houver dia livre depois do pedido, mostrar a faixa
  na última página de dias livres (ou na primeira), com o aviso; o texto "Mostramos o próximo
  dia com horário" fica de fora, como hoje. No painel o caso já tem o "Outra data" e o texto
  "Não há dia livre depois dele …", então pode ficar como está. **Decisão do cliente.**

#### QA-01 · Painel em 360px: o cabeçalho passa 4px da tela

- **Severidade:** Baixa (fora do escopo; anterior à S-01)
- **Página ou fluxo:** todas as telas do painel (visto na Agenda, no Início, em Pacientes e no
  Marcar)
- **Passos executados:** abrir o painel em 360px de largura (sem barra de rolagem).
- **Resultado esperado:** nada passa da largura da tela.
- **Resultado observado:** o botão "Sair" termina em 365px e a página rola 4px para o lado. A
  faixa de dias não contribui (rolagem 0).
- **Evidência:** `evidencias/s0102-cabecalho-360.png`
- **Recomendação:** no celular estreito, encurtar o cabeçalho (por exemplo, esconder o
  "Administrador" abaixo de 380px ou deixar o nome da clínica quebrar/cortar).

### 6.2 Suspeitas

#### S-01 · Última página com um dia só: o dia ocupa a linha inteira

- No Remarcar com o Rafael Lima, a última página da faixa tem só 15/12, e o dia ocupa a largura
  toda (313px em 390px). Antes da S-01, no celular, cada dia tinha 58px; agora o celular faz
  como o computador, onde isso já acontecia (640px em 1280px). O mesmo vale com 2 a 6 dias (por
  exemplo, 4 dias no `/agendar` a partir de 02/11). Funciona, mas o dia "esticado" chama atenção.
  **Para confirmar:** se o cliente prefere manter (igual ao computador) ou limitar a largura de
  cada dia (por exemplo, no máximo a de uma faixa com 7). Evidências:
  `evidencias/s0102-remarcar-um-dia-390.png` e `s0102-remarcar-um-dia-1280.png`.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Confirmar uma marcação ou remarcação depois de usar as setas | Grava o atendimento e manda o WhatsApp; a S-01 e a S-02 não mexem no envio |
| iPhone de verdade | Só o Chromium com a largura do celular |

## 7. Limitações

- O Chromium do teste mostra barra de rolagem de 15px; as larguras do celular foram medidas com
  ela e, no QA-01, também sem ela (como no celular de verdade).
- Sem leitor de tela; acessibilidade vista pelos nomes acessíveis, `aria-*` e foco.

## 8. Evidências

- **Local:** `docs/auditoria-frontend/evidencias/` (prefixo `s0102-`)
- **Arquivos:** `s0102-agendar-sem-horario-390.png`, `s0102-agendar-depois-do-prazo-390.png`,
  `s0102-agendar-1280.png`, `s0102-marcar-390.png`, `s0102-remarcar-sem-horario-390.png`,
  `s0102-remarcar-um-dia-390.png`, `s0102-remarcar-um-dia-1280.png`, `s0102-cabecalho-360.png`
- **Dados sensíveis:** só dados do seed; nenhuma senha, token ou cookie registrado.

## 9. Recomendações

1. S02-08: no `/agendar`, a faixa continua visível quando o dia pedido vem depois do último dia
   livre (decisão do cliente).
2. Suspeita da S-01: decidir se o dia sozinho na última página fica esticado.
3. QA-01: cabeçalho do painel em 360px (fora do escopo, pode ficar para depois).

## 10. Correções (17/out, decisões do cliente) e reteste

| ID | Decisão e correção | Reteste |
| --- | --- | --- |
| S02-08 | **Aviso + faixa a partir do primeiro dia livre.** Em `agendar/[token].astro`, quando o dia pedido vem depois do último dia livre, a faixa abre no primeiro dia livre do link e o aviso continua; o "Mostramos o próximo dia com horário." só aparece quando o dia mostrado vem depois do pedido. | **PASSOU**: 20/11 → "Não existe agenda aberta para esse dia." e a faixa de 19/10 a 03/11, sem o quadro "Não encontramos horários"; 12/11 ocupado (último dia livre, atendimento de teste apagado em seguida) → "Quinta-feira, 12/11 não tem mais horário livre." sem a segunda frase, faixa a partir de 19/10; 21/10 e 02/11 como antes. |
| Suspeita da S-01 | **Cada dia com no máximo 1/7 da faixa**, alinhado à esquerda (`DayStrip` e `PatientDayStrip`, no celular e no computador). | **PASSOU**: Remarcar com só 15/12: 41px em 390px e 85px em 1280px (antes 313px e 640px); com 7 dias, as larguras não mudam (41px, 46px no `/agendar`, 79px no Marcar em 1280px, 62px no `/agendar`); `/agendar` a partir de 02/11 com 4 dias de 46px. |
| QA-01 | **Abaixo de 380px, o papel ("Administrador") sai do cabeçalho**, e no celular o nome da clínica pode encolher com "…" (`AdminLayout`). | **PASSOU**: em 360px, "Sair" termina em 344px e a página não rola para o lado (Agenda e Início); em 380px e 390px o papel continua, sem rolagem e sem cortar o nome (sem a barra de rolagem do navegador de teste); 1280px igual a antes. |

`astro check` sem erros, `npm test` (509) e o teste de banco `agendar-link` (12). Banco local sem
os atendimentos de teste (conferido). Evidências do reteste: `s0102-reteste-agendar-depois-do-prazo-390.png`,
`s0102-reteste-agendar-4-dias-390.png`, `s0102-reteste-agendar-ultimo-ocupado-390.png`,
`s0102-reteste-remarcar-um-dia-390.png`, `s0102-reteste-remarcar-um-dia-1280.png` e
`s0102-reteste-cabecalho-360.png`.
