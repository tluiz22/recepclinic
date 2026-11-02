# Evolução do assistente (EA): jornada inteligente, atendimento humano e taxa de resolução

> **Retomar daqui (02/nov/2026).** Etapa 1 (auditoria) feita; diagnóstico abaixo. Próximo: **rodada de dúvidas
> de negócio** com o cliente (seção 3), depois plano técnico e código numa branch `assistente` criada da `main`.

Pedido do cliente em 02/nov/2026: evoluir o bot em três frentes integradas, sem criar outro assistente, outro
reconhecedor nem outra base: (1) entrada com texto livre ou menu; (2) pedido de recepção que tenta resolver antes
de transferir, sem barreira; (3) taxa de resolução sem intervenção humana em Métricas › Agendamento digital.

## 1. Diagnóstico (auditoria de 02/nov/2026)

### 1.1 Entrada e jornada

- **Caminho:** `webhook.ts` → `bot/router.ts` (`handleIncomingMessage` → `dispatch`). Estado por número em
  `conversation_state` (`state` + `context` jsonb). Conversa parada 15 min fora do repouso recomeça (aviso pela rotina
  `closeIdleConversations`).
- **Ordem do `dispatch`:** número bloqueado → toque antigo ("stale") → respostas da base ("Marcar", "Você quis
  dizer…?") → "Voltar ao menu"/"0"/"menu" → "voltar" → botão "Falar com a recepção" → Sim/Não pendente da recepção
  → pedido digitado de recepção → data sem barras → o passo (`entry.ts`, `manage.ts`, `booking.ts`, `menus.ts`).
- **1ª mensagem** (`WELCOME`): `startConversation` manda `welcome()` ("Olá! 👋 Aqui é da Clínica X.") e o menu
  (`MENU_BODY`: "Escolha uma opção abaixo (ou digite o número)."); com atendimento marcado no número, pergunta antes
  se é sobre ele (`ENTRY_ASK`). Menu principal: Consultas, Exames, Informações, Falar com a recepção (só com
  coexistência). Submenus: marcar consulta/retorno/exame, remarcar, cancelar, encaixe.
- **Texto livre hoje:** o reconhecimento é a **base de conhecimento** (determinística, sem IA, decisão 1 da BC). Ela
  entra em dois pontos: na 1ª mensagem (`firstMessageAnswer`: boas-vindas + resposta + menu, ou abre o fluxo) e onde
  o bot diria "não entendi" (`notUnderstood` → `KnowledgeHook.run`). Fluxos reconhecidos (marcar, remarcar, cancelar,
  confirmar, meus agendamentos, encaixe) abrem o fluxo existente (`performTakeover`). Ambígua → "Você quis dizer…?".
  Não reconhecida → "não entendi" e o texto vai para `kb_unmatched` (Suporte).
- **Limite:** a base só funciona com o item **"Perguntas frequentes no bot"** (`knowledge_base`, fora da tabela de
  planos) ligado e uma publicação ativa. **Correção do cliente (02/nov):** a BC já está na produção, em uso na
  clínica piloto (o bloco do `base-de-conhecimento.md` estava desatualizado). Sem o item, todo texto livre fora de
  um passo cai no "não entendi" + menu.
- **Fluxo em andamento:** texto fora de contexto não tira do fluxo: a base responde e o passo se repete.

### 1.2 Base de conhecimento

- Global, mantida pelo Suporte (`kb_entries`, sinônimos, especialidades, termos clínicos; publicação compilada em
  `kb_publications`, lida por `publishedKnowledge`). Casamento por palavras com peso (`knowledge/match.ts`, limiares
  0,6 responde / 0,45 sugere). Respostas montadas só com o cadastro da clínica (`answers.ts`, `clinicData.ts`): sem o
  dado, não responde. Tipos: `template`, `source` (endereço, serviços, valores, convênios, retorno, preparo,
  profissionais, domiciliar, faixa etária, registro no conselho), `flow`, `fixed` (cortesia), `reception`.
- Pergunta clínica → aviso de saúde + oferta da recepção. Isolamento: credencial da clínica (RLS, D1).

### 1.3 Atendimento humano

- **Pedido:** opção do menu e botão de saída → transfere direto; texto curto ("atendente", até 60 caracteres) →
  "Você quer falar com a recepção?" Sim/Não → transfere. Transferências oferecidas pelo bot (sem horário, 4º "não
  entendi", entrada da base) também perguntam antes (31/out).
- **Transferência** (`manage.ts` `handoff`): `HANDOFF` + aviso de fora do horário (`receptionReplyWhen`, horário da
  recepção F8.5b; recesso substitui) → `pauseForHuman` (estado `HUMAN_HANDOFF`, `human_handoff=true`, motivo e
  origem; evento `handoff` no funil; tentativa em andamento vira abandono "reception_requested") → pergunta o assunto
  **depois** de transferir (`HANDOFF_SUBJECT_QUESTION`), e a 1ª resposta vira `handoff_subject` (tela Atendimento).
- **Sem coexistência:** "A clínica responderá sua mensagem em breve." Volta ao bot: "Devolver ao bot" ou `#bot`.
- **Hoje, sem motivo:** transfere e só depois pergunta o assunto; o assunto não passa pela base.

### 1.4 Métricas › Agendamento digital

- Fonte: `bot_funnel_events` (sessão = tentativa; fluxos `booking`, `return_booking`, `exam`, `cancel`,
  `reschedule`, `handoff`), resumida pela RPC `metrics_bot_sessions`; cálculo em `botFunnel.ts`
  (`buildDigitalReport`), tela `DigitalTab.astro`. Período pelo início da tentativa; em andamento = passo há menos
  de 30 min; filtros de operação e de origem (menu/lembrete); comparação com o período anterior.
- Indicadores: Tentativas, Concluíram (concluídas ÷ terminadas), Marcações que seguem de pé, **Precisaram da
  recepção** (contatos com pedido ou assumidos ÷ contatos com alguma tentativa ou pedido, por telefone), etapas,
  desfechos, por fluxo, motivos e origens da recepção.
- **Não existe** taxa de resolução sem intervenção humana. Respostas da base **não entram no funil** (só em
  `whatsapp_messages` como `bot_kb_*`); não há registro de "resolvido".

## 2. Lacunas para o pedido

1. Entrada com texto livre depende do item `knowledge_base` (hoje desligado em todas).
2. Boas-vindas sem convite a escrever.
3. Pedido de recepção não tenta resolver; o assunto chega depois da transferência.
4. Sem confirmação "resolvido" nem evento de dúvida respondida.
5. Sem indicador de resolução; "Precisaram da recepção" é por contato, não por necessidade.

## 3. Dúvidas de negócio (rodada 1)

Decisões do cliente:

1. **BC ligada por padrão com o "Bot de WhatsApp"**: ao habilitar o bot, "Perguntas frequentes no bot" vem ligado;
   o item fica na matriz para o Suporte desligar. Clínicas que já têm o bot recebem o item na migração.
2. **Boas-vindas** (padrão; texto próprio da clínica continua valendo): "Olá! 👋 Aqui é da Clínica X.\n\nSou a
   assistente virtual e estou aqui para ajudar.\nVocê pode escrever o que precisa ou escolher uma das opções
   abaixo." + menu. Sem a BC ligada, o texto de antes (não convida a escrever).
3. **Pedido de recepção sem motivo** ("atendente" digitado e a opção do menu): "Claro! 😊 Poderia me contar
   brevemente o que você precisa? Assim, talvez eu consiga ajudar você agora. Se preferir, toque abaixo e passo para
   a recepção." + [Falar com a recepção]. Pedir de novo transfere direto. Substitui o Sim/Não. O motivo passa pela
   BC; transferido, o motivo vira o assunto (não pergunta de novo). Botão de saída e ações do agendamento seguem
   transferindo direto.
4. **Direto para a recepção (situação C):** entradas da BC com resposta do tipo "recepção" (o Suporte cadastra
   reclamação, reembolso etc.), mais o pedido repetido.
5. **Resposta no pedido de recepção:** a resposta + "Espero ter ajudado! 😊 Conseguiu resolver ou ainda quer falar
   com a recepção?" [Resolvido] [Falar com a recepção] [Marcar consulta, se a clínica marca pelo bot]. Resolvido →
   "Que bom! Se precisar, é só escrever por aqui.", sem pendência.
6. **Fora do pedido de recepção**, fora de um fluxo: a resposta da BC vem com "Isso resolve sua dúvida?"
   [Resolvido] [Voltar ao menu] [Falar com a recepção], no lugar do menu repetido. Dentro de um fluxo, como hoje.
7. **Unidade da métrica:** mesmo contato + mesmo tipo em 24h = uma necessidade, com o melhor desfecho.
8. **Dúvida sem o "Resolvido":** inconclusiva (entra na taxa como não resolvida); a tela mostra "respondidas sem
   confirmação" à parte.
9. **Tela:** bloco "Resolução sem a recepção" no topo da aba Agendamento digital (taxa, números, evolução por dia,
   tabela por tipo), fora do filtro de operação, com período e comparação. Sai o cartão "Precisaram da recepção".
