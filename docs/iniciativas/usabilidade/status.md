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
- **U1:** tabela `portal_visits`, registro nos passos do portal e funil de 10 passos em Métricas › Portal.
- **U2:** aba Usabilidade, só para o suporte (equipe da plataforma).
