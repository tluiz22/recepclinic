# Vários responsáveis por paciente (planejamento, 10/nov/2026)

> **Retomada (planejamento).** Origem: pergunta do cliente na validação da F3 (10/nov; `implementacao-recepcao-digital.md`,
> 15.3.2, item 1 "Usar outro número"). **Decisão do cliente (10/nov):** um paciente pode ter mais de um responsável,
> cada um com o seu número; a recepção liga outro responsável à ficha; bot e portal reconhecem o paciente pelos números
> ligados; ninguém se liga sozinho pelo portal.
> - **Feito (10/nov):** levantamento do impacto no código (seção 3), modelo (seção 4), **decisões VR-1 a VR-7**
>   (seção 5) e **telas UI-1 a UI-6** (seção 6, canvas aprovado tela a tela), **D14** em [`arquitetura.md`](arquitetura.md)
>   e as etapas VR1 a VR5 (seção 7).
> - **Próximo:** aprovação do cliente para começar a VR1, **depois da F3f**. Nenhum código, branch ou migração até lá.

## 1. O problema

Hoje cada paciente tem **um** contato (`patients.contact_id`): o número que conversa com a clínica. O portal e o bot
acham os pacientes pelo número comprovado (`phonePatients` → `findContactByPhone` → `listContactPatients`). Quando o
pai marca pelo celular dele o filho que a mãe cadastrou, o número dele não tem cadastro: nasce um contato e uma
**segunda ficha** da mesma criança. A ficha fica dividida:

- histórico, anotações e documentos em duas fichas;
- lembretes e avisos de cada consulta vão para quem é dono da ficha em que ela caiu;
- Minhas consultas: a mãe não vê a consulta que o pai marcou (e o contrário);
- retorno: o direito ao retorno fica na ficha da consulta de origem;
- "uma consulta futura por médico" não percebe a consulta da outra ficha;
- métricas contam dois pacientes.

## 2. Como fica (decisão de 10/nov)

- A ficha do paciente passa a ter **uma lista de responsáveis** (cada um com nome, número e, se a clínica quiser, o
  parentesco: mãe, pai, avó…).
- **Quem liga um responsável é a recepção** (na ficha). No portal ninguém se liga sozinho: o número novo continua
  criando cadastro novo, e a recepção junta depois (seção 5, VR-4).
- O bot e o portal reconhecem o paciente por **qualquer** número ligado: o pai entra no portal pelo celular dele e a
  criança aparece em "Para quem…" e em Minhas consultas.
- Paciente adulto também pode ter outro responsável (ex.: filha que marca para a mãe idosa).

## 3. Impacto no código (levantamento de 10/nov)

Hoje a ligação paciente → número é `patients.contact_id` (um só). Os pontos que dependem dela:

| Área | Onde | O que muda |
|---|---|---|
| **Banco** | `contacts`, `patients` (`20261004140000_pacientes.sql`); `patients_one_contact_self_idx` | Tabela nova de ligação paciente ↔ contato; `contact_id` vira o responsável principal (seção 4) |
| **Cadastro (contato)** | `src/lib/data/patients.ts` (`listContactPatients`, `registerPatient`, `similar_contact_ids`); `/admin/pacientes/contato/[id]` | Página do contato lista também os pacientes em que ele é 2º responsável |
| **Cadastro (paciente)** | `/admin/pacientes/[id].astro` (cartão do contato, linha 280; "WhatsApp do contato"; Editar), `novo.astro`, `api/admin/pacientes/[id].ts` | Lista de responsáveis com "Adicionar responsável", "Tornar principal", "Desligar" (com confirmação, regra da Agenda) |
| **Bot** | `bot/manage.ts` (`patients.contact_id = conversa`: Cancelar, Remarcar, encaixe, oferta de vaga), `bot/booking.ts` (`activePatients`, "para quem"; sai na F3f), `bot/entry.ts`, `bot/notCompleted.ts`, `bot/portalLink.ts` | Consultas e pacientes do número = os de todas as fichas ligadas a ele |
| **Portal** | `portal/booking.ts` (`phonePatients`, `similar_patient_ids`), `myAppointments.ts`, `returnVisit.ts`, `links.ts` (linha 326, remarcar), `reserva.astro` (P8 "Para quem…") | `phonePatients` passa a ler a ligação; "(você)" só no paciente que é o próprio responsável |
| **Lembretes e avisos** | `whatsapp/reminders.ts`, `notices.ts`, `preparation.ts`, `cancelNotice.ts`, `waitlist/entries.ts` e `offers.ts` (todos via `patients ( contacts ( phone ) )`); `reminders.ts:525` confere o número do toque | Para quem vai cada mensagem (VR-1); o toque "Confirmar" vale de qualquer responsável ligado |
| **Consulta** | `appointments` não guarda quem marcou | Coluna nova `booked_by_contact_id` (quem marcou), se VR-1 for "quem marcou" |
| **Limites por telefone** | `botLimits.ts` (consultas futuras, cadastros novos e faltas **por contato**); `portal_hold_slot`/`portal_hold_group_slot` (5 por celular em 24 h); `portal_phone_status` e a faixa da ficha | Como contam com dois números (VR-5); a faixa "Portal bloqueado" lista os celulares de todos os responsáveis |
| **Anonimização (LGPD)** | `anonymize_patient` (`20261009140000_anonimizacao.sql`, atualizada na Central): apaga o contato do paciente e deixa os outros pacientes dele sem telefone | Com vários responsáveis: o que acontece com cada um (VR-6) |
| **Importação** | `agendaImportReview.ts` (um telefone por paciente, acha o contato pelo número) | Coluna opcional de 2º telefone (VR-7) |
| **Financeiro** | `finance.ts` (`payer = "contact"`: responsável financeiro é o contato), `nfseDelivery.ts`, `payments.ts` | "Responsável financeiro" passa a ser o responsável principal (sem decisão nova) |
| **Central e Atendimento** | `central.ts`, `centralPanel.ts`, `attention.ts`, `conversations.ts` (conversa por número) | A conversa do pai mostra a criança (o nome dos pacientes vem da ligação) |
| **Métricas** | `metrics.ts` (faltas frequentes com o contato), `botFunnel.ts`, `metricas_trilha` | Contam por paciente (sem mudança); onde aparece o contato, mostra o principal |
| **Busca e listas** | `searchPatients`, `listPatientsPage`, `people.ts`, Resumo do Dia, Agenda (cartão com "Responsável: …") | Busca pelo número de qualquer responsável; o cartão mostra o principal (ou quem marcou) |
| **Central de Ajuda** | `artigos/pacientes.ts` ("Responsável/contato: quem fala com a clínica", "Ficha do paciente", "Anonimizar"), `faq.ts` | Artigos revistos; captura da ficha na fila (`capturas-pendentes.md`) |
| **Jornada do bot** | `botJourney.ts` | Nota "reconhece por qualquer responsável ligado" |
| **Testes** | `tests/db/isolamento.test.ts` (tabela nova precisa de linha no `seed.sql`), testes do bot, do portal e da anonimização | Novos casos com dois responsáveis |

## 4. Modelo proposto (para a D14)

- **Tabela `patient_contacts`** (clínica, paciente, contato, parentesco opcional, quem ligou e quando), uma linha por
  responsável, única por paciente + contato, isolada por clínica (RLS padrão; o bot lê, não liga).
- **`patients.contact_id` continua** e passa a ser o **responsável principal** (também na tabela). Assim o que hoje lê
  `contact_id` (financeiro, cartões, métricas) segue funcionando, e só o que precisa reconhecer o número (bot, portal,
  mensagens, limites) passa a ler a tabela.
- **`is_contact_self`** segue valendo só para o principal (o paciente é o dono do número).
- **`appointments.booked_by_contact_id`**: quem marcou (bot, portal ou recepção escolhendo o responsável), se a
  decisão VR-1 depender disso.
- **Uma função no banco** `contact_patient_ids(clínica, contato)` que todo o código usa para "pacientes deste número".
- **Sem juntar fichas** (VR-4): ao ligar um número que já cuida de uma ficha parecida, a mesma ação pode desativar a
  repetida (UI-2); nada é movido entre fichas.
- **Quem marcou** muda ao remarcar (UI-4): `booked_by_contact_id` passa a ser quem remarcou.

