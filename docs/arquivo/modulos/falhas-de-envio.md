# Falhas de envio pelo WhatsApp (FE, 05/nov/2026)

Origem: em 05/nov/2026 a confirmação de uma paciente da clínica piloto falhou com o erro **131026** (número sem
WhatsApp: cadastro errado). Em 04/nov, o aviso "conversa encerrada" do bot falhou com o **131000** (instabilidade da
Meta), sem reenvio. Na produção, de 439 envios em 3 dias, 3 falharam.

## Decisões do cliente (05/nov/2026)

| # | Decisão |
|---|---|
| 1 | **Conferir o número antes de salvar (A2):** nas confirmações de Marcar, Cadastrar paciente e da troca do WhatsApp do contato, o número aparece em destaque e o botão só libera com "Conferi o número com o paciente" marcado. |
| 2 | **Mostrar se a confirmação chegou (C):** depois de marcar, remarcar ou alterar (data/hora/local), o aviso no topo da Agenda acompanha a entrega: enviando, entregue, enviada (celular sem receber ainda), instabilidade da Meta (tenta de novo) ou não chegou, com o motivo. |
| 3 | No aviso "não chegou": **"Corrigir o número"** (janela: número novo, salva no cadastro e reenvia a confirmação) e **"O número está certo"** (só fecha o aviso). |
| 4 | **Número sem WhatsApp no Início:** a falha 131026 vira a linha "Corrigir número" em "Precisa de você" até a recepção corrigir o cadastro, uma mensagem nova chegar a esse número ou alguém dizer "O número está certo" (com confirmação). Janela de 30 dias. |
| 5 | **Reenvio:** as mesmas 3 tentativas para todas as mensagens. Bot (respostas, menus, "conversa encerrada"): 30 s e 2 min depois da 1ª falha, só se a conversa não andou, por até 5 min. Automáticas: 10 e 30 min, como antes. Todas as falhas passageiras (131000, Meta fora, manutenção, limite). Desistência: só o Suporte fica sabendo. |
| 6 | **Relatório do dia › Envios (Suporte):** o clique na linha abre, logo abaixo, cada envio com falha: o que era, quando saiu cada tentativa, para que número, o motivo da Meta e o que fazer; "Abrir o atendimento na Agenda" fica como link dentro. |
| 7 | **Descartar** (Suporte), em cada envio com falha, sem confirmação: o erro já conhecido e resolvido sai da lista e do alerta. Guarda quem e quando. O caso da remarcação de 03/nov (pagamento da Meta, paciente já avisado) é descartado pelo Suporte na produção. |

Telas desenhadas: canvas "Conferência do WhatsApp" (A1, A2, A3, C1, C2) e "Envios com falha" (opções 1 a 3).

## Implementação (main, 05/nov/2026)

- Migração `20261213120000_falhas_de_envio_descartadas`: tabela `send_failure_dismissals` (lugar `envios` ou `inicio`,
  mensagem ou "não enviado" da trilha, quem e quando) e a função `dismiss_send_failure` (Suporte em `envios`;
  Administrador e recepção em `inicio`). A equipe lê; só a função grava.
- Reenvio do bot: `retryRules.ts` (`BOT_RETRY_DELAYS_MINUTES`, `botRetryContext`, `isRetryable`), `retries.ts` (a
  conversa andou = outra mensagem saiu depois para o número), `bot/engine.ts` e `bot/router.ts`.
- Envios: `sends.ts` (`pendingFailures`, `failedSendDetails`, descartes) e `EnviosTab.astro`.
- Início e Agenda: `whatsapp/undeliverable.ts`, `FixNumberDialog.astro`, `agenda/SendTracker.astro`,
  `/api/admin/envios/falha` (descartar, número certo, corrigir) e `/api/admin/agenda/atendimentos/[id]/envio`.
- Conferência: `ConfirmDeleteDialog.astro`, `confirmDelete.ts`, `confirmFormData.ts`, `marcar.astro`, `novo.astro` e a
  tela do contato.
- Testes: `retryRules.test.ts` e `tests/db/falhas-de-envio.test.ts`.

Roteiro de validação: `staging.md`, parte W.
