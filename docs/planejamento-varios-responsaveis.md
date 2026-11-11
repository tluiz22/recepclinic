# Vários responsáveis por paciente (planejamento, 10/nov/2026)

> **Retomada (planejamento).** Origem: pergunta do cliente na validação da F3 (10/nov; `implementacao-recepcao-digital.md`,
> 15.3.2, item 1 "Usar outro número"). **Decisão do cliente (10/nov):** um paciente pode ter mais de um responsável,
> cada um com o seu número; a recepção liga outro responsável à ficha; bot e portal reconhecem o paciente pelos números
> ligados; ninguém se liga sozinho pelo portal.
> - **Feito (10/nov):** levantamento do impacto no código (seção 3), modelo (seção 4), **decisões VR-1 a VR-7**
>   (seção 5) e **telas UI-1 a UI-6** (seção 6, canvas aprovado tela a tela), **D14** em [`arquitetura.md`](arquitetura.md)
>   e as etapas VR1 a VR5 (seção 7).
> - **VR1 (banco) feita (11/nov, sessão de implementação, branch `varios-responsaveis`):** migração
>   `20270113120000_varios_responsaveis.sql` aplicada no banco local (com o OK do cliente), **não no staging**; detalhe
>   na seção 8. **Não juntar na `main` ainda** (cliente, 11/nov): a branch só entra na `main` com a frente inteira
>   pronta (VR1 a VR5); antes, a `main` vai para a produção.
> - **VR2 (ficha e recepção) feita (11/nov, mesma branch, sem migração):** detalhe na seção 8. Validação pelo cliente
>   pendente.
> - **VR3 sem o bot feita (11/nov, mesma branch, sem migração):** portal (UI-3, UI-4) e mensagens para quem marcou. A
>   F3f ainda não está na `main`: o Remarcar/Cancelar do bot (UI-5) espera por ela (cliente, 11/nov: adiantar a VR3 sem
>   o bot e a VR5). Detalhe na seção 8.
> - **VR5 sem o bot feita (11/nov, mesma branch):** importação com o 2º responsável (migração
>   `20270114120000_importacao_segundo_responsavel.sql`, aprovada pelo cliente e aplicada só no banco local), artigos e
>   FAQ da Central; Métricas sem mudança; nenhuma captura da Central na fila. Detalhe na seção 8.
> - **Próximo:** VR4 (modelo da Meta), **só depois de perguntar ao cliente**. Depois da F3f: Remarcar/Cancelar do bot
>   (resto da VR3). No fim: `security-review`, `/code-review`, suíte inteira, staging (migrações `20270113120000` e
>   `20270114120000` antes do código) e roteiro de validação.

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

## 8. Andamento

### VR1 Banco (11/nov/2026, branch `varios-responsaveis`)

Migração `20270113120000_varios_responsaveis.sql` (aplicada no banco local com o OK do cliente; staging pela validação,
antes do código que a lê):

- **`patient_contacts`** (clínica, paciente, contato, `kinship` = parentesco opcional até 40 letras, `is_self`, quem
  ligou e quando), única por paciente + contato, RLS padrão; a equipe e o bot leem, **só as funções gravam**. Preenchida
  com o contato de cada paciente não anonimizado. Gatilho no paciente: cadastro novo e troca de `contact_id` ligam o
  principal. `is_self` guarda "o número é do próprio paciente": ao tornar principal, `patients.is_contact_self` passa a
  ser o `is_self` do novo principal (voltar ao número do próprio paciente devolve o selo).
- **`patient_contact_events`**: registro de `linked`, `unlinked` e `made_primary` (quem, quando, parentesco).
- **`contact_patient_ids(clínica, contato)`**: pacientes do número, com o RLS de quem chama (equipe e bot).
- **`link_patient_contact`**, **`unlink_patient_contact`** e **`set_patient_primary_contact`**: Administrador,
  Recepção e Suporte (o Profissional e o bot não). Recusas com dica: já ligado, desativado, não ligado, principal não se
  desliga (antes, tornar outro principal), paciente anonimizado. **Desligar** devolve ao principal as consultas
  futuras que o desligado marcou (lembretes e avisos não vão para quem saiu); as passadas continuam com ele.
- **`appointments.booked_by_contact_id`** (VR-1): as consultas que já existiam ficaram com o principal de hoje (sem
  mexer em `updated_at` e sem evento na trilha); sem valor, a marcação nova pega o principal; com valor, precisa ser um
  responsável ligado ao paciente; paciente trocado na consulta volta ao principal do novo, se quem marcou não cuida dele.
  Tornar principal **não** muda quem marcou.
