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
**Cadastro v4 (07/nov/2026):** configuração nova `3784178581733719` (v4, conferida e testada no staging). A antiga
(v3) era `2369473416923657`: para voltar atrás, pôr esse ID no `WHATSAPP_ES_CONFIG_ID` da Vercel e fazer o Redeploy. **Trocado na produção (cliente, 07/nov)**; `.env.production` atualizado. O 1º Redeploy foi cancelado pelo Ignored Build Step (mesmo commit = "nada mudou"); vale desde o Redeploy depois da correção do comando (07/nov, abaixo).

**Ignored Build Step (07/nov/2026):** o comando antigo cancelava todo Redeploy (compara o commit anterior com o atual, iguais no Redeploy). Novo, nos dois projetos (limite de 256 caracteres; aqui com `producao`, no staging com `main`):
`[ "$VERCEL_GIT_COMMIT_REF" != producao ] && exit 0; P=$VERCEL_GIT_PREVIOUS_SHA; [ -n "$P" ] && [ "$P" != "$VERCEL_GIT_COMMIT_SHA" ] && git diff --quiet $P HEAD -- . ':!docs' ':!*.md' && exit 0; exit 1`.
Push só de docs segue sem build; Redeploy constrói. Troca de variável na Vercel exige Redeploy (o Astro grava os valores no build).

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
| 28/out | `a2b4465` | `20261028120000_relacionamento_matriz`, `20261028140000_mensagens_suporte`, `20261028150000_mensagens_sem_texto`, `20261029120000_documentos_do_paciente`, `20261029130000_anotacoes_do_paciente`, `20261029140000_lembretes_do_paciente`, `20261030120000_exame_em_paralelo` | CRM (Relacionamento A1/A2, B0, P1 Documentos, P2 Anotações, P3 Lembretes) e as correções C1 (exame em paralelo) e C2 (Outro horário: equipe marca em qualquer horário, com avisos), validados no staging. Simulação → aplicação → conferência (tabelas `patient_documents`, `patient_notes`, `patient_reminders`, bucket privado `patient-documents`, coluna `is_exam` e trava sem exames) antes do push. Sem rotina nova. |
| 28/out | `3ec78dc` | `20261031120000_alterar_atendimento`, `20261101120000_alterar_passado` | C4 Alterar atendimento (C4.1 confirmação completa no Marcar; C4.2 Alterar futuro; C4.3 data passada no Marcar e no Alterar e alterar o que já passou; C4.4 série "esta e as próximas"; C4.5 ajuda), validada no staging. Simulação → aplicação → conferência (evento `changed` na trava e na trilha, função `change_group_session` com acesso só de `authenticated`) antes do push. Sem rotina nova. |
| 28/out | `da2a6fc` | — | C5 (horário de serviço em local que ele não usa marca o local; aviso e desativação ao tirar o local; alerta com o motivo; turma no alerta como no bot) e C6 (escolha do serviço no Marcar pelo tipo, em cartões), validadas no staging. Sem migração (simulação: banco em dia). |
| 29/out | `5ef2be6` | `20261102120000_arquivo_do_preparo`, `20261103120000_modelo_arquivo_do_preparo`, `20261104120000_preparo_arquivo_sem_texto` | C7 Arquivo no preparo do exame (C7.1–C7.7: arquivo no serviço, preparo numa mensagem só sem link, `rc_preparo_exame_v3` e `rc_preparo_arquivo_v3`, cadastro com instruções só leitura com arquivo, bot sem link) e C8 (escolha do serviço em Horários por tipo e cartões), validados no staging. Simulação → aplicação → conferência (colunas `preparation_file_*`, bucket privado `service-files` de 10 MB, 4 políticas `service_files_*`, `exam_preparation_file` aceito em `whatsapp_templates`, sem a regra "arquivo exige texto") antes do push. Sem rotina nova. Nas clínicas com exames, o Suporte usa "Criar na Meta" para criar os modelos novos (análise da Meta). |
| 30/out | `a7e077a` | — | C9 (clínica em implantação não grava conversas nem mostra Atendimento) e C10 (conversa com a clínica não volta sozinha ao bot; Atendimento com aviso novo, "Devolver ao bot" em destaque e "Como funciona?"). Sem migração. Depois da publicação, limpeza autorizada pelo cliente no piloto em implantação (Consultório da Dra. Ana Karina): apagadas 58 mensagens, 8 conversas com a clínica e 8 registros do funil do bot; contatos (8), pacientes (8) e agendamentos (7) conferidos antes e depois, intactos. |
| 30/out | `b9dc41a` | — | C11 (Início, Agenda, Resumo do Dia e Atendimento se atualizam a cada 1 minuto), C12 (saída das perguntas de data e de Sim/Não que o bot não entende) e C13/C13b (pedido de recepção digitado, com confirmação Sim/Não; origem, etapa e motivos nas Métricas), validados no staging. Sem migração; saúde `ok` depois da publicação. |
| 30/out | `71cbbec` | `20261105120000_sem_dmed` | DMED removida (tabela `clinic_dmed_settings` vazia na produção, conferida antes), cartão do Asaas (escondido sem `ASAAS_PREVIEW`, que a produção não tem), Vendas › Implantação e Tecnologia › Jornada do bot. Migração: simulação, aplicação e conferência no banco (tabela e função fora, versão registrada). |
| 31/out | `fd4668c` | `20261105130000_retomar_contato_retirados` | Menu lateral (L1–L3: menu à esquerda em grupos Hoje, Pacientes, Gestão e Sistema, sem barra no topo; seções de Configurações na lateral; "Mais" em grupos no celular e no tablet; colunas da Agenda de no mínimo 230px), C14 ("Alterar" no "Mais" do cartão) e C15 (Retomar contato sem alertas no menu, nas Métricas e na aba; "Retirar da lista"). **Publicado a pedido do cliente antes da validação dele no staging.** Simulação → aplicação → conferência (tabela `recall_dismissals` vazia, RLS, 3 políticas, 2 gatilhos, versão registrada) antes do push. Sem rotina nova; saúde `ok` depois da publicação. Inclui a correção do CI (tipos do banco e seed). |
| 31/out | `20c2239` | `20261105140000_limites_do_bot_padrao_5` | C16: "Como funciona?" de Contatos para revisar no Início e limites do bot com padrão 5 nos três. Simulação → aplicação → conferência (defaults 5; a clínica piloto, que estava com 3, 3 e 2, passou para 5, 5 e 5) antes do push. Sem rotina nova; saúde `ok` depois da publicação. |
| 31/out | `20bfe8b` | `20261108120000_convenio_no_link`, `20261108130000_assunto_da_transferencia` | Revisão da jornada do bot (E1 serviço único e lista sem preço, retorno sem valor; E2 particular ou convênio com o valor depois das escolhas e o plano no link e no atendimento; E3 paciente antes do responsável e aviso da idade limite com o profissional; E4 assunto da transferência na tela Atendimento, exceção da D12), confirmação na página do link ao marcar e remarcar e ajustes de texto da entrada (sem "Como podemos ajudar?", data "do paciente", data sem atendimento só com Tentar outra data e Voltar ao menu). Publicado a pedido do cliente. Simulação → aplicação → conferência (colunas `booking_links.insurance_plan_id`, `conversation_state.handoff_subject` e `handoff_subject_asked_at`) antes do push. Sem rotina nova. |
| 01/nov | `45c2b9c` | `20261109120000_base_de_conhecimento`, `20261110120000_base_de_conhecimento_encaixe`, `20261111120000_numero_do_suporte`, `20261112120000_recesso_da_clinica` | Base de Conhecimento (bot e tela do Suporte), número do suporte, Central de Ajuda com capturas, recesso da clínica e horário da recepção no bot, botões Sim/Não, encaixe com tipo e serviço, aviso de alterações não publicadas. Simulação → aplicação → conferência. **Base migrada do staging** (script único, por código da entrada): 32 entradas ativas, sinônimos, especialidades e termos iguais; publicações 1 e 2 espelhadas (a v2 com a data da migração). Sem rotina nova. A clínica da produção só tem o item `waitlist` na matriz: `knowledge_base` fica a ligar pelo Suporte. |
| 02/nov | `d6bc2d6` | `20261113120000_agendamento_digital_sem_bot` | Data de nascimento sem barras pede confirmação ("Você quis dizer…?" com Sim/Não), local com link do Maps depois da presença confirmada, e Métricas › Agendamento digital como item próprio da matriz (fora do pacote Métricas e da tabela de preços, sem depender do bot). Simulação → aplicação → conferência (banco em dia) antes do push; saúde `ok` depois. Sem rotina nova. Quem tinha a aba continua com ela. |
| 02/nov | `d47f445` | — | Recaptura da tela Agenda › Bloquear na Central de Ajuda (docs e imagem). Sem migração (simulação: banco em dia); saúde `ok` depois da publicação. |
| 02/nov | `76d2688` | `20261114120000_migrar_agenda` | Redesign da Recepção (Meu dia, Agenda opção B, Pacientes/Para contatar, Relatório do dia opção C, menu novo), Central de Ajuda e ajuda contextual atualizadas (25 capturas), botão da agenda da equipe e **Migrar de agenda** (horários e atendimentos futuros; Horários exige escolher a agenda). Simulação → aplicação → conferência (função `migrate_agenda` responde "Sem acesso" a agendas inexistentes) antes do push; saúde `ok` depois. |
| 02/nov | `849e66f` | `20261115120000_migrar_agenda_por_servico` | Migrar de agenda por serviço: a tela lista os serviços e só migram os marcados (já vêm marcados os que a agenda nova atende; Consulta e Retorno ficam na Dra.). Corrige o bloqueio "A nova agenda ainda não atende…" visto no piloto. Simulação → aplicação nos dois bancos → conferência (função aceita `p_services`) antes do push; saúde `ok`. |
| 02/nov | `b7ec892` | — | Agenda › Dia: o passo das linhas "Livre" é a duração do serviço de cada janela (a de todos os serviços, o menor da agenda; sobrepostas, o menor) e a agenda de exames passa a ter as linhas (só os bloqueios a ocupam). Sem migração. |
| 02/nov | `93ab8cd` | — | Agenda › Dia: a sessão de turma sem ninguém marcado vira linha "Livre · serviço, N vagas" (o Marcar abre com a agenda, o dia e o serviço). Sem migração; saúde `ok` depois da publicação. |
| 02/nov | `c9418ac` | `20261116120000_evolucao_do_assistente` | Evolução do assistente (`evolucao-assistente.md`): boas-vindas convidando a escrever, motivo antes da recepção (situações A/B/C, motivo como assunto), "Isso resolve sua dúvida?" e "Agendar Atendimento", dúvidas no funil (`info`), bloco "Resolução sem a recepção" nas Métricas, BC ligada por padrão com o bot. Simulação → aplicação → conferência (restrição do funil com `info`; 1 clínica com bot, com a BC) antes do push; saúde `ok` depois. |
| 02/nov | `6b0df0b` | — | Menu do bot: "Informações" vira "Informações gerais" (fluxograma, Central de Ajuda e telas acompanham); Vendas › Demonstração com as 4 demos, senhas (lidas do login, só o Suporte) e onde está cada cenário; script das demos (só staging). Validado no staging. Sem migração (simulação: banco em dia); saúde `ok` depois da publicação. |
| 03/nov | `1ceb6a4` | — | Ficha do paciente sem a aba "Todos" (não cabia); ajuda do "Faltou X de Y" no painel da Agenda abre abaixo do selo (antes saía cortada); testes do bot com "Informações gerais". Validado no staging. Sem migração; saúde `ok` depois da publicação. |
| 03/nov | `ebad937` (+ este registro) | `20261201120000_lembrete_nao_concluido`, `20261202120000_link_nao_concluido`, `20261203120000_mensagem_de_teste`, `20261204120000_checklist_implantacao`, `20261205120000_problemas_conhecidos`, `20261206120000_busca_por_nome_parecido` | **Cliente pediu a `main` inteira, sem validar antes no staging.** Pedido não concluído (PN1, PN2), implantação segura do WhatsApp (IS1 a IS5) e a 2ª leva de ajustes (C17 Marcar com um só serviço, C18 busca por nome parecido, C19 cadastro com nomes parecidos e conferência, C20 volta ao bot 12 h depois da resposta da clínica). Simulação com as 6, aplicação e conferência (tabelas `clinic_onboarding_checks` e `known_issues`; funções `search_*_ids` e `similar_*_ids` respondem). |
| 04/nov | `90042a3` (+ `f3d3a44`) | — | **C21 (cliente pediu, sem validar antes no staging):** dúvida respondida pela base fora de um fluxo mostra o menu (ou o submenu) de novo, sem "Isso resolve sua dúvida?"; menu "Escolha uma opção abaixo ou faça uma pergunta." com a base ligada; Métricas: dúvida resolvida sem pedido de recepção em 30 min. Sem migração; saúde `ok` depois da publicação. |
| 04/nov | `bf97b07` (+ este registro) | `20261208120000_base_de_conhecimento_dias`, `20261209120000_base_de_conhecimento_dias_da_semana` | **3ª leva (C22 a C30), a pedido do cliente** com a validação no staging em andamento: rodapé do celular preso ao fundo (C22), busca do Meu dia em destaque e Esperando o paciente com Reenviar lembrete (C23), Cancelar destacado na Agenda (C24), linha do dia que fecha a soma (C25), conversa do atendimento humano na ficha (C26), cortesia não volta para Aguardando (C27), dias de atendimento na F1 (C28, C29) e cabeçalho do Meu dia alinhado no computador (C30). Simulação → aplicação → conferência (F1 com os dias úteis como palavra-chave e 29 sinônimos, M1 com 15 e P2 com 5, iguais ao staging) antes do push; saúde `ok` depois. Sem rotina nova. **Falta publicar a base na produção** (Sistema › Base de conhecimento › Publicar) para o bot usar C28/C29. |
| 04/nov | `d2744f9` (+ este registro) | — | **C31, a pedido do cliente** (validação no staging em andamento, `staging.md` parte U): apresentação do 1º menu do bot ("Estamos aqui para ajudar você! 😊…", só com o que a clínica usa), descrições nas 4 opções do menu principal e botão "Ver opções" em todas as listas. Sem migração; saúde `ok` depois da publicação. |
| 05/nov | `1bfd20f` (+ este registro) | `20261211120000_ciclo_do_atendimento_humano` | **CA, a pedido do cliente** (validação no staging em andamento, `staging.md` parte V): situação da conversa guardada (Aguardando a clínica, Em atendimento) e eventos em `handoff_events`; Finalizar atendimento (era Devolver ao bot) sem mensagem nem menu; 12 h em silêncio, só Em atendimento; tela Atendimento em abas. Simulação → aplicação → conferência (4 colunas, tabela, gatilho e 2 políticas; 2 conversas abertas carregadas em Aguardando a clínica) antes do push; saúde `ok` depois. Sem rotina nova. |
| 05/nov | `ed2931d` (+ este registro) | `20261213120000_falhas_de_envio_descartadas` | **FE, a pedido do cliente** (validação no staging em andamento, `staging.md` parte W): conferência do número ao marcar e cadastrar, aviso de entrega na Agenda, "Corrigir número" no Início (o caso de 05/nov já aparece), reenvio do bot em 30 s e 2 min, detalhes e "Descartar" na aba Envios. Simulação → aplicação → conferência (tabela e função; recusa sem papel) antes do push. Sem rotina nova. Falta o Suporte descartar a remarcação de 03/nov (pagamento da Meta). |
| 06/nov | `552019b` (+ este registro) | `20261214120000_precos_da_meta` a `20261224120000_central_historico` (11 da Central) e `20261225120000_agenda_nome_do_profissional` | **Central de Atendimento e ajustes de 06/nov, a pedido do cliente:** Central (CU2 a CN9, atrás do item `central_attendance`, liberado em nenhuma clínica), tela Conversas como o WhatsApp, foto em JPEG de 8 bits, CSP com o Storage, finalizar com a hora pelo milissegundo, barra de carregamento no download, aviso da mensagem automática em 6 h, bot com confirmação do pedido de recepção digitado e "atendimento", agenda com o nome do profissional e "Exames" automática. Simulação → aplicação → conferência (12 versões, tabelas `whatsapp_media`, `whatsapp_history_events`, `central_switches`, rotinas `midias` e `guarda-conversas`, bucket `whatsapp-media`, nenhuma agenda com nome diferente do profissional) antes do push. Rotina nova `guarda-conversas` chamada uma vez à mão; saúde `ok`. **Falta (cliente), antes de liberar a Central numa clínica:** configuração v4 na Meta e `WHATSAPP_ES_CONFIG_ID` da produção, campos do webhook, modelo "Retomar conversa" e cópia do bucket `whatsapp-media`/PITR (plano da Central, 7.2). |
| 07/nov | `7e8613c` | — | Correção do áudio na Conversas (cliente, validado no staging): CSP com `media-src` do Storage (o áudio não tocava) e anexo baixado na hora pelo webhook (`waitUntil`; a rotina `midias` segue como reserva). Sem migração; saúde `ok` depois da publicação. |
| 07/nov | `d4aff65` (+ este registro) | `20261226120000_conversas_nao_atendimento`, `20261226130000_nao_atendimento_metricas`, `20261226140000_nao_atendimento_conversas` | **NA e Ajuda desta tela, a pedido do cliente** (validação no staging em andamento): conversa marcada como Pessoal ou Administrativo/outros sai do bot, das métricas e dos pendentes; aba "Pessoal e admin." na Conversas e "Pessoal e administrativo" no Atendimento; ajuda contextual no menu lateral; 28 capturas da Central de Ajuda refeitas. Simulação → aplicação → conferência (3 colunas em `conversation_state`, 2 em `handoff_events`, função `set_conversation_classification`, gatilho da guarda, `central_conversations` com `p_classified`, nenhuma conversa marcada) antes do push; saúde `ok` e rota nova (401) depois. Sem rotina nova. |
| 07/nov | `47e086d` | 22 migrações (`--include-all`): `20261106120000_conta_de_cobranca` a `20261228130000_mensagens_que_a_central_nao_mostra` | **Faturamento do SaaS + EC, a pedido do cliente** (validados no staging em 07/nov): financeiro (conta de cobrança, contrato, aceite, suspensão, Asaas, avisos, cancelamento, troca de cartão e cartão ↔ Pix, endereço e celular do pagador) e a EC (Central mostra o que veio pelo app: foto, áudio, documento, localização com "Ver no mapa", contato e reação; o resto, "Veja no app do WhatsApp"). Simulação → aplicação → conferência (7 tabelas `billing_*`, 3 rotinas no `pg_cron`, funções novas, coluna `content_type`; 0 contas e 0 contratos; nenhuma clínica suspensa) antes do push. Rotinas `faturamento-eventos`, `conciliacao-asaas` e `avisos-cobranca` chamadas uma vez; saúde `ok`; webhook do Asaas responde 403 (sem token). **Sem as variáveis do Asaas de produção** (decisão do cliente: publicar agora, Asaas depois): nada é cobrado até a chave, o token, o webhook e a tokenização. |
| 08/nov | `64ec6b1` (+ este registro) | 9 migrações: `20261229120000_especialidades_do_profissional` a `20270101150000_exame_so_na_agenda_de_exames` | **Bloco multiprofissional (ME, MC, MI, MB, MS) e a validação de 08/nov, validados pelo cliente no staging:** especialidades, convênios e informações do bot por profissional, escolha da especialidade e do profissional no bot, serviço por profissional; escolha do profissional em Serviços e Horários, filtros de Agendas e Profissionais; horários saem com o serviço; fotos no cadastro; boas-vindas com o nome; perfil, prazo e idade limite por profissional; exame só na agenda de Exames. Lista dos exames antes (a clínica da Dra. Ana Karina já tinha os 3 na Equipe: nada movido). Simulação → aplicação → conferência (especialidade ligada, nenhum serviço sem dono, agendas com perfil Pediátrica, 60 dias e idade 16 na da Dra., bucket `profile-photos` privado) antes do push. Sem rotina nova. |
| 11/nov | `3594cd0` | 17 migrações: `20270102120000_portal_fundacao` a `20270112120000_turmas_na_faixa` | Portal (F2, F3a–F3e), F5a (agenda em colunas), convênios do exame, turmas na faixa e ajustes da validação. Antes: leitura só leitura sem exames repetidos (a `juntar_exames_repetidos` não juntou nada) e simulação (CLI 3.1.0, `--yes` exigido para aplicar). Conferência: versão `20270112120000`, 10 tabelas novas com RLS, rotinas `limpar-fila-avisos` e `limpar-portal` ativas, 0 exames repetidos; saúde `ok`; arquivos do `app.` iguais aos do staging. Falta: portal na clínica piloto (cliente). |
| 11/nov | `be69117` | — | Foto como primeiro item em Configurações › Profissionais e Equipe (cliente, validada no staging). Sem migração. |
| 11/nov | `2819369` e `2fffd62` | — | **Correção na produção (cliente, sessão paralela, branch `hotfix-producao` feita da `producao`, sem a VR):** portal de exames. Causa: o "Ver valores e convênios aceitos" (criado em 11/nov) só existia na tela de dia e horário, e o quadro "Preparo do exame" aparecia nos dias e horários e na revisão, além de "Exame marcado". Agora: o item fica no fim da lista "Qual exame você vai fazer?", com o valor e os convênios de todos os exames, e o preparo fica só em "Exame marcado". Sem migração; saúde `ok`; lista de exames e dias e horários conferidos em `agendar.` (clínica piloto). Levado à `main` pelo merge da `main` na branch. |
| 12/nov | `1ebfc87d` | 9 migrações: `20270113120000_varios_responsaveis` a `20270120140000_metricas_portal` | **Vários responsáveis (VR1–VR5), bot enxuto (F3f), F5b e F6 (Métricas › Portal, origem das marcações, Sistema › Portal), validados pelo cliente no staging.** Antes: suítes `check`, `test` (1238) e `test:db` (1154) e `build` verdes; simulação, aplicação e conferência (simulação seguinte: banco em dia). Sem rotina nova. Hotfix `2fffd62` já estava na `main`. Vercel `recepclinic-producao` com deploy concluído; `/api/saude` `ok` (todas as rotinas). |
| 12/nov | `cd60a03b` | — | **Eco do app não é mais classificado como mensagem automática pelo tempo** (cliente, 12/nov): a mensagem digitada pela recepção 1,5 s depois do paciente ("ESQUECI ONTEM", clínica piloto, 14:23) virava "mensagem automática do app" e não pausava o bot. Agora todo eco do app conta como resposta da recepção. Os 10 registros antigos `app_auto_reply` seguem como estão (a decidir). Sem migração; `check`, `test` e `test:db` verdes; deploy da Vercel concluído e `/api/saude` `ok`. |
| 13/nov | `8ee5a3d5` | `20270124120000_base_de_conhecimento_link_so_com_pedido` | **Correção do bot na produção (E1–E5), validada pelo cliente localmente; branch `bot-correcao-menu` feita da `producao`, sem a nota fiscal e a limpeza do `/agendar` da `main`:** boas-vindas novas (E1); depois do link ou do "Resolvido" a conversa fica no menu (E2); link do portal só com o pedido dito, base sem palavras que não são pedido e V1 com "quanto tá a consulta" (E3); Agendamento digital conta a marcação pelo portal até 24 h depois do link vencido (E4); retorno e exame no fluxo certo e o Agendar pelo que a pessoa marcou (E5). Ordem: simulação (pela pasta da `producao`; a da `main` traz as migrações da nota fiscal) → aplicação → conferência (versão `20270124120000`; M1 sem "consulta", V1 com "quanto tá a consulta", simulação seguinte em dia) → o Suporte publicou a base (19:15 UTC, conteúdo com o V1 novo) → push da `producao`. Sem rotina nova. **Atenção:** a nota fiscal (`20270121*`) é anterior a esta migração; ao publicá-la, a simulação vai pedir `--include-all`. |

