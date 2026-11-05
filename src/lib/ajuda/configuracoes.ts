import type { ModuloDeAjuda } from "./tipos";

// Ajuda contextual de Configurações (inventário de 23/out/2026).

export const configuracoes = {
  dicas: {
    // D4 em docs/arquitetura.md; prazo do retorno e preparo em configuracoes/servicos/[id].astro.
    servicoTipo: [
      { termo: "Consulta", texto: "atendimento comum." },
      { termo: "Retorno", texto: "volta ligada a uma consulta anterior, com prazo e valor próprios." },
      { termo: "Exame", texto: "pode ter preparo e ser em turma, com vagas por horário." },
    ],
    // Só exames têm o modo (data-only="exam"); as vagas ficam no horário (capacity, configuracoes/horarios.astro).
    servicoModo: [
      { termo: "Individual", texto: "um paciente por horário." },
      { termo: "Em turma", texto: "vários pacientes no mesmo horário, até o número de vagas, que se define em Horários (\"Vagas da turma\")." },
    ],
    // src/lib/data/whatsapp/preparation.ts (cabeçalho), bot/menus.ts (handlePreparationChoice) e "Reenviar preparo" no cartão da Agenda (cardActions.ts).
    servicoPreparo:
      "Vai uma vez só pelo WhatsApp, como na prévia, logo depois que a confirmação da marcação chega ao paciente; o bot também manda quando ele pede. Não vai no lembrete nem ao remarcar. Se não chegou, use \"Reenviar preparo\" na Agenda. Sem texto e sem arquivo, nada vai.",
    // C7.5: preparation.ts (deliverPreparation, resendPreparation) e o modelo rc_preparo_arquivo_v3.
    servicoPreparoArquivo:
      "Com arquivo, o preparo é o arquivo com a mensagem curta da prévia; as instruções ficam guardadas, sem ir. Vai uma vez só, depois da confirmação, e pelo bot. Se não chegou, use \"Reenviar preparo\" na Agenda. Para voltar às instruções, marque \"Tirar o arquivo\" e salve.",
    // isOverConsultationAgeLimit em src/lib/age.ts; aviso no Marcar e na ficha do paciente.
    clinicaIdade:
      "Para quando a clínica marca Consulta só até certa idade, como na pediatria. Ex.: com 18 anos, quem já fez 18 não marca Consulta pelo bot (Retorno e Exame seguem); no painel, o Marcar e a ficha avisam, sem impedir.",
    // professionalRegistry (config/professionals.ts): só nas telas de Profissionais; nenhuma página do paciente usa.
    profissionalRqe:
      "Registro de Qualificação de Especialista: o número que o conselho dá a quem tem especialidade registrada. Preencha só se tiver. Hoje o registro (conselho, número, UF e RQE) aparece só no painel, em Profissionais.",
    // Lembrete ao profissional (src/lib/data/whatsapp/dailySummary.ts: receives_daily_summary e phone).
    profissionalWhatsapp:
      "Para o profissional receber, pelo WhatsApp da clínica, a lista dos atendimentos das agendas dele (o lembrete ao profissional), na véspera ou no dia, como definido em Configurações › Lembretes.",
    // Tipo do local: endereço do domiciliar pedido no Marcar (marcar.astro, home_visit_address).
    localTipo: [
      { termo: "Consultório", texto: "o paciente vai até a clínica." },
      { termo: "Domiciliar", texto: "a equipe vai até o paciente; o endereço do atendimento é pedido ao marcar." },
    ],
    // Nota fiscal: definições públicas, sem regra fiscal nova (inventário de 23/out/2026).
    nfInscricao:
      "O número da clínica no cadastro de contribuintes do ISS da prefeitura. Costuma estar no alvará ou no comprovante de inscrição municipal; o contador também tem.",
    nfIss: "O percentual do ISS, o imposto municipal sobre o serviço, que vai na nota. Depende do município e do serviço: o contador informa.",
    nfRegime: "Tratamento diferente do ISS que a prefeitura dá a alguns tipos de empresa. Se a clínica não tem nenhum, fica \"Nenhum\".",
    // Assinatura (F12.1, faturamento do SaaS): configuracoes/assinatura.astro.
    assinaturaWhatsapp:
      "Mensagens do RecepClinic sobre a assinatura da clínica, nunca para os pacientes. Saem de um número do próprio RecepClinic, não do número da clínica. Só o Administrador autoriza ou retira; trocar o telefone retira a autorização.",
    assinaturaFranquia:
      "A franquia é a quantidade de notas fiscais por mês incluída na mensalidade. Passou dela, cada nota a mais custa o preço por nota do contrato, cobrado no mês seguinte. Sobra não acumula.",
    assinaturaTelefone: "Telefone de quem cuida das contas da clínica. Pode ser diferente do número que atende os pacientes.",
    // ans_code (config/insurance.ts): só nas telas de Convênios; o bot e as notas não usam.
    convenioAns:
      "Número de registro do plano de saúde na ANS (Agência Nacional de Saúde Suplementar). É opcional e, por enquanto, só aparece aqui, em Convênios.",
    // booking_horizon_days: só o bot (bot/engine.ts) e o link de agendar (agenda/publicBooking.ts) usam.
    clinicaPrazo:
      "Até quantos dias à frente o bot e o link de agendamento mostram horários livres. A recepção, pelo painel, não tem esse limite. Ex.: com 30 dias, o paciente vê horários até daqui a um mês.",
    // AREA_ROLES em src/lib/clinicAccess.ts (D6, D11, F11).
    equipePapeis:
      "Uma pessoa pode ter mais de um papel (ex.: Administrador e Profissional). Configurações é só do Administrador; Métricas, do Administrador e do Profissional (só a própria agenda); Financeiro, do Administrador e da Recepção.",
    // app.can_access_agenda e app.default_agenda_scope (supabase/migrations/20261004130000_configuracao.sql).
    equipeAgendas:
      "Restrito: a pessoa vê só a agenda do profissional ligado a ela e as marcadas aqui (ex.: só a psicóloga e a fisioterapeuta); as outras agendas e os atendimentos delas não aparecem. Sem nenhuma, não vê agenda. O Administrador sempre vê todas.",
    // Sem o item "Exames e procedimentos" (D11), o tipo Exame não aparece.
    servicoTipoSemExame: [
      { termo: "Consulta", texto: "atendimento comum." },
      { termo: "Retorno", texto: "volta ligada a uma consulta anterior, com prazo e valor próprios." },
    ],
  },
  comoFunciona: {
    // Jornada de configuração (setup.ts): Clínica → Profissionais → Locais → Agendas → Serviços → Horários.
    // Equipe é à parte: liga pessoas do painel a um profissional (team.ts) e restringe agendas (app.can_access_agenda).
    clinica: {
      serve: "Dizer ao sistema quem é a clínica. Os dados daqui aparecem para o paciente e regem o fuso, os prazos e as palavras do bot.",
      como: [
        "Identificação, perfil e fuso horário definem como a clínica se apresenta e as palavras das telas e do bot; o fuso vale para a agenda, os lembretes e os resumos.",
        "O prazo para oferecer horários limita até onde o bot e o link de agendamento mostram vagas; a recepção, pelo painel, não tem esse limite.",
        "As páginas públicas (logo, cor e site) e as informações do bot são o que o paciente vê ao agendar e em Informações no WhatsApp.",
        "O horário da recepção diz quando a clínica atende no WhatsApp; fora dele, as conversas entram em Atendimento sem notificação.",
      ],
      depende: [{ texto: "Nada: é o primeiro passo da jornada." }],
      alimenta: [
        { texto: "Profissionais, Locais, Agendas, Serviços e Horários: o guia no topo mostra o que falta em cada um.", href: "/admin/configuracoes/profissionais" },
        { texto: "Lembretes e Mensagens: usam o fuso e o nome da clínica.", href: "/admin/configuracoes/lembretes" },
        { texto: "Feriados: contam como recepção fechada.", href: "/admin/configuracoes/feriados" },
      ],
    },
    locais: {
      serve: "Cadastrar onde a clínica atende: consultórios, com endereço, e o atendimento domiciliar. Sem local, nada pode ser marcado.",
      como: [
        "Consultório: o paciente vai até a clínica, e o endereço vai no lembrete e na confirmação, com o link do mapa.",
        "Domiciliar: a equipe vai até o paciente; o endereço é pedido na hora de marcar. Depende de o item estar liberado para a clínica.",
        "Um local sem endereço (consultório) ou desativado não serve para marcar; a lista mostra o selo do que falta.",
        "O tipo do local não muda depois de criado.",
      ],
      depende: [{ texto: "Clínica: os dados básicos, feitos primeiro.", href: "/admin/configuracoes" }],
      alimenta: [
        { texto: "Serviços: cada serviço é atendido em um ou mais locais.", href: "/admin/configuracoes/servicos" },
        { texto: "Horários: cada horário de atendimento é de um local.", href: "/admin/configuracoes/horarios" },
        { texto: "Informações do bot: o endereço vem daqui.", href: "/admin/configuracoes" },
      ],
    },
    agendas: {
      serve: "Definir a agenda de cada profissional (ou da equipe, para exames). É nela que os atendimentos são marcados.",
      como: [
        "Cada profissional tem uma agenda; a da equipe atende só exames que não são de um profissional cadastrado, e a clínica só pode ter uma.",
        "O intervalo entre atendimentos é o tempo livre deixado depois de cada atendimento dela.",
        "Agenda sem serviço ou sem horário de atendimento não recebe marcações; a lista mostra o selo do que falta.",
        "O tipo e o profissional não mudam depois de criada.",
      ],
      depende: [{ texto: "Profissionais: toda agenda de profissional parte de um cadastro.", href: "/admin/configuracoes/profissionais" }],
      alimenta: [
        { texto: "Serviços: o serviço só aparece para marcar nas agendas marcadas nele.", href: "/admin/configuracoes/servicos" },
        { texto: "Horários: cada horário de atendimento é de uma agenda.", href: "/admin/configuracoes/horarios" },
        { texto: "Equipe: o acesso restrito libera agendas escolhidas.", href: "/admin/configuracoes/equipe" },
      ],
    },
    servicos: {
      serve: "Cadastrar o que o paciente pode marcar: consultas, retornos e exames, com duração, valor e as agendas que atendem.",
      como: [
        "A duração define o tamanho de cada horário livre; o valor aparece no bot e na marcação, e pode ser diferente em cada local.",
        "O serviço só aparece para marcar nas agendas e nos locais marcados nele.",
        "Sem horário de atendimento numa agenda e num local dele, o serviço não aparece no bot nem no link de agendar.",
        "Exame pode ter preparo e ser em turma, com as vagas definidas em Horários.",
      ],
      depende: [
        { texto: "Agendas: pelo menos uma que o atenda.", href: "/admin/configuracoes/agendas" },
        { texto: "Locais: pelo menos um onde seja atendido.", href: "/admin/configuracoes/locais" },
      ],
      alimenta: [
        { texto: "Horários: um horário pode ser de um serviço só ou de todos da agenda.", href: "/admin/configuracoes/horarios" },
        { texto: "Nota fiscal: o código fiscal pode ser definido em cada serviço.", href: "/admin/configuracoes/nota-fiscal" },
      ],
    },
    feriados: {
      serve: "Marcar os dias em que a clínica não atende. Nesses dias a agenda não oferece horário.",
      como: [
        "Os feriados nacionais já vêm cadastrados e não mudam.",
        "Os da clínica (municipais, estaduais, recesso) são um por data.",
        "Feriado tira os horários do dia no painel, no bot e no link de agendar, mas não mexe nos atendimentos já marcados.",
        "Também conta como recepção fechada no WhatsApp.",
      ],
      depende: [{ texto: "Horários: só tiram vagas onde já há horário de atendimento.", href: "/admin/configuracoes/horarios" }],
      alimenta: [{ texto: "Agenda, bot e link de agendar: os dias saem da lista de vagas." }],
    },
    convenios: {
      serve: "Cadastrar os planos de saúde atendidos e como o paciente os escreve no WhatsApp.",
      como: [
        "Os outros nomes ajudam o bot a reconhecer o plano que o paciente escreve.",
        "Cada plano indica os profissionais que o atendem.",
        "A opção de carteirinha e validade pede os dois dados ao marcar por plano, no painel e na página de horário.",
        "Plano não aceito: o bot avisa e pergunta se o paciente quer seguir como particular.",
      ],
      depende: [{ texto: "Profissionais: cada plano indica quais o atendem.", href: "/admin/configuracoes/profissionais" }],
      alimenta: [
        { texto: "Bot e Marcar: oferecem só os planos cadastrados." },
        { texto: "Informações do bot (Clínica): o texto de Convênios é escrito à parte.", href: "/admin/configuracoes" },
      ],
    },
    whatsapp: {
      serve: "Ligar o número de WhatsApp da clínica ao sistema. Sem a conexão, não há bot, lembretes nem avisos.",
      como: [
        "Conectar o número é o que permite ao bot receber e responder as mensagens.",
        "Os avisos que a clínica manda primeiro usam modelos aprovados pela Meta; sem aprovação, não saem.",
        "A situação da conexão e dos modelos aparece aqui; o cadastro técnico e os modelos são do Suporte.",
      ],
      depende: [{ texto: "Clínica: o nome e os dados que vão nas mensagens.", href: "/admin/configuracoes" }],
      alimenta: [
        { texto: "Lembretes: sem a conexão, o lembrete não sai.", href: "/admin/configuracoes/lembretes" },
        { texto: "Mensagens: os textos do bot e os avisos aprovados.", href: "/admin/configuracoes/mensagens" },
        { texto: "Bot de agendamento: todo o caminho do paciente no WhatsApp." },
      ],
    },
    equipe: {
      serve: "Dar acesso ao painel: quem entra, com qual papel e quais agendas vê.",
      como: [
        "Convide pela Equipe: a pessoa recebe um e-mail para criar a senha. Enquanto não aceita, aparece \"Convite pendente\".",
        "O papel define as áreas do painel: Configurações é só do Administrador.",
        "Quem tem o papel Profissional precisa estar ligado a um cadastro de profissional; sem a ligação, a lista avisa \"Falta ligar ao profissional\".",
        "O acesso às agendas pode ser a todas ou só às selecionadas.",
      ],
      depende: [
        { texto: "Profissionais: o cadastro de quem tem o papel Profissional.", href: "/admin/configuracoes/profissionais" },
        { texto: "Agendas: só dá para liberar agendas que já existem.", href: "/admin/configuracoes/agendas" },
      ],
      alimenta: [{ texto: "Quem aparece como autor nos atendimentos (\"Marcado por Maria\") e o que cada pessoa vê na Agenda e nas Métricas." }],
    },
    profissionais: {
      serve: "Cadastrar quem atende. É o primeiro passo da jornada: sem profissional, não existe agenda.",
      como: [
        "O nome do cadastro é o que o paciente vê ao marcar; profissão, conselho e RQE aparecem só no painel.",
        "Cada profissional ativo precisa de uma agenda; sem ela, a lista mostra \"sem agenda\".",
        "O WhatsApp do profissional serve para ele receber o lembrete dos atendimentos, se ligado em Lembretes.",
      ],
      depende: [{ texto: "Clínica: os dados básicos, feitos primeiro.", href: "/admin/configuracoes" }],
      alimenta: [
        { texto: "Agendas: cada agenda pertence a um profissional.", href: "/admin/configuracoes/agendas" },
        { texto: "Equipe: o papel Profissional liga a pessoa a este cadastro.", href: "/admin/configuracoes/equipe" },
        { texto: "Lembretes: o resumo do dia vai ao WhatsApp dele.", href: "/admin/configuracoes/lembretes" },
      ],
    },
    // configuracoes/nota-fiscal.astro (certificado, ambiente) e "Emitir nota" em financeiro/pagamento/[id].astro; F11.3 e F11.4.
    notaFiscal: {
      serve: "Emitir a NFS-e nacional (a nota fiscal de serviço) pelo próprio painel.",
      como: [
        "Preencha os dados fiscais da clínica e, se algum serviço tiver código diferente do padrão, o código dele.",
        "Envie o certificado A1 (arquivo .pfx ou .p12 e a senha), do mesmo CNPJ. O arquivo e a senha ficam criptografados e nunca aparecem na tela, nem para o suporte.",
        "A nota é emitida no Financeiro, na tela do pagamento, no CPF de quem pagou.",
        "Toda clínica começa em testes, sem valor fiscal; o suporte passa a nota a valer depois que o contador confere uma nota de teste.",
      ],
      erro: "Certificado vencido desliga a emissão até o novo ser enviado. Nota recusada pela Receita mostra o motivo na tela do pagamento.",
      depende: [
        { texto: "Clínica: o nome e os dados da clínica.", href: "/admin/configuracoes" },
        { texto: "Serviços: o código fiscal de cada serviço, se for diferente do padrão.", href: "/admin/configuracoes/servicos" },
      ],
      alimenta: [{ texto: "Financeiro: a nota é emitida na tela do pagamento." }],
    },
    // configuracoes/assinatura.astro (F12.1): conta de cobrança, contatos e WhatsApp financeiro; aceite do contrato (F12.2b); passo a passo e renovação (F12.2e); passo Cartão ou Pagamento (F12.2i).
    assinatura: {
      serve: "Guardar quem paga o RecepClinic e para onde vão as cobranças e os avisos.",
      como: [
        "O Suporte cadastra o pagador e o contrato (mensalidade e, com a nota fiscal liberada, o preço por nota e a franquia); para mudar, fale com o Suporte.",
        "Com contrato novo, a tela guia em passos: aceitar o contrato (com a autorização da cobrança mensal); informar o cartão (ou, no Pix, pagar a implantação); se quiser, autorizar os avisos pelo WhatsApp. Ficam registrados data, hora, quem aceitou, IP e versão do texto.",
        "A assinatura é mensal e se renova sozinha no vencimento, até o cancelamento. O cartão é informado uma vez, na página do Asaas, e os meses seguintes são cobrados nele; \"Trocar o cartão\" usa outro. No Pix, cada cobrança tem o \"Pagar com Pix\".",
        "Reajuste anual pelo IPCA e outras mudanças de valor chegam ao e-mail financeiro e à tela 30 dias antes; continuar usando vale como aceite. Texto do contrato novo pede aceite de novo.",
        "Os avisos de cobrança (vencimento, atraso e pagamento reconhecido) sempre vão para o e-mail financeiro; com o WhatsApp financeiro autorizado, também para o telefone financeiro.",
      ],
      erro: "Com o e-mail errado, a clínica perde os avisos de cobrança: confira depois de salvar.",
    },
    // src/pages/admin/configuracoes/mensagens.astro (as duas listas, a revisão do Suporte e as 24 horas).
    mensagens: {
      serve: "Ajustar o que o WhatsApp da clínica diz ao paciente.",
      como: [
        "\"Mensagens do bot\": as respostas da conversa, quando o paciente escreve para a clínica. Valem assim que você salva.",
        "\"Mensagens aprovadas pela Meta\": os avisos que a clínica manda primeiro (lembrete, cancelamento e outros). Um texto novo passa pela revisão do Suporte e pela aprovação da Meta; até lá, segue o texto atual.",
        "Mensagem livre só vai para quem escreveu para a clínica nas últimas 24 horas; para os outros, vai a mensagem aprovada pela Meta.",
      ],
      depende: [{ texto: "WhatsApp: a conexão do número da clínica.", href: "/admin/configuracoes/whatsapp" }],
      alimenta: [{ texto: "Bot e lembretes: o que o paciente lê no WhatsApp." }],
    },
    // src/lib/data/whatsapp/reminders.ts (cabeçalho); botões do template em templates.ts; reenvio de 23/out (retryRules.ts).
    lembretes: {
      serve: "Lembrar o paciente, o profissional e a equipe dos atendimentos, pelo WhatsApp da clínica.",
      como: [
        "Um lembrete por público: na véspera (atendimentos do dia seguinte) ou no dia (os que começam depois do horário), na hora escolhida, das 6h às 20h, no fuso da clínica.",
        "O paciente responde pelos botões \"Confirmar presença\", \"Remarcar\" ou \"Cancelar\".",
        "Atendimento marcado depois do envio fica sem lembrete automático: na Agenda, o botão \"Enviar lembrete\" resolve. Remarcar zera o lembrete.",
        "Falha técnica no envio é tentada de novo sozinha, em 10 e 30 minutos.",
        "Sem o WhatsApp conectado ou sem a mensagem aprovada pela Meta, o lembrete não sai e o histórico do atendimento registra o motivo.",
      ],
      depende: [
        { texto: "WhatsApp: a conexão e as mensagens aprovadas pela Meta.", href: "/admin/configuracoes/whatsapp" },
        { texto: "Horários e Agendas: só há lembrete de atendimento marcado.", href: "/admin/configuracoes/horarios" },
      ],
      alimenta: [{ texto: "Agenda: confirmação, remarcação e cancelamento pelos botões do lembrete." }],
    },
    // src/lib/data/agenda/slots.ts e freeSlots.ts; sem ligação dos atendimentos com o horário (removeAvailabilityWindow).
    horarios: {
      serve: "Dizer quando cada agenda atende. É daqui que saem os horários livres para marcar, no painel, no bot e no link de agendamento.",
      como: [
        "Cada horário é de uma agenda, com os dias da semana, o início e o fim, o local e o serviço (um só ou todos os da agenda).",
        "O período é dividido do início em diante, no tamanho da duração do serviço. Atendimentos e bloqueios ocupam o tempo, com o intervalo da agenda antes e depois.",
        "Em turma: uma sessão por horário cadastrado, com o número de vagas.",
        "Feriados (nacionais e os da clínica) e bloqueios tiram os horários do dia.",
        "Mudar ou apagar um horário não mexe nos atendimentos já marcados.",
      ],
      exemplo: "Das 8h às 12h, Consulta de 30 minutos e agenda sem intervalo: 8h, 8h30, 9h… até 11h30. Com uma Consulta já marcada às 9h, o horário das 9h sai da lista.",
      depende: [
        { texto: "Agendas: cada horário é de uma agenda.", href: "/admin/configuracoes/agendas" },
        { texto: "Locais: e acontece em um local.", href: "/admin/configuracoes/locais" },
        { texto: "Serviços: para um serviço ou todos os da agenda.", href: "/admin/configuracoes/servicos" },
      ],
      alimenta: [
        { texto: "Painel, bot e link de agendar: os horários livres saem daqui." },
        { texto: "Feriados: tiram os dias dos horários.", href: "/admin/configuracoes/feriados" },
      ],
    },
    // src/lib/data/whatsapp/botLimits.ts (cabeçalho); "Contatos para revisar" no Meu dia; tela do contato.
    limitesBot: {
      serve: "Proteger o agendamento pelo WhatsApp de abuso, como alguém marcando muitos horários de uma vez.",
      como: [
        "Os limites contam por número de WhatsApp, somando todos os pacientes dele.",
        "Atendimentos futuros contam os marcados pelo bot ou pela equipe e os links de marcar ainda válidos.",
        "Atingido um limite, o bot não marca e passa a conversa para a recepção. Cancelar, remarcar e confirmar seguem pelo bot; a equipe marca sem limite pelo painel.",
        "O contato aparece no Meu dia, em \"Contatos para revisar\", por 7 dias. \"Revisado\" tira o aviso; na tela do contato, \"Liberar dos limites do bot\" (só o Administrador) desliga os três para aquele número.",
      ],
    },
  },
} satisfies ModuloDeAjuda;
