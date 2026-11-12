# Clínica com vários profissionais: especialidades, convênios e informações do bot por profissional

> **Estado atual (retomar daqui), 07/nov/2026.** ME, MC e MI + MB no staging (cliente valida pelo roteiro da seção 8).
> **MS (S2, S3, S1, S4) feita** (seção 10; migrações `20261230120000` e `20261230130000`), no staging para o cliente
> validar pelo roteiro no fim da seção 10, pela [`frente-validacao.md`](arquivo/frente-validacao.md). Produção só com autorização.
> A NFS-e por profissional (N-P1 a N-P7) segue na frente da nota fiscal ([`planejamento-nfse-asaas.md`](planejamento-nfse-asaas.md)).

Marcas como no plano da NFS-e: **[Código]**, **[Cliente]**, **[Hipótese]**, **[Pendência]**.

**Pedido do cliente (07/nov):** o RecepClinic será usado por clínicas com vários médicos de especialidades diferentes.
(1) Especialidade obrigatória no cadastro do profissional, com uma ou mais especialidades por profissional. (2) Em etapa
posterior, o bot e a marcação escolhem **especialidade → profissional → fluxo atual**. (3) As "Informações que o bot
responde" passam a ser por profissional (particular × convênio). (4) A secretária mantém os convênios e associa os
convênios de cada profissional; bot e marcação consultam essa associação. (5) Nota fiscal e a cobrança dela por
profissional (seção 14 da NFS-e).

## 1. Diagnóstico (conferido no código em 07/nov)

| Tema | Hoje | Onde |
|---|---|---|
| Especialidade | Campo de texto livre e **opcional** `professionals.specialty` (uma só), ao lado de `profession` (obrigatória) | `supabase/migrations/20261004130000_configuracao.sql:120` |
| Dicionário de especialidades | Global, do Suporte (`kb_specialties`: nome canônico + como o paciente fala), usado só pela Base de Conhecimento para reconhecer a pergunta | `20261109120000_base_de_conhecimento.sql:81` |
| Convênios | Cadastro por clínica (`insurance_plans`: nome, outros nomes, código ANS), com o item `insurance` da Matriz | `configuracao.sql:358`, `src/lib/data/config/insurance.ts` |
| Convênio × profissional | **Por exceção:** todo profissional atende todos os planos; `professional_insurance_exclusions` guarda os que ele não atende | `configuracao.sql:373`; usado em `publicBooking.ts:110` e `bot/knowledge/clinicData.ts` |
| Quem mantém convênios | Só o **Administrador** (RLS `enable_clinic_config_rls`: gravação com papel `admin`) | `configuracao.sql:31` |
| Informações do bot | Por clínica: `clinic_settings.bot_payment_info`, `bot_insurance_info`, `bot_notes` (Configurações › Clínica › "Informações que o bot responde") | `configuracao.sql:70`, `src/pages/admin/configuracoes/index.astro:353` |
| Ligação pagamento → profissional | `payments.appointment_id` → `appointments` → `agendas.professional_id` (agenda de equipamento/exame não tem profissional) | `20261012130000_pagamentos.sql:23`, `configuracao.sql:158` |
| Fluxo do bot | Serviço → agenda/profissional → data e horário (sem escolha de especialidade) | `src/lib/data/whatsapp/bot/booking.ts` |

Conclusão: convênio por profissional **já existe pela metade** (exceções, só o Administrador, sem tela pensada para
muitos médicos); especialidade e informações do bot são da clínica inteira.

## 2. Especialidades (etapa ME)

- **Lista global fechada (decidido, cliente, 07/nov, M1):** só o Suporte cadastra as especialidades, no dicionário
  global `kb_specialties` (nome canônico + como o paciente fala: "cardiologista", "médico do coração"), que ganha
  `is_active`. A clínica só escolhe da lista; especialidade nova é pedida ao Suporte. Sem tabela por clínica.
- **Vínculo:** `professional_specialties` (profissional × especialidade do dicionário global, N:N), **pelo menos uma** por profissional
  ativo (conferida no banco e na tela). Ordem: a primeira é a principal (aparece nas listas).
