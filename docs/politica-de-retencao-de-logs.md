# Política: guarda dos registros (logs)

**ADOTADA pelo cliente em 13/nov/2026.** Falta a revisão do advogado e do contador (os prazos legais abaixo vêm do
conhecimento geral e precisam ser conferidos). Origem: avaliação BaaS do Asaas (5.1.4).

## Situação hoje (verificada nas migrações)

| Registro | Tabela | Guarda hoje |
|---|---|---|
| Erros do sistema | `system_errors` | apagados após **90 dias** (rotina `limpar-erros`) |
| Alterações da plataforma | `platform_audit_log` | sem expiração |
| Leituras do Suporte nas clínicas | `platform_access_log` | sem expiração |
| Faturamento | `billing_audit_log` | sem expiração |
| Fiscal | `fiscal_audit_log` | sem expiração |
| Pedidos de autoridades | registro próprio | mínimo de 5 anos (política de 09/out) |
| Logs de infraestrutura | Vercel, Supabase | prazo do plano de cada provedor |

## Regra adotada

| Registro | Prazo proposto | Base |
|---|---|---|
| Trilhas de auditoria (plataforma, acesso do Suporte, faturamento) | **5 anos**, depois apagar | prática de prazo prescricional e fiscal; **conferir com o advogado** |
| Auditoria fiscal | **5 anos** a contar do fato (mesmo prazo das notas) | prazo fiscal; **conferir com o contador** |
| Registros de acesso a aplicação (login, uso do painel) | **no mínimo 6 meses** | Marco Civil da Internet, art. 15; **conferir com o advogado** |
| Erros do sistema e rotinas (`system_errors`, `job_runs`) | **90 dias** | operação; sem exigência legal |
| Pedidos de autoridades | **5 anos** (já adotado) | política de 09/out |
| Logs dos provedores | conforme o plano; **exportar** ao mudar de plano se o prazo ficar abaixo de 6 meses | a verificar nos painéis |

- **Pendente:** a exclusão automática dos registros vencidos (rotina agendada, como a `limpar-erros`) ainda não existe;
  hoje as trilhas ficam além do prazo, o que não fere a regra. A rotina entra numa migração (staging antes da produção).
- Registro sob pedido de autoridade ou litígio **não é apagado** até o fim do caso.
- Responsável: o titular do RecepClinic.
