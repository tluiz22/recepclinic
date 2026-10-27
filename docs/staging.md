# Staging na nuvem (F5.5)

> Ambiente de testes na nuvem (D8), em `app.recepclinic.com.br` até a F10. Na F10 o endereço passa
> para a produção e o staging vai para `teste.recepclinic.com.br` (cliente, 06/out/2026): roteiro na
> **parte O** (F10.0b); o `app.` continua apontando para o staging até a F10.0c (cliente, 25/out).
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
   - *Emails › Templates* e SMTP: ver a **parte L** (Resend, 10/out). Antes dela: **ficava para quando houver o provedor de e-mail** (cliente, 06/out/2026:
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
   Convidado que não recebeu o e-mail (sem provedor de e-mail ainda) ou quem esqueceu a senha:
   `node --env-file=.env.staging scripts/link-de-senha.mjs <e-mail>` (link de 1 hora).
   E-mail digitado errado no passo 1? `node --env-file=.env.staging scripts/trocar-email.mjs
   <e-mail errado> <e-mail certo>` (a senha continua a mesma).
3. Criar uma clínica de teste em **Nova clínica**, cadastrar um exame com preparo e abrir
   `https://app.recepclinic.com.br/preparo/<id do exame>`: a página com a marca da clínica
   confirma que a credencial limitada à clínica funciona na nuvem.

O arquivo `.env.staging` tem as mesmas variáveis da tabela do passo B.2.

## E. WhatsApp (F6.1)

O número de testes do RecepClinic vai **direto na Cloud API**, no app RecepClinic (sem o app
do celular; cliente, 06/out/2026). Nada do app ou do número do piloto.

1. **Número** (business.facebook.com › portfólio RecepClinic › WhatsApp Manager › *Números de
   telefone* › *Adicionar número*): nome de exibição, categoria e o código por SMS ou ligação
   no chip. No painel novo dos apps, o caminho é *Casos de uso › Personalizar › Configuração
   básica › Número de telefone › Gerenciar*. Se a Meta disser que o número **já está registrado
   numa conta do WhatsApp**, apagar essa conta no app do celular (*Configurações › Conta › Apagar
   conta*; número reciclado: ativar o WhatsApp no chip e apagar em seguida), esperar uns minutos
   e tentar de novo. Depois, **Registrar** o número ali mesmo, com um PIN de 6 números (guardar;
   é a verificação em duas etapas). Anotar o **Phone number ID** e o **WhatsApp Business Account
   ID** (WABA), em *WhatsApp › Configuração da API*.
2. **Token permanente** (*Configurações do negócio › Usuários › Usuários do sistema*): criar um
   usuário do sistema **Administrador**, dar a ele o app RecepClinic e a conta do WhatsApp
   (controle total) e gerar o token do app RecepClinic, **sem expiração**, com
   `whatsapp_business_messaging` e `whatsapp_business_management`.
3. **Vercel** (*Settings › Environment Variables*, Production) e `.env.staging`:
   `WHATSAPP_APP_SECRET` (app RecepClinic › *Configurações do app › Básico › Chave secreta do
   app*) e `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (um valor aleatório, ex.: `openssl rand -hex 24`).
   Depois, *Deployments › Redeploy* para valerem.
4. **Webhook** (app RecepClinic › *WhatsApp › Configuração*): URL de retorno
   `https://app.recepclinic.com.br/api/whatsapp/webhook`, o mesmo token de verificação; *Verificar
   e salvar*; em *Campos do webhook*, assinar **messages** (e, a partir da F6.2,
   **message_template_status_update**; parte F).
5. **App em modo Ao vivo** (*Configurações do app › Básico*: URL da política de privacidade
   `https://www.recepclinic.com.br/privacidade`, dos termos `https://www.recepclinic.com.br/termos`,
   ícone e categoria; depois a chave **Ao vivo** no topo). Em desenvolvimento, a Meta não manda
   ao webhook os eventos de números reais.
6. **Painel** (logado como Suporte, na clínica de teste › *Configurações › WhatsApp*): no cartão
   *Cadastro da conexão*, o Phone number ID, o WABA ID, o número exibido, a situação
   **Conectado** e o token; *Salvar conexão*. Se o número não foi registrado no passo 1,
   *Registrar o número* com um PIN de 6 números. Depois *Testar conexão* (a Meta responde e o app
   é inscrito na conta).
7. **Forma de pagamento** na conta do WhatsApp do RecepClinic (WhatsApp Manager › Faturamento;
   cartão, BRL, fuso de Brasília): necessária para qualquer template (inclusive o `hello_world`
   de exemplo da Meta); mensagens iniciadas pelo paciente não precisam.
8. **Conferir**: mandar uma mensagem de outro celular para o número de testes; ela aparece em
   *Últimas mensagens* (o bot só responde a partir da F6.3). Número recém-registrado pode levar
   de minutos a horas até o app do celular encontrá-lo ("convidar para o WhatsApp"); nesse caso,
   o número de testes manda o `hello_world` e a resposta do celular fecha o teste (o WhatsApp
   Web reconheceu o número antes do app do celular). **Nunca verificar o número de testes em
   app nenhum** (WhatsApp ou Business): isso o tiraria da Cloud API.

## F. Envio e templates (F6.2)

1. **Banco**: `npx supabase db push` (migração `20261007120000_envio_whatsapp`: "da/do" da clínica,
   motivo da recusa do template e a conta do webhook dos templates).
2. **Webhook** (app RecepClinic › *WhatsApp › Configuração › Campos do webhook*): assinar também
   **message_template_status_update**, para a aprovação dos templates chegar sozinha.
3. **Painel** (Suporte, clínica de teste › *Configurações › WhatsApp*, cartão *Templates*):
   **Criar na Meta**. Os cinco templates (`rc_confirmacao_v1`, `rc_remarcacao_v1`,
   `rc_cancelamento_v1`, `rc_lembrete_v1`, `rc_preparo_exame_v2`) vão para a análise da Meta na
   conta do RecepClinic (categoria Utilidade); a aprovação leva de minutos a algumas horas. A
   situação aparece no cartão (pelo webhook ou por **Atualizar situação**); recusado mostra o
   motivo. O token do passo E.2 já tem `whatsapp_business_management`, que a criação exige.
4. **Configurações › Clínica**: escolher "da" ou "do" ("Aqui é do Consultorio Tluiz22").
5. **Conferir**, com os templates aprovados e o celular do cliente como contato de um paciente
   da clínica de teste:
   - marcar pela Agenda: chega a confirmação; remarcar: a remarcação; cancelar: o cancelamento
     (o aviso de salvo da tela diz se a mensagem saiu);
   - "Enviar lembrete" num atendimento depois da hora do lembrete da véspera: chega o lembrete
     com os três botões (a resposta aos botões é da F6.4);
   - marcar um exame com preparo cadastrado no serviço: depois que a confirmação chega ao
     celular, chega o preparo (texto com as orientações se o celular escreveu para o número nas
     últimas 24h; senão, o template com o link);
   - marcar ou remarcar pelo `/agendar` (link gerado na tela "Avisar" ou pelo bot, a partir da
     F6.3): chega a confirmação ou a remarcação.
   Cada envio aparece em *Últimas mensagens* e na trilha do atendimento.

## G. Bot I: marcar (F6.3)

1. **Banco**: migração `20261007130000_conversa_parada` (agendador `pg_cron` da conversa parada).
2. **Agendador**: `node --env-file=.env.staging scripts/agendador.mjs` grava no cofre o endereço
   do sistema (`SITE_URL`) e o `CRON_SECRET` (o mesmo da Vercel); a partir daí o Supabase chama
   `/api/cron/conversas-paradas` a cada minuto. Rodar de novo se o endereço ou o segredo mudarem.
3. **Matriz de acesso** da clínica de teste com o item **Bot de WhatsApp** (e, para testar tudo,
   Exames e Atendimento domiciliar); serviços com agenda e horários cadastrados.
4. **Conferir** pelo celular, escrevendo para o número de testes:
   - boas-vindas com o nome da clínica e o menu (Consultas, Exames, Informações);
   - Marcar consulta: "com quem?" (com mais de um profissional), local, para quem, cadastro,
     link do `/agendar` que abre com o serviço e o profissional escolhidos;
   - Marcar retorno (depois de uma consulta marcada como realizada) e Marcar exame;
   - Informações (valores, endereço, preparo, outras informações);
   - "0" no meio volta ao menu; parado por 15 minutos, chega o aviso de encerramento.

## H. Bot II: cancelar, remarcar, lembrete e encaixe (F6.4)

1. **Banco**: migração `20261007140000_coexistencia` (marca de coexistência na conexão).
2. **Conferir** pelo celular, com um atendimento futuro marcado para o seu número:
   - Consultas ou Exames › **Cancelar** (Sim/Não) e **Remarcar** (link de remarcação);
   - **Encaixe ou antecipar** (só com o item "Lista de espera" na matriz): com horário livre antes
     do atendimento, mostra até 3 e "Nenhum desses"; escolher um e "Sim" antecipa (a Agenda muda);
     "Não" volta à lista; "Nenhum desses" pergunta se quer entrar na lista de espera. Sem horário
     livre antes (ex.: bloqueio na agenda até o atendimento), entra direto. Já na lista: os horários
     livres aparecem antes; antecipar tira da lista; "Nenhum desses" pergunta se continua ou sai;
   - com os templates aprovados, os botões do lembrete ("Enviar lembrete" na Agenda): Confirmar
     presença, Remarcar, Cancelar.
3. **Falar com a recepção** só aparece com a conexão marcada como **Coexistência** (Suporte, em
   Configurações › WhatsApp). O número de testes está só na API: deixar desmarcado.

## I. Cancelamento pela clínica automático (F6.5)

1. **Banco**: migração `20261007150000_cancelamento_pela_clinica` (chave do template novo).
2. **Template**: Configurações › WhatsApp › *Templates* › **Criar na Meta** cria o
   `rc_cancelamento_clinica_v1` (os outros já existentes ficam como estão).
3. **Conferir**: com um atendimento futuro para o seu número, "Bloquear e cancelar" na Agenda
   ("Cancelar selecionados" saiu em 08/out): com o template aprovado, chega a mensagem com o link e a tela volta para
   a Agenda; sem ele, a tela "Avisar" mostra o paciente com o motivo e o botão do WhatsApp.

## J. Aba Mensagens (F6.6)

1. **Banco**: migração `20261007160000_mensagens` (item "Mensagens personalizadas", versões dos
   templates e textos do bot).
2. **Prévia**: Configurações › **Mensagens** mostra cada aviso e as mensagens do bot no balão.
3. **Personalizar** (libere "Mensagens personalizadas" na matriz da clínica de teste; entrar como
   Administrador da clínica): mudar as boas-vindas e mandar "oi" para o número de testes; propor um
   texto para a Confirmação. Como Suporte, na mesma aba, **Aprovar e enviar à Meta** (ou Recusar
   com o motivo); aprovada pela Meta, a Confirmação passa a sair com o texto novo.
4. **Ajustes de 08/out** (migração `20261008120000_orientacoes_gerais`):
   - **Combo**: a aba abre em "Mensagens do bot"; "Mensagens aprovadas pela Meta" só aparece com o
     item "Mensagens da Meta (templates)". Na matriz, desmarcar um dos dois itens esconde só o grupo
     dele (as orientações gerais continuam).
   - **Template**: Configurações › WhatsApp › *Templates* › **Criar na Meta** cria o
     `rc_orientacoes_consulta_v1`.
   - **Orientações gerais**: escrever o texto em Mensagens (como Administrador); ligar "Enviar as
     orientações gerais depois da marcação" logo abaixo do título, na própria aba; marcar uma consulta para o
     seu número: depois da confirmação chegam as orientações (com conversa nas últimas 24h, o
     texto; sem, o template com o link, que abre a página com o texto formatado). Retorno e exame
     não recebem. Envio que falhou: selo "Orientações não entregues" e "Reenviar orientações" na
     Agenda.

## K. Envios automáticos (F7)

1. **Banco**: migrações `20261007170000_envios_automaticos` (rotinas no agendador) e
   `20261009120000_lembretes` (opções da aba Lembretes). O endereço e o CRON_SECRET já estão no
   cofre (parte G).
2. **Templates**: Configurações › WhatsApp › *Templates* › **Criar na Meta** cria os do resumo do
   dia e o da oferta de vaga.
3. **Opções** (Configurações › **Lembretes**): cada lembrete com enviar ou não, **na véspera** ou
   **no dia do atendimento** e o horário (horas cheias das 6h às 20h).
   - *Lembrete ao paciente*: para testar, marque um atendimento hoje para o seu número e escolha
     "No dia" com a próxima hora cheia (a rotina roda no início de cada hora; no dia, recebem os
     atendimentos que começam depois do horário).
   - *Lembrete ao profissional (resumo do dia)*: marque quem recebe (WhatsApp do profissional
     obrigatório).
   - *Lembrete à equipe (resumo do dia)*: cadastre o seu número nos contatos da equipe. Os
     resumos rodam a cada 5 minutos, dentro da hora escolhida.
4. **Conferir**: no Resumo do Dia › *Envios*, as execuções do lembrete e dos resumos; as mensagens
   chegam quando os templates estiverem aprovados (antes disso, "não enviado" com o motivo).

**Validada em 09/out** com os templates aprovados; resumo e oferta de vaga a conferir quando a
Meta aprovar os templates deles.

## L. E-mail de verdade (Resend)

Decisões no [plano](plano.md) ("E-mail de verdade"): Resend, remetente
`RecepClinic <nao-responda@recepclinic.com.br>`, o mesmo SMTP no painel e no Supabase.

1. **Resend** (cliente, 10/out): conta criada; *Domains* › `recepclinic.com.br` verificado (registros
   na Cloudflare: DKIM `resend._domainkey` e o subdomínio `send`, com a nuvem cinza; os registros do
   site e o MX da raiz, que é o roteamento de e-mail da Cloudflare, não mudam); *API Keys* ›
   `staging-smtp`, só envio, só o domínio. A chave fica só no `.env.staging` e na Vercel.
2. **`.env.staging`** (já gravado): `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`,
   `SMTP_USER=resend`, `SMTP_PASSWORD=<chave>`, `EMAIL_FROM=RecepClinic <nao-responda@recepclinic.com.br>`.
3. **Vercel** (*Settings › Environment Variables*, Production): as mesmas 5 variáveis; depois,
   *Deployments › Redeploy*. Para copiar a chave sem exibir:
   `grep '^SMTP_PASSWORD=' .env.staging | cut -d= -f2- | pbcopy`.
4. **Supabase** (*Authentication › Emails*):
   - *SMTP Settings*: **Enable custom SMTP**; Sender email `nao-responda@recepclinic.com.br`;
     Sender name `RecepClinic`; Host `smtp.resend.com`; Port `465`; Username `resend`; Password: a
     chave; *Save*.
   - *Templates* › **Invite user**: assunto `Convite para o painel RecepClinic`, corpo de
     `supabase/templates/convite.html`; **Reset password**: assunto
     `Redefinir a senha do painel RecepClinic`, corpo de `supabase/templates/recuperar-senha.html`.
     Para copiar o corpo: `pbcopy < supabase/templates/convite.html` (e o outro).
5. **Conferir**: "Esqueci minha senha" em `https://app.recepclinic.com.br/admin/esqueci-senha`
   com um login de verdade (o e-mail leva à tela de nova senha); um convite ou pedido de
   informações pelo Suporte chega sem o aviso de "e-mail não saiu". A partir daqui,
   `scripts/link-de-senha.mjs` fica só de reserva.

## M. Nota fiscal: variáveis do Módulo financeiro (F11.5 e F11.4b)

Na **Vercel** (*Settings › Environment Variables*, Production), depois *Deployments › Redeploy*:

| Variável | Valor | Para quê |
|---|---|---|
| `WHATSAPP_APP_ID` | `1751119452632725` (App ID do app RecepClinic, no topo de developers.facebook.com › Meus apps › RecepClinic; também no `.env.staging`) | "Criar na Meta" do template da nota (`rc_nota_fiscal_v1`), que sobe um PDF de exemplo |
| `NFSE_SIMULATION` | `1` | libera o ambiente **Simulação** da nota fiscal (a nota sai do próprio RecepClinic, sem a Receita). **Só no staging**: nunca na produção |

Com `NFSE_SIMULATION=1`, o Suporte vê "Passar para Simulação" em Configurações › Nota fiscal da
clínica (enquanto ela estiver em Produção Restrita); para sair, "Voltar para Produção Restrita".

## N. Embedded Signup na Meta (F8.0)

Conferido na documentação da Meta em 25/out/2026; passos 1 a 4 feitos pelo cliente em 25/out. Tudo no app **RecepClinic** em
developers.facebook.com (os nomes das telas podem aparecer em inglês).

1. **Configuração do login** (*Login do Facebook para Empresas › Configurações › Criar
   configuração*): nome `RecepClinic Conectar WhatsApp` (a Meta aceita até 30 caracteres); variação de login **Cadastro
   incorporado do WhatsApp** (*WhatsApp Embedded Signup*); produto só **WhatsApp Cloud API** (a lista de 25/out não traz a coexistência: ela é ligada pelo sistema na abertura da janela, com o `featureType`; se, ao marcar a Cloud API, surgir uma opção do app WhatsApp Business, marcar também; os produtos não mudam depois); token de **usuário do sistema** com validade **Nunca**, se a tela oferecer (com 60
   dias a clínica teria de reconectar); ativos: só **Contas do WhatsApp**, com a permissão de tarefa **MANAGE** (marca as
   outras junto); permissões: **whatsapp_business_management** e **whatsapp_business_messaging**, sem
   `business_management` (acesso ao portfólio inteiro, sem uso na conexão). Ao salvar, copiar o **ID da configuração**.
2. **Domínios** (*Login do Facebook para Empresas › Configurações › Configurações do OAuth do
   cliente*): **Sim** em Login no OAuth do cliente, Login do OAuth na Web, Forçar HTTPS, Login do
   OAuth no navegador incorporado, Modo estrito para URIs de redirecionamento e Login com o SDK do
   JavaScript; em **Domínios permitidos para o SDK do JavaScript** e em **URIs de redirecionamento do
   OAuth válidos**, `https://app.recepclinic.com.br/`. Só HTTPS: a janela da Meta não abre no
   `localhost`, então o teste da conexão é no staging.
3. **Campos do webhook** (*WhatsApp › Configuração › Campos do webhook*): além de **messages** e
   **message_template_status_update**, assinar **account_update** (fim da conexão e desconexão),
   **smb_message_echoes** (mensagens da recepção no app, para pausar o bot), **history** e
   **smb_app_state_sync** (a Meta exige as duas sincronizações da coexistência; o RecepClinic não
   grava o conteúdo).
4. **Vercel** (*Settings › Environment Variables*, Production): `WHATSAPP_ES_CONFIG_ID` com o ID do
   passo 1; depois *Deployments › Redeploy*.
5. **Login do analista da Meta** (`analista.meta@recepclinic.com.br`): **bloqueado em 25/out** com o OK do
   cliente (`ban_duration` no Auth do Supabase, até 2126). Nada foi apagado: a clínica de demonstração, os dados e o
   vínculo de Administrador continuam. Para reativar (nova análise da Meta): `auth.admin.updateUserById(<id>, {
   ban_duration: "none" })` com a service role do `.env.staging`.

Para o teste real (F8.4): o número do app antigo precisa estar no **app WhatsApp Business**
(versão 2.24.17 ou mais nova), ativo, e com o app aberto no celular durante a conexão (a Meta
mostra um código para colar). Guias de terceiros falam em **7 dias seguidos** de uso no app
Business antes da coexistência: vale deixar o número no app Business desde já.

## O. Staging para `teste.recepclinic.com.br` (F10.0b)

Decisões no [plano](plano.md) (F10, 25/out). O endereço oficial do staging passa a ser
`https://teste.recepclinic.com.br`. **O `app.recepclinic.com.br` continua apontando para o staging até a F10.0c**
(cliente, 25/out): só então ele passa para a produção, levando junto o webhook principal do app da Meta. Por isso,
nesta parte, nada do `app.` é apagado: o `teste.` é **acrescentado** em cada lugar. O código não muda (F10.0a já
publicada): tudo sai do `SITE_URL` e do desvio.

Fazer na ordem (o desvio do passo 8 pede o `teste.` já no ar).

1. **Vercel** (projeto do staging, *Settings › Domains*): **Add** `teste.recepclinic.com.br`, sem redirecionar para
   outro domínio. **Não remover** o `app.`. A Vercel mostra o registro **CNAME** a criar.
2. **Cloudflare** (*DNS › Records › Add record*): tipo **CNAME**, nome **teste**, destino o que a Vercel mostrou,
   **Proxy status: DNS only** (nuvem cinza). Esperar a Vercel marcar o domínio como válido (minutos). Conferir no
   terminal (deve mostrar `HTTP/2 200`):
   ```
   curl -sI https://teste.recepclinic.com.br/admin/login | head -1
   ```
3. **Vercel** (*Settings › Environment Variables*, Production):
   - `SITE_URL`: trocar para `https://teste.recepclinic.com.br`;
   - **nova** `WHATSAPP_WEBHOOK_OVERRIDE_URL`: `https://teste.recepclinic.com.br/api/whatsapp/webhook` (só no
     staging; **nunca** na produção);

   depois *Deployments › Redeploy*.
4. **`.env.staging`**: o mesmo `SITE_URL` (o agendador e os scripts leem daqui):
   ```
   sed -i '' 's|^SITE_URL=.*|SITE_URL=https://teste.recepclinic.com.br|' .env.staging && grep '^SITE_URL=' .env.staging
   ```
5. **Agendador** (as rotinas passam a chamar o `teste.`):
   ```
   node --env-file=.env.staging scripts/agendador.mjs
   ```
   Deve responder `Agendador ligado: as rotinas chamam https://teste.recepclinic.com.br/api/cron/…`.
6. **Supabase** (projeto `recepclinic-staging`, *Authentication › URL Configuration*): **Site URL**
   `https://teste.recepclinic.com.br`; em **Redirect URLs**, **acrescentar** `https://teste.recepclinic.com.br/**`
   (o `app.` fica até a F10.0c). *Save*.
7. **Meta** (app RecepClinic, *Login do Facebook para Empresas › Configurações › Configurações do OAuth do cliente*):
   em **Domínios permitidos para o SDK do JavaScript** e em **URIs de redirecionamento do OAuth válidos**,
   **acrescentar** `https://teste.recepclinic.com.br/` (o `app.` fica). *Salvar alterações*. O webhook principal do
   app (*WhatsApp › Configuração*) **não muda**.
8. **Desvio da conta de testes**: entrar como Suporte em `https://teste.recepclinic.com.br/admin/login`, abrir a
   clínica **Consultorio de Teste** e, em *Configurações › WhatsApp*, **Testar conexão**. A mensagem verde deve
   terminar com *"App inscrito na conta, com o desvio para https://teste.recepclinic.com.br/api/whatsapp/webhook: as
   mensagens chegam a este ambiente."*
9. **Conferir o desvio**: de um celular pessoal, mandar "oi" para `+55 61 9903-3143`: o bot responde (quem responde
   é o servidor que recebeu a mensagem, então a resposta confirma o desvio para o staging). Sem resposta em 1 minuto,
   avisar o Claude, que confere os registros pelo terminal.
10. **Better Stack: nada muda** (cliente, 25/out). Os 4 monitores ficam em `app.`: até a F10.0c vigiam o staging e,
    quando o `app.` passar para a produção, passam a vigiar a produção sem edição. O staging (`teste.`) fica sem
    monitor externo; problema nele aparece em Administração › Erros.
11. **Conferir o e-mail**: "Esqueci minha senha" em `https://teste.recepclinic.com.br/admin/esqueci-senha`: o link
    do e-mail abre em `teste.`.

Ao terminar, avisar o Claude: ele confere o `teste.`, o webhook, a saúde e as rotinas pelo terminal.

## P. Coexistência no staging (27/out)

Decidido pelo cliente em 27/out: o número de testes `+55 61 9903-3143` sai da Cloud API pura e volta à **Consultorio
de Teste** por **coexistência** (app WhatsApp Business no celular + RecepClinic), antes da clínica de testes na
produção (etapa B). Análise do App e Verificação do acesso aprovadas (RecepClinic é Tech Provider, informado pelo
cliente em 27/out). Documentação da Meta conferida em 27/out: a coexistência exige Tech Provider e app WhatsApp
Business 2.24.17 ou mais novo; não fala em tempo mínimo de uso no app.

**O que muda:** o número passa para uma **conta nova do WhatsApp**, num **portfólio próprio da clínica de teste**,
criado na janela da Meta (o portfólio RecepClinic é dono do app e não pode ser escolhido). Os templates são criados de
novo nessa conta (F8.2) e passam por nova aprovação; a conta precisa de forma de pagamento. A conta antiga
(`1119120121064158`, portfólio RecepClinic) fica sem número.

**Antes de começar:** o celular com o chip do número em mãos; o computador (a janela da Meta não funciona no navegador
do celular); o login do Facebook que administra o app RecepClinic; um cartão para a forma de pagamento; um celular
pessoal para os testes. **Do passo 1 ao 6, o staging fica sem WhatsApp** (bot e lembretes param).

1. **Claude, pelo terminal:** tira o número da Cloud API (`POST /1351377221398698/deregister`), com o token ainda no
   cofre. Tem de ser antes do passo 2, porque desconectar no painel apaga o token.
2. **Painel** (`https://teste.recepclinic.com.br`, como Suporte): Consultorio de Teste › *Configurações › WhatsApp* ›
   **Desconectar WhatsApp** (confirmar). Como a conexão foi cadastrada pelo Suporte, ela só sai do sistema.
3. **Gerenciador do WhatsApp** (`business.facebook.com/wa/manage/phone-numbers/`, portfólio **RecepClinic**):
   no número `+55 61 9903-3143`, **Excluir** (ou *Delete*). Se a Meta recusar, avisar o Claude.
4. **Celular:** instalar o **WhatsApp Business** e entrar com o número, pelo roteiro do aparelho
   ([iPhone](https://claude.ai/artifact/C8E3xDoshuXE3M91qeDDHq) ou
   [Android](https://claude.ai/artifact/78hQ2cXQph4wvXHKPXexnm)); não há conversas para transferir. Código por SMS
   ou ligação. Se o app pedir o **PIN da confirmação em duas etapas**, avisar o Claude (o PIN está no cofre do staging).
   Nome do perfil: **Consultorio de Teste**; categoria Saúde.
5. **Conferir o app:** trocar uma mensagem com o celular pessoal (enviar e receber).
6. **Conectar** (computador, `https://teste.recepclinic.com.br`, como Suporte): Consultorio de Teste ›
   *Configurações › WhatsApp* › **Conectar WhatsApp**. Na janela da Meta: entrar com o Facebook; escolher conectar o
   **app WhatsApp Business existente**; **criar um portfólio novo** (nome sugerido: `Consultorio de Teste`); informar o
   número; no celular, abrir a mensagem do Facebook no WhatsApp Business e tocar em **Conectar** (com o código que a
   janela mostrar); compartilhar o histórico ou não, tanto faz (o RecepClinic não grava). O cartão "Conexão" deve
   mostrar **Conectado, coexistência**. Erro na janela: anotar a mensagem e avisar o Claude.
7. **Claude, pelo terminal:** confere no banco a conexão (`coexistence`, sincronizações), o desvio do webhook para o
   `teste.` na conta nova e os templates criados.
8. **Forma de pagamento:** no Gerenciador do WhatsApp do **portfólio novo**, *Visão geral › Adicionar forma de
   pagamento*. Depois, no painel, o Suporte marca **"Forma de pagamento conferida (Suporte)"**.
9. **Testes** (com os templates aprovados; a situação vem pelo **Atualizar situação**, porque os avisos de templates
   vão à produção):
   - do celular pessoal, "oi" para o número: o bot responde;
   - a recepção responde pelo app WhatsApp Business: o bot pausa naquela conversa (eco);
   - `#bot` pelo app: o bot volta;
   - um lembrete de teste chega com os botões.

Ao terminar cada bloco (1 a 3, 4 a 6, 8 e 9), avisar o Claude.
