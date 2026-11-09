# Proposta: recepção digital integrada (WhatsApp, Portal e Painel)

> **Estado atual (retomar daqui), 08/nov/2026.** Etapa 1 aprovada, RD1 a RD14 decididas (seção 17; RD12 e RD14
> revistas). **Etapa 2 (design) fechada:** portal (P1 a P13, celular e computador), link do profissional e **painel da
> recepção (rodada 3, revisada tela por tela e aprovada)**, no canvas https://claude.ai/artifact/Npzjm2Vixb3UnEuUWfiAmb
> (seção 18). Decisões da rodada 3 que mudam a proposta: conversa **sem profissional** (só com quem está); **vários
> números de WhatsApp fora desta entrega** (seção 10, F4, RD11: pendentes); link no Meu dia e no perfil do profissional;
> aba Métricas › Portal e origens em Desempenho; links marcados por lugar. Especificação das telas
> atualizada (08/nov). **Etapa 3: plano da implementação em [`implementacao-recepcao-digital.md`](implementacao-recepcao-digital.md)**
> (08/nov), **aprovado**; retomar por lá. **Revisões do cliente no plano (08/nov):** regra da Matriz (o item Portal só
> decide os links; o bot depende dele e tem uma jornada só, levando ao portal; telas da recepção para todas as clínicas),
> RD3 (remarcar no portal, I7), RD5 (retorno e exames também no portal, I8) e prazo do retorno sem dias bloqueados (I9).

Base: [`diagnostico-evolucao-recepclinic.md`](diagnostico-evolucao-recepclinic.md) (o que existe hoje). Telas:
[`especificacao-telas-portal-e-recepcao.md`](especificacao-telas-portal-e-recepcao.md). Apresentação:
[`roteiro-apresentacao-clinica-18-profissionais.md`](roteiro-apresentacao-clinica-18-profissionais.md).

Marcas: **[Existe]** já no produto (produção ou staging, como no diagnóstico); **[Evolui]** existe e muda; **[Novo]** a
desenvolver; **(RDn)** decisão do cliente (seção 17); **[Pendência]** depende de terceiro (Meta,
advogado). **Sem inteligência artificial**: tudo é fluxo determinístico, regra de negócio e consulta ao banco.

## 1. Visão do produto

O RecepClinic deixa de ser "o bot do WhatsApp da clínica" e passa a ser **a recepção digital da clínica**: o paciente
resolve pelo WhatsApp ou marca sozinho num portal com a marca da clínica; a equipe acompanha tudo num lugar só, com
os 18 profissionais, as 3 secretárias e os vários números juntos.

**Uma plataforma só, para todos os portes.** Nada de produto separado para clínica grande. Cada peça nova é um **item
da Matriz de acesso (D11)**, ligado pelo Suporte clínica a clínica:

| Item novo da Matriz | Depende de | Clínica pequena (1 profissional) | Clínica de 18 profissionais |
|---|---|---|---|
| **Portal de agendamento** | bot | Pode ligar: o portal pula especialidade e profissional | Ligado |
| **Vários números de WhatsApp** | bot | Desligado (um número, como hoje) | Ligado |
| **Acesso da Recepção por profissional nas conversas** | Central | Desligado | Ligado, se a clínica quiser |
| **Horários por modalidade** (RD6) | Portal | Desligado | Conforme a clínica |

Regra de ouro: **com os itens desligados, a clínica não vê diferença nenhuma** (mesmo bot, mesmo link, mesmas telas).
O que se adapta ao porte sem configuração: telas com busca e filtro a partir de 6 profissionais (já é o padrão da
`main`, `LIST_FILTER_FROM`), passo pulado quando só existe uma opção (uma especialidade, um profissional, uma modalidade).

## 2. Arquitetura conceitual

```
 Entradas do paciente                 Plataforma RecepClinic (um app, um banco, RLS por clínica)
 ─────────────────────                ───────────────────────────────────────────────────────────
 WhatsApp (n números) ──webhook──▶  Camada WhatsApp ──▶ Bot determinístico ──┐
                                     (conexão → clínica,                     │ link com token
                                      profissional/setor)                    ▼
 Site / Instagram / Google ───────▶  Portal da clínica  ◀────────────── /s/{token}
 Endereço direto                     (agendar.recepclinic.com.br/{clinica})
                                              │
                                              ▼
                                     Motor de regras de agenda  ◀──── Painel da recepção
                                     (especialidade, profissional,     (Conversas, Agenda em grade,
                                      serviço, modalidade, horários     Pacientes, Portal, Métricas)
                                      livres, reserva, confirmação)
                                              │
                                              ▼
                                     Notificações (fila com idempotência: confirmação, lembrete,
                                      remarcação, cancelamento, recuperação) ──▶ pela conexão certa
```

- **Motor de regras** [Evolui]: hoje espalhado em `publicBooking.ts`, `freeSlots.ts`, `bot/booking.ts` e
  `appointments.ts`. A proposta concentra as consultas em funções únicas (já previstas no plano multiprofissional:
  "profissionais de uma especialidade", "profissional aceita o plano") usadas **igualmente** pelo bot, pela Marcar da
  Recepção e pelo portal. Nenhuma regra fica só no navegador.
- **Portal** [Novo]: mesma aplicação Astro, mesma marca da clínica, renderização no servidor, pouco JavaScript (bom
  para celulares simples). O link de hoje (`/agendar/{token}`) continua; o portal é a evolução dele.
- **Camada WhatsApp** [Evolui]: passa de "a conexão da clínica" para "a conexão desta conversa".
- **Notificações** [Evolui]: a confirmação sai de uma fila com chave única por atendimento e tipo, nunca dentro da
  transação que grava o atendimento.

## 3. Fluxo do WhatsApp

### 3.1 Primeira mensagem

O webhook identifica a **conexão** pelo `phone_number_id` e, por ela, a clínica e o destino do número (clínica toda,
um setor ou um ou mais profissionais; seção 12). O telefone do remetente localiza o contato (`contacts.phone`) ou abre
uma conversa nova. [Existe para um número; Evolui para vários.]

### 3.2 Mensagem de boas-vindas (proposta de texto)

> Olá! Aqui é a recepção da **{Clínica}**. Como podemos ajudar?
>
> [Agendar consulta] [Médicos, convênios e valores] [Endereço e horários] [Falar com a recepção]

- Botões de resposta da Meta (até 3 botões; com 4 opções, lista com "Ver opções", como o menu de hoje, C31).
- **Número de um profissional só**: "Aqui é a recepção do **Dr. Fulano** ({especialidade}), na {Clínica}." O bot pula a
  escolha de especialidade e profissional (o escopo vem da conexão). [Novo]
- **Número compartilhado** com vários profissionais: como hoje na `main` (staging): especialidade → profissional →
  menu no contexto dele. [Existe]
- Paciente com consulta marcada: o menu inclui "Minhas consultas" (remarcar, cancelar), como hoje. [Existe]

### 3.3 Informações antes de marcar

| Pedido | Resposta | Origem dos dados |
|---|---|---|
| Especialidades | Lista das especialidades com profissional ativo | `professional_specialties` [Existe, staging] |
| Médicos | Nome, especialidade, registro (CRM/UF) | `professionals` [Existe] |
| Convênios | Por profissional: "Dr. X atende Unimed, Amil; Dra. Y só particular" | `professional_insurance_plans` [Existe, staging] |
| Valores | Valor da consulta particular de cada profissional | `services.price_cents` do serviço Consulta do profissional [Existe, staging] |
| Endereço e horário | Local(is) e horário da recepção | `locations`, horário da recepção [Existe] |
| Outras | Base de Conhecimento (perguntas cadastradas, sem IA) | `kb_*` [Existe] |

