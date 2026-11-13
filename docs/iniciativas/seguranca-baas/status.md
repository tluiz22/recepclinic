# Segurança e conformidade (avaliação BaaS do Asaas)
**Origem:** questionário "Avaliação Clientes BaaS" do Asaas (13/nov/2026), seções 1.1 a 10.1, **todas respondidas no chat**.
**Estado:** planejamento. Feito: só documentos e a configuração do GitHub. Nada de código do produto nem migração.
**Para a próxima sessão:** ler este arquivo, escolher a ordem das etapas com o cliente e fechar uma por vez.

## Já feito (13/nov, na `main`)
Documentos (todos no índice `docs/README.md`):
- `politica-de-acessos.md` (papéis, chaves, revisão semestral; MFA ligado nas 6 contas críticas, informado pelo cliente).
- `politica-de-retencao-de-logs.md` (auditoria 5 anos; acesso à aplicação 6 meses ou mais; erros 90 dias).
- `procedimento-de-incidentes.md` (aviso ao Asaas em até 24 h).
- `politica-de-vulnerabilidades.md` (crítica 48 h, alta 7 dias, média 30, baixa 90).
- `politica-de-fornecedores.md` (contrato, acesso mínimo, cadastro; cláusulas a revisar pelo advogado).
- `plano-de-continuidade.md` (RTO 24 h, RPO 24 h).
- `padroes-de-codigo-seguro.md` (regras de desenho e de revisão).

GitHub (`.github/`): `dependabot.yml` e `workflows/seguranca.yml`. **Primeira execução (13/nov):** CodeQL ok, gitleaks ok,
`npm audit` **falhou** (esperado: 22 achados). O Dependabot já abriu os PRs #8 a #17 (atualizações de bibliotecas e de Actions).

## A fazer, em ordem de prioridade

### S1. Vulnerabilidades das bibliotecas (urgente; prazo da política: crítica 15/nov, altas 20/nov)
- 22 achados de produção: 1 crítica (`astro`, execução remota na otimização AVIF), 17 altas (`nodemailer`, `node-forge`,
  `@astrojs/vercel`, `@vercel/functions`, `sharp`, `zod`, `path-to-regexp`, `devalue`, `js-yaml`, `svgo` e outras), 4 médias.
  Todas com correção disponível. Registro na tabela de `politica-de-vulnerabilidades.md`.
- Tratar os PRs do Dependabot (#8–#17): nodemailer 7→10 e web-push 3→4 são **saltos de versão maior** (testar envio de
  e-mail e notificações); `actions/checkout` 4→7 e `setup-node` 4→7 também. Um a um, ou agrupados numa branch.
- Branch curta; `astro check`, `npm test`, `test:db`, Playwright completo; staging antes da produção.
- Ao fim, `npm audit --omit=dev --audit-level=high` verde no workflow `Segurança`.
- Decidir: o repositório `tluiz22/recepclinic` está **público**; é a intenção? (código do produto visível.)

### S2. Logs (migração; staging antes do código)
- `revoke insert, update, delete` em `platform_access_log` (hoje só RLS, sem o `revoke` das outras trilhas).
- Rotina agendada que apaga o vencido: auditoria 5 anos, acesso conforme a política, `job_runs` 90 dias
  (verificar se existe limpeza). Hoje só `system_errors` expira (90 dias).
- Conferir o prazo dos logs da Vercel e do Supabase no plano atual; exportar se ficar abaixo de 6 meses.

### S3. Chaves e segredos
- A chave do Asaas de produção **passou pelo chat com o assistente?** Se sim: gerar chave nova, trocar na Vercel,
  redeploy, trocar o token do webhook. Ajustar as respostas 2.1.1 e 2.1.3 conforme o que de fato ocorreu.
- Decidir se o `.env.production` local continua ou se a chave fica só na Vercel.
- Conferir no painel do Asaas o webhook `https://app.recepclinic.com.br/api/asaas/webhook`.
- Decidir se haverá rotação periódica dos segredos (hoje só por suspeita, saída de pessoa ou vencimento).

