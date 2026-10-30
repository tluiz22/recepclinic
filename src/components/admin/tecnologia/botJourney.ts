// Tecnologia › Jornada do bot (cliente, 30/out/2026): o caminho do paciente no
// WhatsApp, para apresentar ao dono da clínica. Espelha o bot em
// src/lib/data/whatsapp/bot/ (entry.ts, menus.ts, booking.ts, manage.ts,
// router.ts) e as mensagens automáticas (templates). Regra do projeto
// (CLAUDE.md): mudou a jornada do bot, atualizar este arquivo no mesmo commit,
// junto com JOURNEY_UPDATED.

export const JOURNEY_UPDATED = "30/10/2026";

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
          [bot("\"Olá! 👋 Aqui é [clínica].\""), bot(MENU, "Só aparecem as opções que a clínica usa.")],
        ],
        [
          "Sim",
          [
            bot("Boas-vindas e \"Identificamos um agendamento associado a este número. Você deseja tratar desse agendamento?\""),
            patient("Sim, quero", "\"Não, outro assunto\": vai para o menu principal."),
            bot("Pede a data de nascimento do paciente, por segurança", "Nada do atendimento aparece antes disso."),
            check("A data confere com um paciente com atendimento?", "Não: Falar com a recepção · Tentar outra data · Voltar ao menu."),
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
      bot("Qual consulta (ou exame) você quer marcar?", "Lista dos serviços, sempre mostrada, mesmo com um só."),
      check("O serviço tem horário livre no prazo da agenda?"),
      branch(
        ["Não", [bot("\"No momento não há horários livres\"; a recepção assume a conversa")]],
        [
          "Sim",
          [
            bot("Com qual profissional? (ou \"Primeiro horário\")", "Só quando mais de um profissional atende o serviço."),
            bot("Consultório ou atendimento domiciliar?", "Só quando o serviço tem os dois. Domiciliar: pede e confirma o endereço."),
            bot("É para você ou para outra pessoa?", "Clínica pediátrica: só no exame."),
            bot("Identifica o paciente: escolhe um já cadastrado ou informa nome e data de nascimento", "Na primeira vez, o nome de quem escreve. Menor de 18 anos marcando para si: só pelo responsável. Idade limite do serviço conferida."),
            check("O paciente já tem esse atendimento marcado?"),
            branch(
              ["Sim", [bot("Avisa o dia marcado e indica Remarcar")]],
              [
                "Não",
                [
                  bot("Manda o link para escolher dia e horário", "O link vale 30 minutos."),
                  page("Escolhe o dia e o horário livres e confirma"),
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
            bot("Valor do retorno, prazo e \"Para qual paciente é o retorno?\""),
            bot("Manda o link, com datas só até o fim do prazo"),
            page("Escolhe o dia e o horário"),
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
            page("Escolhe o novo horário"),
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
        ["Não há o que marcar", [bot("Sem serviço ou sem horário livre: avisa que a recepção responde")]],
      ),
      bot("\"Vou te transferir para a recepção…\"; o bot fica pausado nessa conversa"),
      reception("Responde pelo app WhatsApp Business, no celular ou no computador", "Responder pelo app também pausa o bot. A tela Atendimento mostra quem espera."),
      reception("Manda #bot ou toca em \"Devolver ao bot\" no painel: o bot volta a atender essa conversa"),
    ],
  },
];

/** Regras gerais, fora do desenho. */
export const JOURNEY_RULES = [
  "A qualquer momento: \"0\" ou \"Voltar ao menu\" volta ao menu principal.",
  "Conversa parada por 15 minutos: o bot encerra com aviso; a próxima mensagem começa de novo.",
  "Os botões do lembrete e da oferta de vaga funcionam em qualquer ponto da conversa.",
  "Clínica em implantação: o bot não responde e nenhuma mensagem automática sai.",
  "Número sem WhatsApp Business (só no sistema): não há \"Falar com a recepção\".",
];
