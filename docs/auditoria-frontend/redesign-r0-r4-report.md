# Relatório de testes de interface: redesign do painel (R0 a R4 e menu do Suporte)

## 1. Resumo da execução

- **Data:** 2026-10-16
- **Executado por:** Claude (skill `playwright-ui-form-best-practices`, a pedido do cliente)
- **Resultado geral:** 6 falhas (2 Médias, 4 Baixas), 2 bloqueios, nenhum Bloqueador nem Alta. **As 6 foram
  corrigidas e retestadas no mesmo dia (seção 10).**
- **Síntese:** as jornadas principais do redesign funcionam: os retornos do Marcar e do Remarcar
  voltam à tela e ao dia de origem, os campos ficam preservados quando o navegador barra o envio, e
  o menu "Mais", o diálogo de confirmação e o U-09 se comportam como aprovado. As duas falhas
  Médias são de navegação: a busca de paciente da Agenda perde a tela e o dia de origem, e as abas
  do Resumo do Dia perdem a data escolhida.

| Status | Quantidade |
| --- | --- |
| PASSOU | 19 |
| FALHOU | 6 |
| BLOQUEADO | 2 |
| NÃO APLICÁVEL | 0 |
| **Total executado** | 27 |

## 2. Ambiente

- **URL base:** `http://localhost:4321` (`npm run dev` do cliente, já no ar)
- **Ambiente:** local, Supabase local com o `seed.sql`. Sem gravar dados: as confirmações foram
  abertas e canceladas. A contagem de 13 tabelas (atendimentos, eventos, séries, pacientes,
  contatos, pagamentos, lista de espera, bloqueios, mensagens, notas etc.) ficou igual antes e
  depois dos testes.
- **Navegador e viewport:** Chromium (MCP Playwright), 1440×900, 1280×800 e 390×844
- **Versão/commit da aplicação:** `7aab80c`
- **Usuário de teste:** Administrador da "Clínica Exemplo Saúde" (`admin@exemplo-saude.local`). O
  menu do Suporte foi testado antes, no mesmo dia, com `suporte@recepclinic.local`.

## 3. Escopo

- **Incluído:** R0 (componentes base: botão, selo, "Mais", diálogo), R1 (cabeçalho, menu do celular,
  "Pular para o conteúdo", menu do Suporte), R2 (Agenda: Dia, Semana, Mês, busca, cartão e legenda),
  R3 (Resumo do Dia: 7 abas, data e "Abrir na Agenda") e R4 (Marcar e Remarcar: passos, faixa de
  dias, horários, série, endereço domiciliar, retorno).
- **Fora do escopo:** telas ainda sem redesign (Pagamento, Pacientes, Início, Financeiro,
  Configurações, Sistema, páginas do paciente).

## 4. Ferramentas utilizadas

- MCP Playwright (exploração). O projeto não tem `@playwright/test`, então não foram criadas specs.
- `psql` no contêiner do banco local, só para a contagem de linhas.

## 5. Cenários executados

