# Diagnóstico para a evolução: recepção digital integrada

> **Etapa 1 (planejamento), 08/nov/2026.** Conferido no código da `main` em `14d0dd8`. Nenhum código, tabela, RLS ou
> integração foi alterado. Documentos irmãos: [`proposta-recepcao-digital-integrada.md`](proposta-recepcao-digital-integrada.md),
> [`especificacao-telas-portal-e-recepcao.md`](especificacao-telas-portal-e-recepcao.md),
> [`roteiro-apresentacao-clinica-18-profissionais.md`](roteiro-apresentacao-clinica-18-profissionais.md).

Marcas: **[Código]** conferido no repositório; **[Doc]** decisão registrada em `docs/`; **[Hipótese]** conclusão técnica
sem confirmação; **[Pendência]** a confirmar (cliente, Meta, advogado).

**Atenção sobre os ambientes.** O bloco multiprofissional (especialidades, convênios, informações do bot e serviços por
profissional, perfil e prazo por profissional, fotos) está na `main` e no **staging**, aguardando a validação do
cliente; **a produção ainda não tem esse bloco** ([`frente-validacao.md`](frente-validacao.md)). Neste documento, "existe"
quer dizer "existe na `main`"; o que só está no staging vem marcado como **(staging)**.

## 1. Arquitetura atual

| Camada | Como é | Onde |
|---|---|---|
| Aplicação | Astro 7 com renderização no servidor (`@astrojs/vercel`), Tailwind 4, TypeScript. Páginas `.astro` com formulários `POST` e pouco JavaScript no navegador | `astro.config.mjs`, `src/pages/` |
| Hospedagem | Vercel (região `gru1`): `app.recepclinic.com.br` (produção, branch `producao`) e `teste.recepclinic.com.br` (staging, `main`) | `vercel.json`, [`producao.md`](producao.md) |
| Banco | Supabase (Postgres) com RLS por clínica (D1), 149 migrações versionadas pela CLI | `supabase/migrations/` |
| Acesso ao banco | Concentrado por domínio em `src/lib/data/` (agenda, pacientes, WhatsApp, financeiro…). Login da equipe usa a credencial do usuário (RLS); bot, rotinas e páginas públicas usam a **credencial limitada à clínica** (`createClinicServiceClient`) | `src/lib/data/clients.ts`, `clinicService.ts` |
| Rotinas | `pg_cron` chamando `/api/cron/*` (lembretes, resumo do dia, reenvios, mídias, faturamento) | `src/pages/api/cron/` |
| WhatsApp | Cloud API direta, RecepClinic como **Tech Provider** (aprovado em 27/out), Embedded Signup com coexistência, token por clínica no Vault | D3a, `src/lib/data/whatsapp/` |
| Testes | Vitest de unidade (`npm test`) e de banco (`npm run test:db`), Playwright disponível (dependência e MCP) | `tests/db`, `*.test.ts` |
| Pagamentos/fiscal | Asaas (faturamento do SaaS; NFS-e das clínicas na branch `nota-fiscal`, fora da `main`) | D13 |

Decisões que esta evolução precisa respeitar ou rever: D1 (isolamento), D2 (agendas), D3 (WhatsApp por clínica), D4
(genérico, perfil por profissional desde 08/nov), D6 (papéis e acesso por agenda), D7 (domínio único, clínica pelo
token), D10 (convênios), D11 (matriz de acesso), D12 (texto das conversas só com a Central). Ver
[`arquitetura.md`](arquitetura.md).

## 2. Modelo de dados atual (o que importa para a evolução)