### S10. Continuidade e backup
- Conferir no painel do Supabase de produção: backups existem, prazo de guarda, PITR ligado ou não. Registrar no plano.
  (O roadmap ainda lista "1º backup diário da produção" como pendência; o `producao.md` registra 27/out.)
- **Primeiro teste de restauração** no staging, registrado na tabela de `plano-de-continuidade.md`; depois a cada 6 meses.
- Decidir quando subir as metas (PITR, custo).

### S9. Fornecedores
- Ler os termos e o DPA de Vercel, Supabase, Cloudflare, GitHub, Meta, Resend, Better Stack, Asaas e da empresa de IA
  e preencher o cadastro em `politica-de-fornecedores.md` (hoje "pendente" em todos).
- Advogado: modelo de contrato para prestador (sigilo, credenciais, incidente em 24 h, subcontratação, LGPD, rescisão).
- Incluir a empresa de IA e a Meta na política de privacidade; listar o Asaas e a IA na tela `/admin/sistema/tecnologia`.

### S6. Jurídico (advogado e contador)
- Revisar: retenção de logs, prazo da ANPD (3 dias úteis), textos de comunicação de incidente, políticas de acessos e
  de fornecedores, plano de continuidade.
- Pendentes de antes: termo de tratamento de dados, contrato com as clínicas, política de privacidade e termos de uso
  (estão no ar no site `www`?), prazo fiscal de guarda (L42), encarregado de dados (DPO).

### S4. 2FA no painel do RecepClinic (L17, hoje "P2")
- Decidir se entra agora (Suporte e Administrador, ao menos) ou depois. Hoje só e-mail e senha.

### S5. Pentest
- Decisão do cliente: contratar ou não, quando e custo. Hoje só varreduras automáticas.

### S7. Confirmações com o cliente (nada a implementar)
- Supabase de produção e de staging em organizações separadas (3.1.1).
- Destinatários e canais do alerta do Better Stack (5.1.1); se os 4 monitores seguem ativos.
- Outras pessoas (sócio, contador) com acesso a alguma ferramenta (1.1.1, 2.1.3).
- Contato do Asaas para incidentes (6.1.2).
- Conferir na documentação do Supabase e da Vercel as frases usadas: AES-256, AWS, hash de senha, rotação de chaves (4.1.3, 4.1.4).
- Conferir que o Asaas tem o webhook em `https://` (4.1.2).

### S8. Rotinas recorrentes
- Revisão de acessos: maio e novembro (1ª: 05/2027). Teste de restauração: mesmos meses.
- Revisão mensal dos alertas de dependência (1ª segunda do mês).

## Respostas do questionário que dependem de uma etapa
| Pergunta | Hoje | Vira firme depois de |
|---|---|---|
| 2.1.1, 2.1.3 | Sim, com ressalva (`.env.production` local; chave possivelmente passou pelo chat) | S3 |
| 3.1.1, 3.1.3 | Sim | S7 (organizações do Supabase) e S2 (`platform_access_log`) |
| 3.1.2 | Sim (aprovação humana é a do cliente no staging) | decisão do cliente; segundo programador, se o Asaas exigir |
| 4.1.4 | Sim, com chaves do provedor (sem KMS próprio) | S7 e decisão de rotação (S3) |
| 5.1.3 | Sim (RLS e permissões; não há WORM nem cópia externa) | S2 |
| 5.1.4 | Sim (política adotada; exclusão automática ainda não existe) | S2, S6 |
| 7.1.2 | Sim só com varreduras automáticas; sem pentest | S1, S5 |
| 7.1.x | Sim (política adotada), com falhas críticas abertas | S1 |
| 8.1.2 a 8.1.6 | Sim como política; sem prestador nem contrato real; DPAs não lidos | S9 |
| 9.1.3 | Não, até o 1º teste | S10 |
| 10.1.2 | Sim, por ferramenta (não por outro programador) | — |

## Próxima ação
Planejar as etapas com o cliente; **S1 primeiro** (vulnerabilidade crítica aberta e `npm audit` vermelho), depois S3, S10 e S2.
