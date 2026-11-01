// Tecnologia › Jornada do bot (cliente, 30/out/2026): o caminho do paciente no
// WhatsApp, para apresentar ao dono da clínica. Espelha o bot em
// src/lib/data/whatsapp/bot/ (entry.ts, menus.ts, booking.ts, manage.ts,
// router.ts) e as mensagens automáticas (templates). Regra do projeto
// (CLAUDE.md): mudou a jornada do bot, atualizar este arquivo no mesmo commit,
// junto com JOURNEY_UPDATED.

export const JOURNEY_UPDATED = "31/10/2026";

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

const MENU = "Menu principal: Consultas · Exames · Informações · Falar com a recepção";

export type JourneySection = { id: string; title: string; intro: string; flow: FlowItem[] };

export const JOURNEY: JourneySection[] = [
  {
    id: "inicio",
    title: "1. Começo da conversa",
    intro: "O paciente manda qualquer mensagem para o número da clínica, a qualquer hora.",
    flow: [
      patient("\"Oi\" (ou qualquer mensagem)"),
      check("Há atendimento marcado para este número?"),
      branch(
        [
          "Não",
          [
            bot("\"Olá! 👋 Aqui é [clínica].\""),
            bot("Se a mensagem já traz uma pergunta frequente (\"vocês aceitam Unimed?\"), a resposta", "Com \"Perguntas frequentes no bot\" ligado (item 9). \"Oi\" sozinho: só as boas-vindas."),
            bot(MENU, "Só aparecem as opções que a clínica usa."),
          ],
        ],
        [
          "Sim",
          [
            bot("Boas-vindas e \"Identificamos um agendamento associado a este número. Você deseja tratar desse agendamento?\""),
            patient("Sim, quero", "\"Não, outro assunto\": vai para o menu principal."),
            bot("Pede a data de nascimento do paciente, por segurança", "Nada do atendimento aparece antes disso."),
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
    intro: "Consultas › Marcar consulta, ou Exames › Marcar exame. O dia e o horário são escolhidos numa página, com a agenda real.",
    flow: [
      bot("Qual consulta (ou exame) você quer marcar?", "Lista dos serviços, sem preço. Com um serviço só, o bot escolhe sozinho e avisa: \"Vamos marcar *Consulta*\"."),
      check("O serviço tem horário livre no prazo da agenda?"),
      branch(
        ["Não", [bot("\"No momento não há horários livres\"; a recepção assume a conversa")]],
        [
          "Sim",
          [
            bot("Com qual profissional? (ou \"Primeiro horário\")", "Só quando mais de um profissional atende o serviço."),
            bot("Consultório ou atendimento domiciliar?", "Só quando o serviço tem os dois, sem preço. Domiciliar: pede e confirma o endereço."),
            check("A clínica aceita convênios?", "Recurso Convênios ligado e pelo menos um plano ativo."),
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
                        bot("Qual é o seu convênio?", "Até 8 planos: lista com \"Outro convênio\"; mais que isso, o paciente escreve e confirma na lista. Só planos ativos."),
                        check("O plano é atendido pelo profissional escolhido (ou por algum, no \"Primeiro horário\")?"),
                        branch(
                          ["Sim", [bot("\"Atendemos pelo convênio *X*\"", "Sem valor. O plano fica no atendimento; a página só oferece quem atende o plano.")]],
                          ["Não", [bot("Não atende e pergunta se quer particular", "Sim: valor e formas de pagamento. Não: a recepção assume.")]],
                        ),
                      ],
                    ],
                  ),
                ],
              ],
            ),
            bot("É para você ou para outra pessoa?", "Clínica pediátrica: só no exame."),
            bot("\"Dr(a). X atende pacientes até N anos\"", "Só na consulta, com idade limite na clínica. No \"Primeiro horário\": \"A clínica atende…\"."),
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
                  bot("Manda o link para escolher dia e horário", "O link vale 30 minutos."),
                  page("Escolhe o dia e o horário livres e confirma", "Antes de gravar, confirma num quadro com o atendimento, o dia e o horário, o profissional e o local."),
                  auto("Confirmação da marcação, com dia, hora e local"),
                  auto("Preparo do exame (texto ou arquivo) ou orientações da consulta", "Quando o serviço tem."),
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
  },
  {
    id: "remarcar-cancelar",
    title: "4. Remarcar ou cancelar",
    intro: "Pelo menu (Consultas ou Exames), pela entrada da conversa ou pelos botões do lembrete.",
    flow: [
      check("Há atendimento futuro neste número?", "Não: avisa e volta ao menu."),
      bot("Pede a data de nascimento e mostra o atendimento", "Pelo lembrete, vai direto ao atendimento do lembrete."),
      branch(
        [
          "Remarcar",
          [
            bot("Domiciliar: confirma o endereço. Retorno: confere o prazo"),
            bot("Manda o link para o novo dia e horário"),
            page("Escolhe o novo horário e confirma", "O quadro de confirmação mostra o horário atual e o novo."),
            auto("Confirmação da remarcação"),
          ],
        ],
        [
          "Cancelar",
          [
            bot("\"Confirma o cancelamento?\" Sim ou Não"),
            branch(
              ["Sim", [bot("\"Prontinho, cancelamos…\""), auto("A vaga é oferecida à lista de espera", "Com a Lista de espera ligada.")]],
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
      bot("Pede a data de nascimento e mostra o atendimento", "Sem atendimento marcado: oferece marcar agora e entrar na lista depois."),
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
    title: "6. Informações",
    intro: "Só aparecem os itens que a clínica preencheu em Configurações.",
    flow: [
      bot("O que você gostaria de saber?"),
      branch(
        ["Valores", [bot("Preço de cada serviço (consultório e domiciliar) e as formas de pagamento")]],
        ["Convênios", [bot("O texto de convênios da clínica")]],
        ["Endereço", [bot("Cada local, com o link do mapa")]],
        ["Preparo para exames", [bot("Escolhe o exame e recebe o preparo (texto ou arquivo)")]],
        ["Outras informações", [bot("O texto de observações da clínica")]],
      ),
      bot("Volta à lista de informações"),
    ],
  },
  {
    id: "depois",
    title: "7. Depois de marcar",
    intro: "Mensagens que saem sozinhas, sem ninguém da equipe.",
    flow: [
      auto("Confirmação, com preparo ou orientações quando houver"),
      auto("Lembrete na véspera ou no dia (como a clínica escolher), com Confirmar presença · Remarcar · Cancelar"),
      branch(
        ["Confirmar presença", [bot("\"Presença confirmada ✓\""), reception("A agenda mostra a presença confirmada")]],
        ["Remarcar", [bot("Segue o caminho do Remarcar (item 4)")]],
        ["Cancelar", [bot("Segue o caminho do Cancelar (item 4)")]],
      ),
      auto("Se a clínica bloquear o dia: aviso de cancelamento com o link para remarcar"),
    ],
  },
  {
    id: "recepcao",
    title: "8. Quando a recepção entra",
    intro: "O número continua no WhatsApp Business da recepção. O bot sai de cena quando uma pessoa precisa atender.",
    flow: [
      check("Por que a conversa vai para a recepção?"),
      branch(
        ["O paciente pede", [patient("Toca em \"Falar com a recepção\" (ou escreve pedindo)", "Escrito: o bot confirma antes.")]],
        ["O bot não entende", [bot("Na 4ª mensagem seguida que não entende, passa para a clínica", "Áudio, foto e figurinha: o bot avisa que só lê texto.")]],
        ["Não há o que marcar", [bot("Sem serviço, sem horário livre ou convênio não atendido sem particular: avisa que a recepção responde")]],
      ),
      bot("\"Vou te transferir para a recepção…\"; o bot fica pausado nessa conversa"),
      bot(
        "\"Para agilizar, poderia me contar brevemente qual assunto deseja tratar com a secretária?\"",
        "Uma vez por transferência. A primeira resposta em texto (antes de a recepção responder) aparece na tela Atendimento; sem resposta: \"Assunto ainda não informado\".",
      ),
      reception("Responde pelo app WhatsApp Business, no celular ou no computador", "Responder pelo app também pausa o bot. A tela Atendimento mostra quem espera."),
      reception("Manda #bot ou toca em \"Devolver ao bot\" no painel: o bot volta a atender essa conversa"),
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
            bot("Responde com os dados da clínica e repete a pergunta em que a pessoa estava", "No meio da marcação, a marcação continua de onde estava. \"Quanto custa?\" depois de escolher o serviço: o valor dele."),
            bot("Pedido de marcar, remarcar, cancelar ou confirmar: abre esse caminho", "Marcar consulta ou exame abre o submenu Consultas ou Exames (marcar, retorno, remarcar, cancelar, encaixe). Remarcar e cancelar como no item 4; nada de data digitada. Encaixe, adiantar ou antecipar: o Encaixe ou antecipar (sem a Lista de espera, pergunta se quer falar com a recepção)."),
          ],
        ],
        ["Em dúvida", [bot("\"Você quis dizer…?\" com até 3 opções e \"Nenhuma destas\"")]],
        ["Pergunta de saúde", [bot("\"Por aqui não conseguimos dar orientação de saúde.\" e \"Quer falar com a recepção?\"", "Sintoma junto com pedido de marcação: abre o submenu de marcar.")]],
        ["Não", [bot("O \"não entendi\" de sempre", "A pergunta fica, sem o telefone, para o Suporte melhorar as respostas.")]],
      ),
    ],
  },
];

/** Regras gerais, fora do desenho. */
export const JOURNEY_RULES = [
  "A qualquer momento: \"0\" ou \"Voltar ao menu\" volta ao menu principal.",
  "\"voltar\" ou \"menu anterior\" digitado: no meio de um caminho, o submenu de onde veio (Consultas ou Exames); no preparo de exame, Informações; nos menus, o menu principal.",
  "Conversa parada por 15 minutos: o bot encerra com aviso; a próxima mensagem começa de novo.",
  "Os botões do lembrete e da oferta de vaga funcionam em qualquer ponto da conversa.",
  "Clínica em implantação: o bot não responde e nenhuma mensagem automática sai.",
  "Número sem WhatsApp Business (só no sistema): não há \"Falar com a recepção\".",
];