Com muitos profissionais, o bot responde o resumo e oferece **"Ver no portal"** (lista completa com foto e convênios),
em vez de uma mensagem enorme. [Novo]

### 3.4 Encaminhamento para o portal

Ao tocar em **Agendar consulta** (com o item Portal ligado, (RD3)):

> Para escolher o médico e o horário, toque no link abaixo. Ele vale por 30 minutos e é só para este número.
> https://agendar.recepclinic.com.br/s/{token}

- **Token**: 128 bits aleatórios do servidor (como o `booking_links.id` de hoje, em 22 caracteres base64url), sem nome,
  telefone ou CPF na URL. Guardado no banco com: clínica, conexão de origem, contato/telefone (no banco, não na URL),
  **finalidade** (`agendar` | `remarcar` | `cancelar` | `minhas_consultas`), validade, uso, revogação. [Evolui]
- **O token não é prova de identidade sozinho.** Ele prova que quem abriu recebeu a mensagem naquele chat. Por isso:
  validade curta (30 min, como hoje), **uma marcação por token**, revogado quando um novo é emitido para o mesmo
  telefone e finalidade, ou quando a conversa vai para a recepção e ela marca. A lista de pacientes do telefone mostra
  só o necessário (seção 5.3).
- **Link encaminhado a outra pessoa**: ela agendaria em nome do dono do telefone, e a confirmação vai para o dono →
  ele percebe e cancela. Para reduzir: o portal mostra "Agendando pelo número terminado em **·· 4321**" e, se a pessoa
  disser que não é ela, oferece "Usar outro número" (que exige o código, seção 5.2).
- Entrada **sem WhatsApp** também é possível (seção 4.1).

## 4. Portal web de agendamento

### 4.1 Entradas

| Entrada | Endereço | Telefone comprovado? |
|---|---|---|
| Link do bot | `agendar.recepclinic.com.br/s/{token}` | Sim (veio do chat) |
| Site, Instagram, Google, direto | `agendar.recepclinic.com.br/{apelido-da-clinica}` (RD1) | Não: pede o código no passo 7 |
| Link de remarcar/cancelar (lembrete) | `…/s/{token}` com finalidade própria | Sim |

A origem do acesso vem de um parâmetro sem dado pessoal (`?origem=instagram`, `site`, `google`) ou do token, e só serve
para métricas (seção 14).

### 4.2 Ordem obrigatória das etapas

1. **Especialidade** (pulada se a clínica só tem uma, ou se o link já veio de um número de um profissional).
2. **Profissional** (pulado se a especialidade só tem um).
3. **Modalidades do profissional** (o que ele atende: particular com valor; convênios aceitos; observações).
4. **Particular ou um dos convênios dele** (pulado se só atende uma modalidade; nunca mostra convênio que ele não aceita).
5. **Datas disponíveis** para aquela modalidade (e para o tipo de consulta, se houver mais de um, (RD5)).
6. **Horário**.
7. **Telefone** (já vem do link; na entrada direta, o paciente digita e recebe o código).
8. **Quem será atendido**: um dos pacientes do telefone, "Outra pessoa" ou cadastro novo.
9. **Revisão e confirmação**.

A modalidade **nunca** é a primeira pergunta. Trocar a modalidade volta ao passo 5 e refaz a consulta de horários.

### 4.3 Especialidade

Cartões grandes com o nome e quantos profissionais atendem ("Pediatria · 4 médicos"). A partir de 8 especialidades,
campo de busca com sinônimos do dicionário global (`kb_specialties`: "médico do coração" → Cardiologia) [Existe o
dicionário]. Atalho **"Já sei o nome do médico"**: busca direta por nome.

### 4.4 Profissional

Cartão por profissional: foto (ou iniciais), nome, registro (ex.: CRM 12345/RN), especialidade principal (e outras),
modalidades em selos ("Particular R$ 350", "Unimed", "+2 convênios"), próximo dia livre ("Próximo horário: amanhã").
Ordem: alfabética (RD7). Filtro "Atende meu
convênio" quando a clínica atende convênios.

### 4.5 Modalidades e convênios

Exemplo para o paciente:

> **Dra. Ana Souza** · Pediatria · CRM 12345/RN
> **Particular**: R$ 350,00
> **Convênios**: Unimed, Bradesco Saúde, Amil
> *Unimed: precisa de autorização prévia. Leve a carteirinha.*

Configurações cobertas: só particular; só convênio; os dois; vários convênios; condições por modalidade. O que existe e
o que falta:

- Particular com valor: [Existe, staging] (`services.price_cents` do serviço do profissional).
- Convênios aceitos: [Existe, staging] (`professional_insurance_plans`).
- **Só convênio** (sem particular): [Novo] coluna `professionals.accepts_private` (hoje o modo é "só particular" ou
  "particular e convênios").
- **Observações por convênio** (autorização, encaminhamento, carteirinha): [Novo] texto curto na ligação profissional
  × convênio. Sem preço por convênio (D10 segue: fora por enquanto).
- Exige carteirinha na marcação: [Existe] configuração D10.

### 4.6 Disponibilidade

Só horários realmente livres, consultados no servidor a cada mudança, considerando: agenda do profissional, serviço e
duração, bloqueios, feriados, horário da agenda, intervalo entre atendimentos, antecedência mínima (2 h, D4b), prazo
para oferecer horários da agenda (por profissional, staging), idade limite (no passo 8, ao escolher o paciente),
retorno (fora do portal no MVP, (RD5)) e **modalidade** (RD6). Cache: nenhum; a lista é sempre
consultada e o horário é revalidado na reserva e na confirmação.

## 5. Identificação do paciente e dos responsáveis

**Regra do produto: o telefone identifica; o CPF não entra no agendamento.**

### 5.1 Telefone comprovado

- **Pelo link do WhatsApp**: comprovado (quem abriu recebeu no chat daquele número).
- **Entrada direta**: o paciente digita o celular; o RecepClinic envia **código de 6 dígitos pelo WhatsApp** (template
  de autenticação da Meta, botão "Copiar código"), válido por 10 min, 5 tentativas, reenvio após 60 s, no máximo 3
  envios por telefone por hora (RD2). Sem SMS no MVP (custo e outro fornecedor). O código prova a posse do
  número; só depois disso o portal mostra cadastros.
- Telefone sem WhatsApp: "Não recebeu? Fale com a recepção" (telefone da clínica). Não marca sem comprovar.

### 5.2 Paciente com cadastro

Telefone comprovado → contato localizado → lista dos pacientes ativos dele:

> Para quem é a consulta?
> ( ) **Maria S.** (você)
> ( ) **João S.**
> ( ) Outra pessoa

- Nome exibido: primeiro nome + inicial do sobrenome (RD12). Sem data de nascimento, convênio ou histórico.
- O titular do telefone **não é presumido** paciente: sempre se pergunta "para quem".
- Pedido de dado extra só se faltar algo indispensável (ex.: carteirinha, se a clínica exige, D10).
- Idade limite do profissional (staging): paciente fora do limite vê "Este profissional atende até {n} anos" e volta
  ao passo 2.

### 5.3 Paciente novo

- **Para mim**: nome completo + data de nascimento (obrigatória no banco hoje e usada para idade limite e perfil,
  (RD8)).
- **Para outra pessoa** (filho, dependente): nome do responsável (se o contato ainda não existe) + nome e nascimento do
  paciente. O contato é o responsável; o paciente fica com `is_contact_self = false`. [Existe o modelo]
- Convênio: vem do passo 4; carteirinha só se a clínica exigir.
- Nada de CPF, endereço, e-mail ou documento. O resto a recepção completa depois, se precisar.
- Nome parecido com um paciente do mesmo contato: "Você quis dizer **João S.**?" (busca por nome parecido, C18/C19). [Existe]

### 5.4 Menores e LGPD

