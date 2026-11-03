# Implantação segura do WhatsApp (IS): pré-requisitos, mensagem de teste, checklist e problemas conhecidos

> **Retomar daqui (03/nov/2026).** IS1 no staging. **IS2 feita na branch `implantacao-is2`** (migração
> `20261203120000_mensagem_de_teste.sql`), testes de banco pelo CI do PR. Próximo: CI verde → migração no staging →
> `main`; depois, em cada clínica do staging e da produção, "Enviar à Meta as que faltam" (o modelo novo) e o teste.
> Cliente valida no staging. Depois: IS3 (checklist).

Pedido do cliente em 03/nov/2026, depois de dois incidentes na produção (clínica piloto) no mesmo dia: impedir que
se repitam nas próximas clínicas.

## 1. Incidentes de 03/nov/2026 (produção, clínica piloto)

| Hora (Brasília) | O que aconteceu | Causa | Solução |
|---|---|---|---|
| 10:38 | Responsável remarcou pelo link e não recebeu o aviso; perguntou se deu certo | Meta recusou o template `rc_remarcacao_v1`: erro **131042** ("Business eligibility payment issue"), cartão não definido como padrão na conta do WhatsApp da clínica. Era o 1º template da produção; o Suporte tinha marcado "Forma de pagamento conferida" em 29/out (só visual) | Admin da clínica cadastrou cartão; às 14:10 o mesmo template foi entregue e lido |
| 11:38 e 11:41 | Dois pacientes escolheram "Consultas" e o bot não respondeu; conversa ficou em "Aguardando a clínica" | Mensagem automática do app WhatsApp Business (saudação/ausência) saiu 2–3 s depois do 1º contato; o eco pausou o bot (`handleAgentEcho`). A ausência só disparava em dias úteis, no horário comercial; os testes pós-implantação foram à noite | Clínica desligou a automação; conversas devolvidas com `#bot` |
| 13:56 | Teste do cliente sem resposta do bot | O número usado era o do Suporte do RecepClinic (Sistema › Suporte), que de propósito não fala com o bot | Testar de outro número |

Achados laterais: a conta da clínica (WABA `795378370167218`, portfólio próprio `1348238117264754`) está com a
empresa **não verificada** (`health_status` LIMITED, erro 141010: ~250 conversas iniciadas pela clínica a cada 24 h).
Como Tech Provider, o RecepClinic **não lê** os dados de pagamento da conta (`primary_funding_id` recusado, código 10).
O aviso que falhou (131042) não tem reenvio nem alerta para a equipe.

## 2. Escopo

1. **Guias públicos** para o dono da clínica: "Antes de conectar ao RecepClinic" e "Pagamento na Meta".
2. **Mensagem de teste** (template próprio) com o status ao vivo e o motivo da falha em português; exigida para ativar.
3. **Checklist de implantação** do Suporte, por clínica, na tela Situação; "Ativar a clínica" só com os obrigatórios.
4. **Mensagem automática do app** detectada: não pausa o bot e avisa.
5. **Sistema › Problemas conhecidos**: registro do Suporte com sintoma, causa, solução e links.

## 3. Decisões do cliente (03/nov/2026)

1. **Ativação exige a mensagem de teste entregue** (ou lida). A marcação manual "Forma de pagamento conferida (Suporte)"
   sai (`payment_checked_at` deixa de ser usado).
2. **Mensagem automática do app no dia a dia:** eco do app que chega poucos segundos (~5 s) depois da mensagem do
   paciente ou do bot **não pausa** o bot e gera **aviso** (Suporte e Administrador). Mas o objetivo é não chegar a
   isso: conferir que as automações estão desligadas é passo obrigatório da implantação (inclusive as programadas para
   o horário comercial).
3. **Checklist no sistema, por clínica** (Sistema › Clínicas › clínica › Situação): itens que o sistema confere sozinho
   e itens que o Suporte marca (com data e quem marcou).
4. **Itens obrigatórios:** todos, menos três recomendados (verificação da empresa, agenda atual importada e número do
   Suporte explicado à clínica).
5. **O link para o dono da clínica tem só o que é da clínica**; o que é do Suporte fica só na tela. O guia explica por
   que o Facebook, por que o cartão e o custo aproximado por mensagem (para o cliente não desistir), o site (se não
   houver, usa-se o do RecepClinic) e não traz os dados da configuração (feita com o Suporte ou pelo formulário por link).
6. **Guias como páginas públicas do sistema** (`/guia/antes-de-conectar` e `/guia/pagamento-meta`), sem login, com a
   marca do RecepClinic; o guia de pagamento sem os ids da clínica piloto.
7. **Problemas conhecidos em Sistema › Problemas conhecidos**, só do Suporte, registros no banco editados pela tela.

## 4. Conteúdo aprovado (rascunhos)

