# Ciclo de vida do atendimento humano (CA)

> **Retomar daqui (04/nov/2026).** Etapas 1 e 2 feitas na `main` (sem commit; migração `20261211120000` só no banco
> local). Próximo: o cliente autoriza o commit e o staging (migração antes do push); depois valida pelo `staging.md`,
> parte V.

Pedido do cliente (04/nov/2026): a recepção controla quando o atendimento humano termina; o bot volta na hora, sem
mandar nada ao paciente; mensagens depois do fim são do bot.

## 1. Como era (diagnóstico)

- **Responsável:** `conversation_state.human_handoff` (bot calado com `true`, `bot/router.ts`). Pausa por
  `pauseForHuman` (`conversations.ts`): pedido do paciente, limite, não entendeu, ou eco da resposta da recepção pelo
  app (`agent_took_over`). Início em `bot_funnel_events` (flow `handoff`); o fim não era registrado.
- **Recepção responde pelo app do WhatsApp** (coexistência); o painel Atendimento só lista, sem o texto (D12).
- **Situação calculada pela última mensagem** (`classifyAttention`, `attention.ts`): "Aguardando a clínica" (paciente
  por último, sem contar cortesia, C27) ou "Em atendimento" (clínica por último). Nada guardado no banco.
- **Devolver ao bot / `#bot`** (`returnToBot`): já silencioso, histórico preservado; sem quem nem quando.
- **Rotina de 12 h** (`handoffReturn.ts`, C20): só "Em atendimento", 12 h depois da última resposta da clínica, com a
  mensagem `HANDOFF_CLOSED`. "Aguardando a clínica" ficava para sempre.

## 2. Decisões do cliente (04/nov/2026)

1. **Encerra sozinha em 12 h:** "Em atendimento" (segurança da C20, a secretária pode nunca abrir o painel), sem
   nenhuma mensagem há 12 h. "Aguardando a clínica" nunca encerra sozinha.
2. **Encerramento automático sem mensagem** (desfaz essa parte da C20): silencioso como o manual.
3. **"Finalizar atendimento" no lugar de "Devolver ao bot"** (painel e ficha, C26). O `#bot` no app continua e conta
   como finalização pela recepção.
4. **Sem botão "Manter aberto":** não fazer nada mantém aberto.
5. **Só duas situações, sem "Aguardar paciente"** (depois do desenho das opções): numa clínica grande, dezenas de
   conversas em três situações confundiriam. Tela em três abas: Aguardando a clínica e Em atendimento, com contador, e
   Notificações (só o cartão de ativar). Em cada conversa, só Abrir no WhatsApp e Finalizar atendimento. Canvas:
   https://claude.ai/artifact/YHmUEm3wov9JEL4r6v32JR

## 3. Como ficou (Etapa 2)

**Banco (`20261211120000_ciclo_do_atendimento_humano.sql`)**
- `conversation_state`: `handoff_status` (`waiting_clinic` | `in_progress`, nulo com o bot), `handoff_status_at` (hora da
  última mudança), `handoff_id` (um por atendimento) e `handoff_changed_by` (`patient` | `reception` | `system` | `bot`).
  Carga das conversas abertas pela regra de antes (última mensagem; cortesia não conta).
- `handoff_events` (estado anterior e novo, origem, usuário, hora; `bot` = com o bot): gravada só pelo gatilho
  `conversation_state_handoff_event`, na mesma operação; sem mudança, sem evento. RLS: a equipe lê; ninguém grava pela
  tela. Base para os indicadores (iniciados, finalizados manual/automático, tempo em atendimento, reabertos).

**Transições**
- Pedido do paciente → `waiting_clinic` (origem `patient`); limite, sem horário, não entendeu → `waiting_clinic` (`bot`).
- Resposta da recepção pelo app (eco) → `in_progress` (`reception`).
- Mensagem do paciente que não é cortesia, em `in_progress` → `waiting_clinic` (`markPatientWrote`, no registro da
  mensagem: a repetida pela Meta não grava e não muda nada). "Obrigado", "Ok", 👍: nada muda.
- Finalizar atendimento / `#bot` → bot (`reception`, com o usuário): sem mensagem, sem menu. Recusa se o paciente
  escreveu depois que a tela abriu (`situacao_em` no formulário) e só muda se nada mudou desde a leitura.
- Rotina de 12 h (`handoffReturn.ts`): `in_progress` sem mensagem há 12 h → bot (`system`), em silêncio; confere a
  situação e a hora lidas antes de encerrar.

**Tela:** Atendimento humano em abas (`Tabs` com `fit` e rótulo curto no celular); `FinishAttendanceForm.astro` na tela
e na ficha (C26); Início, notificação, Central de Ajuda e Jornada do bot com o nome novo.

**Testes:** `tests/db/ciclo-atendimento-humano.test.ts` (os 18 cenários) e `atendimento-humano.test.ts` atualizado.

**Riscos residuais:** eco da recepção e mensagem do paciente fora de ordem na Meta (a situação segue a ordem de
chegada); a lista ainda calcula "a clínica respondeu às…" pelas mensagens.
