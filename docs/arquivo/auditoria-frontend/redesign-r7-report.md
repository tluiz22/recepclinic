# Relatório de testes de interface: R7 (Início e Métricas)

## 1. Resumo da execução

- **Data:** 2026-10-16
- **Executado por:** Claude (skill `playwright-ui-form-best-practices`), a pedido do cliente
- **Resultado geral:** 4 cenários falharam, por 3 defeitos (1 Médio e 2 Baixos); 4 bloqueios
- **Síntese:** os "Voltar" testados levam de volta ao Início, e os atalhos, indicadores e avisos abrem o
  destino certo. Nas Métricas, a troca de aba mantém o período, a agenda e o filtro de paciente; o
  celular não rola de lado e os filtros abrem recolhidos. Os perfis veem o que devem. O defeito
  principal é no período **Personalizado**: com datas inválidas, os campos De e Até voltam para a data
  de hoje e o que foi digitado se perde (já era assim antes da R7). Os outros dois são de
  acessibilidade: a mensagem do período inválido e a tabela que entra no Tab sem precisar.

| Status | Quantidade |
| --- | --- |
| PASSOU | 22 |
| FALHOU | 4 |
| BLOQUEADO | 4 |
| NÃO APLICÁVEL | 0 |
| **Total executado** | 26 (mais 4 bloqueados) |

## 2. Ambiente

- **URL base:** `http://localhost:4321` (servidor `npm run dev` do cliente)
- **Ambiente:** local, banco do seed (Supabase local). **Nada foi gravado:** as telas da R7 só leem
  dados, menos o "Revisado", que foi aberto e cancelado no diálogo de confirmação.
- **Navegador e viewport:** Chromium (MCP Playwright), 1280×900, 1440×900 e 390×844, com e sem
  JavaScript
- **Versão/commit da aplicação:** `088711f` (R7, ainda não publicada no staging)
- **Usuários de teste:** Administrador, Recepção, Profissional (pediatra) e Suporte da "Clínica Exemplo
  Saúde"; Administrador da "Odonto Exemplo". Logins do seed, sem senhas neste relatório.

## 3. Escopo

- **Incluído:**
  - o Início (`/admin/dashboard`): atalhos, avisos, indicadores e "Contatos para revisar";
  - as Métricas (`/admin/metricas`): as 6 abas, o período (com Personalizado), a agenda, o filtro
    por paciente ou responsável e as tabelas;
  - o celular, sem JavaScript e os perfis.
- **Fora do escopo:** as telas de destino (Marcar, Resumo do Dia, contato, Nota fiscal), a não ser
  como destino e origem do "Voltar".

## 4. Ferramentas utilizadas

- MCP Playwright (exploração, com `browser_run_code` para ler valores, foco, ordem de tabulação e
  larguras). O projeto não tem `@playwright/test`; não foram criadas specs.

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| NAV-01 | Início › contato (Contatos para revisar) › Voltar | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-02 | Início › Marcar (cabeçalho) › Voltar | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-03 | Celular: Início › Marcar (barra fixa) › Voltar | Retorno à página anterior | Obrigatório | PASSOU | — |
| NAV-04 | Atalhos e indicadores do Início | Destino certo | Obrigatório | PASSOU | — |
| NAV-05 | Avisos do Início ("Ver os envios", "Abrir Nota fiscal") | Destino certo | Obrigatório | PASSOU | — |
| NAV-06 | Métricas: troca de aba | Mantém período e agenda | Obrigatório | PASSOU | — |
| NAV-07 | Métricas: seletor de agenda | Envia sozinho, mantém aba e período | Obrigatório | PASSOU | — |
| NAV-08 | Filtro por paciente entre abas; "Tirar o filtro" | Mantém aba e período | Obrigatório | PASSOU | — |
| NAV-09 | Faltosos › ficha › Voltar | Retorno à página anterior | Obrigatório | BLOQUEADO | — |
| NAV-10 | Retomar contato › contato › Voltar | Retorno à página anterior | Obrigatório | BLOQUEADO | — |
| FORM-01 | Personalizado com De depois de Até | Preservação dos campos | Obrigatório | FALHOU | Média |
| FORM-02 | Personalizado com mais de 366 dias | Preservação dos campos | Obrigatório | FALHOU | Média (mesmo defeito) |
| FORM-03 | Busca sem resultado | Mantém o texto, a aba e o período | Obrigatório | PASSOU | — |
| FORM-04 | Busca com resultado › escolher › "Com filtro" | Filtro aplicado | Obrigatório | PASSOU | — |
| QA-01 | "Revisado": diálogo e "Voltar" sem gravar | Confirmação | Adicional | PASSOU | — |
| QA-02 | "Revisado": envio | Grava | Adicional | BLOQUEADO | — |
| QA-03 | Ordem das abas e linha do período por extenso | Proposta aprovada | Adicional | PASSOU | — |
| QA-04 | Mensagem do período inválido | Clareza e associação ao campo | Adicional | FALHOU | Baixa |
| QA-05 | Teclado no Início | Ordem de tabulação | Adicional | PASSOU | — |
| QA-06 | Teclado nas Métricas | Ordem de tabulação | Adicional | FALHOU | Baixa |
| QA-07 | Nomes acessíveis (indicadores, WhatsApp, "Tirar o filtro", seletor) | Acessibilidade | Adicional | PASSOU | — |
| QA-08 | Celular: rolagem lateral nas 2 telas e nas 6 abas | Larguras | Adicional | PASSOU | — |
| QA-09 | Celular: filtros recolhidos | Abertos com busca ou Personalizado; abrem no toque | Adicional | PASSOU | — |
| QA-10 | Celular: "Revisado" acima das barras fixas | Larguras | Adicional | PASSOU | — |
| QA-11 | Sem JavaScript | Filtros abertos e telas funcionando | Adicional | PASSOU | — |
| QA-12 | Profissional | Só a própria agenda e as abas dele | Adicional | PASSOU | — |
| QA-13 | Recepção | Métricas negada, aviso no padrão | Adicional | PASSOU | — |
| QA-14 | Suporte | Certificado, "Revisado" e as 6 abas | Adicional | PASSOU | — |
| QA-15 | Itens desligados na matriz somem do Início | Matriz | Adicional | BLOQUEADO | — |
| QA-16 | Console e respostas HTTP | Sem erros e sem 5xx | Adicional | PASSOU | — |