- Guia "Antes de conectar ao RecepClinic": https://claude.ai/artifact/VUyQ2qjT3ekZRBMsPHMfB4 (checklist da clínica;
  Facebook e WhatsApp Business; desligar mensagens automáticas no iPhone, Android e Meta Business Suite; cartão com o
  custo de ~R$ 0,04 a R$ 0,08 por mensagem, ~R$ 35 a R$ 70/mês para 20 atendimentos/dia; verificação da empresa
  recomendada; o dia da conexão).
- Guia do pagamento na Meta, com a mensagem ao suporte da Meta (PT e EN) e o caminho pelo Suporte ao negócio (a Meta
  não atende por e-mail): https://claude.ai/artifact/597uX5NDYhbLdUGRi2bC12 (tem os ids da clínica piloto: na página
  pública, sem eles).

Preços da Meta para o Brasil: fontes divergem; o texto diz "aproximados, definidos pela Meta". Conferir o 1º extrato
da clínica piloto no Gerenciador do WhatsApp para calibrar.

## 5. Fases

### IS1 — Guias públicos e envio ao Administrador (feita, 03/nov)

Feito: `src/pages/guia/antes-de-conectar.astro` e `pagamento-meta.astro` (PublicLayout, marca do RecepClinic, sem
login; caminhos em `src/lib/guides.ts`), com o texto aprovado nos rascunhos (o de pagamento sem os ids da clínica
piloto, com onde achar os ids). Sistema › Clínicas › clínica: cartão "Guia para o Administrador" (abrir, guia do
pagamento, enviar pelo WhatsApp com `wa.me/?text=` e "Enviar o guia por e-mail", ação `enviar_guia` →
`sendConnectGuide`, e-mail `guideEmail`). Convite do primeiro Administrador da clínica nova (`createClinicWithAdmin`)
com o parágrafo do guia. Faixa "Clínica em implantação" (AdminLayout) com "Antes de conectar o WhatsApp: veja o guia".
Vendas › Implantação: pré-requisito novo "Mensagens automáticas do app desligadas", cartão definido como padrão com o
custo, envio do guia na Contratação, conferência das automações e teste de outro número que não o do Suporte. Sem
captura afetada. Testes: `src/lib/guides.test.ts`; `novas-clinicas.test.ts` (o convite leva o guia).

Plano original:

- Páginas `/guia/antes-de-conectar` e `/guia/pagamento-meta` (públicas, sem login, layout das páginas do paciente com
  a marca do RecepClinic), com o conteúdo da seção 4.
- Sistema › Clínicas › clínica (em implantação): **"Enviar guia ao Administrador"** (e-mail com o link; copiar link;
  abrir no WhatsApp).
- O link no e-mail do convite do Administrador e na faixa "Clínica em implantação" do painel.
- Vendas › Implantação: pré-requisitos e etapa "Contratação" apontam para o guia; etapa "Forma de pagamento" e
  "Ativação e testes" atualizadas (mensagem de teste, automações, teste de outro número que não o do Suporte).

### IS2 — Mensagem de teste (feita, 03/nov)

