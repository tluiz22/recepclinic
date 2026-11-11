// Tecnologia › Jornada do bot (cliente, 30/out/2026): o caminho do paciente no
// WhatsApp, para apresentar ao dono da clínica. Espelha o bot em
// src/lib/data/whatsapp/bot/ (entry.ts, menus.ts, booking.ts, manage.ts,
// router.ts) e as mensagens automáticas (templates). Regra do projeto
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

// 1º menu da conversa, logo após as boas-vindas (cliente, 04/nov/2026).
const FIRST_MENU =
  "Menu principal com a apresentação: \"Estamos aqui para ajudar você! 😊 Por aqui, você pode: 📅 Agendar ou remarcar consultas e exames. 🔄 Solicitar cancelamentos ou entrar na fila de espera. ℹ️ Consultar informações sobre atendimentos. 👩‍💼 Falar diretamente com a recepção, se precisar de ajuda. Como podemos ajudar? Escolha uma das opções abaixo ou escreva sua pergunta.\" Botão \"Ver opções\": Consultas · Exames · Informações gerais · Falar com a recepção, cada uma com descrição";
const FIRST_MENU_NOTE =
  "Só aparecem as opções (e as linhas da apresentação) que a clínica usa: sem exames, \"consultas\"; sem Lista de espera, sem a fila; recepção só com coexistência. Sem Perguntas frequentes, termina em \"Escolha uma das opções abaixo.\" Nas outras vezes, o menu curto (\"Escolha uma opção abaixo ou faça uma pergunta.\").";

// Clínica com mais de um profissional (MB, cliente, 07/nov/2026): especialidade e profissional antes do menu.
const CHOOSE_PROFESSIONAL: FlowItem[] = [
  check("A clínica tem mais de um profissional no bot?", "Não (um profissional só, como a piloto): nada muda, o menu vem direto."),
  bot(
    "\"Para qual especialidade é o atendimento?\" Lista das especialidades (e \"Exames\", com exame na agenda da equipe)",
    "Profissional sem especialidade fica em \"Outros profissionais\". O nome escrito também vale (\"cardiologia\"). Mais de 10 opções: \"Mais opções\".",
  ),
  branch(
    ["Exames", [bot("\"Certo, vamos ver os exames.\" e o submenu Exames, sem profissional", "Só os exames da equipe (serviços sem profissional; MS, 07/11). O exame de um profissional fica no menu dele.")]],
    [
      "Uma especialidade",
      [
        check("Mais de um profissional nela?"),
        branch(
          ["Não", [bot("\"Atendimento com *Dr. X* (Cardiologia).\"")]],
          ["Sim", [bot("\"Com qual profissional?\" (com as outras especialidades de cada um e \"Outra especialidade\")"), bot("\"Atendimento com *Dra. Y* (Pediatria).\"")]],
        ),
      ],
    ],
  ),
  bot(
    "Daqui em diante, tudo no contexto dele",
    "Serviços, valores, formas de pagamento, convênios e observações do profissional escolhido, sem exames: exame fica sempre na agenda de Exames, na opção \"Exames\" da pergunta da especialidade (cliente, 08/nov/2026; o \"quero marcar exame\" leva para lá). O menu ganha \"Outro profissional\" (volta à especialidade). Remarcar e cancelar mostram todos os atendimentos do paciente. A escolha vale até a conversa recomeçar.",
  ),
];

export type JourneySection = { id: string; title: string; intro: string; flow: FlowItem[] };

