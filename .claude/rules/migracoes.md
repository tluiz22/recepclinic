---
paths:
  - "supabase/migrations/**"
---
Push na `main` vai ao staging: a migração entra no staging **antes** do código que a lê (`supabase db push`: simular →
aplicar → conferir → push). Produção só com autorização do cliente, pelo `docs/producao.md`. Banco local é único:
migração só avisando. Mudança de tabela com RLS: tenant isolado por clínica (D1).
