# Clínica com vários profissionais: especialidades, convênios e informações do bot por profissional

> **Estado atual (retomar daqui), 07/nov/2026.** Planejamento pedido pelo cliente (07/nov) junto com a revisão da
> NFS-e (seção 14 do [`planejamento-nfse-asaas.md`](planejamento-nfse-asaas.md)). Diagnóstico do código feito; **M1 e M2 decididas**; **M3 a M8
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
  nenhum plano. **Ver M3** (migrar as exceções de hoje para "todos os planos menos as exceções").
- **Quem mantém:** a **Recepção (secretária)** passa a cadastrar convênios e associar aos profissionais (pedido do
  cliente); hoje é só o Administrador. Muda a RLS de `insurance_plans` e da associação para `admin` + `reception`, com
  trilha de quem mudou. **Ver M4.**
- **Telas:** Configurações › Convênios (lista; cada convênio mostra quantos profissionais atendem) e, no cadastro do
  profissional, a seção "Convênios atendidos" (só particular / marcar os planos). Atalho "associar a vários
  profissionais" no convênio.
- **Consulta única** `professional_accepts_plan(profissional, plano)` e "profissionais que atendem o plano X na
  especialidade Y", usada pelo bot (resposta "atende o convênio X?"), pela marcação da Recepção (aviso ao escolher
  agenda de quem não atende o plano do paciente) e pela página pública (`publicBooking.ts`).

## 4. Informações do bot por profissional (etapa MI)

- `professional_bot_info` (profissional, formas de pagamento, texto de convênios, observações), todos opcionais: vazio
  = usa o texto da clínica (o de hoje vira o **padrão da clínica**). **Ver M5.**
- A lista de convênios do profissional sai da associação (seção 3); o texto livre fica para observações ("convênio X
  só para consulta, não para retorno").
- No bot, "Informações gerais › Valores/Convênios": com mais de um profissional, pergunta antes **de qual profissional**
  (ou especialidade, depois da etapa MB); com o profissional já citado na mensagem, responde direto.
- Tela: em Configurações › Profissionais, seção "Informações que o bot responde"; em Configurações › Clínica, o bloco
  atual vira "Padrão da clínica".

## 5. Escolha por especialidade no bot e na marcação (etapa MB, depois)

- Bot: **especialidade → profissional → serviço → data e horário**. Pula o passo que tiver uma opção só (clínica de um
  médico continua como hoje). Convênio do paciente filtra os profissionais quando já conhecido.
- Marcação da Recepção e página pública: o mesmo filtro (especialidade, depois profissional).
- Atualiza no mesmo commit o fluxograma de Tecnologia › Jornada do bot (`botJourney.ts`, `JOURNEY_UPDATED`) e as
  capturas afetadas vão para `docs/capturas-pendentes.md`.
- Funil (`bot_funnel_events`) ganha o passo `specialty`.

## 6. Decisões abertas (uma por vez, com o cliente)

| # | Pergunta | Recomendação |
|---|---|---|
| M1 | Especialidades: lista da clínica ou lista global fechada do Suporte? | **Decidido (07/nov): lista global fechada** |
| M2 | Profissional sem especialidade na publicação: pendência visível ou bloqueio? | **Decidido (07/nov): pendência visível; salvar exige** |
| M3 | Exceções de convênio de hoje: converter para a associação positiva (todos menos as exceções)? | Converter |
| M4 | Recepção mantém convênios e associações (hoje só o Administrador)? | Sim, com trilha |
| M5 | Informações do bot: por profissional com o texto da clínica como padrão, ou só por profissional? | Padrão da clínica + texto do profissional |
| M6 | Especialidade obrigatória para todas as profissões (psicólogo, fisioterapeuta) ou só para médico? | Todas (a especialidade é o que o paciente escolhe no bot) |
| M7 | Ordem das etapas | ME → MC → MI → MB; NFS-e por profissional (seção 14 da NFS-e) em paralelo ao planejamento, código depois da ME |
| M8 | Agenda de exame/equipamento (sem profissional): entra na escolha por especialidade (ex.: "Exames") ou segue no menu de exames? | Segue no menu de exames |

## 7. Etapas

| Etapa | Entrega | Depende de |
|---|---|---|
| ME | Especialidades (lista global do Suporte), vínculo N:N, obrigatória, migração do texto atual, Base de Conhecimento | M1, M2, M6 |
| MC | Convênios por profissional (associação positiva, Recepção mantém, telas, consulta única) | M3, M4, ME |
| MI | Informações do bot por profissional | M5, MC |
| MB | Especialidade → profissional no bot, na marcação e na página pública | ME, MC, M8 |

Cada etapa: testes de unidade e de banco, Playwright nas telas (390 px e 1280 px), staging, validação do cliente.