```
clinics ─┬─ clinic_members (user_id, roles[admin|professional|reception], agenda_scope, can_manage_insurance, photo)
         │      └─ member_agenda_grants (agendas liberadas à pessoa)
         ├─ professionals (nome, profissão, conselho/número/UF, photo_path, user_id opcional)
         │      ├─ professional_specialties ─▶ kb_specialties (lista global do Suporte)      (staging)
         │      ├─ professional_insurance_plans ─▶ insurance_plans (convênios da clínica)   (staging)
         │      └─ professional_bot_info (pagamento, convênios, observações)                 (staging)
         ├─ agendas (uma por profissional + no máx. uma "Exames" da equipe; perfil, prazo, idade limite)
         ├─ services (dono: professional_id ou is_team; duração, preço, categoria consulta|retorno|exame) (staging)
         │      └─ service_locations, service_agendas (espelho do dono), availability_windows
         ├─ locations (consultório | domiciliar)
         ├─ contacts (quem fala no WhatsApp: nome, telefone único na clínica)
         │      └─ patients (nome, nascimento obrigatório, is_contact_self, convênio, carteirinha)
         ├─ appointments (paciente, serviço, agenda, local, horário, status, booking_channel admin|whatsapp_bot,
         │               insurance_plan_id, price_cents; trava de sobreposição por agenda no banco)
         ├─ booking_links (link de agendar/remarcar: contato, paciente, serviço, agenda opcional, validade, uso único)
         ├─ whatsapp_connections (PK = clinic_id: UMA conexão por clínica)
         ├─ conversation_state (uma conversa por clínica + telefone; estado do bot, handoff, responsável)
         ├─ whatsapp_messages, whatsapp_media, handoff_events, conversation_reads, conversation_access_log
         ├─ whatsapp_templates (por clínica)
         └─ contact_finance / patient_finance / payments (CPF só aqui, na parte financeira)
```

Pontos conferidos:

- **Contato → pacientes já existe** [Código: `20261004140000_pacientes.sql`]. O contato é o dono do telefone; cada
  paciente tem `is_contact_self` (o próprio contato) ou não (filho, dependente). Um contato cuida de vários pacientes
  (D4a). É exatamente o "responsável e dependentes" pedido; o que falta é a experiência no portal.
- **Telefone é o identificador** [Código]: `contacts.phone` único por clínica (`unique (clinic_id, phone)`), formato
  E.164. Não há CPF em `contacts` nem em `patients`.
- **CPF já fica separado** [Código: `20261012120000_modulo_financeiro.sql`]: `contact_finance.cpf`,
  `patient_finance.cpf` e `payments.payer_cpf`, com validação, RLS própria e uso só no financeiro e na NFS-e. A regra
  "CPF só na emissão fiscal" já é a do produto; a tela de pagamento pede o CPF quando falta (`20261017120000_falta_cpf.sql`).
- **Trava de horário no banco** [Código: `20261030120000_exame_em_paralelo.sql`]: restrição `exclude using gist` por
  agenda e período, para atendimentos ativos (exceto exames em paralelo). Dois pedidos para o mesmo horário: o banco
  aceita um e recusa o outro. É a base da concorrência do portal.
- **Uma conexão de WhatsApp por clínica** [Código: `whatsapp_connections.clinic_id` é a chave primária]; o webhook
  acha a clínica pelo `phone_number_id`; o envio (`clinicSenderFor(clinicId)`) usa a conexão da clínica.
- **Conversa = clínica + telefone** [Código: `conversation_state unique (clinic_id, contact_phone)`]. Com dois números
  na mesma clínica, o mesmo paciente falando com os dois cairia na mesma conversa: precisa mudar (seção 5).
- **Canal do atendimento** [Código: enum `action_channel` = `admin` | `whatsapp_bot`]. O link de agendar grava
  `whatsapp_bot` (com a trilha `booking_link`). Não há valor para "portal".

## 3. Funcionalidades: classificação

### 3.1 Já existentes e funcionais (produção)

