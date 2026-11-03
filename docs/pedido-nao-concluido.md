# Pedido não concluído (PN): retomada pelo bot e lembrete só com a ação concluída

> **Retomar daqui (03/nov/2026).** Planejamento aprovado pelo cliente (decisões na seção 3). Nada implementado.
> Próximo: PN1, com validação do cliente.

Pedido do cliente em 03/nov/2026, depois de um caso na produção (clínica piloto).

## 1. Caso de 03/nov/2026 (produção)

Lembrete `rc_lembrete_v1` às 15:00 (lido) para a consulta de 04/11 às 14:30. Às 15:04 a responsável tocou em
"Remarcar", recebeu o link (lido) e abriu a página às 15:04:08 (10 dias com horário livre), mas não escolheu horário.
O link venceu às 15:34 sem aviso nenhum. O atendimento ficou marcado, sem confirmação, e o Relatório do dia mostrou
"Pediram para remarcar" (gravado no toque, `recordReminderTap`), como se o pedido tivesse sido atendido.

## 2. Como é hoje

| Pedido | Como o paciente conclui | Sem conclusão |
|---|---|---|
| Marcar consulta, retorno ou exame (bot) | Link `/agendar` (30 min) | Link vence calado; conversa fecha por inatividade (15 min, "encerramos este atendimento") |
| Remarcar (bot ou lembrete) | Link (30 min) | Igual; o lembrete já marca "Pediram para remarcar" no toque |
| Cancelar (bot ou lembrete) | Na conversa: "Tem certeza?" Sim/Não (`CANCEL_CONFIRM`), sem link | Fecha por inatividade; o lembrete já marca "Pediram para cancelar" no toque |
| Remarcar após cancelamento pela clínica | Link (2 dias) | Link vence calado |
| Confirmar (lembrete) | No toque | — |

## 3. Decisões do cliente (03/nov/2026)

1. **Mensagem padrão para todo pedido não concluído** (marcação, remarcação e cancelamento):
   "Não concluímos a {marcação | remarcação | cancelamento} de *{paciente}*. Como prefere seguir?" com os botões
   **[Novo link] [Falar com a recepção] [Desistir]**.
   - **Quando sai:** o link vence sem uso (30 min; 2 dias no cancelamento pela clínica), ou o cancelamento fica sem
     resposta ao "Tem certeza?" por 15 min. Com um pedido em aberto, **substitui** o "encerramos este atendimento".
     **Uma vez por pedido**; sem resposta, a conversa fecha normalmente.
   - **Novo link:** manda outro link igual. No cancelamento, o botão é **"Cancelar agora"** e repete o "Tem certeza?".
   - **Falar com a recepção:** vai para o Atendimento humano com o motivo "Não concluiu {o pedido}".
   - **Desistir:** remarcação e cancelamento: "Tudo bem, a consulta de {paciente} continua marcada para {data}.";
     marcação: "Tudo bem. Quando quiser, é só mandar uma mensagem."
2. **O lembrete só muda com a ação concluída.** Confirmar continua no toque. Remarcar e Cancelar não gravam mais
   "Pediram para…" no toque: só quando a remarcação ou o cancelamento acontece.
3. **Novo grupo "Não concluiu"** no Relatório do dia › Lembretes ("Tocaram e não concluíram", com o que tocou:
   remarcar ou cancelar), para a recepção agir. "Pediram para remarcar/cancelar" passa a ser só de quem concluiu.
   As Métricas (Desempenho) seguem a mesma regra.

## 4. Fases

### PN1 — Lembrete só com a ação concluída

- `recordReminderTap`: o toque em Remarcar/Cancelar continua gravado na mensagem recebida (`reminder_reschedule`,
  `reminder_cancel`, para o histórico), mas o atendimento só recebe a resposta quando a ação conclui (remarcação pelo
  link, cancelamento confirmado). Hoje remarcar zera `reminder_response` (`appointments.ts`): rever a ordem para a
  resposta "remarcou" sobreviver.
- `daily.ts` (`reminderGroup`) e Métricas › Desempenho: grupo novo "Não concluiu" = tocou e o pedido não concluiu.
- Central de Ajuda (`ajuda/resumo.ts`, artigos de lembretes) e capturas do Relatório do dia, se houver (anotar em
  `capturas-pendentes.md`).

### PN2 — Mensagem de pedido não concluído

- Rotina (junto da `closeIdleConversations`): link vencido sem uso e sem pedido concluído na sessão do funil →
  a mensagem; cancelamento parado em `CANCEL_CONFIRM` por 15 min → a mensagem (em vez do "encerramos").
- Estado novo na conversa para os 3 botões; "Novo link" reaproveita a criação de link do fluxo de origem (mesmo
  serviço, agenda, local e atendimento); "Falar com a recepção" usa o caminho de transferência com motivo novo
  (`HANDOFF_REASON_LABELS`); "Desistir" encerra com a frase da decisão 1.
- Janela de 24 h: a mensagem sai dentro dela (o paciente falou com o bot minutos antes). Link de 2 dias
  (cancelamento pela clínica): se a janela fechou, o aviso não sai como texto livre — tratar na implementação
  (sem template novo, o pedido só aparece para a recepção).
- Funil do bot: passo novo (`not_completed_prompt` e a escolha) para a taxa de resolução.
- **Regra do projeto:** fluxograma da Jornada do bot (`botJourney.ts`, `JOURNEY_UPDATED`) no mesmo commit.