### 5.1 Aprovados

- **NAV-01:** o nome "Carlos Pereira" abre `/admin/pacientes/contato/…?volta=%2Fadmin%2Fdashboard`; o
  "Voltar" leva a `/admin/dashboard`, com o título "Início" e "Contatos para revisar" à vista.
- **NAV-02:** "Marcar" do cabeçalho abre `/admin/agenda/marcar?volta=%2Fadmin%2Fdashboard`; o "Voltar"
  leva ao Início.
- **NAV-03:** no celular, o "Marcar" do cabeçalho some e o da barra fixa leva o mesmo `volta`; o
  "Voltar" do Marcar leva ao Início.
- **NAV-04:** "Agenda do dia" › `/admin/agenda`; "Registrar comparecimento" e o indicador
  "Comparecimento a registrar" › Resumo do Dia, aba A registrar; "Presença não confirmada" › aba
  Lembretes, grupo "Não responderam".
- **NAV-05:** "Ver os envios" › aba Envios; "Abrir Nota fiscal" › Configurações › Nota fiscal.
- **NAV-06:** com "Este mês" e a agenda "Dra. Helena Costa", as abas Atendimentos, Funil, Faltosos e
  Visão geral mantêm os dois no endereço. O Funil mostra "a clínica toda" e esconde a agenda;
  Faltosos mostra "Todo o histórico" e esconde o período.
- **NAV-07:** escolher a agenda recarrega com `agenda=…`, mantém `tab` e `periodo` e muda a linha do
  período para "Outubro de 2026 · Dra. Helena Costa".
- **NAV-08:** o filtro por paciente continua ao trocar de aba; "Tirar o filtro" volta para
  `tab=visao_geral&periodo=mes`, com a busca vazia.
- **FORM-03:** a busca "Teste QA zzz" mostra "Ninguém encontrado.", mantém o texto no campo, a aba e o
  período.
- **FORM-04:** "Souza" lista 2 pacientes e 1 responsável (com o telefone); escolher um aplica o filtro
  e mostra "Com filtro:" acima dos indicadores, sem a busca.
- **QA-01:** "Revisado" abre "Marcar como revisado?" com o nome e as consequências; "Voltar" fecha o
  diálogo, nada é enviado e o foco volta ao botão.
- **QA-03:** abas na ordem Visão geral, Atendimentos, Funil do bot, Faltosos, Retomar contato e
  Financeiro; a linha embaixo do título mostra o período e o escopo.
- **QA-05:** Tab no Início: Agenda do dia, Registrar comparecimento, Marcar, os 2 avisos, os 2
  indicadores com link, o contato, o WhatsApp e "Revisado".