- **`anonymize_patient`** (VR-6): o paciente sai de todos os responsáveis; quem fica sem paciente é anonimizado como
  antes (nome, telefone, endereço, mensagens, conversa, funil, links e registro do Suporte); quem cuida de outro
  paciente continua, e só as mensagens das consultas do paciente perdem o texto. Devolve também `contacts_anonymized`
  e `contacts_kept`. **Muda a regra de 09/out** (antes o contato ia sempre junto e os irmãos ficavam sem telefone).

Código:

- `src/lib/data/patientContacts.ts` (novo, para a VR2): `listPatientContacts`, `contactPatientIds`,
  `linkPatientContact`, `unlinkPatientContact`, `setPrimaryContact`.
- **Limites do bot (VR-5)** em `whatsapp/botLimits.ts`: atendimentos futuros e faltas contam por
  `booked_by_contact_id`. Cadastros novos seguem por `patients.contact_id` (o principal; quem cadastrou, salvo troca de
  principal). Os limites do portal já contavam pelo celular da sessão (quem marcou): sem mudança.
- **Prévia da anonimização** (`previewAnonymization` e a ficha): diz, por responsável, quem perde os dados e quem
  continua ("…continua, porque também cuida de …"). Era o único texto que ficaria errado com a VR1 sozinha. O artigo
  "Anonimizar um paciente" da Central fica para a VR5 (o texto geral continua certo).
- Bot (`bot/`) sem mudança, como pedido. `seed.sql`: Carlos é o 2º responsável de Ana (pai), com o registro.

Testes: `tests/db/varios-responsaveis.test.ts` (novo: ligar, permissões, outra clínica, `contact_patient_ids`, quem
marcou, limites, tornar principal, desligar, anonimização com quem continua e quem vai) e `anonimizacao.test.ts`
revisto (sem o irmão; o caso do irmão passou para o teste novo).

**Para a VR2/VR3 (anotado):** o cadastro "o próprio paciente" de um número que já é "próprio" de outra ficha (depois
de tornar outro principal) recusa pela unicidade de `is_self`; a VR2 precisa de mensagem para isso. Bot, portal e
mensagens ainda leem `patients.contact_id` (só o principal) até a VR3.

### VR2 Ficha e recepção (11/nov/2026, branch `varios-responsaveis`, sem migração)

Antes: `main` trazida para a branch (merge `c1407eba`), testes verdes. Canvas das telas não abriu (artefato não
encontrado); feito pela descrição UI-1, UI-2 e UI-6 da seção 6.

- **Ficha (UI-1):** o alto mostra só nome, selos, idade/plano, Marcar e Mais (sem o contato). O cartão "Quem fala com a
  clínica" virou **"Responsáveis (n)"**: cada um com nome (abre a página do contato, onde se edita nome e telefone),
  parentesco, selo Principal (só com mais de um), número em texto e WhatsApp; "+ Adicionar" e, nos não principais,
  "Mais" com **Tornar principal** e **Desligar** (com confirmação). A conversa aberta no Atendimento aparece para
  qualquer responsável. Com mais de um responsável, cada atendimento diz **"Marcada por Carlos (pai), que recebe os
  avisos"**, ou "Marcada pela recepção · avisos para …" (marcação pelo painel); nos passados e cancelados, só "Marcada
  por …". Administrador, Recepção e Suporte mexem; o Profissional só vê.
- **Adicionar responsável (UI-2):** tela nova `/admin/pacientes/[id]/responsavel`. Busca por celular (com DDD) ou nome de
  um contato já cadastrado; número sem cadastro → "Cadastrar e ligar", pede o nome. Se o número já cuida de uma **ficha
  parecida** (mesmo nome, sem acento e caixa, e mesmo nascimento), aviso com **"Desativar a outra ficha"** já marcado,
  com as consultas futuras dela ("remarque nesta ficha antes") e "Abrir a outra ficha". Parentesco opcional (sugestões
  mãe, pai, avó…; até 40 letras). "Ligar …" pede confirmação ("Ligar … a … e desativar a outra ficha?"; sem a marca, o
  texto não fala em desativar). Erro volta à mesma etapa com o que foi digitado. Voltar e Cancelar levam à ficha.
- **Página do contato:** lista também os pacientes em que o número é outro responsável ("outro responsável (pai)").
- **Marcar (UI-6):** com 2 ou mais responsáveis, "Confirmação e lembrete no WhatsApp para", um por responsável; padrão:
  quem está na conversa aberta (o "Marcar consulta" do Atendimento manda `responsavel=`), senão o principal. A
  confirmação mostra o número escolhido. Na marcação (e na série), a escolha vira `booked_by_contact_id`; conferida
  antes de marcar. Alterar não muda quem marcou.
