# Redesign da Recepção (UX)

> **Retomar daqui (02/nov/2026):** as nove etapas (RX1 a RX9) estão **implementadas e commitadas na branch
> `rx1-historico`** (local, sem push, criada da `main` em `c239b84`), cada uma aprovada pelo cliente. Falta: o cliente
> validar tudo, trazer a `main` para a branch e rodar os testes, juntar na `main` (staging) e, com autorização,
> recapturar as telas da Central de Ajuda (lista em [`capturas-pendentes.md`](../capturas-pendentes.md)). Decisões tomadas
> no caminho: contador do Meu dia (soma de conversas à espera, conversas com a clínica, presença a registrar e
> contatos a conferir); "Resolvido hoje" ficou de fora (sem dado persistido); avisos técnicos só para o Suporte
> ([`painel-suporte.md`](../painel-suporte.md), tela do Suporte pendente); "Avisar pacientes" fora do "Mais" da Agenda;
> horário livre = lacunas das janelas gerais, com a hora levada ao Marcar (`hora`).

Canvas com as propostas e as escolhas: <https://claude.ai/artifact/LUVvbPjkrLfVaazSCgMMTT>. As fileiras de baixo
(Menu, Meu dia, Agenda, Pacientes) têm as versões escolhidas marcadas. Os quadros de cima (diagnóstico, fluxos, mapa e
etapas U1–U10) são a primeira proposta: onde divergem deste documento, **vale este documento**.

## 1. Por quê

O crescimento do sistema deixou a rotina da recepção espalhada: as pendências estavam em quatro lugares (Início,
Resumo do Dia, Atendimento e Relacionamento), algumas listas repetidas em dois deles, e nomes que exigem saber como o
sistema funciona por dentro. Princípio do redesign: **a secretária não precisa entender o sistema; só o que fazer
agora.** Não remove função, não muda regra de negócio, banco, API, integração nem permissão.

## 2. Decisões (cliente, 02/nov/2026)

- **RX-D1. Menu: opção A.** Três lugares de trabalho: **Meu dia**, **Agenda** e **Pacientes**. Os demais itens a que a
  pessoa tem acesso ficam num grupo **Mais** (Financeiro, Métricas, Configurações, Central de Ajuda), sumindo como hoje
  quando não há acesso. Celular e tablet: barra inferior com Meu dia, Agenda, Pacientes e Mais. **Revê M2 e M6** do
  [`menu-lateral.md`](menu-lateral.md) quando for implementado; M1, M3, M4, M5 e M7 continuam. Recusadas: B (item
  próprio "Conversas"), C (grupos de hoje renomeados) e D (sem mudança).
- **RX-D2. Mesma experiência para todos os papéis.** Profissional e Administrador usam as mesmas telas da Recepção;
  sem Meu dia próprio por papel por enquanto (cliente, 02/nov). O que cada papel vê continua pelas permissões de hoje.
- **RX-D3. Meu dia aprovado** (quadro "Meu dia · aprovado" do canvas), seção 4.1. O atendimento humano aparece em
  duas linhas, iguais à faixa e ao aviso do Início de hoje, que levam à tela **Atendimento**.
- **RX-D4. A tela Atendimento não muda** (cliente, 02/nov). Recusada a tela "Conversas" desenhada como destino.
- **RX-D5. Cancelados pela clínica que ainda não remarcaram ficam fora do Meu dia**, só em Pacientes › Para contatar
  (cliente, 02/nov). Motivo: o bot não gera "pedido de remarcação" para a recepção; o paciente remarca sozinho pelo
  link, e quando o bot não acha horário a conversa já vai ao atendimento humano.
- **RX-D6. Agenda: opção B** (revista pelo cliente em 02/nov/2026, depois da RX7): linha curta + **painel ao lado**,
  exatamente como o quadro "Agenda · B" do canvas. Cada agenda é um cartão com linhas curtas (hora, paciente, tipo,
  situação) e os horários livres; tocar numa linha abre, no painel à direita, o atendimento com as mesmas ações do
  cartão (principal, frequentes, "Mais", Cancelar) e "Abrir ficha do paciente"; no celular e no tablet o painel sobe
  de baixo. Cabeçalho numa linha: ‹ Hoje ›, o dia (tocar abre o calendário), Dia/Semana/Mês, Bloquear, Mais e
  "+ Marcar consulta". Antes: C (linha que abre no lugar, a RX7), agora substituída; recusada: A (cartão de hoje).
