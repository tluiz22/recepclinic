# Meta: Análise do App e Tech Provider

Textos e respostas usados no cadastro do RecepClinic como Tech Provider (09/out/2026). Caminho no
painel: developers.facebook.com › Meus apps › RecepClinic › Casos de uso › WhatsApp › Torne-se um
parceiro › Torne-se um provedor de tecnologia (etapas: verificação da empresa, Análise do App e
Verificação do acesso).

## Análise do App

Envio em *Analisar › Análise do app* (permissões já incluídas pelo fluxo do Tech Provider) ›
**Avançar**: Verificação e Configurações do app (concluídas), **Uso permitido** (texto e vídeo por
permissão), **Tratamento de dados** e **Instruções da análise**.

| Permissão | Vídeo |
|---|---|
| `whatsapp_business_messaging` | `Meta_Video01-legendado.mp4` (lembrete enviado, botão "Confirmar", resposta automática, registro) |
| `whatsapp_business_management` | `Meta_Video02-legendado.mp4` (versão própria aprovada pelo Suporte, criada na Meta, "Atualizar situação") |
| `business_management` | o vídeo 2, se pedir |
| `public_profile` | o vídeo 2, se pedir |

Os vídeos (com legendas em inglês e as conversas pessoais e os e-mails desfocados) ficam fora do
git. Se a Meta recusar `business_management` ou `public_profile` por falta do Embedded Signup no
vídeo, gravar de novo com a tela de conexão da F8.

**Chamadas de teste obrigatórias:** a `business_management` exigia 1 chamada de API; feita no
Explorador da Graph API (app RecepClinic, token do usuário com `business_management`,
`GET me/businesses`). O contador leva até 24 h.

### `whatsapp_business_messaging`

How will your app use this permission?

```
RecepClinic is a SaaS platform that automates the front desk of healthcare clinics (medical and dental offices) in Brazil. Each clinic connects its own WhatsApp Business number to RecepClinic, and our app uses the WhatsApp Cloud API on behalf of that clinic to communicate with its patients about their appointments.

We use whatsapp_business_messaging to:
1. Send approved utility templates to patients: appointment confirmation, rescheduling, cancellation, appointment reminders with quick-reply buttons (Confirm / Reschedule / Cancel), exam preparation instructions and a daily schedule summary to the clinic's professionals and staff.
2. Receive incoming messages and button replies through our webhook, so patients can confirm, reschedule or cancel an appointment, or book a new one through a guided conversation, within the 24-hour customer service window.
3. Reply automatically with session messages (for example, "Attendance confirmed") and update the appointment in the clinic's dashboard.

Messages are only sent to patients who gave their WhatsApp number to the clinic to book an appointment. We do not send marketing or promotional messages. All messages are logged per clinic with their delivery status, and each clinic's data is isolated from the others.
```

Steps to test:

```
1. In the RecepClinic dashboard, open Agenda and select an appointment for today.
2. Click "Send reminder" and confirm. The app sends the reminder template through the Cloud API.
3. On the patient's WhatsApp, the reminder arrives with the buttons Confirm / Reschedule / Cancel.
4. Tap "Confirm attendance". Our webhook receives the reply, the app answers automatically and the appointment shows "Attendance confirmed" in the dashboard.
5. Settings › WhatsApp › Message log shows each sent and received message with its delivery status.
The screen recording shows this flow end to end.
```

### `whatsapp_business_management`

How will your app use this permission?

```
RecepClinic connects each clinic's own WhatsApp Business Account (WABA) to our platform as a Tech Provider. We use whatsapp_business_management to manage the clinic's WABA on its behalf:

1. Create message templates in the clinic's WABA: our standard utility templates (appointment confirmation, rescheduling, cancellation, reminder, exam preparation, daily summary and waitlist offer) and custom versions of these texts that the clinic proposes and RecepClinic Support reviews before submitting to Meta.
2. Read the status of each template (in review, approved, rejected with the reason) through the API and the template status webhook, so the dashboard shows it to the clinic. Only approved templates are used to send messages; while a new version is in review, the previous approved version keeps being used.
3. Read the phone number and WABA information and subscribe our app to the clinic's WABA, so messages and status updates reach our webhook.

We only access WABAs that the clinic itself connected to RecepClinic, and each clinic's data and credentials are isolated from the others.
```

Steps to test:

```
1. In the RecepClinic dashboard, open Settings › Messages. A clinic's proposed custom version of the "Cancellation" template is shown for review.
2. As RecepClinic Support, click "Approve and send to Meta". Our app creates the template in the clinic's WABA through the API; its status shows "In review".
3. In WhatsApp Manager › Message templates, the same template appears, created by our app, category Utility, status In review.
4. Back in Settings › WhatsApp, click "Refresh status": the app reads the status of every template from the API and updates the list.
The screen recording shows this flow end to end.
```

