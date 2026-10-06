# Staging na nuvem (F5.5)

> Ambiente de testes na nuvem (D8), em `app.recepclinic.com.br` até a F10. Na F10 o endereço passa
> para a produção e o staging vai para `teste.recepclinic.com.br` (cliente, 06/out/2026).
> Só dados de teste: o banco tem o schema e o login do Suporte; as clínicas de teste são criadas
> pela tela "Nova clínica". Os dados fictícios do `seed.sql` ficam só no ambiente local.
>
> **Nada do piloto** (banco, Vercel, número, app da Meta, segredos) é usado aqui.

## A. Supabase

1. Em [supabase.com](https://supabase.com), criar a organização **RecepClinic** (plano Free),
   separada da do piloto, e nela o projeto **recepclinic-staging**, região **South America (São
   Paulo)**. Guardar a senha do banco num gerenciador de senhas.
2. Aplicar as migrações (sem o seed), na raiz do projeto:
   ```
   npx supabase login
   npx supabase link --project-ref <ref do projeto>
   npx supabase db push
   ```
   O `<ref>` é o código do endereço do projeto (`https://<ref>.supabase.co`). O `link` pede a senha
   do banco.
3. **Authentication**:
   - *Sign In / Providers*: desligar **Allow new users to sign up** (a equipe entra por convite);
     senha com no mínimo 8 caracteres.
   - *URL Configuration*: **Site URL** `https://app.recepclinic.com.br`; **Redirect URLs**
     `https://app.recepclinic.com.br/**`.
   - *Emails › Templates*: **fica para quando houver o provedor de e-mail** (cliente, 06/out/2026:
     o Supabase só deixa editar os modelos com SMTP próprio). Nessa hora, o mesmo provedor vira
     o SMTP do painel e do Supabase, e os modelos **Invite user** e **Reset password** recebem o
     assunto e o texto de `supabase/templates/convite.html` e `recuperar-senha.html` (assuntos em
     `supabase/config.toml`). Até lá, **"Esqueci minha senha" não funciona no staging** (o e-mail
     padrão não leva à tela de nova senha): quem esquecer pede ao Suporte. Os convites e o pedido
     de informações não dependem desses modelos (o painel envia pelo próprio SMTP).
4. **Project Settings**, para o arquivo `.env.staging` (fora do git) e para a Vercel:
   - *Data API*: Project URL → `PUBLIC_SUPABASE_URL`;
   - *API Keys*: a chave **anon** (ou *publishable*) → `PUBLIC_SUPABASE_ANON_KEY`; a
     **service_role** (ou *secret*) → `SUPABASE_SERVICE_ROLE_KEY`;
   - *JWT Keys*: o **Legacy JWT Secret** → `SUPABASE_JWT_SECRET`. Nos projetos novos ele já vem
     "migrado para as JWT Signing Keys": o Supabase não assina mais com ele, mas continua
     **verificando** os tokens assinados com ele. A credencial limitada à clínica (páginas
     públicas, bot) é assinada por nós com esse segredo, e as chaves anon e service_role também
     dependem dele: **nunca revogar o legacy secret** (conferido em 06/out/2026: token assinado
     com ele aceito, com outro segredo recusado).

## B. Vercel

1. Em [vercel.com](https://vercel.com), plano **Hobby** (staging não comercial, D8): *Add New ›
   Project*, importar o repositório `tluiz22/recepclinic` (Astro é detectado sozinho).
2. *Environment Variables* (ambiente **Production**):
   | Variável | Valor |
   |---|---|
   | `PUBLIC_SUPABASE_URL` | do passo A.4 |
   | `PUBLIC_SUPABASE_ANON_KEY` | do passo A.4 |
   | `SUPABASE_SERVICE_ROLE_KEY` | do passo A.4 |
   | `SUPABASE_JWT_SECRET` | do passo A.4 |
   | `CRON_SECRET` | gerar com `openssl rand -hex 32` |
   | `SITE_URL` | `https://app.recepclinic.com.br` |

   Sem SMTP por enquanto (provedor de e-mail pendente: convites e pedido de informações avisam
   que o e-mail não saiu) e sem as do WhatsApp (F6).
3. *Deploy*. Cada push na `main` publica de novo.
4. *Settings › Domains*: adicionar `app.recepclinic.com.br`. A Vercel mostra o registro **CNAME**
   a criar.

## C. Cloudflare

1. *DNS › Records › Add record*: tipo **CNAME**, nome **app**, destino o que a Vercel mostrou,
   **Proxy status: DNS only** (nuvem cinza; o certificado é da Vercel).
2. Esperar a Vercel marcar o domínio como válido (minutos).

## D. Login do Suporte e conferência

1. Criar o seu login de Suporte (o link imprimido vale 1 hora):
   ```
   node --env-file=.env.staging scripts/criar-suporte.mjs <seu e-mail> "<seu nome>"
   ```
2. Abrir o link, escolher a senha e entrar em `https://app.recepclinic.com.br/admin/login`.
   E-mail digitado errado no passo 1? `node --env-file=.env.staging scripts/trocar-email.mjs
   <e-mail errado> <e-mail certo>` (a senha continua a mesma).
3. Criar uma clínica de teste em **Nova clínica**, cadastrar um exame com preparo e abrir
   `https://app.recepclinic.com.br/preparo/<id do exame>`: a página com a marca da clínica
   confirma que a credencial limitada à clínica funciona na nuvem.

O arquivo `.env.staging` tem as mesmas variáveis da tabela do passo B.2.
