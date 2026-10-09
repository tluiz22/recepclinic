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
     orientações gerais depois da marcação" em Configurações › WhatsApp; marcar uma consulta para o
     seu número: depois da confirmação chegam as orientações (com conversa nas últimas 24h, o
     texto; sem, o template com o link, que abre a página com o texto formatado). Retorno e exame
     não recebem. Envio que falhou: selo "Orientações não entregues" e "Reenviar orientações" na
     Agenda.

## K. Envios automáticos (F7)

1. **Banco**: migração `20261007170000_envios_automaticos` (opções da clínica e as rotinas no
   agendador). O endereço e o CRON_SECRET já estão no cofre (parte G).
2. **Templates**: Configurações › WhatsApp › *Templates* › **Criar na Meta** cria os 5 novos
   (resumo do dia e oferta de vaga).
3. **Opções** (Configurações › WhatsApp): *Lembrete ao paciente* (enviar ou não e o horário da
   véspera) e *Resumo do dia* (véspera e no dia). Para testar o lembrete, ponha um horário logo à
   frente e tenha um atendimento amanhã para o seu número; para o resumo, cadastre o seu número em
   "Outros contatos" (item "Envio do resumo do dia").
4. **Conferir**: no Resumo do Dia › *Envios*, as execuções do lembrete e do resumo; as mensagens
   chegam quando os templates estiverem aprovados.
