# Plano de continuidade e recuperação

**ADOTADO pelo cliente em 13/nov/2026** (avaliação BaaS do Asaas, 9.1.1 a 9.1.3). Responsável: o titular do RecepClinic.

## Metas
- **RTO (tempo para voltar): 24 horas.**
- **RPO (dado que pode se perder): 24 horas** (backup diário do Supabase Pro). Subir o nível (PITR, RTO e RPO menores)
  quando houver clínicas maiores; é decisão do cliente e tem custo.

## Cenários e recuperação
| Cenário | O que fazer |
|---|---|
| Queda da Vercel | Esperar o provedor; se longa, publicar a `main` em outro projeto da Vercel ou outro host compatível com Astro, apontar o DNS (Cloudflare) e recolocar as variáveis de ambiente |
| Queda ou perda de dados do Supabase | Restaurar o último backup (painel do Supabase); se o projeto se perder, criar um novo, aplicar as migrações (`supabase db push`) e restaurar o backup; refazer o Vault (tokens da Meta, certificados) e as chaves |
| Dado apagado ou corrompido por erro ou ataque | Restaurar o backup num projeto separado, comparar e recuperar só o necessário; seguir `procedimento-de-incidentes.md` |
| Perda de acesso do titular | Recuperação das contas pelos e-mails e métodos de recuperação cadastrados; sem acesso compartilhado |
| Integrações fora do ar (Asaas, Meta, Resend) | Esperar o provedor; a aplicação continua com o que não depende deles; reconfigurar webhooks ao voltar |

Depois de qualquer recuperação: reconfigurar webhooks (Asaas `/api/asaas/webhook`, Meta), trocar chaves e tokens que
possam ter sido expostos, conferir `/api/saude` e o Better Stack, avisar as clínicas e, se couber, o Asaas (24 h).

## Backups
- **Banco:** backup automático diário do Supabase Pro, mantido pelo provedor fora do banco ativo.
  **Conferir no painel:** prazo de guarda e se o PITR está ligado (não afirmar sem ver).
- **Código e migrações:** GitHub (`main` e `producao`); o ambiente se recria a partir deles.
- **Segredos:** não ficam em backup do código; reconfigurar a partir do cofre de cada provedor e das contas.

## Teste de restauração (a cada 6 meses: maio e novembro)
Restaurar o último backup no staging (ou em projeto de teste), conferir login, uma clínica, a agenda e os pacientes,
e registrar o tempo e o resultado. O **primeiro teste** é feito antes da primeira clínica real maior.

| Data | Backup usado | Tempo gasto | Resultado | Problemas e ajustes |
|---|---|---|---|---|
| — | primeiro teste pendente | — | — | — |