## 5. Decisões de negócio

| # | Pergunta | Decisão |
|---|---|---|
| VR-1 | Quem recebe lembretes, confirmações e avisos da consulta | **Decidido (cliente, 10/nov): quem marcou.** Lembrete, confirmação, aviso de cancelamento pela clínica, preparo de exame e oferta de vaga vão só para o número que marcou. Marcação pela recepção: ela escolhe o responsável (padrão: o principal). Sem mensagem em dobro na Meta |
| VR-2 | O que cada responsável vê e pode fazer (portal e bot) | **Decidido (cliente, 10/nov): todos veem e mexem.** Qualquer responsável ligado vê todas as consultas do paciente em Minhas consultas e no bot, remarca, cancela e marca retorno. Quem remarcou ou cancelou recebe o aviso, e quem marcou também |
| VR-3 | Responsável principal | **Decidido (cliente, 10/nov): sim, trocável.** O principal é quem cadastrou; aparece primeiro na ficha e nos cartões, é o responsável financeiro e o padrão das mensagens quando a recepção marca. "Tornar principal" na ficha, com confirmação |
| VR-4 | Fichas repetidas: como juntar | **Decidido (cliente, 10/nov): não juntar.** A recepção liga o número do outro responsável na ficha certa e desativa a repetida; histórico, anotações e documentos da desativada não passam; as consultas futuras dela a recepção remarca à mão. Sem ferramenta de juntar e sem aviso automático de repetidas |
| VR-5 | Limites por telefone com dois responsáveis | **Decidido (cliente, 10/nov): conta por quem marcou.** Consultas futuras, faltas, cadastros novos e as 5 marcações do portal em 24 h contam no número que marcou (consulta antiga, sem quem marcou: conta no principal). A faixa "Portal bloqueado" mostra qual responsável está bloqueado |
| VR-6 | Anonimização (LGPD) com vários responsáveis | **Decidido (cliente, 10/nov): só quem fica sem paciente.** O paciente é anonimizado e desligado de todos; o responsável que não cuida de mais ninguém é anonimizado junto; quem ainda cuida de outro paciente continua. A tela mostra isso antes de confirmar |
| VR-7 | Importação da agenda com 2º telefone | **Decidido (cliente, 10/nov): coluna opcional.** "Nome do 2º responsável" e "Telefone do 2º responsável"; o 1º telefone é o principal; a revisão avisa se o 2º número já é de outro contato |

## 6. Telas (canvas)

Canvas: https://claude.ai/artifact/Xk5VuEDiPsUZb7yY9Tzyxw (ficha, adicionar responsável, "Para quem…", Minhas consultas,
bot, marcação pela recepção).