- **Busca pelo celular de qualquer responsável:** Marcar e Pacientes (`patient_contacts`); o cartão continua com o
  principal. O filtro "Falta CPF" do Financeiro segue pelo principal (responsável financeiro).
- **Faixa "Portal bloqueado":** confere o celular de cada responsável e diz qual está bloqueado ("Celular … (pai)");
  "Liberar agora" solta o celular desse responsável.
- **Prévia da anonimização:** já feita na VR1.

Código: `patientContacts.ts` (`similarRecordsOfContact`, `listContactLinkedPatients`, `responsibleLabel`,
`setAppointmentsBooker`), `patients.ts` (`contactForResponsible`; busca pelo celular via `patient_contacts`),
`agenda/view.ts` (`bookedByContactId`), ficha, `[id]/responsavel.astro`, página do contato, Marcar, API do paciente
(`ligar_responsavel`, `desligar_responsavel`, `tornar_principal`, `liberar_portal` com o responsável) e da Agenda.

Testes: `tests/db/varios-responsaveis-ficha.test.ts` (novo: número novo pede nome, ficha parecida com consultas futuras,
página do contato, busca pelo celular do 2º responsável, quem recebe escolhido no Marcar e recusa de quem não é
responsável). Unidade 1217, banco 1199, `astro check` sem erros. Playwright (script isolado, o MCP estava com a outra
sessão) em 390 e 1280: ficha, Adicionar (Voltar, busca, número novo, erro de nome com o parentesco mantido, ligar),
Desligar, página do contato, Marcar (padrão e vindo da conversa) e busca; sem erro no console. Sem captura da Central
afetada (a do Marcar mostra o passo 1 vazio).

**Para a VR3 (anotado):** as mensagens (confirmação, lembrete, avisos) ainda vão para o principal: a escolha do Marcar
só vale depois da VR3 (por isso VR2 e VR3 vão juntas ao staging). Sessões novas de série geradas depois pegam o
principal (a série não guarda quem marcou). A conversa do Atendimento ainda lista só os pacientes em que o número é o
principal. Sem mensagem própria ainda para o "próprio paciente" repetido (anotado na VR1): não aparece pela ficha,
porque ligar não marca `is_self`.


### VR3 Portal e mensagens, sem o bot (11/nov/2026, branch `varios-responsaveis`, sem migração)

Antes: a branch já tinha a `main` (nada a trazer), migração `20270113120000` conferida no banco local, testes verdes
(unidade 1217, banco 1199). **A F3f não está na `main`:** a pedido do cliente (11/nov), a VR3 saiu sem o bot (o
Remarcar e o Cancelar do chat mudam com a F3f; ficam para depois dela).

- **Mensagens para quem marcou** (`whatsapp/recipient.ts`, novo): confirmação, aviso de remarcação e de cancelamento,
  cancelamento pela clínica (e o link de remarcação dele, do portal e o antigo), lembrete, preparo, orientações e
  oferta da lista de espera vão para `booked_by_contact_id`; sem ele (ou sem celular), para o principal, como antes. A
  Lista de espera da Agenda mostra quem recebe a oferta.
- **"Confirmar presença" do lembrete:** vale do número que recebeu ou de qualquer responsável ligado ao paciente;
  número de fora continua sem efeito.
- **Portal pela ligação:** `phonePatients` lê `patient_contacts` (principal ou não); "(você)" vem do `is_self` da
  ligação; "Para mim" é recusado quando o número já é o "próprio paciente" de uma ficha (anotado na VR1); a ficha
  parecida (P8b) procura também pelos principais das fichas do número (a função do banco procura só pelo principal;
  sem migração).
- **"Para quem…" (UI-3, opção B):** cada paciente com "também com Maria" / "também com Ana (mãe) e Carlos (pai)" e,
  abaixo de "Outra pessoa", "Falta alguém? Peça à recepção para ligar o seu número à ficha. Assim não cria um cadastro
  repetido."
- **Marcação pelo portal** (consulta e retorno): quem marcou = o celular comprovado (`bookAppointment` aceita
  `bookedByContactId`). Os limites do portal já contavam por ele.
- **Minhas consultas (UI-4):** com mais de um responsável na ficha, cada consulta diz "Marcada por você", "Marcada por
  Carlos (pai), que recebe os avisos" ou "Marcada pela recepção, com avisos para …"; com um só, nada muda. Remarcar e
  Cancelar para todos. **Quem remarca passa a ser quem marcou** (e recebe o aviso da remarcação); a remarcação depois do
  cancelamento pela clínica marca com quem remarcou. **O aviso do cancelamento pelo portal vai para quem cancelou**;
  quem marcou recebe o aviso dele na VR4 (modelo novo da Meta).
