---
name: fechar-etapa
description: Fecha uma etapa: testes, code-review do diff da etapa, status.md e parada para confirmação.
---
1. `npm test` (+ `npm run test:db` se mexeu em banco; PATH com `/opt/homebrew/bin`) e `astro check`.
2. UI mudou: Playwright só da tela alterada, skill `playwright-ui-form-best-practices`; conferir pelo snapshot de
   texto; no fim, uma captura a 390 e outra a 1280 px.
3. `/code-review` do diff da etapa: nível `medium`; `high` se tocou migração/RLS, autenticação, webhook Meta ou Asaas.
   Corrigir os achados no mesmo commit. Nunca `max`/`ultra` sem pedido do cliente.
4. Mudou tela com captura da Ajuda: anotar em `docs/capturas-pendentes.md`.
5. Atualizar o `status.md` da frente (enxuto: o que está em cada ambiente + próxima ação) e a linha no `roadmap.md`.
   Detalhe longo vai para o `historico.md`.
6. Commit. Dizer ao cliente o que foi feito + comandos de validação e **parar até a confirmação**.
