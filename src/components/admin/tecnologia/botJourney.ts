// Tecnologia › Jornada do bot (cliente, 30/out/2026): o caminho do paciente no
// WhatsApp, para apresentar ao dono da clínica. Espelha o bot em
// src/lib/data/whatsapp/bot/ (menus.ts, portalLink.ts, manage.ts, router.ts)
// e as mensagens automáticas (templates). Bot enxuto (F3f, 11/nov/2026): o
// WhatsApp é a porta de entrada e o portal marca, remarca e cancela. Regra do projeto
// (CLAUDE.md): mudou a jornada do bot, atualizar este arquivo no mesmo commit,
// junto com JOURNEY_UPDATED.

export const JOURNEY_UPDATED = "11/11/2026";

export type NodeKind = "patient" | "bot" | "page" | "auto" | "reception" | "decision";

export type FlowNode = { kind: NodeKind; text: string; note?: string };
export type FlowBranch = { kind: "branch"; options: { label: string; flow: FlowItem[] }[] };
export type FlowItem = FlowNode | FlowBranch;

export const NODE_STYLES: Record<NodeKind, { label: string; box: string; tag: string }> = {
  patient: { label: "Paciente", box: "border-line-strong bg-white", tag: "text-ink-soft" },
  bot: { label: "Bot", box: "border-brand/40 bg-brand-soft", tag: "text-brand-ink" },
  page: { label: "Página de marcar", box: "border-sv-indigo-200 bg-sv-indigo-50", tag: "text-sv-indigo-700" },
  auto: { label: "Mensagem automática", box: "border-sv-ciano-200 bg-sv-ciano-50", tag: "text-sv-ciano-700" },
  reception: { label: "Recepção", box: "border-pend-200 bg-pend-50", tag: "text-pend-800" },
  decision: { label: "O bot confere", box: "border-dashed border-line-strong bg-canvas", tag: "text-ink-soft" },
};

const bot = (text: string, note?: string): FlowNode => ({ kind: "bot", text, note });
const patient = (text: string, note?: string): FlowNode => ({ kind: "patient", text, note });
const check = (text: string, note?: string): FlowNode => ({ kind: "decision", text, note });
const page = (text: string, note?: string): FlowNode => ({ kind: "page", text, note });
const auto = (text: string, note?: string): FlowNode => ({ kind: "auto", text, note });
const reception = (text: string, note?: string): FlowNode => ({ kind: "reception", text, note });
const branch = (...options: [string, FlowItem[]][]): FlowBranch => ({ kind: "branch", options: options.map(([label, flow]) => ({ label, flow })) });

// Bot enxuto (F3f, BE-2; canvas aprovado pelo cliente em 11/nov/2026).
const FIRST_MENU =
  "Uma mensagem só: \"Clínica [Nome]\" no cabeçalho, \"Olá! Seja bem-vindo(a). Como podemos ajudar?\" e o botão \"Ver opções\": 📅 Agendar (Consulta ou exame, pelo portal) · 🗓 Minhas consultas (Consultar, remarcar ou cancelar) · 👥 Profissionais (Especialidades, valores e convênios) · 🎧 Falar com a recepção (Atendimento com a nossa equipe)";
const FIRST_MENU_NOTE =
  "Número cadastrado: \"Olá, Ana!\". \"Falar com a recepção\" só com coexistência. A clínica pode trocar as boas-vindas em Configurações › Mensagens. Nas outras vezes, o menu curto (\"Escolha uma opção abaixo ou faça uma pergunta.\"). Sem a pergunta \"Identificamos um agendamento…\", sem a data de nascimento e sem a especialidade antes do menu.";

/** Uma mensagem com o botão do link do portal (BE-3); sem o portal, a recepção (F3-5/F3-7). */
const PORTAL_LINK_NOTE =
  "O link vale 30 minutos, é só para este número e abre o portal com o celular já comprovado (sem código). Sem o portal ligado para a clínica: transfere para a recepção (\"Certo! A recepção vai te atender por aqui…\"); sem a recepção no app, \"A clínica responderá sua mensagem em breve.\"";

export type JourneySection = { id: string; title: string; intro: string; flow: FlowItem[] };