- **QA-07:** os indicadores com link são lidos inteiros ("Comparecimento a registrar 0 Nada a
  registrar Ver em A registrar ›"); o WhatsApp diz o número; "Tirar o filtro" e o seletor "Agenda" têm
  nome.
- **QA-08:** largura do documento igual à da tela (390px) no Início e nas 6 abas.
- **QA-09:** os filtros abrem recolhidos, com o resumo ("Este mês · todas as agendas ›"); abrem sozinhos
  com uma busca ou com o Personalizado; o toque no resumo abre.
- **QA-10:** com a página rolada até o fim, o "Revisado" fica acima da barra fixa do Marcar.
- **QA-11:** sem JavaScript, os filtros ficam abertos no celular e as duas telas funcionam.
- **QA-12:** Profissional (pediatra): "só da sua agenda", as abas Visão geral, Atendimentos, Faltosos e
  Financeiro, sem o seletor de agenda; `?tab=funil` digitado cai na Visão geral. No Início, sem o aviso
  do certificado e sem "Revisado".
- **QA-13:** Recepção: Métricas leva ao Início com "Essa tela não está disponível para o seu acesso.",
  no aviso âmbar novo. No Início, o "Revisado" aparece.
- **QA-14:** Suporte (dentro da Clínica Exemplo): o aviso do certificado, "Revisado" e as 6 abas.
- **QA-16:** nenhum erro no console nas jornadas acima; nenhuma resposta 5xx.

### 5.2 Falhas

Ver a seção 6.

### 5.3 Bloqueios

- **NAV-09:** nenhum paciente do seed tem faltas frequentes (a tabela mostra "Nenhum paciente com
  faltas frequentes."). Para testar, seria preciso gravar faltas no banco local.
- **NAV-10:** nenhuma conversa interrompida no seed ("Ninguém nessa situação no período.").
- **QA-02:** o envio do "Revisado" grava no banco.
- **QA-15:** as duas clínicas do seed têm Exames, Lembretes e o bot ligados; desligar um item muda a
  matriz de acesso (grava).

## 6. Achados

### 6.1 Defeitos confirmados

#### FORM-01 e FORM-02 · Período personalizado inválido apaga as datas digitadas

- **Severidade:** Média
- **Página ou fluxo:** Métricas › Período › Personalizado
- **URL:** `/admin/metricas?tab=visao_geral&periodo=personalizado&de=2026-10-10&ate=2026-10-05`
- **Critério avaliado:** preservação dos campos após erro de validação
- **Pré-condições:** Administrador; Personalizado aberto (De 01/10/2026, Até 31/10/2026).
- **Passos executados:**
  1. Digitar De = 10/10/2026 e Até = 05/10/2026 e tocar em "Ver".
  2. Corrigir só o Até para 15/10/2026 e tocar em "Ver".
  3. (FORM-02) Digitar De = 01/01/2024 e Até = 15/10/2026 e tocar em "Ver".
- **Resultado esperado:** o erro aparece e os campos continuam com 10/10 e 05/10; corrigido só o Até,
  o período 10/10 a 15/10 é aplicado.
- **Resultado observado:** o erro aparece, mas **De e Até mudam para 16/10/2026** (hoje). No passo 2,
  o envio vai com De = 16/10 (o valor trocado) e Até = 15/10 e dá erro de novo. No passo 3, também os
  dois voltam para 16/10.
- **Campos perdidos:** De e Até.
- **Impacto:** quem errou uma data precisa digitar as duas de novo; corrigir só a errada não resolve.
- **Evidência:** `evidencias/r7-form01-antes-1280.png` e `evidencias/r7-form01-depois-1280.png`.
- **Causa provável:** os campos mostram o período aplicado (`period.from` e `period.to`), que no
  inválido vira "hoje". Já era assim antes da R7.
- **Recomendação:** com o período inválido, preencher De e Até com o que veio no endereço (`de` e
  `ate`), e só a linha do período e os números mostrarem hoje.

#### QA-04 · Mensagem do período inválido genérica e solta dos campos

- **Severidade:** Baixa
- **Página ou fluxo:** Métricas › Personalizado
- **Critério avaliado:** clareza da mensagem e associação ao campo
- **Passos executados:** como FORM-01, passo 1.
- **Resultado esperado:** uma mensagem que diga o problema ("A data De é depois da data Até") e
  campos marcados (`aria-invalid`, mensagem ligada por `aria-describedby`), com o foco no campo errado.
- **Resultado observado:** "Período inválido (até 366 dias): mostrando hoje." aparece nos dois casos
  (De depois de Até e mais de 366 dias); os campos não têm `aria-invalid` nem `aria-describedby`; o
  foco fica no corpo da página.
- **Impacto:** com De depois de Até, a menção a 366 dias confunde; quem usa leitor de tela não sabe
  qual campo corrigir.
- **Evidência:** `evidencias/r7-form01-depois-1280.png`; atributos lidos no navegador.
- **Recomendação:** uma mensagem por caso, ligada aos campos, e o foco no primeiro campo errado (como
  nos formulários do painel com `keepFormValues`).

#### QA-06 · Tabela entra no Tab sem precisar rolar e repete o nome da seção

- **Severidade:** Baixa
- **Página ou fluxo:** Métricas › Visão geral (vale para todas as tabelas)
- **Critério avaliado:** ordem de tabulação
- **Passos executados:** com 1280px, Tab a partir do conteúdo.
- **Resultado esperado:** a tabela só vira parada do Tab quando não cabe e precisa rolar de lado
  (no celular).
- **Resultado observado:** depois de "Buscar", o foco vai para a caixa da tabela "Marcados por",
  que não rola e não faz nada. O leitor de tela também anuncia duas regiões "Marcados por" (a seção e
  a caixa da tabela).
- **Impacto:** uma parada a mais por tabela no teclado (3 na aba Atendimentos); anúncio repetido.
- **Evidência:** ordem de tabulação e árvore de acessibilidade lidas no navegador.
- **Recomendação:** pôr o `tabindex="0"` e o papel de região só quando a tabela rola (ex.: um script
  que compara `scrollWidth` e `clientWidth`, ou só no celular), e não repetir o nome quando a seção já
  tem título.

### 6.2 Suspeitas

- **Alvos de toque menores que 44px no celular:** as abas (41px) e os botões do período (38px). Usam
  os mesmos componentes já aprovados na Agenda e no Resumo do Dia (`Tabs` e `SegmentedControl`), então
  não é uma regressão da R7. **Para confirmar:** decidir se o painel todo deve subir esses controles
  para 44px.

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Faltosos e Retomar contato com linhas (nome que abre a ficha ou o contato, WhatsApp, "Voltar") | O seed não tem esses dados; gravar seria preciso |
| Envio do "Revisado" | Grava no banco |
| Indicadores que somem sem Exames ou Lembretes; "Contatos para revisar" sem o bot | Mudaria a matriz de acesso |
| Aviso do certificado vencido (só o "vencendo" apareceu) | Mudaria o certificado no banco |

## 7. Limitações

- Sem leitor de tela de verdade: os nomes e papéis foram lidos da árvore de acessibilidade do Chromium.
- Só Chromium.
- As linhas de Faltosos e Retomar contato foram conferidas só no código e no canvas, não com dados.

## 8. Evidências

- **Local:** `docs/auditoria-frontend/evidencias/` (como nos relatórios anteriores)
- **Arquivos:** `r7-inicio-1280.png`, `r7-inicio-390.png`, `r7-inicio-acesso-negado-1280.png`,
  `r7-metricas-visao-geral-1280.png`, `r7-metricas-filtros-390.png`, `r7-form01-antes-1280.png`,
  `r7-form01-depois-1280.png`
- **Dados sensíveis:** só dados fictícios do seed; nenhuma senha, token ou cookie nas capturas.

## 9. Recomendações

1. FORM-01/02: manter as datas digitadas quando o período é inválido.
2. QA-04: mensagem por caso, ligada aos campos, com o foco no campo errado.
3. QA-06: a caixa da tabela só como parada do Tab quando rola.
4. Decidir, para o painel todo, os alvos de toque de 44px nas abas e no seletor segmentado.

## 10. Correções e reteste (16/out, a pedido do cliente)

| ID | Correção | Reteste |
| --- | --- | --- |
| FORM-01/02 | Com o período inválido, De e Até voltam como foram digitados (`requested` em `parsePeriod`); só os números e a linha do período mostram hoje. | De 10/10 e Até 05/10: os campos continuam 10/10 e 05/10. Corrigido só o Até para 15/10, o período 10/10 a 15/10 é aplicado. Com 01/01/2024 a 15/10/2026, os dois continuam como digitados. **PASSOU** |
| QA-04 | Uma mensagem por caso (`INVALID_PERIOD_MESSAGES`): "Informe as duas datas.", "A data De é depois da data Até." e "O período passa de 366 dias.", seguida de "Os números mostram hoje."; o campo a corrigir fica com borda vermelha, `aria-invalid` e `aria-describedby`, e recebe o foco (no celular, os filtros abrem). | Os 3 casos mostram a mensagem certa; com só o De, a marcação e o foco vão para o Até; nos outros dois, os dois campos ficam marcados e o foco vai para o De. **PASSOU** |
| QA-06 | A caixa da tabela só vira região com nome e parada do Tab quando a tabela rola (`src/scripts/scrollRegion.ts`, carregado no `AdminLayout`; marcação `data-scroll-region`). | Em 1280px, o Tab vai de "Buscar" direto para fora do conteúdo, sem parar nas 3 tabelas da aba Atendimentos, e não há região repetida. No celular, a tabela de Faltosos (que rola) vira região "Faltam com frequência" com `tabindex="0"`; ao alargar a janela, volta a ficar fora do Tab. **PASSOU** |

Teste de unidade novo em `src/lib/metricsPeriod.test.ts` (motivo e datas pedidas). `npm run check` sem
erros e `npm test` com 497 testes passando. Evidências: `r7-form01-corrigido-1280.png` e
`r7-form01-corrigido-390.png`. A suspeita dos alvos de toque de 44px continua com o cliente.