- **Profissional existente:** a migração liga o texto atual de `specialty` à especialidade do dicionário de mesmo nome
  ou sinônimo (texto sem correspondência: lista para o Suporte decidir antes da publicação); quem não tem especialidade fica **pendente**: a tela Profissionais e a lista de
  configuração da clínica mostram "falta a especialidade", e salvar o profissional passa a exigir. Não bloqueia agenda
  nem bot no dia da publicação (**decidido, cliente, 07/nov, M2**).
- **Leitura única:** uma função do banco/servidor devolve "profissionais ativos de uma especialidade" (e o inverso),
  usada pelo bot, pela marcação da Recepção e pela página pública de agendamento, para não espalhar consultas.
- A Base de Conhecimento troca `p.specialty` pelas especialidades vinculadas (`answers.ts:135-159`).

**Feito (07/nov, ME):** `professional_specialties` (posição 0 = principal), `set_professional_specialties` (lista
inteira, ao menos uma, só ativas ou já ligadas, RLS do Administrador), leitura de `kb_specialties` pela equipe e pelo bot,
bloqueio de clínica suspensa, `app.link_legacy_specialties()` (nome ou sinônimo, sem acento; partes por `,` `;` `/`).
`professionals.specialty` fica só como histórico; `Professional.specialty` passa a ser os nomes ligados. Tela: lista com
busca, "Especialidade principal" com duas ou mais, aviso e selo "sem especialidade" (jornada de configuração). Playwright:
achados corrigidos na hora (aviso de busca vazia com uma marcada; principal perdida depois de erro em outro campo).
Captura `config-profissionais` na fila.

## 3. Convênios por profissional (etapa MC)

- **Associação positiva** no lugar da exceção: `professional_insurance_plans` (profissional × plano que ele
  **atende**) e, no profissional, `insurance_mode`: **só particular** | **particular e convênios**. Só particular =
  nenhum plano. **Começar vazio (decidido, cliente, 07/nov, M3):** na publicação todo profissional fica "só
  particular" e `professional_insurance_exclusions` sai; a secretária associa os convênios. **Atenção:** até a
  associação, o bot e a página pública não oferecem convênio: avisar as clínicas com o item `insurance` ligado e
  mostrar a pendência "convênios não associados" na tela Convênios e no Início do Administrador.
- **Quem mantém (decidido, cliente, 07/nov, M4):** o **Administrador** sempre; os demais membros só com a
  permissão **"Cadastrar e associar convênios"**, que o Administrador marca no cadastro da equipe (Configurações ›
  Equipe, por pessoa). **[Código]** hoje a equipe só tem papéis (`clinic_members.roles`) e o alcance das agendas
  (`agenda_scope`), sem permissão avulsa: coluna nova `clinic_members.can_manage_insurance` (padrão desligada) e RLS
  de `insurance_plans` e da associação = `admin` ou membro com a permissão, com trilha de quem mudou.
- **Telas:** Configurações › Convênios (lista; cada convênio mostra quantos profissionais atendem) e, no cadastro do
  profissional, a seção "Convênios atendidos" (só particular / marcar os planos). Atalho "associar a vários
  profissionais" no convênio.
**Feito (07/nov, MC):** `professional_insurance_plans` (vazia na publicação; `professional_insurance_exclusions` apagada),
`clinic_members.can_manage_insurance` + `app.can_manage_insurance()` na RLS de `insurance_plans` e da ligação, trilha
`insurance_change_log` (gatilho; só o Administrador lê). Área "insurance" no acesso: quem tem a permissão vê só
Convênios (menu "Mais" e menu lateral). Telas: Convênios com "Quem atende" e aviso enquanto nenhum plano tem
profissional; plano com "Profissionais que atendem" (marcar); Profissional com "Convênios atendidos"; Equipe com
"Cadastrar e associar convênios". Bot: só planos do caminho (profissional só particular: não pergunta); dúvidas de
convênio dizem com quem. Marcar (Recepção): aviso quando o profissional não atende o plano do paciente. Captura
`config-convenios` na fila.

- **Consulta única** `professional_accepts_plan(profissional, plano)` e "profissionais que atendem o plano X na
  especialidade Y", usada pelo bot (resposta "atende o convênio X?"), pela marcação da Recepção (aviso ao escolher
  agenda de quem não atende o plano do paciente) e pela página pública (`publicBooking.ts`).

## 4. Informações do bot por profissional (etapa MI)