| Funcionalidade | Onde |
|---|---|
| Painel da recepção: Início, Agenda (Dia, Semana, Mês, com escolha das agendas exibidas), Marcar, Remarcar, Bloquear, Trilha, Lista de espera | `src/pages/admin/agenda*` |
| Pacientes e contatos, com dependentes (contato → pacientes), busca por nome parecido, anotações, lembretes e documentos do paciente | `src/pages/admin/pacientes/`, `patientNotes.ts`, `patientDocuments.ts` |
| Bot determinístico no WhatsApp: menu, marcar, remarcar, cancelar, retorno, exames, informações, falar com a recepção, Base de Conhecimento (dicionário de termos, sem IA) | `src/lib/data/whatsapp/bot/` |
| Link de agendar/remarcar com token opaco (UUID aleatório em 22 caracteres), validade de 30 min, uso único, marca da clínica, horários reais por agenda | `src/pages/agendar/[token].astro`, `publicBooking.ts`, `publicId.ts` |
| Confirmação pelo WhatsApp depois de marcar, reenvio automático de falhas (30 s e 2 min), aviso de falha na Agenda | `notices.ts`, `retries.ts`, [`falhas-de-envio.md`](falhas-de-envio.md) |
| Lembrete da véspera com Confirmar / Remarcar / Cancelar | `reminders.ts` |
| Pedido não concluído: link vencido sem marcação recebe "Não concluímos a marcação de *X*" com [Novo link] [Falar com a recepção] [Desistir] | [`pedido-nao-concluido.md`](pedido-nao-concluido.md), `bot/notCompleted.ts` |
| Limites contra abuso no bot: atendimentos futuros, pacientes novos em 30 dias e faltas em 90 dias por contato; "Contatos para revisar" | `botLimits.ts` |
| Central de Atendimento (item da Matriz): conversas no painel, assumir, transferir, responder, mídias, não lidas por pessoa, leitura registrada | [`planejamento-central-atendimento.md`](planejamento-central-atendimento.md), `src/pages/admin/conversas.astro` |
| Papéis Administrador / Profissional / Recepção / Suporte; acesso por agenda; matriz de funções por clínica; limite de profissionais ativos | D6, D11 |
| Funil do bot e Métricas (Visão geral, Atendimentos, Faltosos, Funil, Financeiro) | `botFunnel.ts`, `metrics.ts` |
| Marca da clínica nas páginas públicas (nome, logo, cor) | `config/brand.ts` |
| Auditoria: trilha do atendimento, acessos do Suporte, leitura de conversas, mudanças de convênio | `appointment_events`, `platform_access_log`, `conversation_access_log` |
| Anonimização de paciente/contato a pedido (LGPD) | `anonymization.ts` |

### 3.2 Existentes, mas precisam evoluir

| Funcionalidade | Hoje | O que falta |
|---|---|---|
| Vários profissionais **(staging)** | Especialidades (lista global), convênios por profissional (associação positiva), serviços por profissional, informações do bot por profissional, perfil/prazo/idade por profissional, foto no cadastro | Validar e publicar; mostrar foto e especialidade nas telas públicas; observações por convênio (autorização, encaminhamento) |
| Bot com escolha especialidade → profissional **(staging)** | Clínica com 2+ profissionais: especialidade → profissional → menu no contexto dele | Opção de mandar para o portal em vez de seguir no chat; número próprio do profissional pula a escolha |
| Link de agendar | Exige contato e paciente já identificados no chat (`booking_links.patient_id not null`) e um serviço escolhido; o paciente só escolhe data e horário | Portal com a jornada inteira (especialidade, profissional, modalidade, horário, identificação) e entrada sem WhatsApp |
| Convênio na marcação | O bot pergunta o convênio junto do nome; o link já vem com o plano | Escolha da modalidade **depois do profissional**, no portal; horários por modalidade (não existe regra hoje) |
| Agenda com vários profissionais | Dia mostra um cartão por agenda escolhida (todas por padrão); escolha das agendas no endereço | Com 18 agendas: visão em grade (colunas por profissional), filtro por especialidade, busca, "primeiros horários livres" |
| Conversas (Central) | Uma lista da clínica; filtros Todas/Minhas; Profissional vê só as dele | Filtro por profissional, especialidade, número de origem; conversa ligada a um profissional; Recepção restrita aos profissionais liberados |
| Origem do atendimento | `booking_channel` = `admin` ou `whatsapp_bot` | Valor/trilha para "portal" e origem do acesso (WhatsApp, site, Instagram, Google, direto) |
| Funil | `bot_funnel_events` e `logBookingPageStep` contam passos do link | Funil do portal por etapa, sem dado pessoal |
| Confirmação | Enviada logo depois de gravar, no mesmo pedido; falha vai para o reenvio | Fila com chave de idempotência por atendimento (sem duplicar confirmação) |

