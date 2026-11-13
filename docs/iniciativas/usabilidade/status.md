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
- **U2:** aba Usabilidade, só para o suporte (equipe da plataforma).