- **Só por profissional (decidido, cliente, 07/nov, M5):** `professional_bot_info` (profissional, formas de pagamento,
  texto de convênios, observações). Sai o texto da clínica (`clinic_settings.bot_payment_info`, `bot_insurance_info`,
  `bot_notes`). Profissional sem texto: o bot não responde aquela informação.
- **Migração [Hipótese]:** o texto atual da clínica é copiado para **cada profissional ativo** (clínica de um
  profissional, como a piloto, não muda nada para o paciente); depois a clínica ajusta o de cada um.
- A lista de convênios do profissional sai da associação (seção 3); o texto livre fica para observações ("convênio X
  só para consulta, não para retorno").
- No bot, as informações respondidas são as **do profissional escolhido no início da conversa** (seção 5).
- Tela: em Configurações › Profissionais, seção "Informações que o bot responde"; o bloco de Configurações › Clínica
  sai (com aviso apontando para Profissionais).

## 5. Escolha da especialidade e do profissional no início do bot (etapa MB)

**Decidido (cliente, 07/nov, junto da M5):**
- **Clínica com um profissional** (como a piloto): **nada muda**; o bot segue como hoje.
- **Clínica com mais de um profissional:** no início da conversa o bot pergunta **a especialidade**, depois mostra
  **os profissionais dela** para escolher; se a especialidade tiver **um só**, só mostra o nome dele (sem pergunta).
  Em seguida, o **menu principal de hoje**, já no contexto daquele profissional: marcação, informações gerais
  (formas de pagamento, convênios, observações dele), remarcar, cancelar etc.
- Especialidade com o mesmo profissional em mais de uma: ele aparece em cada uma.
- **Exames (decidido, cliente, 07/nov, M8):** na pergunta da especialidade aparece também **"Exames"** (só se a
  clínica tiver agenda de exame/equipamento ativa); escolhendo, o bot vai direto ao fluxo de exames de hoje, sem
  escolher profissional.
- **[Hipótese]** remarcar, cancelar e "minhas consultas" continuam mostrando todas as consultas do paciente na clínica
  (não só as do profissional escolhido), para o paciente não precisar voltar ao início; trocar de profissional fica
  como opção no menu ("Escolher outro profissional"). A confirmar no desenho das telas do bot.
- Convênio do paciente filtra os profissionais quando já conhecido.
- Marcação da Recepção e página pública: o mesmo filtro (especialidade, depois profissional).
- Atualiza no mesmo commit o fluxograma de Tecnologia › Jornada do bot (`botJourney.ts`, `JOURNEY_UPDATED`) e as
  capturas afetadas vão para `docs/capturas-pendentes.md`.
- Funil (`bot_funnel_events`): os passos `specialty` e `professional` ficaram para depois (o funil conta as tentativas
  de marcar, que começam no menu).
- **Dependência nova:** como as informações do bot passam a ser só do profissional, a MI precisa da escolha do
  profissional no início: **MI e MB saem juntas** (ver M7).

## 6. Decisões abertas (uma por vez, com o cliente)

| # | Pergunta | Recomendação |
|---|---|---|
| M1 | Especialidades: lista da clínica ou lista global fechada do Suporte? | **Decidido (07/nov): lista global fechada** |
| M2 | Profissional sem especialidade na publicação: pendência visível ou bloqueio? | **Decidido (07/nov): pendência visível; salvar exige** |
| M3 | Exceções de convênio de hoje: converter ou começar vazio? | **Decidido (07/nov): começar vazio** (todos "só particular" até a associação) |
| M4 | Quem mantém convênios e associações? | **Decidido (07/nov): Administrador + quem ele autorizar no cadastro da equipe** |
| M5 | Informações do bot: padrão da clínica + profissional, ou só por profissional? | **Decidido (07/nov): só por profissional**; bot escolhe especialidade e profissional no início (seção 5) |
| M6 | Especialidade obrigatória para todas as profissões ou só para médico? | **Decidido (07/nov): todas** (o Suporte cadastra as de cada profissão) |
| M7 | Ordem das etapas | **Decidido (07/nov): ME → MC → MI + MB**; NFS-e por profissional depois (depende de Asaas, contador e advogado) |
| M8 | Exames (agenda sem profissional) na clínica com vários profissionais | **Decidido (07/nov): opção "Exames" na pergunta da especialidade**, direto ao fluxo de exames |

## 7. Etapas

| Etapa | Entrega | Depende de |
|---|---|---|
| ME | Especialidades (lista global do Suporte), vínculo N:N, obrigatória, migração do texto atual, Base de Conhecimento | M1, M2, M6 |
| MC | Convênios por profissional (associação positiva, Recepção mantém, telas, consulta única) | M3, M4, ME |
| MI + MB | Informações do bot por profissional; especialidade → profissional no início do bot, na marcação e na página pública | ME, MC, M8 |

Cada etapa: telas com a skill `frontend-design`; testes de unidade e de banco e testes de tela com a skill
`playwright-ui-form-best-practices` (390 px e 1280 px); staging; validação do cliente (cliente, 07/nov).

## 8. Feito na MI + MB (07/nov/2026) e roteiro de validação no staging

**MI:** `professional_bot_info` (migração `20261229140000`, com o texto da clínica copiado para cada profissional ativo);
seção "Informações que o bot responde" no cadastro do profissional; o bloco de Configurações › Clínica virou um aviso.
O bot e a Base de Conhecimento usam as informações do profissional em uso; "Convênios" mostra os planos dele (ou "atende
só particular") e o texto dele, só com algum plano ativo na clínica.

**MB:** `bot/professionalScope.ts` e `bot/chooseProfessional.ts`. Clínica com mais de um profissional no bot (com
serviço e horário): boas-vindas → "Para qual especialidade é o atendimento?" (com "Exames" se houver exame na agenda da
equipe; quem está sem especialidade fica em "Outros profissionais"; o nome escrito vale; "Mais opções" acima de 10) →
"Com qual profissional?" (um só: "Atendimento com *Dr. X* (Especialidade).") → menu no contexto dele, com "Outro
profissional". A escolha vale até a conversa recomeçar. Profissional desativado não entra na escolha. Na clínica com
vários profissionais, o "Primeiro horário" entre profissionais deixa de existir no bot (o paciente escolhe antes).
Marcar (Recepção): a especialidade principal ao lado do nome em "Com quem". Jornada do bot atualizada.

**Roteiro (staging):**
1. Profissionais: cadastrar/editar com uma ou mais especialidades e a principal; salvar sem nenhuma dá erro; quem estava
   sem especialidade aparece com o selo.
2. Convênios: plano com "Quem atende"; marcar profissionais no plano e no cadastro do profissional; Equipe › pessoa da
   Recepção › "Cadastrar e associar convênios" e entrar com ela (só Convênios no menu).
3. Profissional › Informações que o bot responde: preencher para dois profissionais com textos diferentes.
4. WhatsApp do número de testes numa clínica com dois profissionais: especialidade → profissional → menu; Informações
   gerais (valores, convênios, outras informações do escolhido); "Outro profissional"; "Exames".
5. Clínica de um profissional (piloto do staging): o bot igual a antes.
6. Marcar (Recepção): paciente com convênio e profissional que não atende o plano mostra o aviso.

## 9. Serviços por profissional (etapa MS, pedido do cliente em 07/nov/2026)

**Pedido:** serviços vinculados ao médico; cada médico tem os próprios serviços, com características (duração, valor,
locais, retorno, preparo) só daquele serviço daquele profissional; na lista de Serviços, com mais de um profissional,
escolher o profissional.

**Hoje [Código]:** o serviço é da clínica e liga a várias agendas (`service_agendas`, N:N); duração, valor, retorno,
preparo e locais (com valor por local, `service_locations`) são do serviço, iguais para todas as agendas. Ex.: no seed,
"Avaliação inicial" é de Marina e Rafael ao mesmo tempo. Exames da agenda da equipe não têm profissional.

**Proposta:** o serviço passa a ter **um dono**: um profissional (`services.professional_id`) ou a **equipe** (exames na
agenda sem profissional). Tudo o que é do serviço vale só para ele. Serviço usado por vários profissionais hoje vira
uma cópia por profissional, com as mesmas características (ver S2). O bot, a página de agendar e a Marcar já trabalham
por agenda: com um dono só, o "Com quem" do serviço deixa de existir (já é do profissional escolhido).

**Decisões (uma por vez):**

| # | Pergunta | Recomendação |
|---|---|---|
| S1 | Quem cadastra o serviço do profissional? | **Decidido (07/nov): Administrador e o próprio profissional (só os dele)** |
| S2 | Serviço de vários profissionais hoje | **Decidido (07/nov): copiar para cada um**, com as mesmas características; atendimentos e horários próprios do serviço vão para a cópia do profissional da agenda |
| S3 | Exames da agenda da equipe | **Decidido (07/nov): serviços da equipe** (sem profissional; só o Administrador; no bot, em "Exames") |
| S4 | Lista de Serviços com vários profissionais | **Decidido (07/nov): opção D, busca de profissional** (um campo com sugestões agrupadas por especialidade e quantos serviços cada um tem; a lista mostra só os serviços do escolhido; a última escolha fica lembrada; o profissional com login vê só os dele). Desenhos: canvas "Serviços por profissional (S4)" |

**Decisões da implementação (cliente, 07/nov):**

- **Ordem:** S2 → S3 → S1 → S4, uma etapa por vez, sem parar; staging depois da S4 para o cliente validar.
- **Serviço sem nenhuma agenda** (na migração): com um profissional só na clínica, vai para ele; com vários, é
  **desativado** e o Administrador reativa escolhendo o dono.
- **O dono não muda** depois de criado (como a categoria); para outro profissional, cadastra-se um serviço novo.
- **S1, alcance do profissional com login:** em Configurações o menu mostra só o que é dele, em 4 telas:
  Profissionais (só o próprio cadastro: dados, especialidades, convênios que atende, informações do bot), Agenda (só a
  dele), Horários (só os da agenda dele) e Serviços (cadastrar, editar, desativar os dele). Desativar o próprio
  cadastro ou a agenda, Equipe/login, Locais, Feriados e o resto da clínica seguem só com o Administrador.
- **Marcar (Recepção): opção A** do canvas "Marcar com serviços por profissional (MS)": passo "Com quem" antes do
  serviço, com busca por profissional ou especialidade (e "Equipe (exames)"); depois só os serviços do escolhido. Sai o
  "Primeiro horário disponível" entre profissionais (como no bot); com um profissional só, o passo já vem escolhido.

## 10. Feito na MS (07/nov/2026)

**S2, dono do serviço e cópias** (migração `20261230120000`): `services.professional_id` e `services.is_team` (dono
fixo; o banco liga o serviço à agenda do dono e recusa outra agenda). Serviço que estava em várias agendas virou uma
cópia por agenda (fica com a de mais atendimentos), com atendimentos, séries, horários próprios, links e vagas da lista
de espera da agenda; sem agenda: o profissional único da clínica ou desativado sem dono. Cadastro do serviço com
"Profissional" (por especialidade, "Equipe (exames)" só no exame; fixo depois); lista com a coluna Profissional; Marcar
na opção A ("Com quem" com busca antes do serviço). Migrar agenda (cliente, 07/nov): vai para o serviço de mesmo nome e
tipo do novo profissional ou cria a cópia. Bot: as cópias de mesmo nome viram uma opção, e a agenda escolhida segue com
a cópia dela (sem "Primeiro horário" entre cópias). Marcar fecha os links pendentes das cópias do mesmo serviço.
Importação da agenda: nome repetido leva a agenda. Arquivo do preparo compartilhado só sai sem uso.

**S3, serviços da equipe:** exame com "Equipe (exames)" como dono (só exame; o banco recusa outro tipo e a tela tira a
equipe ao trocar o tipo); na Marcar, "Equipe (exames)" mostra só os exames dela; no bot, "Exames" lista só os exames
da equipe (o exame de um profissional fica no menu dele). Só o Administrador grava (a RLS do S1 libera ao profissional
só os serviços dele).

**S1, o profissional configura o que é dele** (migração `20261230130000`): o profissional com login (cadastro ligado
em Equipe) entra em Configurações (item no "Mais") com Meu cadastro (dados, especialidades, convênios que atende,
informações do bot), Minha agenda (o intervalo), Horários (só os da agenda dele) e Meus serviços (cadastrar, editar,
desativar; o novo já é dele). Sem Desativar no cadastro e na agenda, sem Migrar, sem criar profissional ou agenda;
cadastro, agenda ou serviço de outro voltam para o dele. No banco: políticas `*_own` (só o que é dele) e o gatilho que
barra desativar o cadastro, mudar o login e mudar a agenda além do intervalo. Equipe, Locais, Feriados e o resto da
clínica seguem só com o Administrador.

**S4, lista de Serviços com busca de profissional (opção D):** com mais de um dono, a lista abre em "De qual
profissional?" (busca por nome ou especialidade, grupos pela especialidade principal, quantos serviços cada um tem,
"Equipe (exames)" e "Sem profissional (desativados)" quando houver); escolhido, só os serviços dele, com "Trocar de
profissional"; a escolha fica lembrada neste navegador (cookie de 180 dias) e "Novo serviço" já vem com ele. Clínica com
um dono só: a lista direto. O profissional com login vê só os dele (S1). A busca é o componente `OwnerPicker`, o mesmo
da Marcar.

**Roteiro de validação no staging (MS):**
1. Configurações › Serviços (Administrador): "De qual profissional?", busca por especialidade, escolher, Trocar; a
   escolha lembrada ao voltar; "Novo serviço" já com o profissional; "Equipe (exames)" só no tipo Exame.
2. Serviço que era de vários profissionais: uma cópia em cada, com os atendimentos de cada agenda.
3. Agenda › Marcar: "Com quem" (busca) antes do serviço; só os serviços do escolhido; Trocar.
4. Agendas › Migrar: a prévia diz o serviço que recebe ou "cria a cópia".
5. Profissional com login (Equipe › pessoa ligada a um profissional): Configurações com Meu cadastro, Minha agenda,
   Horários e Meus serviços; serviço novo já dele; sem Desativar nem Migrar.
6. WhatsApp: clínica com vários profissionais — "Exames" só com os exames da equipe; clínica de um profissional — igual
   a antes.

## 11. Ajuste da validação (cliente, 08/nov/2026): escolha do profissional em Configurações

- **Serviços e Horários**, com mais de um profissional: a mesma busca de profissional (`OwnerPicker`), com a
  especialidade (o grupo) em negrito. Pelo menu, nada vem escolhido: a escolha é obrigatória. Só vem escolhido quando
  outra tela manda para um profissional (`?profissional=` em Serviços, `?agenda=` em Horários), como a volta de um
  serviço, "Cadastrar os horários" da agenda ou do serviço. A escolha **não fica mais lembrada** (o cookie de 180 dias
  da S4 saiu). Em Horários, a lista suspensa de agendas virou "De qual profissional?" e a barra "Profissional: … ·
  Trocar de profissional"; agenda de profissional desativado fica em "Outras agendas".
- **Agendas e Profissionais:** a lista fica como estava, com "Buscar agenda" / "Buscar profissional" acima dela a partir
  de 6 cadastros (`LIST_FILTER_FROM`), filtrando sem acento pelo nome, profissional, especialidade ou registro.
- As abas Ativos/Desativados de Serviços mantêm o profissional escolhido.

**Roteiro (staging):** Serviços e Horários pelo menu pedem o profissional; escolher, abrir um serviço e voltar (volta no
mesmo profissional); sair e entrar pelo menu (pede de novo); Agenda › "Cadastrar os horários" abre Horários já
escolhido; grupos da busca em negrito; em clínica com 6+ profissionais, o filtro de Agendas e Profissionais.

## 12. Perfil, prazo e idade limite por profissional (cliente, 08/nov/2026; item 4 da validação)

**Pedido:** "Perfil", "Prazo para oferecer horários" e "Idade limite para consulta" saem de Configurações › Clínica e
passam a ser de cada profissional.

**Decisões do cliente (08/nov):**
1. Palavras das telas da clínica inteira: **calculadas** pelos perfis (todos Pediátrica: criança/responsável; todos
   Adultos: paciente/contato; diferentes: paciente/responsável). Bot e link de agendar usam o perfil do profissional.
2. Equipe (agenda "Exames"): **valores próprios** (perfil e prazo; sem idade limite, pois só faz exame), no cartão
   Atendimento da agenda da Equipe.
3. Ficha do paciente: **sai** o aviso de idade limite. Cadastro de paciente novo: **sai** também. Fica no Marcar e no bot.
4. Onde editar: cartão **Atendimento no cadastro do profissional** (sem agenda: o cartão pede para criar).
5. O profissional com login **muda os dele** (como o resto do cadastro, S1).

**Como ficou:**
- Migração `20270101140000_atendimento_por_profissional.sql`: `agendas.profile`, `booking_horizon_days` e
  `consultation_age_limit_years` (cópia dos valores da clínica; a da Equipe sem idade limite); gatilho que recalcula
  `clinic_settings.profile` a cada mudança de perfil ou ativação de agenda; agenda nova nasce com o perfil da clínica,
  60 dias e sem idade limite.
- Bot: perfil, palavras e Informações gerais pelo profissional em uso (`scopeAttendance`); cada marcação usa o prazo e
  a idade limite da agenda (no "Primeiro horário", os comuns às agendas). Link de agendar: prazo e perfil da agenda (com
  mais de uma, o maior prazo e o perfil comum). Marcar: aviso com a idade limite de cada agenda do serviço. Importação
  de agenda: idade limite da agenda de cada atendimento.
- **Pendente (limpeza):** `clinic_settings.booking_horizon_days` e `consultation_age_limit_years` ficam sem uso; saem
  numa migração depois da produção.

**Roteiro no staging:**
1. Configurações › Clínica: o cartão Atendimento mostra só o fuso e as palavras das telas.
2. Configurações › Profissionais › um profissional: cartão Atendimento com os valores de antes da clínica. Mude o
   perfil para Adultos, o prazo para 30 e desligue a idade limite; salve.
3. Volte à Clínica: com perfis diferentes, as palavras viram "paciente" e "responsável".
4. Configurações › Agendas › Exames: cartão Atendimento sem idade limite; mude o prazo e salve.
5. Agenda › Marcar: paciente adulto + consulta de um profissional com idade limite: o aviso cita o profissional.
6. Ficha do paciente acima da idade: sem o aviso.
7. WhatsApp: com o prazo de 30 dias, o bot só oferece horários até 30 dias; com perfil Pediátrica, a consulta não
   pergunta "para quem é".

## 13. Exame só na agenda de Exames (cliente, 08/nov/2026; item 3 da validação)

**Pedido:** com mais de um profissional, o menu do profissional não oferece exames (estão em "Exames", na pergunta da
especialidade) e as Informações gerais dele não trazem valores nem informações de exame.

**Decisões do cliente (08/nov):**
1. "Exames será sempre na agenda de exames. O profissional faz parte da equipe e a equipe se organiza junto com os
   profissionais para tratar os exames." O profissional que tenta cadastrar exame recebe o aviso.
2. Vale para **todas** as clínicas, também as de um profissional só.
3. Os exames que já estavam na agenda de um profissional **passam para a agenda de Exames**, com os horários e os
   atendimentos futuros.

**Como ficou:**
- Migração `20270101150000_exame_so_na_agenda_de_exames.sql`: move cada exame de profissional para a agenda de Exames
  (criada ou reativada onde faltar): horários só dele, cópia dos horários "todos os serviços" da agenda do profissional
  (só para o exame), atendimentos futuros, séries em andamento e links. O histórico fica. Daqui em diante, o banco
  recusa exame de profissional (`services_exam_team_only`).
- Serviço novo: tipo Exame põe "Equipe (exames)" e desabilita os profissionais, com o aviso; o servidor recusa e mostra
  a mensagem no campo Tipo.
- Bot: o catálogo do profissional escolhido fica sem exames (menu e Informações gerais); "quero marcar exame" com um
  profissional escolhido passa para "Exames".
- Staging, antes da migração: Odonto Sorriso Leve, Clareamento, Limpeza e Restauração (19 atendimentos futuros); Clínica
  Exemplo Saúde, Espirometria e Exame com Arquivo (desativados). **Produção:** listar antes de aplicar (o Claude mostra
  a lista ao cliente).

**Roteiro no staging:**
1. Odonto Sorriso Leve › Configurações › Serviços: Clareamento, Limpeza e Restauração em "Equipe (exames)"; Horários da
   agenda Exames com os horários copiados; Agenda: os atendimentos futuros desses exames na agenda Exames.
2. Novo serviço, tipo Exame: o profissional vira "Equipe (exames)" e aparece o aviso.
3. WhatsApp (clínica com mais de um profissional): escolhido o profissional, o menu fica sem "Exames"; Informações
   gerais › Valores sem exames; "quero marcar exame" leva aos exames.