export const JOURNEY: JourneySection[] = [
  {
    id: "inicio",
    title: "1. Começo da conversa",
    intro: "O paciente manda qualquer mensagem para o número da clínica, a qualquer hora.",
    flow: [
      patient("\"Oi\" (ou qualquer mensagem)", "Exceções: o número de WhatsApp do suporte do RecepClinic (Sistema › Suporte) nunca passa pelo bot nem entra em Atendimento; número que a equipe marcou como Pessoal ou Administrativo/outros também não (regras gerais)."),
      check("Há atendimento marcado para este número?"),
      branch(
        [
          "Não",
          [
            bot(
              "\"Olá! 👋 Aqui é [clínica]. Sou a assistente virtual e estou aqui para ajudar. Você pode escrever o que precisa ou escolher uma das opções abaixo.\"",
              "Número cadastrado: \"Olá, [primeiro nome]! 👋…\" (no texto próprio da clínica, onde ela pôs {nome}). Sem \"Perguntas frequentes no bot\" (o Suporte desligou), só \"Olá! 👋 Aqui é [clínica].\": o texto livre não seria entendido.",
            ),
            check("A mensagem já diz o que a pessoa precisa?", "Com \"Perguntas frequentes no bot\" (vem ligado com o bot; item 9). \"Oi\" sozinho: não."),
            branch(
              ["Pedido claro (marcar, remarcar, cancelar…)", [bot("Abre esse caminho direto, sem o menu")]],
              ["Pergunta (\"vocês aceitam Unimed?\")", [bot("A resposta e o menu principal com a apresentação", "Sem o \"Isso resolve sua dúvida?\" (item 9).")]],
              ["Não", [...CHOOSE_PROFESSIONAL, bot(FIRST_MENU, FIRST_MENU_NOTE)]],
            ),
          ],
        ],
        [
          "Sim",
          [
            bot("Boas-vindas e \"Identificamos um agendamento associado a este número. Você deseja tratar desse agendamento?\""),
            patient("Sim, quero", "\"Não, outro assunto\": vai para o menu principal, com a apresentação."),
            bot("Pede a data de nascimento do paciente, por segurança", "Nada do atendimento aparece antes disso. Data digitada sem as barras (10032020) ou com o ano em 2 números (25/11/84, 251184; 20xx se não for futura, senão 19xx): pergunta \"Você quis dizer 10/03/2020?\" com Sim · Não; vale em todo pedido de data."),
            check("A data confere com um paciente com atendimento?", "Não: \"Não encontramos agendamentos para essa data de nascimento.\" com Tentar outra data · Voltar ao menu."),
            bot("Mostra o atendimento (dia e hora) e pergunta o que fazer: Confirmar presença · Remarcar · Cancelar · Encaixe ou antecipar · Falar com a recepção"),
          ],
        ],
      ),
    ],
  },
  {
    id: "marcar",
    title: "2. Marcar consulta ou exame",
    intro: "Consultas › Marcar consulta, ou Exames › Marcar exame. Uma jornada só: o bot manda o link do portal de agendamento; o chat só marca o que o portal ainda não marca.",
    flow: [
      check(
        "O portal marca este atendimento?",
        "Sim quando a clínica tem o endereço do portal e o Portal ligado, o profissional aparece no portal e o atendimento é individual, no consultório ou em casa (F3b, 09/nov/2026; domiciliar desde a F3e-1, 10/nov/2026), ou exame em turma da agenda de Exames (F3e-2: o portal mostra os dias com vaga e as turmas do dia, uma a cada duração do exame dentro do horário; 11/nov/2026). Exame sem horário num local da clínica segue no chat.",
      ),
      branch(
        [
          "Sim: link do portal",
          [
            bot(
              "\"Para escolher o dia e o horário de *consulta com Dr(a). X*, toque no link abaixo. Ele vale por 30 minutos e é só para este número\"",
              "Com vários profissionais, o escolhido no começo da conversa; exame: o exame (com mais de um, a lista dos exames). Venceu sem marcar: item 10.",
            ),
            page(
              "Portal: particular ou convênio, dia e horário, para quem é, revisão e \"Confirmar agendamento\"",
              "Sem pedir o código: o celular da conversa já vem confirmado (\"Usar outro número\" pede o código). Um link marca uma vez; outro link do mesmo número desfaz o anterior. Profissional que atende no consultório e em casa: \"No consultório / Em casa\" em cima dos dias; em casa, o endereço depois do paciente (\"Mesmo endereço da última visita\" ou outro).",
            ),
            auto("Confirmação da marcação, com dia, hora e local"),
            auto("Preparo do exame (texto ou arquivo) ou orientações da consulta", "Quando o serviço tem. Consulta em casa: sem as orientações."),
          ],
        ],
        [
          "Não: marcação no chat (como antes)",
          [
          bot("Qual consulta (ou exame) você quer marcar?", "Lista dos serviços, sem preço. Com um serviço só, o bot escolhe sozinho e avisa: \"Vamos marcar *Consulta*\"."),
          check("O serviço tem horário livre no prazo da agenda?", "Prazo para oferecer horários do profissional da agenda (ou da Equipe), no cadastro dele (cliente, 08/nov/2026; antes, da clínica)."),
          branch(
            ["Não", [bot("\"No momento não há horários livres\" e pergunta se quer falar com a recepção", "Sim: a recepção assume (item 8). Não: o menu.")]],
            [
              "Sim",
              [
                bot("Com qual profissional? (ou \"Primeiro horário\")", "Só quando mais de uma agenda atende o serviço no contexto da conversa (com vários profissionais, o paciente já escolheu um no começo). Serviços por profissional (MS, 07/11): as cópias de mesmo nome viram uma opção; escolhida a agenda, valem o valor e o preparo da cópia dela; entre cópias diferentes não há \"Primeiro horário\"."),
                bot("Consultório ou atendimento domiciliar?", "Só quando o serviço tem os dois, sem preço. Domiciliar: pede e confirma o endereço."),
                check("O caminho escolhido aceita convênios?", "Recurso Convênios ligado e algum plano ativo ligado ao profissional escolhido (exame: os planos e o \"Aceita particular\" marcados no cadastro dele, 10/11/2026). Profissional só particular: não pergunta (MC, 07/11/2026). Profissional só convênio (\"Atende particular\" desmarcado no cadastro, 08/11/2026): não pergunta e vai direto a \"Qual é o seu convênio?\"; plano não atendido não oferece particular, avisa e pergunta se quer falar com a recepção; sem nenhum plano ativo, avisa que a marcação é com a recepção."),
                branch(
                  ["Não", [bot("Valor e formas de pagamento", "\"O valor da consulta (ou do exame) é R$ …\" e o texto de formas de pagamento das Configurações.")]],
                  [
                    "Sim",
                    [
                      bot("O atendimento será particular ou por convênio?"),
                      branch(
                        ["Particular", [bot("Valor e formas de pagamento")]],
                        [
                          "Convênio",
                          [
                            bot("Qual é o seu convênio?", "Até 8 planos: lista com \"Outro convênio\"; mais que isso, o paciente escreve e confirma na lista. Só os planos ativos que o caminho atende."),
                            check("O plano é atendido pelo profissional escolhido (ou por algum, no \"Primeiro horário\")?"),
                            branch(
                              ["Sim", [bot("\"Atendemos pelo convênio *X*\"", "Sem valor. O plano fica no atendimento; a página só oferece quem atende o plano.")]],
                              ["Não", [bot("Não atende e pergunta se quer particular", "Sim: valor e formas de pagamento. Não: pergunta se quer falar com a recepção (item 8).")]],
                            ),
                          ],
                        ],
                      ),
                    ],
                  ],
                ),
                bot("É para você ou para outra pessoa?", "Clínica pediátrica: só no exame."),
                bot("\"Dr(a). X atende pacientes até N anos\"", "Só na consulta, com idade limite no cadastro do profissional da agenda (cliente, 08/nov/2026; antes, da clínica). No \"Primeiro horário\": \"A clínica atende…\"."),
                bot(
                  "Identifica o paciente: escolhe um já cadastrado ou informa nome completo e data de nascimento",
                  "Número novo: o paciente primeiro, depois o nome de quem escreve (paciente menor: \"do responsável\"), que recebe os lembretes. Menor de 18 anos marcando para si: só pelo responsável. Acima da idade limite: \"Dr(a). X atende pacientes até N anos. Deseja agendar para outra criança?\"",
                ),
                check("O paciente já tem esse atendimento marcado?"),
                branch(
                  ["Sim", [bot("Avisa o dia marcado e indica Remarcar")]],
                  [
                    "Não",
                    [
                      bot("Manda o link para escolher dia e horário", "O link vale 30 minutos. Venceu sem marcar: item 10."),
                      page("Escolhe o dia e o horário livres e confirma", "Antes de gravar, confirma num quadro com o atendimento, o dia e o horário, o profissional e o local."),
                      auto("Confirmação da marcação, com dia, hora e local"),
                      auto("Preparo do exame (texto ou arquivo) ou orientações da consulta", "Quando o serviço tem. Consulta em casa: sem as orientações."),
                    ],
                  ],
                ),
              ],
            ],
          ),
          ],
        ],
      ),
    ],
  },
  {
    id: "retorno",
    title: "3. Marcar retorno",
    intro: "Consultas › Marcar retorno. Só para quem tem direito, com o profissional da consulta de origem.",
    flow: [
      check("O portal marca o retorno?", "Mesma regra da marcação (item 2)."),
      branch(
        [
          "Sim: link do portal",
          [
            bot("\"Para escolher o dia e o horário do *retorno*, toque no link abaixo…\""),
            page(
              "Portal: de qual consulta é o retorno, dias só até o fim do prazo, revisão sem valor e \"Marcar retorno\"",
              "As mesmas regras do bot: sem direito, explica o motivo (prazo vencido com \"Agendar consulta com…\").",
            ),
            auto("Confirmação da marcação"),
          ],
        ],
        [
          "Não: no chat (como antes)",
          [
          check("Algum paciente deste número tem consulta recente, dentro do prazo do retorno, sem retorno marcado?"),
          branch(
            ["Não", [bot("Explica o motivo (prazo vencido, retorno já usado, consulta domiciliar) e indica Marcar consulta")]],
            [
              "Sim",
              [
                bot("Prazo e \"Para qual paciente é o retorno?\"", "Sem falar de valor."),
                bot("Manda o link, com datas só até o fim do prazo"),
                page("Escolhe o dia e o horário e confirma", "Antes de gravar, confirma num quadro com o atendimento, o dia e o horário, o profissional e o local."),
                auto("Confirmação da marcação"),
              ],
            ],
          ),
          ],
        ],
      ),
    ],
  },
  {
    id: "remarcar-cancelar",
    title: "4. Remarcar ou cancelar",
    intro: "Pelo menu (Consultas ou Exames), pela entrada da conversa ou pelos botões do lembrete. No portal, Minhas consultas também remarca e cancela (com o prazo de antecedência da clínica, se houver; padrão sem prazo).",
    flow: [
      check("Há atendimento futuro neste número?", "Não: avisa e volta ao menu."),
      bot("Pede a data de nascimento e mostra o atendimento", "Pelo lembrete, vai direto ao atendimento do lembrete."),
      branch(
        [
          "Remarcar",
          [
            bot("Retorno: confere o prazo. Turma: segue no link de hoje (entra no portal depois)", "Em casa: o portal pergunta se o endereço continua o mesmo (F3e-1, 10/nov/2026)."),
            bot(
              "\"Para escolher o novo dia e horário para a consulta de *[paciente]*, toque no link abaixo…\"",
              "Link do portal (F3c, 10/nov/2026), sem o prazo de antecedência: o Remarcar do WhatsApp remarca a qualquer hora. Venceu sem remarcar: item 10.",
            ),
            page("Portal: dias e horários do mesmo profissional, \"Confirme a remarcação\" com o horário de hoje e o novo", "Sem pedir o código: o celular da conversa já vem confirmado."),
            auto("Confirmação da remarcação"),
          ],
        ],
        [
          "Cancelar",
          [
            bot("\"Confirma o cancelamento?\" com os botões Sim e Não", "Toda confirmação de Sim ou Não do bot (dados, paciente, endereço, cancelamento) vem com esses botões; digitar sim ou não também vale."),
            branch(
              ["Sim", [bot("\"Prontinho, cancelamos…\""), auto("A vaga é oferecida à lista de espera", "Com a Lista de espera ligada.")]],
              ["Sem resposta por 15 minutos", [bot("A mensagem do pedido não concluído (item 10)")]],
              ["Não", [bot("Mantém o atendimento e pergunta se quer confirmar a presença")]],
            ),
          ],
        ],
      ),
    ],
  },
  {
    id: "encaixe",
    title: "5. Encaixe ou antecipar",
    intro: "Com a Lista de espera ligada: para quem quer um horário mais cedo do que o marcado.",
    flow: [
      bot("Pergunta o tipo: Consulta, Retorno ou Exame", "Só quando o paciente pede \"encaixe\" por escrito sem dizer o tipo (só os tipos que a clínica oferece). Pelo menu Consultas ou Exames, o tipo já está escolhido."),
      bot("Pede a data de nascimento e mostra o atendimento", "Sem atendimento marcado: oferece marcar agora; o link do portal avisa que, ao marcar, entra na lista de espera (o portal repete o aviso nos horários e na revisão). Com mais de um serviço marcado, lista os serviços para escolher antes dos atendimentos."),
      check("Há horário livre antes do atendimento?"),
      branch(
        ["Sim", [bot("\"Quer antecipar para um destes?\""), patient("Escolhe um horário (ou \"Nenhum desses\")"), bot("Confirma e antecipa")]],
        ["Não", [bot("Entra na lista de espera", "Quem já está na lista pode sair.")]],
      ),
      auto("Quando abre uma vaga antes: oferta da vaga com Sim e Não", "A vaga fica reservada para a pessoa enquanto ela pode responder."),
    ],
  },
  {
    id: "informacoes",
    title: "6. Informações gerais",
    intro: "Só aparecem os itens preenchidos. Formas de pagamento, convênios e observações são do profissional em uso (Configurações › Profissionais; MI, 07/11/2026).",
    flow: [
      bot("O que você gostaria de saber?"),
      branch(
        ["Valores", [bot("Preço de cada serviço (consultório e domiciliar) e as formas de pagamento do profissional")]],
        ["Convênios", [bot("\"Convênios atendidos por *Dra. Y*: Unimed, Amil.\" (ou \"atende só particular\") e o texto dele sobre convênios", "Só com algum plano ativo na clínica; sem o item Convênios, só o texto.")]],
        ["Endereço", [bot("Cada local, com o link do mapa")]],
        ["Preparo para exames", [bot("Escolhe o exame e recebe o preparo (texto ou arquivo)")]],
        ["Outras informações", [bot("As observações do profissional")]],
      ),
      bot("Volta à lista de informações"),
    ],
  },
  {
    id: "depois",
    title: "7. Depois de marcar",
    intro: "Mensagens que saem sozinhas, sem ninguém da equipe. Com mais de um responsável na ficha, vão para quem marcou (ou para o escolhido pela recepção); quem remarca pelo portal passa a recebê-las (D14, 11/nov/2026).",
    flow: [
      auto("Confirmação, com preparo ou orientações quando houver", "Consulta em casa: sem as orientações gerais (cliente, 10/nov/2026)."),
      auto("Lembrete na véspera ou no dia (como a clínica escolher), com Confirmar presença · Remarcar · Cancelar"),
      branch(
        ["Confirmar presença", [bot("\"Presença confirmada ✓\"", "Em seguida, outra mensagem com o nome e o endereço do local e o link do Google Maps (só local da clínica com endereço)"), reception("A agenda mostra a presença confirmada")]],
        ["Remarcar", [bot("Segue o caminho do Remarcar (item 4)")]],
        ["Cancelar", [bot("Segue o caminho do Cancelar (item 4)")]],
      ),
      auto(
        "Se a clínica bloquear o dia: aviso de cancelamento com o link para remarcar",
        "O link abre o portal (F3c) com os dias e horários do mesmo profissional, por 2 dias; retorno sem o limite do prazo. Em casa, o portal pergunta se o endereço continua o mesmo (F3e-1). Turma: o link de hoje.",
      ),
    ],
  },
  {
    id: "recepcao",
    title: "8. Quando a recepção entra",
    intro: "O número continua no WhatsApp Business da recepção. O bot sai de cena quando uma pessoa precisa atender.",
    flow: [
      check("Por que a conversa vai para a recepção?"),
      branch(
        [
          "O paciente pede",
          [
            patient("Toca em \"Falar com a recepção\" no menu (ou escreve \"atendente\", \"secretária\" ou \"atendimento\")", "O botão de saída de uma resposta não entendida e as ações do agendamento transferem direto. \"Atendimento\" só quando a mensagem é o pedido (\"quero atendimento\"); \"horário de atendimento\" vai para a base (cliente, 06/nov/2026)."),
            check("O pedido já traz o motivo (\"atendente, qual o endereço?\")?", "Só com \"Perguntas frequentes no bot\". Digitado sem motivo (\"secretária\", \"atendente\"), com ou sem a base: pergunta \"Você quer falar com a recepção?\" com Sim · Não (cliente, 06/nov/2026)."),
            branch(
              ["Não", [bot("Pelo menu: transfere direto (abaixo). Digitado: \"Você quer falar com a recepção?\" Sim · Não", "Sem perguntar o motivo antes (cliente, 06/nov/2026). Sim transfere; Não: \"Tudo bem, seguimos por aqui.\" e o menu.")]],
              [
                "Sim, e a base de conhecimento tem resposta",
                [
                  bot("Responde (ou abre o caminho: marcar, remarcar, cancelar) e pergunta \"Espero ter ajudado! 😊 Conseguiu resolver ou ainda quer falar com a recepção?\"", "Botões: Resolvido · Falar com a recepção · Agendar Atendimento (pergunta Consulta · Retorno · Exame, só o que a clínica marca pelo bot; um tipo só vai direto; serviço citado na resposta abre ele). No meio de uma marcação, ela para (pediu a recepção)."),
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
        ["Não há o que marcar", [bot("Sem serviço, sem horário livre ou convênio não atendido sem particular: avisa")]],
      ),
      check("Quando o bot oferece: \"Você quer falar com a recepção?\"", "Nunca transfere sem perguntar (cliente, 31/out/2026). Sem a recepção no app: \"Você quer que a clínica entre em contato por aqui?\". Fora disso, só o limite de marcações do contato transfere direto."),
      branch(
        ["Não", [bot("\"Tudo bem, seguimos por aqui.\" e o menu", "Clínica sem nada para marcar: \"Se precisar, é só mandar mensagem por aqui.\" e a próxima mensagem recomeça.")]],
        ["Sim", [bot("A conversa passa para a recepção")]],
      ),
      bot("\"Vou te transferir para a recepção…\"; o bot fica pausado nessa conversa", "Fora do horário da recepção (Configurações › Clínica), acrescenta que responde a partir da próxima abertura. Em recesso da clínica (bloqueio marcado como recesso), envia a mensagem de recesso no lugar, com a data de retorno."),
      bot(
        "\"Para agilizar, poderia me contar brevemente qual assunto deseja tratar com a secretária?\"",
        "Uma vez por transferência, e só quando o motivo ainda não foi contado. A primeira resposta em texto (antes de a recepção responder) aparece na tela Atendimento, sem resposta do bot (cliente, 06/nov/2026); sem resposta: \"Assunto ainda não informado\".",
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
    title: "9. Perguntas frequentes",
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
              "No menu principal: \"Escolha uma opção abaixo ou faça uma pergunta.\"; nos submenus (Consultas, Exames, Informações gerais), o próprio submenu. Sem o \"Isso resolve sua dúvida?\" (cliente, 04/nov/2026). Nas Métricas, a dúvida conta como resolvida se o paciente não pedir a recepção nos 30 minutos seguintes.",
            ),
            bot(
              "Convênio de um exame (\"a espirometria aceita Unimed?\"): responde pelo cadastro do exame",
              "\"Sim, *Espirometria* aceita *Unimed*.\" ou \"não aceita…; pode ser feito particular\". Convênio que só algum exame aceita: \"Aceitamos *X* nos exames: …\" (10/11/2026).",
            ),
            bot("No meio de um caminho: responde e repete a pergunta em que a pessoa estava", "A marcação continua de onde estava. \"Quanto custa?\" depois de escolher o serviço: o valor dele."),
            bot("Pedido de marcar, remarcar, cancelar ou confirmar: abre esse caminho", "Marcar consulta ou exame abre o submenu Consultas ou Exames (marcar, retorno, remarcar, cancelar, encaixe). Remarcar e cancelar como no item 4; nada de data digitada. Encaixe, adiantar ou antecipar: o Encaixe ou antecipar (sem a Lista de espera, pergunta se quer falar com a recepção)."),
          ],
        ],
        ["Em dúvida", [bot("\"Você quis dizer…?\" com até 3 opções e \"Nenhuma destas\"")]],
        ["Pergunta de saúde", [bot("\"Por aqui não conseguimos dar orientação de saúde.\" e \"Quer falar com a recepção?\"", "Sintoma junto com pedido de marcação: abre o submenu de marcar.")]],
        ["Não", [bot("O \"não entendi\" de sempre", "A pergunta fica, sem o telefone, para o Suporte melhorar as respostas.")]],
      ),
    ],
  },
  {
    id: "nao-concluido",
    title: "10. Pedido não concluído",
    intro: "O link de marcar ou remarcar venceu sem uso (30 minutos; 2 dias no cancelamento pela clínica), ou o cancelamento ficou sem resposta por 15 minutos.",
    flow: [
      check(
        "O pedido ainda está em aberto?",
        "Não manda nada se: a conversa está com a recepção ou em outro caminho, já há um link mais novo, o atendimento foi remarcado, cancelado ou marcado de outro jeito, ou a última mensagem do paciente tem mais de 24 horas. Sai uma vez por pedido.",
      ),
      bot(
        "\"Não concluímos a marcação | remarcação | o cancelamento de [paciente]. Como prefere seguir?\" com Novo link (no cancelamento, Cancelar agora) · Falar com a recepção · Desistir",
        "Link do portal vencido sem marcar: \"Não concluímos a sua marcação. Como prefere seguir?\" (o portal pergunta o paciente depois); o novo link abre o portal no mesmo ponto.",
      ),
      branch(
        ["Novo link", [bot("Um novo link igual ao anterior, que vale 30 minutos")]],
        ["Cancelar agora", [bot("\"Confirma o cancelamento?\" de novo, com Sim e Não")]],
        ["Falar com a recepção", [reception("A conversa vai para Atendimento humano, com o assunto \"Não concluiu a … de [paciente] pelo WhatsApp.\"")]],
        ["Desistir", [bot("\"Tudo bem, a consulta de [paciente] continua marcada para [data].\"", "Na marcação: \"Tudo bem. Quando quiser, é só mandar uma mensagem.\"")]],
        ["Sem resposta", [bot("Depois de 15 minutos, o aviso de encerramento de sempre")]],
      ),
    ],
  },
];

/** Regras gerais, fora do desenho. */
export const JOURNEY_RULES = [
  "A qualquer momento: \"0\" ou \"Voltar ao menu\" volta ao menu principal.",
  "\"voltar\" ou \"menu anterior\" digitado: no meio de um caminho, o submenu de onde veio (Consultas ou Exames); no preparo de exame, Informações gerais; nos menus, o menu principal.",
  "Conversa parada por 15 minutos: o bot encerra com aviso; a próxima mensagem começa de novo. Exceção: o cancelamento sem resposta ao \"Confirma o cancelamento?\" recebe a mensagem do pedido não concluído (item 10).",
  "Os botões do lembrete e da oferta de vaga funcionam em qualquer ponto da conversa.",
  "Paciente com mais de um responsável (D14, 11/nov/2026): confirmação, lembrete, preparo, orientações, avisos da clínica e lista de espera vão para quem marcou; \"Confirmar presença\", \"Remarcar\" e \"Cancelar\" do lembrete e a resposta à oferta da lista de espera valem de qualquer responsável ligado (ou de quem marcou); no chat, o bot acha as consultas de todos os pacientes ligados ao número, não só daqueles em que ele é o principal (F3f); o aviso do cancelamento pelo portal vai para quem cancelou e, quando quem remarca ou cancela não é quem marcou, quem marcou recebe \"Consulta remarcada\" ou \"Consulta cancelada\" (modelo próprio da Meta, só com ele aprovado). No portal, cada número vê os pacientes de que é responsável.",
  "Mensagem que não sai por instabilidade da Meta (ex.: \"131000 Something went wrong\"): 3 tentativas. Do bot, 30 segundos e 2 minutos depois, só se a conversa não andou; as automáticas (confirmação, lembrete, avisos), 10 e 30 minutos depois (cliente, 05/nov/2026).",
  "Mensagem automática do app WhatsApp Business (saudação, ausência), até 5 segundos depois da do paciente ou do bot: não pausa o bot; aviso para desligar no app.",
  "Número marcado pela equipe como Pessoal ou Administrativo/outros (Conversas ou Atendimento, só Administrador e Recepção): o bot não responde, a resposta da equipe pelo app não abre atendimento e o número fica fora das métricas e dos pendentes. Os botões do lembrete e da oferta de vaga continuam valendo, com o caminho que abrem (confirmar, remarcar, cancelar). Ao marcar, o atendimento aberto sai sem mensagem; \"Voltar para atendimento\" devolve o número ao bot, também sem mensagem (cliente, 06/nov/2026).",
  "Clínica em implantação: o bot não responde e nenhuma mensagem automática sai.",
  "Clínica suspensa: o bot não responde, nenhuma mensagem automática sai e os links (agendar, preparo, orientações) mostram \"indisponível no momento\"; a mensagem do paciente fica no histórico.",
  "Número sem WhatsApp Business (só no sistema): não há \"Falar com a recepção\".",
];