| ID | Cenário | Critério | Tipo | Status | Severidade |
| --- | --- | --- | --- | --- | --- |
| NAV-01 | Agenda Dia 23/10 › Marcar › Voltar | Retorno à tela anterior | Obrigatório | PASSOU | — |
| NAV-02 | Agenda Semana 28/10 › Marcar › Voltar | Retorno à tela anterior | Obrigatório | PASSOU | — |
| NAV-03 | Agenda Dia 20/10 › Remarcar › Voltar | Retorno à tela anterior | Obrigatório | PASSOU | — |
| NAV-04 | Semana › toque no dia 19/10 | Destino certo | Obrigatório | PASSOU | — |
| NAV-05 | Dia › Semana › Mês › Dia mantendo a data | Estado preservado | Obrigatório | PASSOU | — |
| NAV-06 | Resumo do Dia 21/10 › Abrir na Agenda | Destino certo | Obrigatório | PASSOU | — |
| NAV-07 | Mês 19/10 › busca de paciente › retorno | Retorno à tela anterior | Obrigatório | FALHOU | Média |
| NAV-08 | Resumo do Dia 21/10 › aba Lembretes | Estado preservado (data) | Obrigatório | FALHOU | Média |
| NAV-09 | Suporte › Sistema › telas do sistema | Destino certo | Obrigatório | PASSOU | — |
| FORM-01 | Marcar com série, endereço domiciliar vazio | Preservação dos campos | Obrigatório | PASSOU | — |
| FORM-02 | Marcar sem horário escolhido | Bloqueio do envio | Obrigatório | PASSOU | — |
| FORM-03 | Envio válido e erros do servidor no Marcar e no Remarcar | Preservação após erro do servidor | Obrigatório | BLOQUEADO | — |
| QA-01 | Menu "Mais" pelo teclado | Teclado e foco | Adicional | PASSOU | — |
| QA-02 | Diálogo de confirmação (Confirmar presença, Marcar, Remarcar) | Foco e cancelamento | Adicional | PASSOU | — |
| QA-03 | Legenda com contadores × cartões do dia 21/10 | Coerência | Adicional | PASSOU | — |
| QA-04 | U-09: vindo de 23/10, a faixa começa em 23/10 | Decisão do cliente | Adicional | PASSOU | — |
| QA-05 | Marcar: paciente primeiro (passos travados) | Ajuste de 16/out | Adicional | PASSOU | — |
| QA-06 | Remarcar de série: "De" sem risco e escolha da série | Ajuste de 16/out | Adicional | PASSOU | — |
| QA-07 | Botão Marcar ou Remarcar sem horário escolhido | Proposta aprovada da R4 | Adicional | FALHOU | Baixa |
| QA-08 | Mês: nome acessível das células | Acessibilidade | Adicional | FALHOU | Baixa |
| QA-09 | Semana e busca: situação só pela cor | Decisão 4 da Agenda | Adicional | FALHOU | Baixa |
| QA-10 | Busca: "Às" com maiúscula no meio da data | Acabamento | Adicional | FALHOU | Baixa |
| QA-11 | Mês com atalho para o mês atual | Consistência | Adicional | PASSOU (revisto) | — |
| QA-12 | Celular: Agenda em lista única e barra fixa do Marcar | Larguras de tela | Adicional | PASSOU | — |
| QA-13 | "Pular para o conteúdo" no primeiro Tab | Acessibilidade | Adicional | PASSOU | — |
| QA-14 | Console e HTTP das telas (7 abas do Resumo: 200) | Erros | Adicional | PASSOU | — |
| QA-15 | Envio duplo (duplo clique) | Prevenção | Adicional | BLOQUEADO | — |

### 5.1 Aprovados

- **NAV-01 a NAV-03:** o "Voltar" levou à URL de origem (`/admin/agenda?date=2026-10-23`,
  `/admin/agenda/semana?date=2026-10-28`, `/admin/agenda?date=2026-10-20`). O subtítulo e o campo
  de data mostravam o mesmo dia de origem.
- **NAV-04 a NAV-06:** os links mantêm o dia (`date=` nas três visões). "Abrir na Agenda" abre o dia
  do Resumo.
- **NAV-09:** o botão "Sistema" do Suporte abre os 6 itens, e cada um leva à Administração do sistema.
- **FORM-01:** com a série ligada (quinzenal, 5 sessões), o horário 15:10 escolhido e o endereço
  vazio, o navegador barrou o envio e pôs o foco no endereço ("Preencha este campo."). Horário,
  serviço, frequência, fim e número de sessões ficaram iguais. Corrigido só o endereço, o novo envio
  abriu a confirmação sem preencher mais nada, e ela foi cancelada.
- **FORM-02:** sem horário, o envio é barrado e o foco vai para o primeiro horário. Não abre a
  confirmação.
- **QA-01:** o foco vai para o 1º item, a seta para baixo passa ao 2º, e o Esc fecha o menu e devolve
  o foco ao botão "Mais ações de Carlos Pereira, 07:00".