Feito: modelo `connection_test` (`rc_teste_envio_v1`, texto aprovado: "Olá, {{1}}! Aqui é {{2}}. Os avisos de
agendamento (lembretes, confirmações e remarcações) da clínica pelo WhatsApp estão ativos neste número. Esta é uma
mensagem automática do RecepClinic. Não é preciso responder.") no catálogo, em toda clínica, fora da aba Mensagens
(sem texto próprio); migração da restrição `whatsapp_templates_template_key_check`. `connectionTest.ts`:
`sendConnectionTest` (número digitado, {{1}} = "equipe"; erro sem modelo aprovado, sem conexão ou número inválido;
recusado na hora grava `failure_code`/`failure_reason`, sem reenvio), `getLatestConnectionTest`,
`getDeliveredConnectionTest`. `createClinicSender`/`clinicSenderFor` com `allowOnboarding` (só o teste sai em
implantação). Configurações › WhatsApp (Administrador e Suporte): bloco "Mensagem de teste" (`#teste`) com o último
envio (Lida/Entregue/Enviada/Não entregue), o motivo em português com o que fazer e o guia
(`src/lib/whatsappErrors.ts`, tabela de códigos da Meta: 131042, 131026, 131031, 131047…) e o formulário; rota
`whatsapp-teste.ts` no lugar de `whatsapp-pagamento.ts` (removida; a função e a coluna `payment_checked_*` ficam sem
tela). Sistema › Clínicas › clínica › Situação: linha do teste e "Ativar a clínica" desabilitado sem teste entregue;
a rota recusa também. Início do Suporte: "Falta uma mensagem de teste entregue" no lugar de "falta conferir a forma
de pagamento". Roteiro de Implantação e Central de Ajuda (Configurações › WhatsApp, problemas) atualizados; captura
`config-whatsapp` na fila. Testes: `whatsappErrors.test.ts`, `templates.test.ts`, `tests/db/mensagem-de-teste.test.ts`.
A tabela de motivos ainda não foi levada aos Envios e ao histórico do atendimento (fica para depois, se o cliente
quiser).

Plano original:

- Template novo no catálogo, `rc_teste_envio_v1` (utilidade), criado na conexão como os outros. Texto a aprovar, ex.:
  "Teste do RecepClinic: o WhatsApp da {{1}} está enviando mensagens automáticas normalmente. Não é preciso responder."
- Configurações › WhatsApp (Administrador e Suporte): **"Enviar mensagem de teste"**, número de destino (padrão: o
  celular de quem testa). Registro em `whatsapp_messages` (tipo próprio); status ao vivo pelo webhook (enviada →
  entregue → lida, ou falhou).
- **Motivo da falha em português, com o que fazer**, numa tabela única de códigos da Meta usada também nos Envios e no
  histórico do atendimento (131042 pagamento, com o link do guia; 131026 número sem WhatsApp; 132001 template não
  aprovado; 141010/limite; 131049; 130472; 368; genérico com o código).
- Sai a marcação manual "Forma de pagamento conferida" (cartão, Situação da clínica, Implantação, Central de Ajuda).

### IS3 — Checklist de implantação (Situação da clínica)

Itens (A = automático, S = Suporte marca; R = recomendado, não bloqueia):

| Grupo | Item | Tipo |
|---|---|---|
| Antes da conexão | Contrato e termo de tratamento de dados assinados; implantação paga ou isenta | S |
| | Login do Facebook do Administrador funcionando | S |
| | Número no app WhatsApp Business, atualizado, perfil comercial | S |
| | Mensagens automáticas do app desligadas (saudação, ausência, Meta Business Suite; inclusive horário comercial) | S |
| Clínica no sistema | Convite aceito | A |
| | Configuração mínima (guia do Início completo) | A |
| | Agenda atual importada ou "não se aplica" | S, R |
| WhatsApp e Meta | Conectado, coexistência, com as sincronizações | A |
| | Templates aprovados (com os de exames, se houver) | A |
| | Cartão cadastrado e **definido como padrão** na conta do WhatsApp | S |
| | Mensagem de teste entregue ou lida | A |
| | Teste do bot de outro número: o bot respondeu e nenhuma mensagem do app saiu sozinha | A |
| | Verificação da empresa iniciada | S, R |
| Ativação | Número do Suporte cadastrado e explicado à clínica | S, R |

- Tabela nova por clínica para os itens marcados (item, quem, quando; desmarcar volta); os automáticos são
  calculados. "Ativar a clínica" bloqueado na tela e **no banco** (a função de ativação confere os obrigatórios).
- Clínica piloto (já ativa): a checklist aparece só como consulta.

### IS4 — Mensagem automática do app

- Eco do app (`message_echoes`) até ~5 s depois de uma mensagem recebida do paciente ou de uma mensagem do bot naquela
  conversa: **não pausa**; fica registrado como suspeita de mensagem automática.
- Aviso ao Suporte (Meu dia) e ao Administrador (Início e Configurações › WhatsApp) com o link do guia (seção de
  desligar as automações).
- O item automático "Teste do bot" da IS3 usa a mesma regra.
- Atualiza o fluxograma da Jornada do bot (`botJourney.ts`, `JOURNEY_UPDATED`) no mesmo commit (regra do projeto).
- Risco aceito: uma resposta humana muito rápida (resposta rápida do app) nesses segundos também não pausa.

### IS5 — Problemas conhecidos

- Sistema › Problemas conhecidos (só Suporte): lista com busca; cada registro com título, sintoma (o que a clínica
  relata), causa, solução, links e data; criar e editar pela tela.
- Primeiros registros (vão na migração, para staging e produção):
  1. Implantação: pré-requisitos da clínica → guia "Antes de conectar".
  2. Lembretes e avisos não chegam, erro 131042 → guia "Pagamento na Meta" (com a mensagem ao suporte da Meta).
  3. O bot para depois do menu e a conversa fica "Aguardando a clínica" → mensagem automática do app ligada.
  4. O bot não responde no teste → o número usado é o do Suporte do RecepClinic.
  5. Conversa em "Aguardando a clínica" sem o "Devolver ao bot" → usar `#bot` pelo app (a tela não tem o botão nessa
     seção; mudança não decidida).

## 6. Fora do escopo, a decidir depois

- "Devolver ao bot" também em "Aguardando a clínica" (perguntado em 03/nov, sem decisão).
- Reenvio ou alerta à equipe quando um aviso de marcação/remarcação falha (hoje só fica no histórico).
- Verificação da empresa da clínica piloto.

## 7. Capturas da Central de Ajuda

A IS2 muda Configurações › WhatsApp (captura `config-whatsapp`): anotar em `capturas-pendentes.md` no commit da fase.