- **Atendimento (Central):** a conversa lista todos os pacientes de que o número é responsável (antes, só aqueles em
  que é o principal); a faixa "Portal bloqueado" da ficha lista os pacientes do número pela ligação.
- Jornada do bot (`botJourney.ts`): item 7 e regra geral dos vários responsáveis.

Testes: `tests/db/varios-responsaveis-portal.test.ts` (novo: "Para quem" do pai e da mãe, número de fora, ficha
parecida pelo 2º responsável, confirmação para quem marcou, principal sem quem marcou, toque "Confirmar" da mãe e de um
estranho, "Marcada por" com um e com dois responsáveis e pela recepção, remarcar troca quem marcou, aviso do
cancelamento para quem cancelou). Unidade 1217; banco (portal, lembretes, lista de espera, preparo, Central,
anonimização e vários responsáveis) 231; `astro check` sem erros. Playwright (script isolado; o MCP estava com a outra
sessão) em 390 e 1280 com o celular do Carlos (2º responsável de Ana no `seed.sql`): Minhas consultas com "Marcada por
Maria, que recebe os avisos" nas consultas de Ana; "Para quem…" com "também com Maria" e a dica; Voltar volta aos
horários e solta a reserva; sem erro no console e sem rolagem horizontal. Nenhuma captura da Central afetada (o portal
não tem captura). Para testar, os limites do código do portal do celular do Carlos foram soltos no banco local.

**Para depois (anotado):** Remarcar e Cancelar do bot com todos os pacientes ligados (UI-5) esperam a F3f; a conversa do
bot ainda acha os pacientes pelo principal (`bot/booking.ts`). Sessões novas de série seguem com o principal.

### VR5 Importação e fechamento, sem o bot (11/nov/2026, branch `varios-responsaveis`)

- **Importação (VR-7):** o cartão do link da agenda atual ganhou "Nome do 2º responsável" e "WhatsApp do 2º
  responsável" (opcionais; o rótulo segue o "WhatsApp" do 1º, em vez de "Telefone"), com a dica "Opcional: outra pessoa
  que também cuida do paciente…". A conferência pede os dois juntos, um número válido e diferente do 1º, e o mesmo
  WhatsApp sempre com o mesmo nome entre os cartões (1º ou 2º). A revisão do Suporte mostra o 2º responsável e avisa
  quando o número já é de um contato cadastrado ("Fica o cadastro"; inativo volta a ficar ativo).
- **Migração `20270114120000_importacao_segundo_responsavel.sql`** (o cliente escolheu a migração em 11/nov; aplicada
  só no banco local; staging pela validação, antes do código): `patient_contacts.agenda_import_id`; `load_agenda_import`
  liga o 2º responsável (já cadastrado, criado antes na mesma carga ou novo) com o registro e devolve `links`;
  `undo_agenda_import` desliga o que a carga ligou, menos quem virou o principal ou marcou consulta do paciente, não
  apaga o contato que ainda cuida de alguém e devolve `linksRemoved`. Mensagens do Suporte dizem quantos segundos
  responsáveis foram ligados ou desligados.
- **Métricas:** sem mudança, como decidido (contam por paciente; o contato mostrado é o principal; o filtro por contato
  segue pelo principal).
- **Central de Ajuda:** "Responsável/contato" reescrito (vários responsáveis, Adicionar, ficha repetida, Tornar
  principal, Desligar, para quem vão os avisos, portal e bot); "Ficha do paciente" (cartão Responsáveis, faixa do
  portal, "Marcada por", trocar telefone pela página do responsável); "Cadastrar um paciente" (principal e ficha
  repetida); "Anonimizar" (o que acontece com cada responsável); "Marcar atendimento" (campo "Confirmação e lembrete no
  WhatsApp para"). FAQ: "duplicado" e "trocar telefone" revistas e a nova "O pai e a mãe querem receber as mensagens".
- **Capturas:** nenhuma na fila. A ficha não tem captura; a do Marcar mostra o passo 1 vazio; o portal não tem
  captura; o link da importação não está na Central.

Testes: unidade da importação (2º responsável na conferência, revisão e plano); `tests/db/varios-responsaveis-importacao.test.ts`
(novo: revisão sem erro com aviso, carga com 4 ligações e o registro, principal pelo 1º telefone, Desfazer com 3
desligadas, o pai que marcou consulta fica, a avó sem paciente sai) e `importacao-agenda.test.ts` com `links: 0`.
Playwright (script isolado) do link em 390 e 1280: erro só no 2º WhatsApp, `aria-invalid`, os outros campos mantidos,
corrigido sem erro, número igual ao 1º recusado; sem erro no console. O link de teste foi apagado do banco local.

**Fica para o fim da frente:** `security-review`, `/code-review` e a suíte inteira, antes do staging.

