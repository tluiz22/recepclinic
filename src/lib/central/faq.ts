import type { Faq } from "./types";

// Perguntas frequentes: respostas rápidas, cada uma ligada ao artigo completo. Linguagem de quem usa o painel.
// Cada resposta repete só o essencial; a regra está nos artigos (conferidos no código).

const f = (id: string, question: string, answer: string, article: string, keywords: string[] = []): Faq => ({ id, question, answer, article, keywords });

export const FAQS: Faq[] = [
  f("marcar-consulta", "Como marco uma consulta para um paciente?", "Agenda › Marcar: escolha o paciente, o serviço, com quem e o dia e horário, e toque em Marcar.", "marcar-atendimento", ["agendar"]),
  f("marcar-paciente-novo", "O paciente ainda não tem cadastro. Preciso cadastrar antes?", "Não precisa sair do Marcar: use o link de cadastrar novo no passo do paciente.", "marcar-atendimento"),
  f("remarcar", "Como remarco um paciente?", "No cartão do atendimento na Agenda, toque em Remarcar, escolha o novo dia e horário e confirme.", "remarcar-atendimento", ["reagendar", "mudar horário"]),
  f("desmarcar", "Como desmarco uma consulta?", "No cartão do atendimento, toque em Cancelar (em vermelho, à direita) e confirme.", "cancelar-atendimento", ["cancelar"]),
  f("trocar-servico", "Marquei o serviço errado. Preciso cancelar e marcar de novo?", "Não. Em Mais › Alterar você troca serviço, profissional, local, convênio ou horário no mesmo atendimento.", "alterar-atendimento"),
  f("bloquear", "Como bloqueio a agenda do médico nas férias?", "Agenda › Bloquear: marque a agenda, o período e o motivo. Se houver atendimentos, escolha entre bloquear e cancelar ou bloquear e manter.", "bloquear-agenda", ["folga"]),
  f("recesso", "Como marco o recesso da clínica?", "Agenda › Bloquear: marque todas as agendas, ligue \"Recesso da clínica\" e confira a mensagem. Quem pedir a recepção no WhatsApp recebe essa mensagem, com a data de retorno.", "bloquear-agenda", ["férias coletivas", "clínica fechada"]),
  f("desbloquear", "Como desbloqueio um horário?", "Agenda › Bloqueios: abra o bloqueio e remova.", "gerenciar-bloqueios"),
  f("cores", "O que significam as cores dos atendimentos na Agenda?", "Dizem a situação: Não confirmado, Confirmado, Compareceu, Faltou, Cancelado e Bloqueio.", "situacoes-e-acoes-do-cartao"),
  f("registrar-falta", "Como registro que o paciente veio ou faltou?", "No cartão do atendimento, toque em Compareceu ou Faltou. Os que ainda faltam registrar ficam em Relatório do dia › A registrar.", "resumo-do-dia", ["comparecimento"]),
  f("serie", "Como marco um atendimento que se repete toda semana?", "No Marcar, escolha a frequência e até quando. O sistema marca os próximos 3 meses e continua sozinho.", "series-recorrentes"),
  f("retorno", "Por que o botão Marcar retorno não aparece?", "Só aparece na última Consulta do paciente nessa agenda, não domiciliar, dentro do prazo do Retorno e sem retorno já marcado.", "marcar-retorno"),
  f("buscar-paciente", "Como acho um paciente pelo telefone?", "Em Pacientes, digite só os números do telefone (4 ou mais) na busca.", "buscar-pacientes"),
  f("duplicado", "Cadastrei o mesmo paciente duas vezes. Dá para juntar?", "Não existe tela para mesclar cadastros. Mantenha o correto e desative o outro; se a repetida é do outro responsável, ligue o número dele na ficha certa (Responsáveis › Adicionar), que já oferece desativar a outra.", "responsavel-e-contato"),
  f("trocar-telefone", "Como mudo o telefone do paciente?", "Na ficha, em Responsáveis, toque no nome e edite o telefone na página do responsável.", "ficha-do-paciente"),
  f("dois-responsaveis", "O pai e a mãe querem receber as mensagens. Dá?", "Sim: na ficha, Responsáveis › Adicionar liga o número do outro. Os avisos de cada consulta vão para quem marcou; os dois veem e mexem nas consultas pelo portal.", "responsavel-e-contato", ["segundo responsável", "outro número", "pai", "mãe"]),
  f("anonimizar", "O paciente pediu para apagar os dados dele. O que faço?", "O Administrador usa Mais ações › Anonimizar (LGPD) na ficha. É sem volta.", "anonimizar-paciente", ["lgpd"]),
  f("bot-parou", "A conversa parou de ser respondida pelo bot. Por quê?", "Provavelmente está em Atendimento, esperando a clínica. Depois de atender, toque em Finalizar atendimento (ou escreva #bot na conversa).", "atendimento-humano", ["pausado"]),
  f("devolver-bot", "Como devolvo a conversa ao bot?", "Em Atendimento, \"Finalizar atendimento\", ou escreva #bot na conversa pelo app. O bot volta na próxima mensagem do paciente, sem mandar nada antes.", "atendimento-humano"),
  f("bot-nao-agenda", "Por que o bot não está realizando agendamentos?", "Confira se a clínica saiu da implantação, se o WhatsApp está Conectado, se há horário livre no prazo e se o contato não bateu um limite.", "bot-nao-agenda"),
  f("lembrete-nao-saiu", "O paciente não recebeu o lembrete. O que olho?", "Veja Relatório do dia › Lembretes (Não entregue) e Configurações › WhatsApp (conexão, mensagens aprovadas e forma de pagamento na Meta).", "lembrete-nao-saiu"),
  f("confirmar-presenca", "Como o paciente confirma a presença?", "Tocando em Confirmar presença no lembrete do WhatsApp. A recepção também confirma pelo cartão.", "lembretes-e-confirmacoes"),
  f("sem-horario", "Não aparece nenhum horário livre. O que pode ser?", "Falta horário de atendimento, é feriado, há bloqueio, o serviço não está ligado à agenda/local, ou o dia passou do prazo (no bot e no link).", "sem-horario-livre"),
  f("servico-sumiu", "O serviço não aparece para marcar. Por quê?", "Veja o selo dele em Configurações › Serviços: sem agenda, sem local ou sem horário.", "servico-nao-aparece"),
  f("ordem", "Por onde começo a configurar a clínica?", "Clínica, Profissionais, Locais, Agendas, Serviços e Horários, nessa ordem. O guia no topo de Configurações › Clínica mostra o que falta.", "ordem-de-configuracao", ["implantação"]),
  f("cadastrar-medico", "Como cadastro um médico?", "Configurações › Profissionais › Novo profissional. Depois crie a agenda dele em Agendas.", "config-profissionais", ["cadastrar profissional"]),
  f("login-medico", "Como dou acesso ao painel para uma secretária ou médico?", "Configurações › Equipe › Convidar pessoa, com o papel certo. Quem é Profissional precisa ligar ao cadastro de profissional.", "equipe-convidar"),
  f("whatsapp-config", "Como configuro o WhatsApp?", "Configurações › WhatsApp › Conectar WhatsApp, e siga a janela da Meta.", "config-whatsapp"),
  f("sem-permissao", "Não consigo abrir Configurações. Por quê?", "Configurações é só do Administrador. Peça a um Administrador da clínica.", "papeis-e-permissoes", ["acesso negado"]),
  f("limite-profissionais", "A clínica chegou ao limite de profissionais. E agora?", "Desative um profissional que não atende mais, ou fale com o suporte para ampliar o plano.", "config-profissionais"),
  f("contato-revisar", "O que é Contatos para revisar?", "Números que bateram um limite do bot nos últimos 7 dias. Confira, marque pelo painel se fizer sentido e toque em Revisado.", "contatos-para-revisar"),
  f("convenio-nao-aceito", "O paciente é de um convênio que a clínica não atende. O que o bot faz?", "Avisa e pergunta se o paciente quer seguir como particular; se não, pergunta se quer falar com a recepção.", "config-convenios"),
  f("falta-cpf", "A nota fiscal não sai. Por quê?", "Confira o CPF de quem pagou (Financeiro › Falta CPF) e o certificado A1 em Configurações › Nota fiscal.", "emitir-nota-fiscal"),
  f("fuso", "Os horários estão errados. O que verifico?", "O fuso horário em Configurações › Clínica: agenda, lembretes e resumos seguem esse fuso.", "config-clinica"),
];