export const JOURNEY: JourneySection[] = [
  {
    id: "inicio",
    title: "1. Começo da conversa",
    intro: "O paciente manda a primeira mensagem para o número da clínica.",
    flow: [
      patient("\"Oi\", \"bom dia\" ou uma pergunta"),
      check("A primeira mensagem é uma pergunta que a base de conhecimento responde?", "Só com \"Perguntas frequentes no bot\" ligado (item 5)."),
      branch(
        ["Sim", [bot("A resposta e, em seguida, o menu (BE-7)")]],
        ["Não", [bot(FIRST_MENU, FIRST_MENU_NOTE)]],
      ),
    ],
  },
  {
    id: "portal",
    title: "2. Agendar, Minhas consultas e Profissionais",
    intro: "As três opções levam ao portal numa mensagem, com o botão do link. Marcar, remarcar e cancelar acontecem lá (o chat não marca mais).",
    flow: [
      check("O portal está ligado para a clínica?", PORTAL_LINK_NOTE),
      branch(
        ["📅 Agendar", [bot("\"Para agendar sua consulta ou exame, toque no botão abaixo. Você escolhe o profissional, o dia e o horário.\" [Agendar no portal]"), page("Início do portal: o profissional (ou o exame), o dia, o horário e para quem")]],
        [
          "🗓 Minhas consultas",
          [
            bot("\"Para ver, remarcar ou cancelar suas consultas, toque no botão abaixo.\" [Minhas consultas]"),
            page("Minhas consultas: os atendimentos de todos os pacientes ligados ao número, com Remarcar e Cancelar", "Quando quem remarca ou cancela não é quem marcou, quem marcou recebe \"Consulta remarcada\" ou \"Consulta cancelada\" (VR4)."),
          ],
        ],
        ["👥 Profissionais", [bot("\"Veja os profissionais, valores e convênios aceitos. Se quiser, já agenda por lá.\" [Ver profissionais]"), page("Profissionais, valores e convênios (/medicos), com \"Agendar\" em cada um")]],
        ["🎧 Falar com a recepção", [bot("Segue o item 4")]],
      ),
      bot("Depois do link, a conversa volta ao começo", "A próxima mensagem recebe o menu de novo."),
    ],
  },
  {
    id: "depois",
    title: "3. Depois de marcar",
    intro: "Mensagens que saem sozinhas, sem ninguém da equipe. Com mais de um responsável na ficha, vão para quem marcou (ou para o escolhido pela recepção); quem remarca pelo portal passa a recebê-las (D14, 11/nov/2026).",
    flow: [
      auto("Confirmação, com preparo ou orientações quando houver", "Consulta em casa: sem as orientações gerais (cliente, 10/nov/2026)."),
      auto("Lembrete na véspera ou no dia (como a clínica escolher), com Confirmar presença · Remarcar · Cancelar"),
      branch(
        ["Confirmar presença", [bot("\"Presença confirmada ✓\"", "Em seguida, outra mensagem com o nome e o endereço do local e o link do Google Maps (só local da clínica com endereço)"), reception("A agenda mostra a presença confirmada")]],
        ["Remarcar", [bot("\"Para remarcar a consulta de [paciente], toque no botão abaixo.\" [Remarcar]", "Abre o portal já nos dias e horários do mesmo profissional. Turma, ou sem o portal: a recepção.")]],
        ["Cancelar", [bot("\"Para cancelar a consulta de [paciente], toque no botão abaixo.\" [Cancelar]", "Abre o portal já no \"Tem certeza?\" do cancelamento. Sem o portal: a recepção.")]],
      ),
      auto(
        "Se a clínica bloquear o dia: aviso de cancelamento com o link para remarcar",
        "O link abre o portal (F3c) com os dias e horários do mesmo profissional, por 2 dias; retorno sem o limite do prazo. Em casa, o portal pergunta se o endereço continua o mesmo (F3e-1). Sem o portal, turma ou paciente sem celular: o aviso vai sem o link e a recepção remarca (F3f).",
      ),
    ],
  },
  {
    id: "recepcao",
    title: "4. Quando a recepção entra",
    intro: "O número continua no WhatsApp Business da recepção. O bot sai de cena quando uma pessoa precisa atender.",
    flow: [
      check("Por que a conversa vai para a recepção?"),
      branch(
        [
          "O paciente pede",
          [
            patient("Toca em \"Falar com a recepção\" no menu (ou escreve \"atendente\", \"secretária\" ou \"atendimento\")", "O botão de saída de uma resposta não entendida transfere direto. \"Atendimento\" só quando a mensagem é o pedido (\"quero atendimento\"); \"horário de atendimento\" vai para a base (cliente, 06/nov/2026)."),
            check("O pedido já traz o motivo (\"atendente, qual o endereço?\")?", "Só com \"Perguntas frequentes no bot\". Digitado sem motivo (\"secretária\", \"atendente\"), com ou sem a base: pergunta \"Você quer falar com a recepção?\" com Sim · Não (cliente, 06/nov/2026)."),
            branch(
              ["Não", [bot("Pelo menu: transfere direto (abaixo). Digitado: \"Você quer falar com a recepção?\" Sim · Não", "Sem perguntar o motivo antes (cliente, 06/nov/2026). Sim transfere; Não: \"Tudo bem, seguimos por aqui.\" e o menu.")]],
              [
                "Sim, e a base de conhecimento tem resposta",
                [
                  bot("Responde (ou manda o link: Agendar ou Minhas consultas) e pergunta \"Espero ter ajudado! 😊 Conseguiu resolver ou ainda quer falar com a recepção?\"", "Botões: Resolvido · Falar com a recepção · Agendar Atendimento (o link do Agendar)."),
                  branch(
                    ["Resolvido", [bot("\"Que bom! Se precisar, é só escrever por aqui.\"", "Sem pendência para a recepção; conta como resolvida nas Métricas.")]],
                    ["Falar com a recepção", [bot("Transfere com o motivo como assunto", "Não pergunta o assunto de novo.")]],
                  ),
                ],
              ],
            ),
          ],
        ],
        ["O bot não entende", [bot("Na 4ª mensagem seguida que não entende: \"Não consegui entender sua mensagem.\"", "Áudio, foto e figurinha: o bot avisa que só lê texto.")]],
        ["Sem o portal", [bot("Agendar, Minhas consultas, Profissionais ou o Remarcar/Cancelar do lembrete com o portal desligado: transfere direto")]],
      ),
      check("Quando o bot oferece: \"Você quer falar com a recepção?\"", "Quando o bot não entende (4ª mensagem seguida) ou numa pergunta de saúde (cliente, 31/out/2026). Sem a recepção no app: \"Você quer que a clínica entre em contato por aqui?\"."),
      branch(
        ["Não", [bot("\"Tudo bem, seguimos por aqui.\" e o menu")]],
        ["Sim", [bot("A conversa passa para a recepção")]],
      ),
      bot(
        "\"Certo! A recepção vai te atender por aqui. Escreva sua dúvida, por favor.\" Uma mensagem; o bot fica pausado nessa conversa (BE-4)",
        "Fora do horário da recepção (Configurações › Clínica), na mesma mensagem: \"A recepção atende de seg. a sex., 8h às 18h, e responde assim que abrir.\" Em recesso da clínica (bloqueio marcado como recesso), a mensagem de recesso no lugar, com a data de retorno. A primeira resposta em texto (antes de a recepção responder) vira o assunto na tela Atendimento, sem resposta do bot; sem resposta: \"Assunto ainda não informado\". Na transferência porque o bot não entendeu, o bot ainda pergunta o assunto.",
      ),
      reception(
        "Responde pelo app WhatsApp Business, no celular ou no computador",
        "Responder pelo app também pausa o bot. A tela Atendimento mostra quem espera. Exceção: mensagem que sai do app até 5 segundos depois da do paciente ou do bot (saudação ou ausência automática) não pausa; o Início e Configurações › WhatsApp avisam para desligar.",
      ),
      reception(
        "Com a Central de atendimento ligada: responde pela tela Conversas, dentro das 24 h da última mensagem do paciente",
        "Quem responde assume a conversa; pode mandar texto, foto (JPG ou PNG, até 5 MB) ou PDF (até 10 MB) com legenda. Responder numa conversa finalizada pausa o bot, como pelo app. Se a equipe assume enquanto o bot ainda está respondendo, o bot para ali e não manda mais nada. Passadas 24 h, só o modelo \"Retomar conversa\" (\"Olá! Aqui é da Clínica X. Vi que a nossa conversa de 04/11 ficou pendente. Quer continuar de onde paramos?\"), um por vez; a resposta do paciente reabre a conversa. Paciente esperando 30 min sem resposta, no horário da clínica: a conversa volta para \"Sem responsável\", sem aviso (Central, cliente, 05/nov/2026).",
      ),
      reception(
        "Manda #bot ou toca em \"Finalizar atendimento\" no painel: o bot volta a atender essa conversa, sem mandar nada nem mostrar o menu",
        "O bot só responde na próxima mensagem do paciente, do começo. Se o paciente escreveu depois que a tela abriu, o painel avisa para conferir antes (CA, cliente, 04/nov/2026).",
      ),
      bot(
        "Sem #bot nem \"Finalizar atendimento\": \"Em atendimento\" sem nenhuma mensagem há 12 h volta ao bot, em silêncio",
        "Só quando a recepção já respondeu (\"Aguardando a clínica\" continua com a clínica). Cortesia do paciente depois da resposta (\"ok\", \"obrigado\", \"tchau\", 👍) não volta para Aguardando. Nada é enviado ao paciente (CA, cliente, 04/nov/2026; a C20 mandava uma mensagem de encerramento). A próxima mensagem do paciente começa do início.",
      ),
    ],
  },
  {
    id: "perguntas",
    title: "5. Perguntas frequentes",
    intro:
      "Com \"Perguntas frequentes no bot\" ligado, o paciente pode escrever a pergunta em qualquer ponto da conversa. A resposta sai do cadastro da clínica; o que não está cadastrado, o bot não responde.",
    flow: [
      patient("Escreve uma pergunta (\"qual o endereço?\", \"quanto custa?\", \"aceitam Unimed?\")", "Número, toque, Sim/Não, data, nome e endereço continuam como antes."),
      check("O bot reconhece a pergunta?"),
      branch(
        [
          "Sim",
          [
            bot(
              "Fora de um caminho: responde com os dados da clínica e mostra de novo o menu em que a pessoa estava",
              "\"Escolha uma opção abaixo ou faça uma pergunta.\" com o menu (na 1ª mensagem, o menu com as boas-vindas). Sem o \"Isso resolve sua dúvida?\" (cliente, 04/nov/2026). Nas Métricas, a dúvida conta como resolvida se o paciente não pedir a recepção nos 30 minutos seguintes.",
            ),
            bot(
              "Convênio de um exame (\"a espirometria aceita Unimed?\"): responde pelo cadastro do exame",
              "\"Sim, *Espirometria* aceita *Unimed*.\" ou \"não aceita…; pode ser feito particular\". Convênio que só algum exame aceita: \"Aceitamos *X* nos exames: …\" (10/11/2026).",
            ),
            bot("Pedido de marcar: o link do Agendar; remarcar, cancelar ou \"minha consulta\": o link de Minhas consultas", "Encaixe, adiantar ou antecipar: pergunta se quer falar com a recepção (o Encaixe saiu do chat). Preparo de exame: a lista dos exames com preparo."),
          ],
        ],
        ["Em dúvida", [bot("\"Você quis dizer…?\" com até 3 opções e \"Nenhuma destas\"")]],
        ["Pergunta de saúde", [bot("\"Por aqui não conseguimos dar orientação de saúde.\" e \"Quer falar com a recepção?\"", "Sintoma junto com pedido de marcação: o link do Agendar.")]],
        ["Não", [bot("O \"não entendi\" de sempre", "A pergunta fica, sem o telefone, para o Suporte melhorar as respostas.")]],
      ),
    ],
  },
];

