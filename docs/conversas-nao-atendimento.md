# Conversas que não são atendimento (NA)

> **Retomar daqui (06/nov/2026).** Etapa 1 (análise), decisões 1 a 5 e **NA0 (telas) aprovados** pelo cliente.
> **Próximo:** NA1 na branch `nao-atendimento` (criada da `main` em 07/nov, só local). Nada implementado.

## Objetivo

A equipe usa o WhatsApp da clínica também para conversas pessoais (secretária) e administrativas (fornecedores,
parceiros). Hoje elas viram atendimento humano (a resposta pelo app pausa o bot e abre atendimento) e distorcem as
métricas. A equipe passa a marcar o número como **Pessoal** ou **Administrativo/outros**: o número sai do bot, das
métricas e dos pendentes, e as mensagens dele aparecem numa aba própria.

## Decisões do cliente (06/nov)

1. **Métricas:** enquanto marcado, o **número inteiro** sai das métricas, inclusive o período anterior à marcação.
   Voltou para "Atendimento", o passado volta a contar.
2. **Comportamento:** o número marcado **não passa mais pelo bot** e fica sempre como conversa humana, **sem contar
   nas métricas nem como pendente** (Aguardando/Em atendimento, contadores, avisos). Atendimento aberto na hora da
   marcação sai de Aguardando/Em atendimento sem mensagem nenhuma.
3. **Quem marca e desmarca:** só **Administrador e Recepção**. O Profissional não marca; a visibilidade dele não muda
   (vê só a conversa transferida a ele, decisão 4 da Central).
4. **Botões dos lembretes** (Confirmar/Remarcar/Cancelar) **seguem valendo** no número marcado; qualquer outra mensagem
   não passa pelo bot.
5. **Telas:** na **Conversas** (Central ligada), **aba nova** que lista esses contatos e conta as mensagens novas (não
   lidas por pessoa, `conversation_reads`). **Também na Atendimento** (clínica sem a Central): botão para marcar e
   seção "Pessoal e administrativo" com número e hora da última mensagem (sem texto, que só a Central guarda).

## Telas aprovadas (NA0, 06/nov)

Canvas: https://claude.ai/artifact/2WRXb3QDsLy2SFdZbqLrX6 (privado do cliente).

- **Conversas, lista:** três abas: **Abertas**, **Finalizadas**, **Pessoal e admin.** (com a contagem de mensagens
  novas). Em Abertas, filtros **Todas / Minhas** abaixo das abas, no lugar do "Mostrar". Na aba Pessoal e admin., sem
  filtro; o selo (Pessoal / Administrativo) em cada item.
- **Marcar:** pelo menu **⋯** da conversa ("Marcar como Pessoal" / "Marcar como Administrativo/outros"), com
  confirmação. Escolhida a opção 2B (menu) e não o botão visível.
- **Conversa marcada:** selo, quem marcou e quando, aviso no histórico ("Marcada como Pessoal · o bot não responde este
  número"); **um só botão: "Voltar para atendimento"** (sem "Mudar"; para trocar o tipo, volta e marca de novo).
- **Atendimento (sem a Central):** aba "Pessoal e administrativo" (número, tipo, hora da última mensagem, aviso de
  mensagem nova, "Abrir no WhatsApp", "Voltar para atendimento"); botão "Não é atendimento" nos cartões.
- **Celular:** igual (três abas, Todas/Minhas em Abertas, conversa marcada só com "Voltar para atendimento").

Classificação por IA: fora desta frente (pedido do cliente).

## Como é hoje (análise)

| Peça | Onde |
|---|---|
| Conversa (uma por clínica e telefone) | `conversation_state` (`unique (clinic_id, contact_phone)`) |
| Atendimento humano | `human_handoff`, `handoff_status` (`waiting_clinic`/`in_progress`), `handoff_id`; trilha `handoff_events` (só por gatilho) |
| Entrada do bot | `processWebhook` → `handleIncomingMessage` (`bot/router.ts`); toques de template passam antes da pausa |
| Resposta pelo app (eco) | `handleAgentEcho` (`webhook.ts`) pausa e abre atendimento: origem principal da distorção |
| Paciente escreveu de novo | `markPatientWrote` → `waiting_clinic`; `notifyWaitingConversation` (aviso) |
| Métricas › Digital | `metrics_bot_sessions` (`bot_funnel_events`, inclusive `flow = 'handoff'`) → `botFunnel.ts`, `botResolution.ts` |
| Contadores e listas | `countAwaitingClinic`, `countWaitingConversations`, `listHumanAttention`, `listConversations`, `dashboard.ts`, `attentionPush.ts`, `AdminLayout.astro`, `relationship.ts` |
| Precedente | Número do suporte (`webhook.ts`): grava, não chama o bot, não pausa, não avisa |
| Diferente | Bloquear contato (`contactBlock.ts`): por contato, o bot responde neutro 1×/dia |

Tempo de 1ª resposta e produtividade por atendente ainda não existem (plano da Central, seção 9, "futuras"); quando
vierem, seguem a mesma exclusão.

## Solução técnica

- **Banco (migração aditiva):** `conversation_state.classification` (`patient` padrão | `personal` |
  `administrative`), `classified_at`, `classified_by`. Função `set_conversation_classification(p_clinic_id, p_phone,
  p_classification)`: confere clínica e perfil (Administrador/Recepção), trava a linha (`for update`), ao marcar zera
  o estado do bot (`WELCOME`, contexto vazio, funil fechado como `classified`) e tira de `waiting_clinic`/`in_progress`
  sem mensagem; ao voltar para `patient`, estado inicial e sem mensagem (a próxima mensagem segue as regras atuais).
  `handoff_events` ganha o `kind` `classified` (de/para, quem, quando), pelo gatilho existente. Sem tabela nova.
- **Bot/webhook:** número marcado grava a mensagem (histórico e idempotência intactos), não chama o bot (exceto
  toques de lembrete), eco do app não abre atendimento, não avisa a equipe, fora do encerramento de 12 h. A leitura
  da classificação vem na mesma consulta da conversa (corrida: no máximo uma resposta em voo).
- **Métricas:** exclusão no banco (`metrics_bot_sessions` e consultas dos contadores e listas), pela classificação
  atual do telefone.
- **Telas:** ação "Marcar como não atendimento" (Pessoal / Administrativo, com confirmação), selo na lista e no
  histórico, "Voltar para atendimento"; aba nova na Conversas; seção na Atendimento.
- **Regras do projeto:** fluxograma da Jornada do bot (`botJourney.ts`, `JOURNEY_UPDATED`); capturas `atendimento` e
  `conversas` em `capturas-pendentes.md`.

## Etapas

| Etapa | O quê |
|---|---|
| NA0 | Desenho das telas (canvas) e escolha do cliente. **Feito (06/nov)** |
| NA1 | Migração, função e gatilho; testes de banco (clínica, perfil, auditoria) |
| NA2 | Bot e webhook; testes (calado, eco, lembrete, reativação) |
| NA3 | Métricas e contadores; testes (antigas iguais para operacionais) |
| NA4 | Conversas: ação, selo, aba nova com não lidas |
| NA5 | Atendimento: ação e seção |
| NA6 | Jornada do bot, capturas pendentes, todos os testes (inclusive Playwright), staging |

Testes obrigatórios do pedido (1 a 11) distribuídos entre NA1 e NA3.