- Dados de crianças e adolescentes tratados no melhor interesse deles (LGPD art. 14): o portal só coleta nome e
  nascimento; quem informa é o responsável; os dados aparecem só para o telefone comprovado.
- A tela de identificação traz o aviso de privacidade curto e o link da política da clínica/RecepClinic.
- Termo de tratamento e política revisados pelo advogado antes da produção [Pendência].

### 5.5 CPF e nota fiscal

- O CPF continua só no **financeiro** (`contact_finance`, `patient_finance`, `payments.payer_cpf`), informado pela
  **secretária na saída do atendimento**, dentro do registro do pagamento e da emissão da nota (frente da NFS-e,
  branch `nota-fiscal`). [Existe]
- O portal, o bot e a marcação **não pedem nem mostram CPF**. Nenhuma tabela nova ganha CPF. Nenhuma busca usa CPF.
- Impacto no modelo: nenhum; a separação já existe. Na Etapa 3, um teste confere que nenhuma rota pública lê as
  tabelas financeiras.

## 6. Confirmação do agendamento

**Revisão** (passo 9): profissional, especialidade, modalidade (particular com valor, ou convênio), data e hora (dia
da semana por extenso), endereço do local com "Ver no mapa", orientações gerais e preparo (quando houver),
quem será atendido, e o aviso "Você receberá a confirmação no WhatsApp ·· 4321". Botão **Confirmar agendamento**.

Ao confirmar, numa transação única no banco:

1. Confere a reserva temporária (seção 9.2) e revalida o horário.
2. Cria contato/paciente se novos.
3. Grava o atendimento com `booking_channel = 'portal'` [Novo valor], modalidade, origem do acesso e sessão.
4. A trava `appointments_no_overlap` garante um só atendimento no horário; se outro ganhou, nada é gravado.
5. Marca o token/sessão como usado e libera a reserva.
6. **Enfileira** a confirmação (`notification_outbox`, chave única `atendimento + tipo`).

Depois da transação: a tela mostra "Consulta marcada" com o resumo, "Adicionar à agenda do celular" (.ics) e "Falar
com a recepção". A fila envia pela **conexão da conversa de origem** (ou a conexão padrão da clínica/profissional), com
tentativas controladas (reenvio já existente: 30 s, 2 min) e a chave única impedindo duplicidade. **Falha no envio
nunca desfaz o atendimento**; ela aparece na Agenda como hoje (FE).

## 7. Segurança e prevenção de agendamentos falsos

### 7.1 Camadas

| Camada | Medida | Onde |
|---|---|---|
| Identidade | Telefone comprovado (link do chat ou código) antes de ver cadastros ou marcar | Servidor |
| Limites de uso | Por telefone: os limites do bot (atendimentos futuros, pacientes novos em 30 dias, faltas em 90 dias, padrão 5) passam a valer também no portal [Existe, Evolui] | `botLimits.ts` |
| Limite de requisições | Por IP, por sessão e por telefone: consultas de horários, pedidos de código, reservas e confirmações, com janela deslizante (valores na seção 7.2) [Novo] | Postgres (contador por chave e janela) ou Vercel Firewall [Investigação] |
| Robôs | CAPTCHA **adaptativo** (Cloudflare Turnstile, invisível na maioria dos casos), exigido só na entrada direta ao pedir o código, ou quando um sinal de risco aparece (RD9) | Servidor valida o token do CAPTCHA |
| Sessão | Token opaco, validade curta, finalidade única, revogável; cookie `HttpOnly`, `Secure`, `SameSite=Lax` para a sessão do portal | Servidor |
| Repetição | Chave de idempotência em cada "Reservar" e "Confirmar" (o duplo toque não cria dois) [Existe parecido: `sendOnce.ts`] | Servidor + banco |
| Reserva | Só na revisão, curta, uma por sessão/telefone (seção 7.2) | Banco |
| Bloqueio progressivo | 15 min → 1 h → 24 h para a chave que estoura o limite; **nunca permanente automático**; desbloqueio pela recepção | Banco + tela "Contatos para revisar" [Existe, Evolui] |
| Monitor | Painel do Suporte: picos de reservas abandonadas, muitos telefones por IP, muitas marcações seguidas canceladas | [Novo] |
| Auditoria | Trilha do atendimento com canal "portal", sessão e IP truncado (sem guardar o IP inteiro por mais de 30 dias) | `appointment_events` [Evolui] |

### 7.2 Valores iniciais propostos (ajustáveis pelo Suporte)

| Ação | Limite |
|---|---|
| Consultar horários | 60 por sessão em 10 min; 300 por IP em 10 min |
| Pedir código | 3 por telefone por hora; 10 por IP por hora |
| Errar o código | 5 por código; depois, novo código |
| Reservar | 1 reserva ativa por sessão e por telefone; 5 reservas por telefone por dia |
| Confirmar | Limites do bot por telefone (atendimentos futuros) |

### 7.3 Reserva temporária

- **Não** reserva ao abrir a página nem ao ver horários.
- Reserva ao tocar em **"Continuar"** depois de escolher o horário **e** comprovar o telefone (passo 7), isto é, na
  entrada da revisão. Prazo **5 min** (RD4), com contador visível ("Reservamos este horário por 4:59").
- Liberada ao vencer, ao trocar de horário, ao voltar ou ao confirmar. Sem rotina obrigatória: a reserva vencida
  simplesmente não conta (a consulta de horários ignora `expires_at < now()`); uma limpeza diária apaga as velhas.
- **Modelo técnico** [Novo]: tabela `slot_holds` (clínica, agenda, período, sessão, telefone, `expires_at`). A função
  `reserve_slot` do banco, numa transação com `pg_advisory_xact_lock` pela agenda, confere atendimentos ativos e
  reservas não vencidas que se sobrepõem e grava a reserva. A função `confirm_portal_booking` toma o mesmo lock, confere
  que a reserva é da sessão e não venceu, e grava o atendimento; a trava `appointments_no_overlap` continua como última
  barreira (a Recepção marcando pelo painel no mesmo horário também é barrada).
- A Marcar da Recepção mostra o horário reservado como "Em reserva no portal (até 10:42)" e pode marcar por cima
  depois de confirmar (a reserva cai e o paciente do portal vê "horário não está mais disponível").

### 7.4 Concorrência (dois pacientes, mesmo horário)

- Dois tentam reservar ao mesmo tempo: o lock por agenda serializa; o primeiro reserva; o segundo vê **"Esse horário
  acabou de ser escolhido por outra pessoa. Veja os próximos horários livres."** com a lista já atualizada.
- Se, por qualquer caminho, dois confirmarem: a restrição de exclusão do banco aceita só um (já é assim hoje,
  `slot_taken`).

### 7.5 Dados

- Isolamento por clínica (D1): o portal usa a credencial limitada à clínica do apelido/token; nenhuma chave
  privilegiada vai ao navegador [Existe o padrão].
- RLS das tabelas novas por clínica; funções `security definer` só para reservar e confirmar, com validação dos
  argumentos.
- Validação sempre no servidor; o navegador só exibe.
- Minimização: o portal grava só o que a marcação precisa; métricas sem telefone nem nome (seção 14).
- Retenção: sessões e reservas apagadas em 30 dias; IP truncado; trilha do atendimento segue a política atual.
- Fotos do profissional no portal: toda foto do cadastro aparece (RD13), servida pelo servidor por URL assinada curta
  ou cópia pública; o cadastro avisa que a foto é pública.

## 8. Recuperação de agendamentos abandonados

- **Já existe para o link do WhatsApp** (PN): link vencido sem marcação → "Não concluímos a marcação de *X*. Como
  prefere seguir?" [Novo link] [Falar com a recepção] [Desistir]. [Existe]