- **RX-D7. Pacientes › "Para contatar": opção A**, uma lista por vez (seção 4.3). Recusada: B (tudo numa lista).
- **RX-D8. Ficha do paciente: opção A**, a ficha de hoje (R6) com a faixa "Próxima consulta". Recusada: B (linha do
  tempo única).
- **RX-D10. Relatório do dia: opção C** (cliente, 02/nov/2026; canvas <https://claude.ai/artifact/LjptqCJPoddFvznjyHMXf1>):
  três abas, Resumo do dia (linhas curtas), Lembretes (como antes) e A registrar (como o quadro "B · aba A registrar":
  linhas com Compareceu e Faltou, a mais antiga primeiro). Saíram Lista de espera e Aguardando remarcação (estão em
  Pacientes › Para contatar; o Profissional, que não tem Para contatar, deixa de vê-las), Registradas (corrigir pela
  Agenda) e Envios (só o Suporte, até a tela do Suporte). Os endereços antigos levam ao lugar novo.
- **RX-D9. "Trilha" passa a se chamar "Histórico" em todo o sistema** (cartão da Agenda, ficha, título da tela,
  artigos da Central de Ajuda). O endereço da tela (`/admin/agenda/trilha/…`) não muda.

## 3. Nova navegação

| Hoje | Depois |
|---|---|
| Início | **Meu dia** (mesma rota `/admin/dashboard`) |
| Agenda | **Agenda** |
| Resumo do Dia (item do menu) | **Agenda › Mais › Relatório do dia** (mesmo conteúdo; rota `/admin/consultas` continua) |
| Pacientes | **Pacientes** (abas Todos, Contatos e **Para contatar**) |
| Atendimento (item do menu, com contador) | Linhas do **Meu dia** levam à tela Atendimento (rota igual) |
| Relacionamento (item do menu, com contador) | **Pacientes › Para contatar** (rota `/admin/relacionamento` redireciona no fim) |
| Gestão: Métricas, Financeiro, Configurações | **Mais** (conforme acesso) |
| Central de Ajuda | **Mais** |

- Um contador no menu, no **Meu dia**. Regra a fechar na RX5: proposta é a soma das linhas de "Precisa de você".
- Endereços antigos continuam abrindo (favoritos, links da Central de Ajuda, "Voltar"). Redirecionar só na RX9.
- Administração do sistema (Suporte) e Configurações na lateral (M5, M7) sem mudança.

## 4. Telas aprovadas

### 4.1 Meu dia (antigo Início)

De cima para baixo:
1. Saudação e data; **Buscar paciente**; **+ Marcar consulta**.
2. **Linha do dia:** total de consultas de hoje, confirmadas, sem resposta e já atendidas, com uma barra; "Abrir agenda
   de hoje". Substitui os números do Início.
3. Avisos que hoje ficam no Início continuam no alto, para quem os vê hoje (falha de envios; ao Administrador:
   WhatsApp, templates na Meta, certificado A1).
4. **Precisa de você** (some uma linha quando alguém resolve):
   - **Conversas aguardando atendimento humano**: a faixa vermelha atual do Início ("N conversas aguardando…", a mais
     antiga e o motivo) → "Ver conversas" (Atendimento).
   - **Conversas com a clínica que ainda não voltaram ao bot**: o aviso amarelo atual, com os nomes e o lembrete do
     "Devolver ao bot" → "Ver conversas" (Atendimento).
   - **Registrar presença**: consultas que já passaram sem presença ou falta (hoje: Resumo do Dia › A registrar).
   - **Conferir contato**: contatos que bateram um limite do bot (hoje: "Contatos para revisar"), com "Revisado".
5. **Esperando o paciente**: lembretes sem resposta (hoje e amanhã), cada linha com telefone, WhatsApp, Confirmar
   presença e Remarcar (com confirmação).
6. **Resolvido hoje** (fechado). Só entra se houver o dado sem mudar o banco; senão fica de fora (verificar na RX3).
7. **Próximas consultas** (coluna à direita): hora, paciente, com quem, situação; "Compareceu" a partir do horário.

### 4.2 Agenda

- **Cabeçalho:** ‹ Hoje ›, data, Dia/Semana/Mês, **Bloquear**, **Mais** (Bloqueios, Avisar pacientes, Buscar,
  Relatório do dia) e **+ Marcar consulta** em destaque.
- **Visão Dia:** uma coluna por agenda; cada atendimento é **uma linha curta** (hora, paciente, tipo, situação). Tocar
  abre, na própria linha, telefone com WhatsApp, os sinais (ex.: lembrete sem resposta) e as **mesmas ações e a mesma
  hierarquia do cartão de hoje** (principal, frequentes, "Mais", Cancelar à parte) e "Ficha". Uma linha aberta por vez.
- **Horário livre** aparece como linha "Livre · + Marcar", que abre o Marcar com agenda, dia e hora (verificar se o
  Marcar aceita a hora pela URL; se não, só agenda e dia).
- Semana e Mês sem mudança.

### 4.3 Pacientes

- Abas **Todos**, **Contatos** (pelo vocabulário da clínica) e **Para contatar** (com contador; Recepção e
  Administrador, como o Relacionamento hoje).
- **Para contatar:** coluna com as listas e o número de cada uma (Retomar contato, Retorno, Faltosos, Aguardando
  remarcação, Lista de espera, Lembretes da equipe); a escolhida à direita, com as ações de hoje.
- O que sai do Relacionamento para outro lugar: aba Atendimento → Meu dia; Contatos para revisar → Meu dia; Lembretes
  (sem resposta) → Meu dia › Esperando o paciente; Lembretes não entregues → Agenda › Relatório do dia › Lembretes.
- **Ficha (R6):** igual à de hoje + faixa **Próxima consulta** (Confirmar presença, Remarcar, Abrir na Agenda) logo
  abaixo do cabeçalho; "Trilha" vira "Histórico".

## 5. Fluxos aprovados

1. **Marcar consulta:** "+ Marcar consulta" (Meu dia, Agenda ou ficha) ou tocar num horário livre da Agenda → Marcar
   (tela de hoje), já com agenda, dia e hora quando vem do horário livre.
2. **Remarcar:** Agenda › tocar na linha → Remarcar; ou ficha › Próxima consulta › Remarcar; ou Meu dia › Esperando o
   paciente › Remarcar. Cancelados pela clínica sem nova data: Pacientes › Para contatar › Aguardando remarcação.
3. **Quem não confirmou:** Meu dia › Esperando o paciente → WhatsApp, Confirmar presença ou Remarcar, na própria linha.
4. **Atendimento humano:** Meu dia › Precisa de você › linha vermelha → tela Atendimento (Responder no WhatsApp; ao
   terminar, Devolver ao bot ou "#bot"). Conversas que ficaram com a clínica: linha amarela → Atendimento.
5. **Histórico do paciente:** Buscar paciente (Meu dia ou Pacientes) → ficha → atendimentos, documentos, anotações e
   lembretes nas abas; o que aconteceu com cada atendimento (mensagens do bot incluídas) em **Histórico**.

## 6. Componentes e dados reaproveitados

| Para | Reaproveita |
|---|---|
| Moldura, lateral, celular | `src/layouts/AdminLayout.astro` (grupos, contadores, slot `side`, "Mais" do celular) |
| Meu dia · conversas | `listHumanAttention`, `handoffReasonLabel` (`lib/data/whatsapp/attention.ts`); faixa e aviso de `pages/admin/dashboard.astro` |
| Meu dia · conferir contato | `listContactsToReview` (`lib/data/whatsapp/botLimits.ts`), ação "Revisado" do `RevisarTab` |
| Meu dia · registrar presença | `listPendingAttendance` (`lib/data/daily.ts`) |
| Meu dia · esperando o paciente | `listPendingReminders` (`lib/data/relationship.ts`), grupo "Sem resposta" |
| Meu dia · linha do dia e avisos | `getDashboardCounts` (`lib/data/dashboard.ts`), `getSendsAlert`, avisos do Administrador do `dashboard.astro` |
| Ações dos atendimentos | `cardActions.ts`, `CardActionButton.astro`, `ConfirmDeleteDialog.astro`, `situationStyle.ts`, `categoryStyle.ts` |
| Agenda | `AgendaHeader.astro`, `buildDayItems`/`listAgendaAppointments` (`lib/data/agenda/view.ts`), `DateStepper`, `SegmentedControl`, `MoreMenu` |
| Relatório do dia | `pages/admin/consultas/index.astro` e `components/admin/resumo/*` |
| Para contatar | `components/admin/relacionamento/*`, `AguardandoTab`, `ListaEsperaTab`, `loadRelationshipLists`, `relationshipTabs`, `relationshipCounts` |
| Ficha | `pages/admin/pacientes/[id].astro` (R6) |
| Telefone e WhatsApp | `PhoneLinks.astro` |
| Base visual | `components/admin/ui/*` (Button, Tabs, Notice, Pill, StatusPill, EmptyState, PageHeader, HowItWorks) |
| "Voltar" | `lib/returnPath.ts` (`withReturn`) |

## 7. Plano de implementação (quando o cliente pedir)

Uma etapa por vez, cada uma publicável sozinha: branch curta da `main`, testes (`npm test`, `npm run check`),
Playwright, staging, validação do cliente. Mudou tela com captura da Central: anotar em
[`capturas-pendentes.md`](../capturas-pendentes.md) no mesmo commit e pedir autorização (regra do CLAUDE.md).

| Etapa | O que | Risco |
|---|---|---|
| **RX1** | "Trilha" → "Histórico" (cartão, ficha, título, artigos da ajuda) | baixo |
| **RX2** | Início vira **Meu dia** com "Precisa de você" (conversas, presença, conferir contato) e a linha do dia | médio |
| **RX3** | Meu dia: "Esperando o paciente", "Próximas consultas" e "Resolvido hoje" (se houver dado) | médio |
| **RX4** | Pacientes › **Para contatar** (as listas do Relacionamento, mesmas permissões) | baixo |
| **RX5** | Agenda: cabeçalho novo e **Relatório do dia** (antigo Resumo do Dia) no "Mais" | baixo |
| **RX6** | **Menu novo** (RX-D1) e barra do celular; registrar a revisão de M2/M6 em `menu-lateral.md` | médio |
| **RX7** | Agenda, visão Dia: **linha curta que abre** (RX-D6), mesmas ações do cartão | médio |
| **RX8** | Agenda: **horário livre** com "+ Marcar" | baixo |
| **RX9** | Ficha: faixa **Próxima consulta**; limpeza: listas duplicadas, redirecionar `/admin/relacionamento`, artigos e capturas | médio |

O menu (RX6) vem depois de Meu dia, Para contatar e Relatório do dia, para nenhum item sair do menu sem ter lugar novo.

## 8. O que não pode ser removido nem alterado

- **Permissões:** papéis e áreas (D6), matriz de acesso (D11), acesso por agenda, Suporte. Itens sem acesso somem.
- **Regras:** toda ação da Agenda pede confirmação; "Voltar" leva à tela de origem; telefone em texto com o botão do
  WhatsApp (sem ligação).
- **Atendimento:** tela, Responder, "#bot", Devolver ao bot e a regra de que a conversa não volta sozinha ao bot.
- **Ações dos atendimentos** (`cardActions.ts`): Confirmar/Desfazer presença, Compareceu, Faltou e correções, Remarcar,
  Alterar, Marcar retorno, Reenviar lembrete/preparo/orientações, Pagamento, lista de espera, Ver série, Encerrar a
  série, Histórico, Cancelar.
- **Listas e ações do Relacionamento:** Retirar, Desistiu, Tirar da lista, Feito, Revisado; Lembretes da equipe.
- **Agenda:** Semana, Mês, Bloquear, Bloqueios, Avisar pacientes, Buscar, Marcar e Alterar.
- **Resumo do Dia:** todo o conteúdo (Resumo, A registrar, Registradas, Lembretes, Envios) continua, como Relatório do dia.
- **Ficha:** dados, contato, plano de saúde, Financeiro, documentos, anotações, lembretes, desativar e anonimizar (LGPD).
- **Avisos do Início:** falha de envios e os avisos do Administrador.
- **Fora do escopo:** bot e mensagens automáticas (jornada do bot sem mudança), banco, APIs, Configurações (M5),
  Administração do sistema (M7).

## 9. Fora do escopo agora (propostas não aprovadas, para o futuro)

- Meu dia próprio do Profissional e do Administrador (RX-D2).
- Marcar em uma tela só, sem recarregar a cada escolha.
- Ficha com linha do tempo única e mensagens na ficha (RX-D8, opção B).
- Tela "Conversas" no lugar de Atendimento (RX-D4).
