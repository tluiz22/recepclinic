---
name: publicar
description: Publica a main no staging ou na produção (migração antes do código; produção só com autorização).
---
**Staging** (`teste.recepclinic.com.br`; push na `main` já publica):
1. Migração nova: `supabase db push` com `.env.staging` — simular → aplicar → conferir. Só depois o push do código.
2. Suíte completa do Playwright antes; CI verde.

**Produção** (`app.recepclinic.com.br`): só com autorização explícita do cliente. Seguir `docs/producao.md`
(simulação → aplicar → conferir → `git push origin main:producao`). Antes, conferir que o staging foi validado.
Docs-only não gera deploy. Registrar a publicação em `docs/producao.md`.