- Evolução (Fase 6): para o portal aberto pelo link do bot, aviso após **15 min** sem conclusão, dentro da janela de
  24 h da conversa (mensagem de serviço, sem template), texto neutro: "Olá! Vimos que você começou um agendamento e não
  terminou. Se precisar, a nossa recepção ajuda. [Continuar] [Falar com a recepção]". Sem especialidade, médico ou dado
  de saúde.
- Não envia: se marcou; se a conversa está com a recepção; se já enviou para aquela sessão; fora da janela de 24 h (sem
  template de marketing); para a entrada direta sem consentimento.
- É **recuperação**, não remarketing: uma vez, ligada à sessão, sem lista de campanha.

## 9. Remarcação e cancelamento

- **Pelo WhatsApp** [Existe]: lembrete e menu "Minhas consultas" com remarcar (link) e cancelar (na conversa, com
  confirmação).
- **No portal** [Novo]: "Minhas consultas" com telefone comprovado → lista das próximas consultas do contato (nome
  parcial do paciente, profissional, data) → **Remarcar** (mesma jornada a partir do passo 5, mesmo profissional e
  modalidade) ou **Cancelar** (com "Tem certeza?").
- Links do lembrete: token com finalidade única (`remarcar` ou `cancelar` daquele atendimento), uso único, vencido
  depois do horário da consulta.
- **Antecedência** (RD10): hoje não há antecedência mínima para cancelar pelo bot [Hipótese: conferir
  `bot/manage.ts` na Etapa 3]. Proposta: a clínica define (padrão 24 h para cancelar e remarcar pelo portal); dentro do
  prazo, o portal oferece "Falar com a recepção".
- Na Recepção: remarcação e cancelamento pelo portal entram na trilha com canal "portal", no Início ("Cancelados hoje")
  e na lista de espera (vaga liberada é oferecida como hoje, D2).

## 10. Vários profissionais e vários números de WhatsApp

> **Vários números de WhatsApp: fora desta entrega (cliente, 08/nov).** Fica pendente para planejamento e
> implementação depois desta entrega ou quando o cliente decidir. O que vale agora: um número por clínica, como hoje.

### 10.1 Modelo conceitual

```
Clínica 1──n Profissional n──n Especialidade (global)
   │            │  1──1 Agenda          n──n Convênio (da clínica, com observação)
   │            └─ n Serviço (dono)
   ├─1──n Usuário da equipe (papéis; acesso a agendas/profissionais)
   ├─1──n Conexão WhatsApp (número, WABA, portfólio, token, destino)
   │            └─ n──n Profissional (destino do número; vazio = clínica toda)
   ├─1──n Contato (telefone) 1──n Paciente
   └─1──n Conversa (conexão + telefone) 1──n Mensagem
                └─ profissional em foco, responsável, situação
Agendamento: paciente, profissional/agenda, serviço, modalidade, local, canal, origem, conversa/sessão
```

Mudanças no banco (todas aditivas, Fase 1):

| Tabela | Mudança |
|---|---|
| `whatsapp_connections` | Nova chave `id`; `clinic_id` vira coluna comum (índice); `label` ("Recepção geral", "Dr. Fulano"); `is_default`; `business_portfolio_id` (pode ser diferente por conexão); token por conexão no Vault. A conexão atual vira a padrão |
| `whatsapp_connection_professionals` [Novo] | Conexão × profissional (destino); vazio = número da clínica toda |
| `conversation_state` | `connection_id`; único passa a ser `(clinic_id, connection_id, contact_phone)`; `professional_id` em foco (vem do número, da escolha no bot ou da recepção) |
| `whatsapp_messages`, `whatsapp_media`, `handoff_events` | `connection_id` |
| `whatsapp_templates` | `connection_id` (ou WABA): cada conta tem os templates aprovados dela |
| `appointments` | `booking_channel` ganha `portal`; `conversation_id`/`portal_session_id` opcional; `access_origin` |
| `contacts` | **Sem mudança**: o mesmo telefone é o mesmo contato na clínica, falando com qualquer número |

Não é "mais um campo de telefone na clínica": cada número é uma conexão com dono, destino, token e templates.

### 10.2 Caixa de entrada unificada

