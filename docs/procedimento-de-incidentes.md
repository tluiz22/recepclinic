# Procedimento: incidentes de segurança

**ADOTADO pelo cliente em 13/nov/2026** (avaliação BaaS do Asaas, 6.1.1 e 6.1.2).
**A revisar pelo advogado** (prazos da LGPD/ANPD e texto das comunicações).

Vale para invasão, vazamento de dados, uso indevido de acesso ou de chave, e qualquer evento que comprometa
dados pessoais ou financeiros. Responsável: o titular do RecepClinic (até haver um encarregado definido).

## 1. Detecção
Alertas do Better Stack; erros e rotinas no painel do Suporte; trilhas de auditoria; aviso de clínica, do Asaas
ou da Meta; suspeita de qualquer pessoa da equipe.

## 2. Contenção (no mesmo dia)
- Revogar e trocar as chaves e os tokens envolvidos (Asaas, Supabase, Vercel, Meta, Resend, `CRON_SECRET`).
  Chave do Asaas: ver `politica-de-acessos.md`.
- Desativar o usuário ou o acesso comprometido; suspender a integração afetada; se preciso, tirar o sistema do ar.
- Preservar as evidências (logs, registros de auditoria) antes de qualquer limpeza.

## 3. Avaliação
Que dados e quais clínicas foram afetados, desde quando, se há dado pessoal ou financeiro, e se ainda ocorre.
Usar as trilhas (`platform_audit_log`, `platform_access_log`, `billing_audit_log`, `fiscal_audit_log`) e os logs
da Vercel e do Supabase.

## 4. Comunicação
| Quem | Quando | Como |
|---|---|---|
| **Asaas** | **até 24 horas** depois de confirmado incidente que afete a integração, as chaves ou dados de cobrança | canal de suporte/gerente de conta do Asaas, com o que houve, o impacto e as ações |
| **Clínicas afetadas** (controladoras dos dados dos pacientes) | sem demora, assim que se souber quais dados e quais clínicas | e-mail e contato direto, com o que aconteceu, quais dados e o que fazer |
| **ANPD e titulares** | quando houver risco ou dano relevante aos titulares (LGPD, art. 48); referência de **3 dias úteis** da regulamentação da ANPD, **a confirmar com o advogado** | a clínica (controladora) decide e comunica, com o nosso apoio; o RecepClinic fornece as informações |
| **Meta** | se o incidente envolver o app, os tokens ou o WhatsApp | canais da Meta para desenvolvedores |

## 5. Causa raiz e prevenção
Depois de conter: escrever o que aconteceu, a causa, a correção e o que muda para não se repetir (regra, teste,
alerta ou treinamento). Atualizar este procedimento, se for o caso.

## 6. Registro
Cada incidente fica registrado (data, impacto, ações, comunicações, causa raiz) e guardado por **5 anos**.

| Data | Incidente | Impacto | Comunicados | Causa raiz |
|---|---|---|---|---|
| — | nenhum até 13/nov/2026 | — | — | — |