### 3.3 Não existem e precisarão ser desenvolvidas

1. **Várias conexões de WhatsApp por clínica** (modelo, Embedded Signup repetido, roteamento, templates por conta).
2. **Portal público da clínica** com endereço fixo (hoje a clínica só é achada pelo token do link, D7).
3. **Jornada completa no portal**: especialidade → profissional → modalidade → horário → telefone → paciente → revisão.
4. **Verificação do telefone** para quem entra direto no portal (código pelo WhatsApp).
5. **Reserva temporária** do horário na revisão, com prazo e liberação automática.
6. **Proteções do portal**: limite de tentativas por IP/telefone/sessão, CAPTCHA adaptativo, bloqueio progressivo,
   monitor de padrões. **Hoje não há limite de requisições nas páginas públicas** [Código: nenhum rate limit em
   `src/pages/api/agendar/`].
7. **"Minhas consultas" no portal** (consultar, remarcar, cancelar com regras de antecedência).
8. **Caixa de entrada com filtros por profissional, especialidade e número.**
9. **Permissão da Recepção por profissional nas conversas** (hoje o acesso por agenda vale só para a agenda).
10. **Métricas do portal** (acessos, origem, conversão, abandono por etapa, tentativas bloqueadas).
11. **Horários por modalidade** (ex.: convênio X só às terças), se a clínica precisar.

### 3.4 Exigem investigação técnica adicional

| Ponto | Por quê |
|---|---|
| Limites da Meta para vários números | Quantos números por conta (WABA) e por portfólio, limite de mensagens (por número ou por portfólio), qualidade do número, coexistência em cada número. Conferir na documentação atual da Meta antes da Fase 2 **[Pendência]** |
| Várias contas (WABAs) e portfólios por clínica | Cada médico pode ter o próprio portfólio; cada conta precisa do conjunto de templates aprovado; inscrição do app no webhook por conta |
| Template de autenticação (código por WhatsApp) | Categoria própria da Meta, com botão de copiar código; custo por mensagem (~R$ 0,035, tabela de 01/out, [`planejamento-central-atendimento.md`](planejamento-central-atendimento.md) seção 15) e quem paga (a clínica paga a Meta) |
| CAPTCHA e CSP | Provedor (ex.: Cloudflare Turnstile) exige liberar o domínio na CSP; a CSP só existe no build (o `npm run dev` não tem CSP; só quebra no staging) |
| Rate limit na Vercel | Sem Redis hoje: contador no Postgres, Vercel Firewall/WAF ou serviço externo |
| Webhook com volume maior | Hoje processa em linha, inclusive o bot; 18 profissionais e vários números aumentam o volume ([`planejamento-central-atendimento.md`](planejamento-central-atendimento.md) seção 7) |
| Agenda em grade com 18 colunas | Desempenho da consulta de horários livres de 18 agendas de uma vez e leitura no celular |

## 4. Limitações técnicas existentes

1. **Uma conexão de WhatsApp por clínica** (chave primária `clinic_id`) e **uma conversa por telefone**. É a maior
   barreira para "cada médico com o seu número".
2. **O portal depende do bot**: o link nasce no chat, com paciente e serviço já escolhidos. Não há entrada pública.
3. **Templates por clínica**, não por conta da Meta: com várias contas, cada uma precisa dos próprios templates.
4. **Recepção vê todas as conversas**; o acesso restrito por agenda não chega à Central.
5. **Nenhum limite de requisições** nas rotas públicas; a defesa atual é o token de 30 min e os limites do bot por contato.
6. **Sem reserva temporária**: entre ver o horário e confirmar, outro pode ocupar; hoje o paciente recebe "horário
   ocupado" (`slot_taken`) e escolhe outro.