Uma lista com as conversas de todos os números e profissionais que a pessoa pode ver, com filtros: profissional,
especialidade, número de WhatsApp, situação (com o bot, aguardando, em atendimento, finalizada), responsável (eu,
ninguém, outra pessoa) e "aguardando atendimento humano". Cada conversa mostra o selo do número ("Dr. Fulano ·
(84) 9xxxx-1234") e o profissional em foco. [Evolui a Central]

### 10.3 Resposta pelo número certo

- A resposta da recepção **sempre** sai pela `connection_id` da conversa. Não existe "escolher número" ao responder.
- Confirmações e lembretes de um atendimento saem pela conexão da conversa que o originou; sem conversa (portal direto
  ou marcado pela recepção), pela conexão do profissional; sem ela, pela padrão da clínica (RD11).
- Janela de 24 h é **por número**: a conversa com o número A não abre janela no número B.

### 10.4 Requisitos da Meta (a conferir na documentação atual, [Pendência])

- Cada número entra pelo **Embedded Signup** (o mesmo botão de hoje, repetido por número); pode ser de outra WABA e de
  outro portfólio. O RecepClinic **não presume** um portfólio só.
- O webhook já chega com `metadata.phone_number_id`: é por ele que se acha a conexão. Assinatura `X-Hub-Signature-256`
  com o segredo do app (um app só, o do RecepClinic).
- Inscrição do app em cada WABA (`subscribed_apps`) a cada conexão.
- Templates pertencem à WABA: conexão nova numa WABA nova recebe o conjunto padrão e espera aprovação (como hoje na
  conexão, D3b).
- Coexistência por número; sincronização de contatos/histórico por número.
- Limites de mensagens, qualidade e custo **por número ou por portfólio**: conferir e mostrar na tela de conexões.
- Cobrança: a clínica paga a Meta direto pelo(s) portfólio(s) dela (como hoje).

### 10.5 Permissões

| Perfil | Vê | Faz |
|---|---|---|
| Administrador da clínica | Tudo | Conecta números, define destino, equipe e acessos |
| Recepção | Agendas e conversas dos profissionais liberados (padrão: todos) (RD14); conversas de números da clínica toda | Atende, marca, transfere |
| Profissional | A própria agenda; conversas em que está em foco ou com ele (como hoje) | Configura o que é dele (S1) |
| Suporte RecepClinic | Tudo, com cada leitura registrada (D6) | Diagnóstico |

Base técnica: `member_agenda_grants` já restringe agendas por pessoa; a proposta usa a mesma lista para as conversas
com `professional_id` em foco (RLS nas funções da Central). **Equipes de recepção** (grupos de secretárias) não entram
no MVP: com 3 secretárias, o acesso por pessoa basta (RD14).

## 11. Experiência da secretária

- **Início**: o que precisa de ação agora, de todos os profissionais dela: conversas aguardando, marcações novas pelo
  portal, cancelamentos, confirmações pendentes de amanhã, falhas de envio. Cada item com o profissional.
- **Conversas**: caixa única (10.2); ao abrir, a faixa do paciente com a próxima consulta e o profissional; "Direcionar
  para outro profissional" muda o foco (e o filtro), sem trocar o número de envio.
- **Agenda em grade**: colunas = profissionais filtrados (por especialidade, busca, "só com atendimento hoje"), linhas
  = horários; no celular, um profissional por vez com troca rápida. Atalho **"Próximos horários livres"**: dada a
  especialidade/convênio, os primeiros horários de todos os profissionais, para responder o paciente na hora.
- **Origem visível**: selo em cada atendimento — "Portal", "WhatsApp" ou "Recepção" (com quem marcou).
- **Sem conflito**: a trava do banco vale para todos; a Marcar mostra reservas do portal em andamento.
- **Confirmações, cancelamentos, remarcações**: as abas de hoje do Resumo do dia, filtráveis por profissional.

## 12. Métricas e indicadores

Funil do portal por sessão anônima (sem telefone, nome ou IP): acesso → especialidade → profissional → modalidade →
horário → telefone → paciente → revisão → confirmado. Com: origem (WhatsApp, site, Instagram, Google, direto),
especialidade, profissional, modalidade/convênio escolhidos, abandono por etapa, horário visto vs. marcado, pedidos de
ajuda, tentativas bloqueadas (por motivo). Comparativo: marcações pelo paciente (portal + bot) vs. pela recepção, por
profissional e por semana. Agregados diários (`portal_funnel_daily`) e eventos brutos guardados só 90 dias. Aba nova
"Portal" nas Métricas (item da Matriz, como as outras abas, D11). Não guardar dado pessoal só para métrica.

## 13. Fases de evolução

Reorganizei a sequência sugerida: **o portal sai antes dos vários números**, porque (a) é o que mais aparece na
demonstração, (b) reaproveita quase tudo do bloco multiprofissional (na produção desde 08/nov) e (c) os vários números dependem de
conferências na Meta. A identificação e a segurança entram **junto** do portal (portal aberto sem segurança não vai
para a produção).

| Fase | Objetivo | Entregas | Depende de | Riscos | Complexidade | Aceite | Demonstrável |
|---|---|---|---|---|---|---|---|
| **F0 Base** | Publicar o que já existe | **Feito (08/nov, `64ec6b1`)**: bloco multiprofissional (ME, MC, MI, MB, MS, itens 1 a 4, fotos) validado e na produção | — | — | — | Validado pelo cliente | Bot com especialidade → médico; convênios por médico |
| **F1 Fundação** | Modelo pronto para vários números e portal | Conexões com `id`, `connection_id` em conversas/mensagens/templates; canal `portal`; observação por convênio; "só convênio"; consultas únicas do motor; fila de notificações | F0 | Migração das conexões em produção | Média | Testes de banco: clínica de um número igual a antes; isolamento | Nada visível (base) |
| **F2 Portal + segurança** | Paciente marca sozinho | Portal (passos 1–9), apelido da clínica, sessão/token com finalidade, código pelo WhatsApp, reserva 5 min, limites, CAPTCHA adaptativo, confirmação pela fila, canal "Portal" na Agenda | F1, RD1–RD9 | Abuso; template de autenticação aprovado | Alta | Cenários 1–12, 15–17 (seção 15) no staging com Playwright | **Jornada completa no celular** |
| **F3 Bot → portal** | WhatsApp leva ao portal | "Agendar" envia o link; informações com "Ver no portal"; remarcar/cancelar e "Minhas consultas" no portal; antecedência | F2 | Mudar o caminho do bot em produção | Média | Jornada do bot atualizada; clínica sem o item igual a antes | WhatsApp → portal → confirmação no WhatsApp |
| **F4 Vários números + caixa unificada** — **fora desta entrega (cliente, 08/nov): pendente, para planejar depois da entrega ou quando o cliente decidir** | Cada médico com o número dele | Conectar vários números, destino por profissional, roteamento, resposta pelo número certo, filtros da Central, acesso da Recepção por profissional | F1, conferência Meta | Limites e custo da Meta; coexistência | Alta | Cenários 13–14; resposta sempre pela conexão da conversa | Secretária atende 2 médicos de números diferentes numa tela |
| **F5 Agenda da clínica grande** | 18 profissionais sem 18 telas | Agenda em grade, "Próximos horários livres", Início com pendências por profissional | F0 | Desempenho com 18 agendas | Média | 18 agendas carregam em < 2 s no staging | Visão da manhã da clínica inteira |
| **F6 Métricas e otimização** | Medir e recuperar | Funil do portal, aba Portal, recuperação de abandono em 15 min, horários por modalidade (se RD6), ajustes | F2–F3 | Excesso de mensagens | Média | Números conferidos com uma semana de uso | Painel de conversão |

Sem prazos: dependem da validação de cada fase pelo cliente e das respostas da Meta e do advogado. Medida de tamanho
relativo: F2 é a maior (telas novas + segurança); F1 e F4 mexem nas tabelas mais sensíveis.

## 14. Integrações

| Integração | Uso | Situação |
|---|---|---|
| Meta Cloud API | Mensagens, templates (inclui autenticação), Embedded Signup por número | Existe para um número |
| Cloudflare Turnstile (ou similar) | CAPTCHA adaptativo | Novo (RD9) |
| Supabase Storage | Fotos públicas do portal | Bucket privado existe |
| Calendário (.ics) | "Adicionar à agenda do celular" | Novo, sem serviço externo |
| Google Maps | "Ver no mapa" (link, sem API) | Existe (EC) |

## 15. Cenários validados

Cada cenário vira um teste da Etapa 3 (unidade/banco e Playwright).

| # | Cenário | Fluxo e comportamento | Regras e segurança | Mensagem ao paciente | Aceite |
|---|---|---|---|---|---|
| 1 | Paciente novo, particular, para si | Portal direto → especialidade → médico → Particular → horário → celular + código → "Para mim" → nome e nascimento → revisão → confirma | Código obrigatório; limite de pacientes novos; reserva 5 min | "Consulta marcada! Enviamos a confirmação no WhatsApp ·· 4321." | Contato e paciente criados com `is_contact_self`; atendimento `portal`; confirmação enfileirada uma vez |
| 2 | Paciente cadastrado pelo telefone | Link do bot (telefone comprovado) → … → lista "Para quem?" com o nome dele | Nome parcial; sem dados extras | Idem | Usa o paciente existente; não cria duplicado |
| 3 | Responsável marca para o filho | "Outra pessoa" → nome e nascimento do filho | Filho com `is_contact_self = false`; idade limite do médico | Idem, com o nome do filho | Filho ligado ao contato do responsável |
| 4 | Médico com particular e vários convênios | Passo 3 mostra valor e convênios; passo 4 com as opções | Só os convênios dele | — | Escolha gravada no atendimento |
| 5 | Médico só particular | Passo 4 pulado; selo "Particular R$ X" | — | — | Atendimento sem convênio |
| 6 | Médico só convênio | Passo 4 só com os convênios; sem valor | `accepts_private = false` | "Atende somente pelos convênios abaixo." | Particular nunca aparece |
| 7 | Convênio não aceito | O convênio não aparece; filtro "atende meu convênio" esconde o médico; quem chegar pelo link com outro plano vê os aceitos | Validação no servidor recusa plano fora da lista | "A Dra. X não atende {plano}. Veja quem atende ou siga como particular." | Nenhum atendimento com plano não aceito |
| 8 | Horário some antes da confirmação | Reserva falha (outro reservou) ou venceu | Revalidação na reserva e na confirmação | "Esse horário não está mais disponível. Veja os próximos." | Volta ao passo 6 com a lista atualizada |
| 9 | Dois confirmam o mesmo horário | Lock por agenda + trava de exclusão | Um só grava | O segundo vê a mensagem do 8 | Um atendimento; o outro sem efeito |
| 10 | Pede ajuda no meio | Botão fixo "Falar com a recepção" | Link para o WhatsApp da clínica (ou do médico) com texto pronto sem dado de saúde; conversa vai para a fila da recepção com "veio do portal" | "Nossa recepção vai continuar com você no WhatsApp." | Sessão ligada à conversa; nada marcado |
| 11 | Portal direto, sem WhatsApp antes | Entrada pelo apelido | Código pelo WhatsApp; CAPTCHA se risco | — | Igual ao 1 |
| 12 | Abre e abandona | Sessão expira; reserva cai | Sem mensagem na entrada direta; pelo link do bot, PN (existe) e, na F6, aviso em 15 min | Texto neutro (seção 8) | Uma mensagem no máximo; nenhuma se marcou ou está com a recepção |
| 13 | 18 médicos, 3 secretárias | Agenda em grade com filtros; caixa única | Acesso por pessoa | — | Nenhuma tela exige abrir agenda a agenda |
| 14 | Secretária atende dois médicos de números diferentes | Caixa única com selo do número | Resposta pela conexão da conversa | — | Mensagem sai do número de origem (teste com dois números de testes) |
| 15 | Confirmação falha | Atendimento já gravado; fila tenta de novo; aviso na Agenda | Chave única por atendimento e tipo | Portal já mostrou "marcada" | Atendimento intacto; no máximo uma confirmação entregue |
| 16 | Link antigo, vencido ou repassado | Vencido/usado: "Este link venceu" + "Pedir novo link no WhatsApp" e "Agendar pelo portal" (com código); repassado: "Agendando pelo número ·· 4321" + "Usar outro número" | Token de finalidade única; revogado ao emitir outro | "Este link não vale mais. Peça um novo ou agende pelo portal." | Nada marcado com token vencido/usado |
| 17 | Dependente já cadastrado | Lista "Para quem?" com o dependente | Nome parcial; só com telefone comprovado | — | Atendimento no paciente dependente |

## 16. Skills para as próximas etapas

Conferido nesta sessão (lista de skills do Claude Code no ambiente):

| Skill | Situação | Uso recomendado |
|---|---|---|
| `frontend-design:frontend-design` | Disponível | **Principal da Etapa 2** (design das telas do portal e da recepção) e da parte visual da Etapa 3. Não usada nesta etapa |
| `playwright-ui-form-best-practices` | Disponível (do projeto) | Testes de tela da Etapa 3: fluxo completo, formulários, "Voltar", dados preservados após erro, 390 px e 1280 px |
| Ferramentas Playwright (MCP `mcp__playwright__*`) | Disponíveis | Capturas, navegação e conferência das telas na Etapa 2 (protótipos) e 3 |
| `artifact-design` / `artifact-diagramming` | Disponíveis | Página de apresentação comercial e diagramas de fluxo para a reunião (Etapa 2) |
| `dataviz` | Disponível | Telas de Métricas do portal (funil, conversão) |
| `run` | Disponível | Subir o app local para ver as telas |
| `code-review`, `security-review`, `simplify` | Disponíveis | Revisão de cada fase da Etapa 3 (segurança do portal, sobretudo F2) |
| UX/UI dedicada, acessibilidade (WCAG), formulários de conversão | **Não encontradas** | Pode-se instalar uma skill de acessibilidade/auditoria WCAG; enquanto isso, os requisitos estão na especificação das telas e a conferência é feita com Playwright (foco, rótulos, contraste) |

Sequência: Etapa 2 → `frontend-design` (telas) + Playwright MCP (capturas em 390/1280 px) + `artifact-design` (apresentação).
Etapa 3 → `frontend-design` (implementação visual) + `playwright-ui-form-best-practices` (testes por fase) +
`security-review` (F2 e F4) + `code-review`.

## 17. Decisões do cliente (08/nov/2026)

Planejamento aprovado pelo cliente em 08/nov; RD1 a RD14 respondidas no mesmo dia, uma por vez.

| # | Pergunta | Decisão |
|---|---|---|
| RD1 | Endereço do portal público (muda a D7: hoje a clínica só é achada pelo token) | **`agendar.recepclinic.com.br/{apelido}`** (subdomínio por função, como a D7 ajustada); apelido escolhido pelo Suporte. Registrar a revisão na D7 ao implementar |
| RD2 | Como comprovar o telefone na entrada direta | **Código de 6 dígitos pelo WhatsApp** (template de autenticação), sem SMS. **Revisto (cliente, 09/nov/2026): o código sai de um número do RecepClinic** (empresa verificada uma vez), não do número da clínica: a Meta recusou o template de autenticação numa conta de empresa não verificada (implementação, seção 14) |
| RD3 | No WhatsApp, "Agendar" vai para o portal ou continua no chat? | **Vai para o portal** com o item Portal ligado; sem ele, como hoje. Remarcar e cancelar seguem no chat |
| RD4 | Prazo da reserva temporária | **5 min, ajustável pelo Suporte (3 a 10)** por clínica |
| RD5 | Quais serviços o portal marca | **Só consultas** (passo "tipo de consulta" só se o profissional tiver mais de uma); retorno e exames pelo bot/recepção |
| RD6 | Horários só para particular ou só para um convênio (ex.: Unimed só à tarde)? | **Começar sem**: todo horário livre vale para particular e para os convênios do médico (como hoje). Perguntar na reunião; se a clínica usar, regra opcional na F6 |
| RD7 | Ordem dos médicos na lista | **Ordem alfabética** (sem ordenar por horário mais próximo) |
| RD8 | Data de nascimento no cadastro novo | **Obrigatória** (idade limite e perfil dependem dela) |
| RD9 | CAPTCHA | **Cloudflare Turnstile, só quando há risco**: entrada direta ao pedir o código ou com sinal de abuso; quem vem do link do WhatsApp não vê |
| RD10 | Antecedência para cancelar/remarcar pelo portal | **A clínica define, padrão 24 h**; dentro do prazo, só "Falar com a recepção" |
| RD11 | Por qual número sai a confirmação de quem marcou pelo portal direto | **Número do médico**; sem ele, o número principal da clínica **Sem efeito nesta entrega (um número só; vários números pendentes, 08/nov).** |
| RD12 | Como mostrar os pacientes de um telefone | **Primeiro nome + inicial do sobrenome**. **Revista pelo cliente em 08/nov (Etapa 2):** nome completo nas telas depois do telefone comprovado (P8 a P10) |
| RD13 | Foto do profissional no portal | **Sempre que houver foto** no cadastro (sem opção por médico). O cadastro avisa "Esta foto aparece no portal de agendamento"; sem foto, iniciais |
| RD14 | Recepção restrita por profissional nas conversas; equipes de recepção | **Mesma restrição da agenda** (médicos liberados à pessoa, padrão todos; número geral: todas veem); sem equipes na 1ª versão. **Revista em 08/nov (rodada 3):** conversa sem profissional; toda a recepção vê todas as conversas; restrição por profissional só na Agenda |

Em aberto para a reunião com a clínica: RD6 (se usam limitação de horário por convênio) e as perguntas do roteiro.
A decidir na F3: se o prazo da RD10 vale também para cancelar pelo WhatsApp.

Fora do código: advogado (termo, política, menores), template de autenticação na Meta, conferência dos limites da Meta
para vários números, preço do item "Portal" e "Vários números" no contrato.

## 18. Etapa 2: design (rodadas)

**Rodada 1 (08/nov/2026), portal no celular, P1 a P10.** Canvas https://claude.ai/artifact/Npzjm2Vixb3UnEuUWfiAmb
(skill `frontend-design`). Base: cores e fontes do link de hoje (verde `#0B7A62`, Bricolage Grotesque nos títulos,
Source Sans 3 a 18 px). Desenho: uma pergunta grande por tela; cabeçalho com Voltar, "Recepção" (WhatsApp) e "Passo n
de 6" com barra; **ficha** verde-clara no topo com as escolhas e "Trocar" (resume em uma linha a partir da P7); barra
fixa embaixo com a escolha e o botão; faixa amarela do horário guardado a partir da P8; na P9 e P10 o cartão com data
e hora em destaque. P3 em duas opções: A (cartão completo, com selos e próximo horário) e B (lista compacta, para
especialidades com muitos médicos). Telas: P1, P2, P3 A/B, P4, P5, P6, P7 (veio do WhatsApp), P7 (celular + código,
com erro), P8 (com carteirinha), P8b (com "Você quis dizer"), P9, P10. Clínica e médicos fictícios.
Escolhas do cliente (08/nov): **P3 mista** (cartão A até 5 médicos na especialidade, lista B com 6 ou mais);
**ficha aprovada** como está; visual geral: **ajustar antes** da próxima rodada. **Ajustes do cliente (08/nov), já no canvas:** P3 sem o botão
"Avisar a recepção" (médico sem horário fica visível só com "Sem horário nos próximos 60 dias", sem toque); **P4
retirada da jornada** (P3 → P5); os dados do profissional da P4 (foto, nome, CRM, especialidades, local com "Ver no
mapa", orientações) entram no topo da P5 e da P6, com "Trocar"; a P6 também mostra a observação do convênio escolhido
e "Ver valores e convênios aceitos" (fechado). **P1 a P6 aprovadas pelo cliente (08/nov).** P7 em diante: em avaliação.
**P7, código (cliente, 08/nov):** link do WhatsApp não pede código (número já comprovado); entrada direta pede celular
e código. "Usar outro número" no caminho do WhatsApp manda o código ao número novo, com a saída "Continuar com o
final 4321" para quem não está com aquele celular (volta ao número da conversa sem perder as escolhas).
**P7 do WhatsApp retirada (cliente, 08/nov):** quem vem pelo link vai da P6 direto à P8, que mostra no topo
"Confirmação no WhatsApp final 4321" com "Usar outro número" (abre a tela do código para o número novo). A P7 com
celular e código fica só para a entrada direta. **P7, "Outro número" e P8 aprovadas (08/nov).**
**Ajustes de P8b a P10 (cliente, 08/nov):** nome completo do paciente nas telas (revisão da RD12); P8b confere
duplicado por **nome parecido + data de nascimento** entre os pacientes do número: mesma data → "Já existe um
cadastro neste número: {nome completo}, nascido em {data}. É ele?"; data diferente → mostra a data cadastrada e a
digitada, "Sim, é ele (manter {data})" / "Não, é outra pessoa". Data errada: bloqueia data impossível (dia do mês,
futura, ano com 4 números, mais de 110 anos), mostra a data por extenso com a idade abaixo dos campos e de novo na P9
(com Alterar). "Seu nome" só aparece quando o número não tem cadastro. **Data diferente com "Sim, é ele" (cliente, 08/nov):** vale a
data cadastrada; a consulta vai para o cadastro existente e a recepção vê o selo "Data informada diferente no portal"
(R4) para conferir com o paciente. **Terceira opção (cliente, 08/nov):** "É ele, mas a data certa é {digitada}" → aviso
"Vamos marcar a consulta no cadastro de {nome completo}. Para corrigir a data de nascimento do cadastro, fale com a
recepção no dia da consulta. Avisamos a recepção que você informou {data}." (o portal não altera o cadastro; o selo
leva a data informada). **Rodada 1 aprovada pelo cliente (08/nov): P1 a P10 no celular.**

**Rodada 2 (08/nov/2026), portal no computador + P11 a P13 no celular.** Mesmo canvas. Computador (1280 px): P1, P3,
P6 e P9 numa coluna de 1040 px; a ficha vira a coluna "Seu agendamento" à direita (itens a escolher em itálico), que
leva também o botão de seguir (no lugar da barra fixa do celular); P3 em duas colunas de cartões; P6 com 7 dias na
faixa e 6 horários por linha; P9 com o cartão de data e hora ao lado das linhas, e o tempo, as orientações e o
Confirmar na coluna da direita. Celular: P11 em folha sobre a tela (mensagem pronta com o código da sessão, botão
"Abrir conversa no WhatsApp", telefone da recepção em texto); P12 com as consultas do número (nome completo,
Remarcar/Cancelar; dentro do prazo, só "Falar com a recepção") e a confirmação do cancelamento; P13 "já usado" (só
primeiro nome e data, porque o telefone não foi comprovado) e "vencido". **Complemento pedido pelo cliente (08/nov),
clínica de 18:** no computador, P2 com 12 especialidades em 3 colunas e busca que também acha o médico pelo nome; P3
com 6 ou mais em lista (colunas Médico, Atendimento, Próximo horário; busca pelo nome e filtro de convênio); P7
(celular no computador, código lido no WhatsApp do celular e digitado no computador); P8 (pacientes em 2 colunas;
"Confirmação no WhatsApp final 4321 / Usar outro" na coluna da direita). A ordem é a mesma do celular: P6 → P7 (só sem
link do WhatsApp) → P8/P8b → P9 → P10. **Cliente (08/nov): computador aprovado; P13 "já usado" não mostra nada da
consulta** (só "Ele já foi usado para marcar uma consulta" e o caminho para Minhas consultas, que pede o telefone).
**P11 e P12 aprovadas (08/nov). Desenho do portal fechado (rodadas 1 e 2).**

**Link do profissional (pedido do cliente, 08/nov/2026).** Cada profissional tem um link próprio de agendamento, com a
mesma jornada da clínica sem escolher especialidade e médico; pode ser posto no Instagram ou no site do profissional e
mandado em mensagem de WhatsApp. Desenho no canvas: início do profissional (foto, nome, CRM, especialidades, próximo
horário, "Agendar consulta com a Dra. Ana", valores e convênios, local, orientações) → P5 → P6 → P7 → P8 → P9 → P10,
"Passo n de 4" (3 com um só atendimento), sem "Trocar médico". Clínica de um só profissional (como o piloto): o
endereço da clínica abre direto nessa página. Link compartilhado (Instagram, site, mensagem de WhatsApp) é entrada
direta: pede celular e código; só o link do bot na conversa dispensa o código. **Endereço (cliente, 08/nov): `agendar.recepclinic.com.br/{apelido-da-clínica}/{apelido-do-profissional}`** (ex.:
`/vila-serena/dra-ana-lima`). **Apelido do profissional (cliente, 08/nov): automático e fixo**, montado pelo nome do cadastro na criação
(Dra. Ana Lima → `dra-ana-lima`; nome repetido na clínica ganha `-2`); ninguém muda depois, para o link nunca quebrar.
**Outros médicos (cliente, 08/nov): nunca** aparecem no link do profissional; sem horário, só "Falar com a recepção".
O link (copiar e QR code) aparece no cadastro do profissional e em Configurações › Portal (desenho na rodada 3).

**Rodada 3 (08/nov/2026), painel da recepção (R1 a R7) e onde copiar o link e o QR do profissional.** Mesmo canvas,
mesma cara do painel de hoje (menu lateral, verde `#0B7A62`, Bricolage nos títulos, Source Sans 3), clínica fictícia de
18 profissionais e 3 números. Novo no visual: **selo do número** (quadradinho com iniciais e cor do número + final do
telefone: RG Recepção geral ·· 0001, PM Dr. Paulo Mendes ·· 1234, AL Dra. Ana Lima ·· 5678); **origem** em selo com
contorno (Portal, WhatsApp, Recepção com o nome) e **situação** em selo preenchido, como hoje. Computador (1280 px):
R5 Meu dia (pendências com o profissional, bloco "marcadas pelo portal" com Abrir/Revisado, tabela por profissional);
R1 Conversas (filtros Profissional, Especialidade, Número, Situação, Responsável e "Aguardando"; linha com selo do
número, profissional em foco e "Veio do portal"; faixa fixa "Respondendo pelo número do Dr. Paulo ·· 1234" sobre a
resposta; painel do paciente com horários livres da especialidade e convênio); R1 filtro de profissional aberto
(busca, grupos por especialidade, "com conversa aguardando"); R1 Direcionar a outro profissional (o número não muda);
R3 Agenda em grade (18 colunas agrupadas por especialidade, rolagem só dentro da grade, reserva do portal tracejada
"Em reserva até 10:42", bloqueio hachurado); R3 Próximos horários livres (especialidade, convênio, atendimento, a
partir de; horário abre a Marcar preenchida); R2 Agenda com "Origem: Portal" e o atendimento aberto (origem, quando e
por onde entrou, "Cadastro novo: completar dados", Marcar como revisado); R4 Pacientes, aba "Do portal", e contato com
dependentes e o bloco "Data de nascimento a conferir" (Corrigir / Manter); R5 Métricas › Portal (funil por passo com a
perda, origem, bloqueios, tabela por profissional); R6 Números de WhatsApp (para quem é, padrão, qualidade e limite da
Meta, modelos; regra de qual número sai cada mensagem) e a confirmação de Desconectar com o impacto; R7 Configurações ›
Portal (endereço da clínica com Copiar/QR/Abrir, **lista do link de cada profissional com busca e filtro**,
antecedência, quem aparece, textos do início); folha do QR (Baixar imagem, Imprimir cartaz A4, Copiar link); cadastro
do profissional com o bloco **"Link de agendamento"** no topo (Copiar, QR, Ver como o paciente vê, Mostrar no
portal). Celular (390 px): Meu dia, Conversas, conversa aberta, Agenda de um profissional por vez com "Próximos
horários livres" e o link no cadastro com "Compartilhar". **Aguardando a avaliação do cliente.**
**Revisão da rodada 3, tela por tela (cliente, 08/nov):** **Meu dia:** consulta do portal só aparece quando precisa
da recepção ("Consultas do portal para conferir": cadastro incompleto → Completar dados; data de nascimento diferente
→ Conferir data), e some quando resolvida; **sem "Revisado"** (saiu também do atendimento na Agenda) e sem a coluna
Portal na tabela; o volume do portal fica só em Métricas › Portal. Tabela "Por profissional": **mantida**. **Conversas:** aguardando primeiro (pela espera), depois pela última mensagem; horários
livres da especialidade e do convênio **sempre** no painel do paciente; "Aguardando" como **botão com contador** junto
dos filtros; abas de hoje mantidas (Abertas, Finalizadas, Pessoal e admin.). **Conversa sem profissional (cliente, 08/nov):** a conversa **não é
ligada a profissional** ("profissional em foco" sai da proposta: filtros Profissional e Especialidade, "Direcionar a
outro profissional" e a coluna "aguardando" por profissional no Meu dia); o único vínculo é **com quem está** (o
responsável), além do número em que o paciente escreveu (a resposta sai por ele). Filtros: Responsável, Situação,
Número e Aguardando. **Painel do paciente:** paciente cadastrado → horários dos **profissionais com quem ele já
consulta** (com a última consulta), "Outro horário" em cada um e "Agendar com outro profissional"; sem cadastro →
"Marcar consulta". Tabela "Por profissional" do Meu dia passa a ter: conferir (portal), cancelamentos, a confirmar e
atendimentos de hoje. **RD14 revista (cliente, 08/nov):** sem profissional na conversa, **toda a recepção vê todas as conversas**
de todos os números (o filtro Responsável separa o trabalho); a restrição por profissional fica só na Agenda. **Agenda em grade (cliente, 08/nov):** mostra **sempre todas as agendas a que a pessoa
tem acesso**; para estreitar, a pessoa escolhe a especialidade ou o profissional (sem "só quem atende hoje" e sem
lembrar filtro); **barra de rolagem em destaque** no topo da grade (setas, trilho largo, "Profissionais 1 a 7 de 18") e
botão "Mais 11" na borda direita. Desenhada também a agenda de **clínica pequena** (2 profissionais e Exames): colunas
na largura toda, sem rolagem, só o filtro "Agenda" como hoje. **Filtros da Agenda (cliente, 08/nov):** até 7 agendas (cabem sem
rolagem), só o filtro "Agenda"; a partir de 8, Especialidade e Profissional, **um de cada vez** (ou todos), com a barra
de rolagem. **Filtro "Origem" retirado:** a origem aparece no selo do atendimento (Portal, WhatsApp · bot, Recepção ·
nome) e o volume fica em Métricas. Agenda da clínica pequena **aprovada**. **Próximos horários livres:** filtros Especialidade, Atendimento e "A partir de" (**sem
convênio**; cada profissional mostra os convênios que atende); os **2 primeiros dias com vaga** de cada um, com "Ver
mais dias"; horário em reserva do portal **aparece apagado**, sem marcar. **Atendimento aberto na grade (cliente, 08/nov):** clicar num atendimento abre
uma **coluna à direita, como hoje**, com "Fechar"; a agenda dele passa para a **primeira coluna** (destacada) e as
outras que couberem continuam visíveis (com a coluna aberta, 4 de 18). **Origem** (Portal · Instagram, WhatsApp · bot,
Recepção · nome) **só nos dados do atendimento**, não na grade. **Sem "completar cadastro":** o portal pega os mesmos
dados do WhatsApp (nome, data de nascimento, telefone e responsável quando precisa) e **não guarda endereço**; saem o
aviso "Cadastro novo: completar dados" e o selo "Dados a completar". No Meu dia, consulta do portal para conferir é só a
de **data de nascimento diferente**. Coluna do atendimento **aprovada**. **Pacientes:** sem a aba "Do portal" (fica como hoje); o selo
"Cadastrado pelo portal" só na ficha; quadro "Data de nascimento a conferir" (Corrigir / Manter) **aprovado**. **Métricas (cliente, 08/nov):** as 5 abas de hoje
ficam (Desempenho, Agendamento digital, Retomar contato, Faltosos, Financeiro; remarcação e cancelamento seguem no
WhatsApp e no Agendamento digital); **aba nova "Portal"** com os números do portal, onde as pessoas param (filtro
"Entrada": link do WhatsApp, link da clínica, link de profissional) e tentativas bloqueadas. **Percentuais de origem
em Desempenho › "De onde vêm as marcações"**: Recepção (painel), WhatsApp (bot marcou), WhatsApp (link do portal na
conversa), Link da clínica e Links dos profissionais, com o detalhe por lugar e a tabela "Pelos links dos
profissionais". **Origem por link marcado:** "Copiar link para…" (Configurações › Portal, cadastro do profissional,
celular) pergunta onde vai usar (Instagram, site, Google, mensagem, outro lugar) e o link leva a marca (`?de=…`); o QR
sai marcado como cartaz; link sem marca conta como "origem não informada". Métricas **aprovadas**. **Vários números de WhatsApp fora desta entrega (cliente,
08/nov):** pendente para planejar depois (seção 10, F4, RD11); saíram do desenho as telas Números de WhatsApp e
Desconectar, o selo do número, o filtro Número e a faixa "Respondendo pelo número" em Conversas. **Onde pegar o link (cliente, 08/nov):** **atalho no Meu dia** para mandar no WhatsApp
("Copiar link" e "Abrir o WhatsApp"): a recepção pega por padrão o **link da clínica** (todos os profissionais); o
profissional, no Meu dia dele, o **próprio link**. Os links marcados para **redes sociais, site e Google** (e o QR)
ficam no **perfil do profissional** ("Meu perfil"), e **cada profissional altera tudo o que é dele** (o Administrador
também). O link da clínica para redes sociais fica em Configurações › Portal. **QR code só pelo botão** (sem QR fixo na tela; a janela tem Baixar imagem e
Imprimir cartaz). **Configurações › Portal aprovada** (item em Atendimento, depois de Convênios). Janela do QR e **Meu perfil** do profissional
**aprovados**. **Celular:** **barra embaixo** com Meu dia, Conversas, Agenda e Pacientes (o resto no menu); Meu dia,
Conversas e conversa aberta **aprovados** (capturas da ajuda do celular a refazer, com autorização, na implementação). Agenda no celular e link no perfil pelo celular **aprovados**.
**Rodada 3 aprovada pelo cliente (08/nov). Desenho da Etapa 2 fechado (portal e painel da recepção).**