- **QA-02:** o foco abre em "Voltar", e o Esc ou o "Voltar" fecham o diálogo sem gravar (URL e
  contagem iguais).
- **QA-03:** em 21/10, 2 não confirmados, 1 cancelado e 1 bloqueio, iguais aos cartões. O
  atendimento da outra clínica (Odonto Exemplo) não aparece, e o isolamento está correto.
- **QA-04 a QA-06:** conforme as decisões e os ajustes de 15 e 16/out.
- **QA-12:** em 390px, a Agenda vira lista única e não há rolagem lateral (a legenda rola de lado de
  propósito). No Marcar, a barra fixa fica logo acima da barra de abas, sem sobreposição.
- **QA-13 e QA-14:** "Pular para o conteúdo" aparece no primeiro Tab. Não há erro de JavaScript; o
  console só registrou o bloqueio de iframe causado pelo próprio teste (a CSP do painel nega
  iframes, o esperado).

### 5.2 Falhas

Ver a seção 6.

### 5.3 Bloqueios

- **FORM-03:** o envio válido do Marcar e do Remarcar grava atendimento e manda WhatsApp, e
  provocar um erro do servidor também exigiria enviar. Falta autorização para gravar no banco local,
  com limpeza depois.
- **QA-15:** para confirmar o envio duplo seria preciso enviar duas vezes. É o mesmo motivo do
  FORM-03, e a suspeita da auditoria de 14/out continua aberta.

### 5.4 Não aplicáveis

- Nenhum.

## 6. Achados

### 6.1 Defeitos confirmados

#### NAV-07 · A busca de paciente da Agenda perde a tela e o dia de origem

- **Severidade:** Média
- **Página ou fluxo:** Agenda (Dia, Semana ou Mês) › campo "Nome ou telefone" › Buscar
- **URL:** `/admin/agenda/buscar?q=João&paciente=…`
- **Critério avaliado:** retorno à tela anterior
- **Pré-condições:** Administrador; Agenda › Mês, vindo de 19/10
- **Passos executados:**
  1. Abrir `/admin/agenda/mes?date=2026-10-19`.
  2. Digitar "João" na busca e tocar em Buscar.
  3. Procurar um retorno ao Mês de 19/10.
- **Resultado esperado:** um "Voltar" para a tela de origem (Mês, 19/10), ou ao menos os links
  Dia, Semana e Mês na data de onde se veio.
- **Resultado observado:** a tela não tem "Voltar", e os links Dia, Semana e Mês apontam para hoje
  (`date=2026-10-16`). O `buscar.astro` usa a data de hoje no cabeçalho e não recebe a origem.
- **Impacto:** quem buscou um paciente a partir de outro dia ou visão precisa refazer o caminho.
- **Evidência:** `redesign-r0-r4/r2-busca.png`; os `href` lidos no navegador foram
  `/admin/agenda?date=2026-10-16`, `/admin/agenda/semana?date=2026-10-16` e
  `/admin/agenda/mes?date=2026-10-16`.
- **Recomendação:** o formulário de busca passa a levar a tela de origem (`volta`) e a data. A
  busca mostra "Voltar" para lá e mantém a data nos links das visões.

#### NAV-08 · As abas do Resumo do Dia perdem a data escolhida

- **Severidade:** Média
- **Página ou fluxo:** Resumo do Dia
- **URL:** `/admin/consultas?tab=resumo&date=2026-10-21` › aba Lembretes
- **Critério avaliado:** estado preservado (data)
- **Passos executados:**
  1. No Resumo do Dia, escolher 21/10 no campo de data.
  2. Tocar na aba "Lembretes".
- **Resultado esperado:** Lembretes de 21/10, já que essa aba também aceita `date=` (com
  `?tab=lembretes&date=2026-10-21` ela abre em 21/10).
- **Resultado observado:** a aba abre em 16/10 (hoje). Os links das abas são só `?tab=…`.
- **Impacto:** quem confere outro dia precisa escolher a data de novo a cada aba.
- **Evidência:** URL `?tab=lembretes` e campo de data `2026-10-16` depois do clique.
- **Recomendação:** os links das abas que dependem do dia (Resumo do dia e Lembretes) passam a
  levar a data. As outras abas não usam data.

