# Central de atendimento humano (ficha)
Reúne: Central, ciclo do atendimento, conversas que não são atendimento, falhas de envio, pedido não concluído.
Detalhe completo (só por `grep`): `../arquivo/modulos/` — `planejamento-central-atendimento.md` (seções 11, 14, 15, 16),
`ciclo-atendimento-humano.md`, `conversas-nao-atendimento.md`, `falhas-de-envio.md`, `pedido-nao-concluido.md`.
**Estado (segundo os documentos, 07/nov):** Central finalizada, na produção e ligada na clínica piloto. CA (04–05/nov),
PN (03/nov), FE (05/nov) e NA (07/nov, "produção não" no documento) — validação do cliente e produção da NA: **a confirmar**.
Em aberto: preço/pacote do item e advogado (termo, contrato, política). Etapa 2 (Gestão) só se o cliente reabrir.

## Decisões que valem
- **Texto das conversas:** só em clínicas com a Central ligada, com retenção e leitura registrada (revisão da D12, `arquitetura.md`).
- **Coexistência:** app e Central juntos, sem configuração. Resposta pelo app entra no histórico marcada "Respondida pelo
  app", pausa o bot e põe "Em atendimento"; `#bot` no app finaliza.
- **Lista única** com abas Abertas/Finalizadas; selo Aguardando a clínica / Em atendimento (2 situações no banco).
- **Quem vê:** Administrador e Recepção, todas; Profissional só as transferidas a ele; Suporte todas com registro (D6).
- **Responder assume** (confirma se já tem dona). **Liberação automática** após 30 min sem resposta, só no horário da
  clínica, sem notificação.
- **Ciclo (CA):** "Em atendimento" encerra sozinha em 12 h sem mensagem, em silêncio; "Aguardando a clínica" nunca
  encerra sozinha; botão "Finalizar atendimento"; sem "Manter aberto" nem "Aguardar paciente".
- **Não-atendimento (NA):** número marcado não passa pelo bot, sai das métricas (inclusive o passado) e não é pendente;
  só Administrador e Recepção marcam; botões dos lembretes seguem valendo.
- **Pedido não concluído (PN):** mensagem padrão com [Novo link] [Falar com a recepção] [Desistir], uma vez por pedido;
  lembrete só muda com a ação concluída; grupo "Não concluiu" no Relatório do dia.
- **Falhas de envio (FE):** conferir o número antes de salvar; aviso de entrega na Agenda; 131026 vira "Corrigir número";
  3 tentativas (bot 30 s/2 min até 5 min; automáticas 10/30 min); Suporte vê cada falha e pode descartar.
