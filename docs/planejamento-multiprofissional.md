# Clínica com vários profissionais: especialidades, convênios e informações do bot por profissional

> **Estado atual (retomar daqui), 07/nov/2026.** Planejamento pedido pelo cliente (07/nov) junto com a revisão da
> NFS-e (seção 14 do [`planejamento-nfse-asaas.md`](planejamento-nfse-asaas.md)). Diagnóstico do código feito; **M1 a M6 decididas** (ME pronta para planejar o código); **M7 e M8
> abertas** (seção 6), uma por vez com o cliente. Sem código antes das decisões e do OK.

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
- **[Hipótese]** remarcar, cancelar e "minhas consultas" continuam mostrando todas as consultas do paciente na clínica
  (não só as do profissional escolhido), para o paciente não precisar voltar ao início; trocar de profissional fica
  como opção no menu ("Escolher outro profissional"). A confirmar no desenho das telas do bot.
- Convênio do paciente filtra os profissionais quando já conhecido.
- Marcação da Recepção e página pública: o mesmo filtro (especialidade, depois profissional).
- Atualiza no mesmo commit o fluxograma de Tecnologia › Jornada do bot (`botJourney.ts`, `JOURNEY_UPDATED`) e as
  capturas afetadas vão para `docs/capturas-pendentes.md`.
- Funil (`bot_funnel_events`) ganha os passos `specialty` e `professional`.
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
| M7 | Ordem das etapas | ME → MC → MI + MB juntas; NFS-e por profissional (seção 14 da NFS-e) em paralelo ao planejamento, código depois da ME |
| M8 | Agenda de exame/equipamento (sem profissional): entra na escolha por especialidade (ex.: "Exames") ou segue no menu de exames? | Segue no menu de exames |

## 7. Etapas

| Etapa | Entrega | Depende de |
|---|---|---|
| ME | Especialidades (lista global do Suporte), vínculo N:N, obrigatória, migração do texto atual, Base de Conhecimento | M1, M2, M6 |
| MC | Convênios por profissional (associação positiva, Recepção mantém, telas, consulta única) | M3, M4, ME |
| MI + MB | Informações do bot por profissional; especialidade → profissional no início do bot, na marcação e na página pública | ME, MC, M8 |

Cada etapa: testes de unidade e de banco, Playwright nas telas (390 px e 1280 px), staging, validação do cliente.