### `business_management`

How will your app use this permission?

```
RecepClinic is a Tech Provider for healthcare clinics. We use business_management only as part of Embedded Signup: when a clinic connects its WhatsApp number to RecepClinic, it uses its own business portfolio, and this permission lets our app read the WhatsApp Business Account and phone number that the clinic shared with us, and subscribe our app to that account so we can manage its message templates and receive its messages.

We do not create, change or manage the clinic's business portfolio, its users, ad accounts or any other assets. Access is limited to the WhatsApp Business Account each clinic chose to share with RecepClinic, and each clinic's data is kept separate.
```

Steps to test:

```
1. In the RecepClinic dashboard, Settings › WhatsApp shows the clinic's connected WhatsApp Business Account and phone number.
2. "Test connection" reads the phone number and account information through the API and subscribes our app to the clinic's WhatsApp Business Account.
3. Settings › Messages › "Approve and send to Meta" creates a message template in that account, and WhatsApp Manager shows it (see the screen recording).
```

### `public_profile`

```
We use public_profile only within Embedded Signup (Facebook Login for Business), so that the clinic's administrator can log in with Facebook and connect the clinic's own WhatsApp Business Account to RecepClinic. We use only the basic profile data needed to identify who completed the connection; we do not store or use it for any other purpose.
```

### Tratamento de dados

- Operadores com acesso aos Dados da Plataforma: **Supabase** (banco; região São Paulo,
  `sa-east-1`) e **Vercel** (hospedagem; região São Paulo, `gru1`).
- Categoria: armazenamento / hospedagem de dados (sem análise, marketing ou suporte).
- Países: **Brasil e Estados Unidos** (dados em São Paulo; acesso remoto das equipes das duas
  empresas americanas).
- Responsável: RecepClinic, Brasil. Pedidos de autoridades nos últimos 12 meses: não.
- Processos para pedidos de autoridades: as 4 opções (legitimidade, contestação, minimização,
  registro), na [política](politica-pedidos-de-autoridades.md).

### Instruções da análise (pendente)

Antes, adicionar uma plataforma ao app: Configurações do app › Básico › **Adicionar plataforma** ›
Site, com `https://app.recepclinic.com.br`. Decidir com o cliente se o analista recebe um login de
teste no staging.

## Verificação do acesso (pendente)

Antes de enviar: dados da empresa (nome jurídico e documento usados na verificação da Meta) no
rodapé do site `www.recepclinic.com.br` (sessão separada do site).

1. **Como a empresa usará os Dados da Plataforma:**

```
O RecepClinic é um sistema de recepção automatizada para clínicas e consultórios de saúde no Brasil (médicos, dentistas e outros profissionais). Nossos clientes são as clínicas.

Cada clínica conecta o próprio número de WhatsApp Business ao RecepClinic, pelo cadastro incorporado da Meta (Embedded Signup), usando o próprio portfólio empresarial e a própria conta do WhatsApp Business. A clínica continua dona da conta e paga à Meta diretamente pelas mensagens.

Com essa conexão, o RecepClinic envia e recebe mensagens no WhatsApp em nome da clínica, para os pacientes dela:
- confirmação, remarcação e cancelamento de atendimentos;
- lembrete do atendimento, com botões para o paciente confirmar, remarcar ou cancelar;
- orientações de preparo de exames e orientações gerais da consulta;
- resumo diário da agenda para os profissionais e a equipe da clínica;
- atendimento automático quando o paciente escreve: o paciente marca, remarca ou cancela sozinho pela conversa, e a recepção pode assumir a conversa a qualquer momento.

Os dados da plataforma que usamos são os da conta do WhatsApp Business da clínica: o número conectado, os modelos de mensagem (que criamos na conta da clínica e cuja situação de aprovação acompanhamos) e as mensagens trocadas com os pacientes, com a situação de entrega. Esses dados são usados apenas para prestar esse serviço à própria clínica, ficam separados por clínica e não são vendidos nem compartilhados. Não enviamos mensagens de marketing.

A clínica usa o serviço pelo painel do RecepClinic: vê a agenda, as mensagens enviadas e as respostas dos pacientes, e escolhe quais avisos e lembretes quer enviar.
```

2. **Gerencia vários portfólios empresariais?** Não (recomendado; o cliente confirma se não
   administra outro portfólio em nome de alguma empresa).
3. **Site:** `https://www.recepclinic.com.br`
