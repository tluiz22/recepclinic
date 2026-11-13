# Segurança e conformidade (avaliação BaaS do Asaas)
**Origem:** questionário "Avaliação Clientes BaaS" do Asaas (13/nov/2026), seções 1.1, 2.1, 3.1, 4.1, 5.1, 6.1 e 7.1.
**Estado:** planejamento. Já feito: só documentos e configuração do GitHub (abaixo). Nada de código do produto nem migração.

## Já feito (13/nov, na `main`)
- `docs/politica-de-acessos.md` (acessos, chaves, revisão semestral, MFA: ligado nas 6 contas críticas, informado pelo cliente).
- `docs/politica-de-retencao-de-logs.md` (adotada: auditoria 5 anos, acesso à aplicação 6 meses ou mais, erros 90 dias).
- `docs/procedimento-de-incidentes.md` (adotado; aviso ao Asaas em até 24 h).
- `docs/politica-de-vulnerabilidades.md` (adotada; crítica 48 h, alta 7 dias, média 30, baixa 90), com `.github/dependabot.yml`
  e `.github/workflows/seguranca.yml` (npm audit, gitleaks, CodeQL).

## A fazer (candidatos a etapas)
**S1: Corrigir as vulnerabilidades das bibliotecas (urgente, prazo da política: crítica 15/nov, altas 20/nov)**
- 22 achados em produção (1 crítica: `astro`, execução remota na otimização AVIF; 17 altas: `nodemailer`, `node-forge`,
  `@astrojs/vercel`, `@vercel/functions`, `sharp`, `zod`, `path-to-regexp` e outras). Todas com correção disponível.
- Branch curta; atualizar, rodar `astro check`, `npm test`, `test:db` e a suíte do Playwright; staging antes da produção.
- Conferir o resultado do workflow `Segurança` no GitHub (gitleaks e CodeQL ainda não vistos rodando).

**S2: Logs (migração, staging antes do código)**
- `revoke insert, update, delete` em `platform_access_log` (hoje só RLS).
- Rotina agendada que apaga o vencido: trilhas de auditoria 5 anos, acesso à aplicação conforme a política, `job_runs` 90 dias
  (verificar se já existe limpeza). Hoje só `system_errors` expira (90 dias).
- Conferir o prazo dos logs da Vercel e do Supabase no plano atual; exportar se ficar abaixo de 6 meses.

**S3: Chaves e segredos**
- Verificar se a chave do Asaas de produção passou por conversa de chat (o formulário pergunta). Se sim: gerar chave nova,
  trocar na Vercel, redeploy, trocar o token do webhook.
- Decidir se o `.env.production` local continua existindo ou se a chave fica só na Vercel.
- Conferir no painel do Asaas que o webhook está em `https://app.recepclinic.com.br/api/asaas/webhook`.
- Decidir se haverá rotação periódica dos segredos (hoje só por suspeita, saída de pessoa ou vencimento).

**S4: 2FA no painel do RecepClinic (L17, hoje "P2")**
- Decidir se entra agora (clínicas e Suporte) ou depois; pelo menos para o Suporte e o Administrador.

**S5: Pentest**
- Decisão do cliente: contratar ou não, quando (por exemplo, antes da primeira clínica grande) e o custo.

**S6: Jurídico (advogado e contador)**
- Revisar: prazos de retenção, prazo da ANPD (3 dias úteis), textos de comunicação de incidente, política de acessos.
- Pendentes de antes: termo de tratamento de dados, contrato com as clínicas, política de privacidade e termos de uso
  (confirmar se estão no ar no site `www`), prazo fiscal de guarda (L42), encarregado de dados (DPO).

**S7: Confirmações com o cliente (nada a implementar)**
- Supabase de produção e de staging em organizações separadas; destinatários e canais do alerta do Better Stack;
  se há outras pessoas (sócio, contador) com acesso a alguma ferramenta; contato do Asaas para incidentes;
  repositório `tluiz22/recepclinic` está **público** no GitHub (é a intenção?).
- Conferir na documentação do Supabase e da Vercel as frases usadas nas respostas (AES-256, AWS, hash de senha).

**S9: Fornecedores (política adotada em 13/nov: `politica-de-fornecedores.md`)**
- Ler os termos e o DPA de Vercel, Supabase, Cloudflare, GitHub, Meta, Resend, Better Stack, Asaas e da empresa de IA e
  preencher o cadastro (coluna "Termo/DPA lido?"). Lacunas: decidir manter, mitigar ou trocar.
- Advogado: revisar e transformar as cláusulas da seção 3 num **modelo de contrato** para prestador (sigilo, credenciais,
  aviso de incidente em 24 h, proibição de subcontratar sem autorização, LGPD, rescisão).
- Incluir a empresa de IA e a Meta na política de privacidade.
- Ao contratar o primeiro desenvolvedor: seguir a seção 1 (contrato, conta nominal, staging, MFA, sem chave de produção).

**S10: Continuidade (plano adotado em 13/nov: `plano-de-continuidade.md`; RTO 24 h, RPO 24 h)**
- Conferir no painel do Supabase de produção: prazo de guarda dos backups e se o PITR está ligado; registrar no plano.
- Fazer o **primeiro teste de restauração** (no staging) e registrar na tabela; depois, a cada 6 meses (maio e novembro).
- Decidir quando subir as metas (PITR) e o custo.
- Roadmap: a "1º backup diário da produção" ainda está como pendência avulsa; conferir se já está confirmado.

**S8: Rotinas**
- 1ª revisão semestral de acessos: 05/2027 (maio e novembro). Revisão mensal dos alertas de dependência.

## Respostas ao questionário
As respostas estão no chat de 13/nov. Não ficaram em arquivo; se o cliente quiser, gravar em `docs/` ao enviar.
Pontos em que a resposta depende de uma etapa acima: 2.1.x (S3), 5.1.3 e 5.1.4 (S2), 7.1.x (S1 e S5), 6.1.x (S6).

## Próxima ação
Escolher a ordem das etapas com o cliente; S1 primeiro (vulnerabilidade crítica aberta).