/** Regras gerais, fora do desenho. */
export const JOURNEY_RULES = [
  "A qualquer momento: \"0\", \"Voltar ao menu\" ou \"voltar\" mostra o menu principal.",
  "Conversa parada por 15 minutos fora do começo (no menu, na escolha do preparo): o bot encerra com aviso; a próxima mensagem começa de novo.",
  "Saíram com o bot enxuto (F3f, 11/nov/2026): a marcação no chat, a entrada com a data de nascimento, a especialidade antes do menu, os submenus Consultas e Exames, Informações gerais, o Encaixe no chat e o pedido não concluído.",
  "Os botões do lembrete e da oferta de vaga funcionam em qualquer ponto da conversa.",
  "Paciente com mais de um responsável (D14, 11/nov/2026): confirmação, lembrete, preparo, orientações, avisos da clínica e lista de espera vão para quem marcou; \"Confirmar presença\", \"Remarcar\" e \"Cancelar\" do lembrete e a resposta à oferta da lista de espera valem de qualquer responsável ligado (ou de quem marcou) (F3f); o aviso do cancelamento pelo portal vai para quem cancelou e, quando quem remarca ou cancela não é quem marcou, quem marcou recebe \"Consulta remarcada\" ou \"Consulta cancelada\" (modelo próprio da Meta, só com ele aprovado). No portal, cada número vê os pacientes de que é responsável.",
  "Mensagem que não sai por instabilidade da Meta (ex.: \"131000 Something went wrong\"): 3 tentativas. Do bot, 30 segundos e 2 minutos depois, só se a conversa não andou; as automáticas (confirmação, lembrete, avisos), 10 e 30 minutos depois (cliente, 05/nov/2026).",
  "Mensagem automática do app WhatsApp Business (saudação, ausência), até 5 segundos depois da do paciente ou do bot: não pausa o bot; aviso para desligar no app.",
  "Número marcado pela equipe como Pessoal ou Administrativo/outros (Conversas ou Atendimento, só Administrador e Recepção): o bot não responde, a resposta da equipe pelo app não abre atendimento e o número fica fora das métricas e dos pendentes. Os botões do lembrete e da oferta de vaga continuam valendo (confirmar; remarcar e cancelar mandam o link do portal). Ao marcar, o atendimento aberto sai sem mensagem; \"Voltar para atendimento\" devolve o número ao bot, também sem mensagem (cliente, 06/nov/2026).",
  "Clínica em implantação: o bot não responde e nenhuma mensagem automática sai.",
  "Clínica suspensa: o bot não responde, nenhuma mensagem automática sai e os links (portal, preparo, orientações) mostram \"indisponível no momento\"; a mensagem do paciente fica no histórico.",
  "Número sem WhatsApp Business (só no sistema): não há \"Falar com a recepção\".",
];
