# Produção (F10.0c)

> Produção em `https://app.recepclinic.com.br`, só com clínicas reais. Decisões no [plano](plano.md) (F10, 25 e
> 26/out): **time Pro na Vercel** com os dois projetos (o do staging transferido para ele e o da produção); **Supabase
> numa organização nova, Pro**, só com a produção (o staging fica na organização gratuita); a produção publica pela
> **branch `producao`** (o staging continua publicando a cada push na `main`). O código é o mesmo: primeiro o staging
> e, validado, a produção.
>
> Variáveis no `.env.production` (fora do git, já criado pelo Claude com o que é igual ao staging e um `CRON_SECRET`
> novo). Os scripts de teste (`demo-clinicas`, `reset-test-data`) recusam rodar com ele.

Fazer na ordem. O `app.` só passa para a produção no passo 9, com tudo pronto: até lá ele continua no staging.

## 1. Vercel: time Pro e o staging dentro dele (cliente)

1. Em [vercel.com](https://vercel.com), no seletor de conta (alto, à esquerda), **Create Team**: nome `RecepClinic`,
   plano **Pro** (US$ 20/mês, 1 membro), forma de pagamento.
2. Projeto do staging (**recepclinic**, na conta pessoal) › **Settings › General**, no fim: **Transfer Project** para o
   time `RecepClinic`. Variáveis, domínios (`teste.` e `app.`) e a ligação com o GitHub vão junto. Se a Vercel pedir,
   dar ao time acesso ao repositório `tluiz22/recepclinic` (instalar o app da Vercel no GitHub para o repositório).
3. Conferir: `https://teste.recepclinic.com.br/admin/login` abre e o próximo push na `main` publica o staging (o Claude
   faz um push de conferência).
4. No projeto do staging, **Settings › Git › Ignored Build Step**, opção *Custom*, comando:
   ```
   [ "$VERCEL_GIT_COMMIT_REF" != "main" ]
   ```
   (o staging só publica a `main`; pushes na `producao` não geram versões nele).

## 2. Supabase: organização e projeto da produção (cliente)

1. Em [supabase.com](https://supabase.com), **New organization**: nome `RecepClinic Produção`, plano **Pro** (US$ 25/mês,
   já cobre 1 projeto Micro). Deixar o **Spend cap** ligado.
2. Nela, **New project**: nome `recepclinic-producao`, região **South America (São Paulo)**, senha do banco gerada (guardar
   no gerenciador de senhas).
3. **Ponto de parada:** *Project Settings › JWT Keys*. Se aparecer o **Legacy JWT Secret** (como no staging), seguir.
   **Se não aparecer, parar e avisar o Claude**: a credencial limitada à clínica (bot e páginas do paciente) é assinada
   com ele, e o Claude ajusta antes de continuar.
4. Preencher no `.env.production` (abrir com `open -e .env.production`):
   - *Data API*: Project URL → `PUBLIC_SUPABASE_URL`, **sem** o `/rest/v1/` do fim (a tela mostra com ele);
   - *API Keys*: **anon** → `PUBLIC_SUPABASE_ANON_KEY`; **service_role** → `SUPABASE_SERVICE_ROLE_KEY`;
   - *JWT Keys*: **Legacy JWT Secret** → `SUPABASE_JWT_SECRET` (**nunca revogar**, como no staging);
   - a senha do banco → `SUPABASE_DB_PASSWORD`;
   - botão **Connect** (alto da página) › *Session pooler*: o endereço `postgresql://…` com a senha no lugar de
     `[YOUR-PASSWORD]` → `SUPABASE_DB_URL`.
5. Avisar o Claude: ele aplica as migrações (passo 4).

## 3. Resend: chave da produção (cliente)

Em [resend.com](https://resend.com) › *API Keys* › **Create API Key**: nome `producao-smtp`, permissão **Sending access**,
domínio `recepclinic.com.br`. Colar no `SMTP_PASSWORD` do `.env.production` (a chave aparece uma vez só). O
`WHATSAPP_ES_CONFIG_ID` do `.env.production` é o mesmo da Vercel do staging (*Settings › Environment Variables*).

## 4. Banco da produção (Claude)

Com o `.env.production` preenchido, o Claude aplica as migrações sem mexer no vínculo do repositório com o staging:
simulação (`supabase db push --db-url … --dry-run`), aplicação, e conferência no banco (tabelas, extensões, rotinas do
`pg_cron`, buckets da logo e da nota). Sem dados de exemplo (o `seed.sql` é só do ambiente local).

## 5. Supabase: login e e-mail da produção (cliente)

No projeto `recepclinic-producao`, **Authentication**:
1. *Sign In / Providers*: desligar **Allow new users to sign up**; em **Email**, senha com no mínimo **8** caracteres e
   **Email OTP Expiration** `86400` (o link do convite e da senha vale 24 horas).
2. *URL Configuration*: **Site URL** `https://app.recepclinic.com.br`; **Redirect URLs** `https://app.recepclinic.com.br/**`.
3. *Emails › SMTP Settings*: **Enable custom SMTP**; Sender email `nao-responda@recepclinic.com.br`; Sender name
   `RecepClinic`; Host `smtp.resend.com`; Port `465`; Username `resend`; Password: a chave `producao-smtp`; *Save*.
   Para copiar sem exibir: `grep '^SMTP_PASSWORD=' .env.production | cut -d= -f2- | pbcopy`.
4. *Emails › Templates*: **Invite user**, assunto `Convite para o painel RecepClinic`, corpo de
   `supabase/templates/convite.html` (`pbcopy < supabase/templates/convite.html`); **Reset password**, assunto
   `Redefinir a senha do painel RecepClinic`, corpo de `supabase/templates/recuperar-senha.html`.

## 6. Branch `producao` (Claude)

O Claude cria a branch `producao` a partir da `main` (a versão validada no staging) e envia ao GitHub.

## 7. Vercel: projeto da produção (cliente)

1. No time `RecepClinic`, **Add New › Project**, importar `tluiz22/recepclinic` de novo; nome `recepclinic-producao`.
2. Antes do *Deploy*, em *Environment Variables* (todas só em **Production**), copiar do `.env.production`: `PUBLIC_SUPABASE_URL`,
   `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `CRON_SECRET`, `SITE_URL`,
   `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_ID`, `WHATSAPP_ES_CONFIG_ID`, `SMTP_HOST`,
   `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`. A Vercel aceita colar o arquivo inteiro na primeira caixa:
   antes, tirar as linhas `RECEPCLINIC_PRODUCAO`, `SUPABASE_DB_PASSWORD` e `SUPABASE_DB_URL` (só do terminal).
   **Nunca** pôr `NFSE_SIMULATION` nem `WHATSAPP_WEBHOOK_OVERRIDE_URL` na produção.
3. *Deploy*.
4. **Settings › Git › Production Branch** (ou *Settings › Environments › Production › Branch Tracking*): `producao`.
5. **Settings › Git › Ignored Build Step**, *Custom*:
   ```
   [ "$VERCEL_GIT_COMMIT_REF" != "producao" ]
   ```
   (pushes na `main` não geram versões na produção).
6. *Deployments*: **Redeploy** da última versão da `producao`. Conferir no endereço `….vercel.app` que a Vercel mostra:
   a tela de login abre.

## 8. Agendador da produção (cliente)

```
node --env-file=.env.production scripts/agendador.mjs
```
Deve responder `Agendador ligado: as rotinas chamam https://app.recepclinic.com.br/api/cron/…`. Até o passo 9 as
rotinas chamam o `app.`, que ainda é o staging, e recebem recusa (o segredo é outro): não fazem nada lá.

## 9. O `app.` passa para a produção (cliente, num horário calmo)

1. Projeto do **staging** › *Settings › Domains*: **Remove** `app.recepclinic.com.br` (o `teste.` fica).
2. Projeto **recepclinic-producao** › *Settings › Domains*: **Add** `app.recepclinic.com.br`, sem redirecionar. Se a
   Vercel mostrar um CNAME diferente de `ed13a388a0d7bbde.vercel-dns-017.com`, trocar o destino do registro `app` na
   Cloudflare.
   Na F10.0c (26/out) a Vercel pediu **Verification Required** ("linked to another Vercel account": o `app.` tinha sido
   cadastrado na conta pessoal): TXT `_vercel` com o `vc-domain-verify=…` que ela mostra, criado na Cloudflare (pode
   ficar). As rotinas diárias (`series`, 03:00, e `notas-fiscais`, 03:30) ainda não tinham rodado e a Saúde dava 503:
   o Claude rodou as duas uma vez (`select app.call_system_route('/api/cron/series')` e a das notas), sem clínica
   nenhuma, só para registrar a execução.
3. Supabase do **staging** (*Authentication › URL Configuration*): tirar `https://app.recepclinic.com.br/**` das Redirect
   URLs (fica só o `teste.`).
4. **Meta: nada muda.** O webhook principal do app continua em `https://app.recepclinic.com.br/api/whatsapp/webhook`,
   agora na produção (mesmo App Secret e mesmo token de verificação); o desvio leva a conta de testes ao staging.
   Os domínios do Embedded Signup já têm o `app.` e o `teste.`.
5. **Better Stack: nada muda.** Os 4 monitores em `app.` passam a vigiar a produção.

## 10. Login do Suporte na produção (cliente)

```
node --env-file=.env.production scripts/criar-suporte.mjs <seu e-mail> "<seu nome>"
```
Abrir o link (vale 1 hora), criar a senha e entrar em `https://app.recepclinic.com.br/admin/login`. Se vencer, `node --env-file=.env.production
scripts/link-de-senha.mjs <seu e-mail>`.

## 11. Conferência (cliente e Claude)

1. O Claude confere pelo terminal: saúde (banco e rotinas), webhook (como a Meta confere), erros e que o staging segue
   respondendo em `teste.` (bot pelo número de testes).
2. **Backup**: no dia seguinte, *Database › Backups* do `recepclinic-producao` mostra o primeiro backup diário.

## Depois: publicar uma versão na produção

Validada no staging, o Claude (com o OK do cliente) aplica as migrações novas na produção (simulação → aplicar →
conferir) e leva a `main` para a `producao` (`git push origin main:producao`); a Vercel publica a produção.

## Feito em 26/out

Passos 1 a 10 feitos e conferidos (cliente e Claude); passo 11 conferido pelo Claude: `app.` na produção (login,
saúde, webhook com o token da Meta, erros), `teste.` no staging, 1 login de Suporte, banco sem clínica e sem erro;
e-mail de senha da produção conferido pelo cliente (remetente, modelo e link em `app.`). Falta só conferir o
primeiro backup diário (27/out).

## Publicações

| Data | Versão (`producao`) | Migrações | Observações |
|---|---|---|---|
| 27/out | `793587f` | `20261027120000_atendimento_humano`, `20261027140000_horario_da_recepcao`, `20261027160000_notificacoes` | F8.5a a F8.5c (atendimento humano, horário da recepção, notificações), avisos do Início no fim da página, manifesto com escopo `/` e login instalável. Simulação → aplicação → conferência (colunas, tabela `push_subscriptions`, rotina `atendimento-humano` no `pg_cron`) antes do push. Rotina nova chamada uma vez à mão (GET com o `CRON_SECRET`) para a `/api/saude` voltar a `ok`. Chaves de notificação próprias da produção geradas no `.env.production`; **falta o cliente pô-las na Vercel da produção** (`WEB_PUSH_PUBLIC_KEY` e `WEB_PUSH_PRIVATE_KEY`, Production) e fazer o Redeploy. |
| 27/out | `af0902d` | `20261027180000_bot_nao_entende` | F8.5d (bot que não entende: 4ª mensagem seguida vai para a clínica; aviso próprio para áudio e mídia) e o ajuste da notificação (abre a tela Atendimento e, no celular, o WhatsApp pelo aplicativo). Simulação → aplicação → conferência da coluna `not_understood_count` antes do push; saúde `ok` depois da publicação. Chaves de notificação da produção na Vercel (cliente, 27/out). |

**Rotina nova numa publicação:** a `/api/saude` dá a rotina como "sem execução registrada" (503, o Better Stack
alerta) até a primeira execução. Logo depois de a Vercel publicar, chamar uma vez:
`curl -s -H "Authorization: Bearer <CRON_SECRET da produção>" https://app.recepclinic.com.br/api/cron/<rotina>` (GET; o
POST de fora é recusado pela proteção do Astro).