#### QA-07 · Marcar e Remarcar com o botão habilitado sem horário

- **Severidade:** Baixa
- **Página ou fluxo:** Marcar e Remarcar
- **Critério avaliado:** proposta aprovada da R4 (nota m1 do canvas: "o botão Marcar … só se
  habilita com tudo escolhido")
- **Passos executados:** em Marcar, escolher paciente e serviço sem escolher horário, e olhar o botão
  do resumo. No Remarcar, abrir a tela e olhar o botão.
- **Resultado esperado:** o botão desabilitado até haver horário.
- **Resultado observado:** o botão fica habilitado (cheio, verde). Ao tocar, o navegador barra o envio
  e foca o 1º horário, então não grava nada.
- **Evidência:** `redesign-r0-r4/r4-marcar-horarios.png`, `redesign-r0-r4/r4-remarcar.png`
- **Recomendação:** desabilitar o botão (no resumo e na barra do celular) enquanto não houver horário.

#### QA-08 · Mês: as células têm o nome acessível emendado ("212 atend.bloqueio")

- **Severidade:** Baixa
- **Página ou fluxo:** Agenda › Mês
- **Critério avaliado:** acessibilidade (nome acessível)
- **Resultado observado:** a célula do dia 21 é lida como "212 atend.bloqueio" (dia 21 + 2
  atendimentos + bloqueio, sem separação). As células vazias não têm nome.
- **Recomendação:** dar a cada célula um nome como "21 de outubro: 2 atendimentos, 1 bloqueio".

#### QA-09 · Semana e busca: situação só pela cor

- **Severidade:** Baixa
- **Página ou fluxo:** Agenda › Semana e busca de paciente
- **Critério avaliado:** decisão 4 da Agenda (15/out): cores de situação sempre com ícone e texto
- **Resultado observado:** os itens têm só a borda colorida; a situação não aparece em texto nem para
  o leitor de tela. A busca ainda usa cores antigas (`slate`).
- **Evidência:** `redesign-r0-r4/r2-semana.png`, `redesign-r0-r4/r2-busca.png`
- **Recomendação:** um selo pequeno (ícone e texto) ou ao menos o texto para o leitor de tela.

#### QA-10 · Busca: "Às" com maiúscula

- **Severidade:** Baixa
- **Página ou fluxo:** Agenda › busca de paciente
- **Resultado observado:** "Segunda 19/10/2026 Às 08:00". O `capitalize` do Tailwind põe maiúscula
  em todas as palavras (igual ao F-08 da auditoria).
- **Recomendação:** pôr maiúscula só na primeira letra (como no subtítulo da Agenda).

#### QA-11 · Revisto: não é defeito

- Registrado de início como "Mês sem atalho para o mês atual". Na correção, o código mostrou que o
  Mês tem "Este mês", que só aparece fora do mês atual, como "Esta semana" e "Hoje". O teste foi
  feito justamente em outubro, o mês atual. Status: PASSOU.

### 6.2 Suspeitas

#### S-01 · A confirmação da série não diz quando começa nem quantas sessões terá

- **Página ou fluxo:** Marcar com "Repetir este atendimento"
- **Observado:** "Criar a série? Ana Souza: Consulta pediátrica, no horário escolhido. O paciente é
  avisado pelo WhatsApp." O texto não traz dia, horário, frequência ou número de sessões. A
  confirmação simples do Remarcar segue o mesmo padrão ("vai para o horário escolhido").
- **O que falta para confirmar:** é texto de negócio, mantido como estava no redesign. Cabe ao
  cliente dizer se quer o detalhe.

#### S-02 · Envio duplo

- Continua a suspeita da auditoria de 14/out (ver o QA-15).

### 6.3 Pontos não verificados

| Item | Motivo |
| --- | --- |
| Envio válido do Marcar, Remarcar e ações do cartão | Grava atendimento e envia WhatsApp (sem autorização para gravar) |
| Erros devolvidos pelo servidor e preservação depois deles | Exige envio |
| Perfis Recepção e Profissional | Não testados nesta rodada (só Administrador e Suporte) |
| Leitor de tela | Verificados atributos e foco, não a fala |

## 7. Limitações

- Envios que gravam não foram executados. A contagem de 13 tabelas ficou igual antes e depois.
- Em 390px, a largura medida da página foi de 375px por causa da barra de rolagem do Chromium; não
  há rolagem lateral.
- Os dados do seed só têm atendimentos de 19/10 a 26/11; os estados "Compareceu" e "Faltou" no
  cartão não foram vistos nesta rodada (cobertos pelos testes de `cardActions.test.ts`).

## 8. Evidências

- **Local:** `~/.playwright-mcp/redesign-r0-r4/` (fora do repositório)
- **Arquivos:** `r2-dia-1440.png`, `r2-dia-21-1440.png`, `r2-dia-19.png`, `r2-semana.png`, `r2-mes.png`,
  `r2-busca.png`, `r2-dia-390.png`, `r2-filtro-390.png`, `r3-resumo-21.png`, `r4-marcar-inicio.png`,
  `r4-marcar-horarios.png`, `r4-marcar-390.png`, `r4-remarcar.png`
- **Dados sensíveis:** só dados fictícios do seed; senhas não aparecem.

## 9. Recomendações

1. NAV-07 e NAV-08 (Médias): levar a origem e a data na busca da Agenda e nas abas do Resumo do Dia.
2. QA-07: desabilitar Marcar e Remarcar sem horário, como na proposta aprovada.
3. QA-08 a QA-10: acabamentos da Agenda (nome acessível do Mês, situação em texto na Semana e na
   busca, "Às").
4. S-01 e envio duplo: decidir com o cliente; o envio duplo entra na R5 (Pagamento).

## 10. Status das correções

> 16/10/2026, a pedido do cliente ("corrigir as 7 antes da R5"; o QA-11 foi revisto e não era
> defeito). Retestadas no mesmo ambiente local, com o login do Administrador. A contagem das 13
> tabelas ficou igual. Checagem de tipos sem erros e 496 testes automáticos passando.

| ID | Correção | Reteste |
| --- | --- | --- |
| NAV-07 | O formulário de busca do cabeçalho da Agenda leva a tela de origem (`volta`). A busca mostra "Voltar" para ela, usa o dia dela nos links Dia, Semana e Mês e mantém a origem numa busca nova, em "Voltar à lista" e em "Buscar outro paciente" (`AgendaHeader.astro`, `buscar.astro`) | Mês de 19/11 › busca "João" › nova busca › Voltar: Mês de 19/11; links das visões em 19/11. CORRIGIDO |
| NAV-08 | Os links das abas Resumo do dia e Lembretes, e a volta das ações delas, levam a data escolhida quando não é hoje (`consultas/index.astro`) | Resumo de 21/10 › Lembretes: 21/10. As outras abas não usam data. CORRIGIDO |
| QA-07 | Marcar e Remarcar (resumo e barra do celular) desabilitados até haver horário (`data-needs-slot`). Sem JavaScript, o navegador continua barrando o envio | Marcar: desabilitado → horário 15:10 → habilitado. Remarcar comum e de turma ("Outra turma"): igual. CORRIGIDO |
| QA-08 | Cada célula do Mês tem nome acessível ("2 de novembro, 1 atendimento, feriado") e o dia de hoje tem `aria-current="date"` (`mes.astro`) | Nome lido no navegador. CORRIGIDO |
| QA-09 | Selo da situação (ícone e texto) em cada atendimento da Semana e da busca, no lugar das marcas ✓ e ✗ (`semana.astro`, `buscar.astro`) | Captura `fix-semana.png`; na busca, "… Não confirmado" em cada linha. CORRIGIDO |
| QA-10 | Maiúscula só na primeira letra da data da busca ("Segunda 19/10/2026 às 08:00") | Lido no navegador. CORRIGIDO |