**Rotina nova numa publicação:** a `/api/saude` dá a rotina como "sem execução registrada" (503, o Better Stack
alerta) até a primeira execução. Logo depois de a Vercel publicar, chamar uma vez:
`curl -s -H "Authorization: Bearer <CRON_SECRET da produção>" https://app.recepclinic.com.br/api/cron/<rotina>` (GET; o
POST de fora é recusado pela proteção do Astro).
| 07/nov | — | — | **Asaas de produção configurado (cliente, guiado pelo Claude):** chave da API (conta aprovada; consulta de leitura 200) no `.env.production`; `ASAAS_API_KEY`, `ASAAS_BASE_URL=https://api.asaas.com/v3` e `ASAAS_WEBHOOK_TOKEN` (64 hex, gerado no `.env.production`) na Vercel da produção + Redeploy; webhook `https://app.recepclinic.com.br/api/asaas/webhook` no painel (ativo, v3, não sequencial, com token, 31 eventos de cobrança). Conferido: token errado 401, certo 200; saúde `ok`. **Falta:** tokenização do cartão (pedida pelo cliente ao Asaas). |
| 07/nov | `305efd7` | `20261228140000_uso_do_mes_sem_enviando` | Ajustes da análise BaaS do Asaas: selo na Nota fiscal em todo ambiente (sem `ASAAS_PREVIEW`) e contrato com nota `provisorio-2026-11-07c-nf` com a cláusula do Asaas; junto, o `9b22e00` da Central (conta religada avisa o Suporte; uso do mês sem "enviando"), a validar pelo cliente. Migração (só a função `meta_message_counts`) simulada, aplicada e conferida no staging e na produção antes do push; saúde `ok`. |
| 13/nov | `b09b18c` | `20270122120000_portal_visitas`, `20270123120000_usabilidade_sinais`, `20270123130000_usabilidade_sinais_ajustes` | Frente Usabilidade (U1 e U2), a pedido do cliente, **só ela**: funil de 8 passos em Métricas › Portal (visita anônima) e aba Usabilidade só para o Suporte. A `producao` recebeu os 3 commits da frente por cherry-pick sobre `cd60a03b`; a **nota fiscal (6 migrações `20270121*`) e a limpeza do /agendar continuam só na `main`**. Simulação → aplicação → conferência (tabela `portal_visits`, 3 funções, 2 gatilhos, limpeza `limpar-portal` com 6 remoções, 0 visitas) antes do push. **Atenção:** ao publicar a nota fiscal, as migrações `20270121*` ficam anteriores às de agora: `db push --include-all`, e os tipos do banco virão da `main`. |