| # | Tela | Decisão |
|---|---|---|
| UI-1 | Ficha do paciente | **Decidido (cliente, 10/nov): opção A, só no lado.** A ficha de hoje fica igual (abas Próximos, Anteriores, Documentos, Anotações e Lembretes; cartões Dados, Plano de saúde e Financeiro com o seu Editar). O cartão "Quem fala com a clínica" vira **"Responsáveis (n)"**: cada um com nome, parentesco, selo Principal, número em texto e WhatsApp; "+ Adicionar", "Tornar principal" e "Desligar" (com confirmação); o nome abre a página do contato (Editar nome e telefone, como hoje). **O alto da ficha deixa de mostrar o contato** (só nome, selos, idade/plano, Marcar e Mais). Cada atendimento mostra "Marcada por … · avisos para …" |
| UI-2 | Adicionar responsável | **Decidido (cliente, 10/nov): como desenhado.** Celular (ou busca pelo nome de um contato já cadastrado) → se o número já cuida de uma ficha parecida (mesmo nome e nascimento), aviso com **"Desativar a outra ficha"** já marcado (diz quantas consultas futuras ela tem: remarcar nesta antes; o histórico dela não passa) → parentesco opcional → "Ligar …" → confirmação "Ligar … a … e desativar a outra ficha?" |
| UI-3 | Portal, "Para quem…" | **Decidido (cliente, 10/nov): opção B.** Cada paciente mostra "também com Ana (mãe)" (primeiro nome e parentesco dos outros responsáveis) e, embaixo, "Falta alguém? Peça à recepção para ligar o seu número à ficha. Assim não cria um cadastro repetido." |
| UI-4 | Minhas consultas | **Decidido (cliente, 10/nov): como desenhado**, com "Marcada por Carlos (pai) · os avisos vão para ele" ou "Marcada por você"; Remarcar e Cancelar para todos. **Quem remarca passa a ser quem marcou**: lembrete e avisos seguintes vão para ele; o anterior recebe só o aviso da remarcação |
| UI-5 | Bot | **Decidido (cliente, 10/nov): lista e aviso.** Remarcar e Cancelar listam as consultas de todos os pacientes ligados ao número, com "(marcada por …)" quando foi outro responsável. Quando quem remarca ou cancela não é quem marcou, este recebe o aviso por **modelo novo da Meta** (mensagem paga a mais só nesse caso): "*Consulta remarcada* · Ana remarcou a consulta de João Pedro com Dra. Helena Rocha para *qui 20/11 às 10:00*. Dúvidas? Responda aqui." e "Ana cancelou a consulta de João Pedro com Dra. Helena Rocha de ter 18/11 às 09:30." |
| UI-6 | Recepção marca (Agenda) | **Decidido (cliente, 10/nov): como desenhado.** Com 2 ou mais responsáveis, "Confirmação e lembrete no WhatsApp para" com uma escolha por responsável; padrão: quem está na conversa aberta no Atendimento, senão o principal. Com um só, igual a hoje. A busca do paciente aceita o celular de qualquer responsável |

## 7. Etapas de implementação (proposta)

**Quando:** depois da F3f (a marcação no chat sai, e com ela `bot/booking.ts`, o que diminui o que muda no bot). Só com a
aprovação do cliente. Branch curta da `main` por etapa; testes por etapa; Playwright em 390 e 1280 px nas telas.

| Etapa | O que entrega | Migração |
|---|---|---|
| **VR1 Banco** | `patient_contacts` (RLS padrão, `seed.sql`, isolamento), preenchida com o principal de cada paciente; `appointments.booked_by_contact_id` (nulo nas antigas = principal); função `contact_patient_ids`; ligar, desligar e tornar principal (Administrador e Recepção, com registro); limites por quem marcou (VR-5); `anonymize_patient` revista (VR-6); testes de banco | sim |
| **VR2 Ficha e recepção** | Cartão "Responsáveis" (UI-1), "Adicionar responsável" com desativar a outra ficha (UI-2), alto da ficha sem o contato, "Marcada por … · avisos para …" nas abas; página do contato com os pacientes ligados; Marcar com "Confirmação e lembrete para" (UI-6); busca pelo celular de qualquer responsável; faixa "Portal bloqueado" por responsável; prévia da anonimização com o que acontece com cada um | não |
| **VR3 Portal e bot** | `phonePatients` e Minhas consultas pela ligação; "Para quem…" opção B (UI-3); "Marcada por" e quem remarca passa a ser quem marcou (UI-4); Remarcar e Cancelar do bot com todos os pacientes ligados (UI-5); mensagens para quem marcou (lembrete, confirmação, aviso de cancelamento pela clínica, preparo, lista de espera; toque "Confirmar" de qualquer responsável ligado); Jornada do bot (`botJourney.ts`) | não |
| **VR4 Aviso ao outro responsável** | Modelo novo da Meta (remarcada/cancelada por outro responsável), aprovação na Meta antes do código; envio só quando quem mexe não é quem marcou | não |
| **VR5 Importação e fechamento** | Colunas do 2º responsável na importação (VR-7) e na revisão; Métricas (contato = principal); artigos da Central ("Responsável/contato", "Ficha do paciente", "Anonimizar") e FAQ; capturas da ficha e do Marcar em `capturas-pendentes.md` (recaptura só com autorização); `security-review`, `/code-review`, staging e roteiro de validação | não |

**Atenção:** a VR1 sozinha não muda nada para o usuário (só prepara). VR2 e VR3 vão juntas ao staging: ligar um
responsável na ficha sem o portal e o bot reconhecerem confunde a recepção.
