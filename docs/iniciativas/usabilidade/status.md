# Funil do portal e aba Usabilidade
**Em andamento (13/nov/2026).** Desenho aprovado: canvas "Métricas: funil do portal e usabilidade" (Claude Design).
Branch `metricas-usabilidade`, criada da `main`.

## Decisões do cliente (13/nov)
- **Registro:** visita anônima. Uma linha por visita (cookie, sem nome nem celular) que só avança o passo mais longe
  alcançado. A gravação corre junto com as consultas da tela, falha sem quebrar a tela e só grava quando o passo avança.
  Robôs ficam de fora. A linha é apagada em 30 dias pela limpeza diária.
- **Sinais da aba Usabilidade (1ª entrega):** só o que sai de dados já gravados, sem gravação nova. Formulário com erro,
  confirmação cancelada e cadastro duplicado ficam para depois.
- **Alcance:** uma clínica por vez, como o resto de Métricas. O ranking entre clínicas fica para depois.

## Etapas
- **U1 (feita na branch, 13/nov; aguarda validação):** migração `20270122120000_portal_visitas` (tabela `portal_visits`,
  `portal_visit_step`, `metrics_portal_steps`, limpeza de 30 dias, Suporte/auditoria/suspensão), anotação nas telas do
  portal (`trackPortalStep`, depois da resposta) e funil de **8 passos** em Métricas › Portal, com filtro por entrada e
  maior perda. Os passos reais do portal são 8, não 10 como no desenho: especialidade e local não são telas próprias.
  Testes: 1236 unitários e 1163 do banco; Playwright do portal (passos 1–5) e do funil a 390/1280. Os passos 6–8 pedem
  o código do celular e ficaram cobertos só pelos testes do banco. Revisão `high`: 10 achados corrigidos (limpeza de
  `portal_limit_resets` mantida; passos 6–8 só com reserva ativa ou consulta marcada; entrada guardada no cookie; cookie
  renovado a cada tela; sem visita nova a partir do passo 5; filtro de robôs mais estreito; aviso de período anterior
  à anotação; `portalSteps` antigo removido). `metrics_portal` ainda calcula as colunas de sessão que a tela não usa
  (custo pequeno, só ao abrir Métricas). Banco local com a migração; staging e produção ainda não.
- **U1 confirmada pelo cliente (13/nov).**
- **U2 (feita na branch, 13/nov; aguarda validação):** migração `20270123120000_usabilidade_sinais` (função
  `metrics_usability`, só Suporte, sem tabela nova) e aba **Usabilidade** em Métricas (só `isPlatformStaff`, uma clínica,
  período como as outras). 5 sinais de dados existentes: marcou e cancelou em menos de 5 min (recepção); marcou e
  cancelou em menos de 1 h (portal); remarcou em menos de 1 h depois de marcar; errou o código do celular; reserva
  vencida sem marcar; mais a maior perda do funil, com link para Portal. Cada sinal traz "o que pode significar" e "o que
  melhorar". "Remarcou 2 vezes no dia" ficou de fora: a remarcação guarda só a última data. Códigos e reservas valem
  30 dias. Banco local com a migração; staging e produção ainda não.

- **Publicação (13/nov, a pedido do cliente):** juntada na `main` (`8905c68c`) e no staging (migrações antes do código); produção só com
  esta frente (`b09b18c`, cherry-pick; sem a nota fiscal). Revisão `high` da U2: 8 achados, corrigidos na migração
  `20270123130000` e no código. `revisto até: ae6814f8`.