7. **O canal "portal" não existe** nos dados; métricas e telas não distinguem.
8. **Disponibilidade não conhece modalidade**: horários são por agenda e serviço; convênio só filtra profissionais.
9. **Preço só do particular** (`services.price_cents`); convênio não tem preço nem condições (D10: fora por enquanto).
10. **Fotos do profissional** ficam num bucket privado com link temporário para a equipe; para o portal público,
    precisam de leitura pública ou URL assinada servida pelo servidor.

## 5. Oportunidades de reaproveitamento

| Peça existente | Uso na evolução |
|---|---|
| Contato → pacientes (`is_contact_self`) | Responsável e dependentes no portal, sem tabela nova |
| `professional_specialties`, `professional_insurance_plans`, `services.professional_id` (staging) | Passos 1 a 4 do portal saem prontos do banco; "consulta única" já pedida no plano multiprofissional |
| `publicBooking.ts` (`listLinkDates`, `listLinkSlots`, `confirmBookingLink`) e `freeSlots.ts` | Motor de horários e confirmação do portal; o portal vira outra "porta" do mesmo motor |
| Trava `appointments_no_overlap` | Garantia atômica de um só atendimento por horário |
| `booking_links` (token opaco, validade, uso único, `funnel_session_id`) | Base do token de sessão do portal (a evoluir para sessão com escopo) |
| `PatientDayStrip`, `PatientSlots`, `PatientLayout`, `LinkNotice`, marca da clínica | Componentes do portal |
| `OwnerPicker` (busca de profissional por nome/especialidade, grupos) | Seleção de profissional na Recepção e no portal |
| Pedido não concluído (PN) | Recuperação de agendamento abandonado vindo do WhatsApp já existe |
| `botLimits` | Mesmos limites para o portal (por contato) |
| Central: `handoff_events`, responsável, transferir | Caixa unificada com filtros novos |
| `member_agenda_grants` / `agenda_scope` | Base para o acesso da Recepção por profissional nas conversas |
| Funil do bot | Modelo para o funil do portal |

## 6. Riscos

| Risco | Efeito | Como tratar |
|---|---|---|
| Mudar `whatsapp_connections` e `conversation_state` com clínicas em produção | Bot, lembretes e Central param se a migração errar | Migração aditiva: chave nova `id`, `connection_id` preenchido com a conexão atual; o código lê pela conexão; clínica de um número não percebe diferença; testes de banco antes |
| Portal aberto a qualquer pessoa | Reservas falsas, robôs, ocupação da agenda | Verificação do telefone, limites, CAPTCHA adaptativo, reserva curta, revisão pela recepção (proposta, seção 9) |
| Mostrar dependentes a quem não é o dono do telefone | Vazamento de dados de menores | Lista só depois do telefone comprovado, com nome parcial; link do WhatsApp com prazo curto |
| Coexistência com vários números | Secretária responde pelo app num número e pelo painel em outro | Conversa sempre ligada à conexão; resposta sempre pela conexão da conversa |
| Custo da Meta por número | Cada número tem a própria cota e a própria cobrança | Calculadora da Central por número; avisar no contrato |
| Bloco multiprofissional ainda não validado | Proposta comercial sobre base não publicada | Validar e publicar antes da demonstração ao vivo, ou demonstrar no staging |
| Escopo grande para uma clínica só | Generalizar por uma demanda | Tudo como item da Matriz (D11); clínica pequena não vê nada novo |

## 7. Impactos nos clientes atuais

- **Clínica de um profissional e um número** (piloto): nada muda se as novas funções ficarem desligadas na Matriz.
  O link de agendar de hoje continua funcionando (a mesma rota, os mesmos tokens).
- **Migrações**: todas aditivas; a conexão existente vira a primeira conexão da clínica; conversas existentes ganham
  a conexão atual.
- **Bot**: o fluxo atual segue como padrão; "mandar para o portal" é opção da clínica.
- **Jornada do bot e capturas da ajuda**: qualquer mudança no bot atualiza `botJourney.ts` no mesmo commit, e telas
  com captura vão para `docs/capturas-pendentes.md` (regras do `CLAUDE.md`).
