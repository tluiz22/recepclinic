import type { ArticleImage } from "./types";

// Capturas de tela reais (clínica de exemplo do seed local, dados fictícios), feitas com o Playwright em 01/nov/2026
// e guardadas em public/ajuda/. O destaque vermelho marca o que o texto cita. Refazer quando a tela mudar.

const shot = (file: string, alt: string, caption: string): ArticleImage => ({ file, alt, caption });

export const IMAGENS: Record<string, ArticleImage[]> = {
  "inicio-do-painel": [shot("inicio", "Tela Início com os números de hoje e o cartão Comparecimento a registrar destacado.", "Início: o cartão destacado mostra os atendimentos que já passaram e esperam o registro.")],
  "agenda-visualizar": [shot("agenda-dia", "Agenda na visão Dia, com os botões Marcar e Bloquear destacados.", "Agenda › Dia: os botões Marcar e Bloquear ficam no alto, e cada atendimento mostra as ações no cartão.")],
  "situacoes-e-acoes-do-cartao": [shot("agenda-dia", "Cartões de atendimento na Agenda, com a legenda das situações e os botões Confirmar presença, Remarcar, Mais e Cancelar.", "A legenda das situações fica acima das agendas; as ações estão no cartão de cada atendimento.")],
  "marcar-atendimento": [shot("marcar", "Tela Marcar, com o passo 1, Paciente, destacado e o resumo à direita.", "O Marcar começa pelo paciente: busque por nome, telefone ou nascimento, ou use \"Cadastrar paciente novo\".")],
  "bloquear-agenda": [shot("bloquear", "Tela Bloquear agenda, com a opção Dia todo destacada.", "Agenda › Bloquear: escolha as agendas, o período e o motivo.")],
  "gerenciar-bloqueios": [shot("bloqueios", "Lista de bloqueios da Agenda.", "Agenda › Bloqueios: edite ou remova os bloqueios que ainda não terminaram.")],
  "buscar-pacientes": [shot("pacientes", "Lista de pacientes, com o campo de busca e o botão Cadastrar destacados.", "Pacientes: a busca aceita nome, telefone ou nascimento.")],
  "cadastrar-paciente": [shot("paciente-novo", "Formulário de cadastro de paciente, com o botão de cadastrar destacado.", "Pacientes › Cadastrar: paciente, contato e, com Convênios, o plano.")],
  "resumo-do-dia": [shot("resumo-do-dia", "Resumo do Dia, com as abas Lembretes, A registrar e Registradas destacadas.", "Resumo do Dia: uma aba para cada tipo de pendência.")],
  "atendimento-humano": [shot("atendimento", "Tela Atendimento, com as conversas que aguardam a clínica.", "Atendimento: conversas em que o bot parou. Use Devolver ao bot ao terminar.")],
  relacionamento: [shot("relacionamento", "Tela Relacionamento, com as abas de pendências.", "Relacionamento: uma aba para cada motivo de contato.")],
  "metricas-visao-geral": [shot("metricas", "Tela de Métricas, com as abas e o seletor de período.", "Métricas: escolha o período e a aba.")],
  "financeiro-quem-paga": [shot("financeiro", "Tela Financeiro, com o filtro Falta CPF destacado.", "Financeiro: os pacientes com o responsável financeiro e o CPF.")],
  "config-clinica": [shot("config-clinica", "Configurações › Clínica, com os blocos Identificação e Atendimento destacados.", "Cada bloco tem o seu botão Salvar. O guia de configuração fica no topo.")],
  "config-profissionais": [shot("config-profissionais", "Configurações › Profissionais, com o botão Novo profissional destacado.", "Profissionais: a lista mostra o registro, o WhatsApp e o selo do que falta.")],
  "config-locais": [shot("config-locais", "Configurações › Locais, com o botão Novo local destacado.", "Locais: consultórios e atendimento domiciliar.")],
  "config-agendas": [shot("config-agendas", "Configurações › Agendas, com o botão Nova agenda destacado.", "Agendas: uma por profissional, mais a da equipe para exames.")],
  "config-servicos": [shot("config-servicos", "Configurações › Serviços, com o botão Novo serviço destacado.", "Serviços: o selo diz o que falta para o serviço aparecer para marcar.")],
  "config-horarios": [shot("config-horarios", "Configurações › Horários, com o seletor de agenda destacado e a semana da agenda.", "Horários: escolha a agenda e adicione os horários de cada dia.")],
  "config-feriados": [shot("config-feriados", "Configurações › Feriados, com o botão Adicionar destacado.", "Feriados: os nacionais já vêm cadastrados; adicione os da clínica.")],
  "config-convenios": [shot("config-convenios", "Configurações › Convênios, com o botão Novo plano destacado.", "Convênios: planos atendidos e a opção de pedir carteirinha.")],
  "config-lembretes": [shot("config-lembretes", "Configurações › Lembretes.", "Lembretes: um bloco para o paciente, o profissional e a equipe.")],
  "config-mensagens": [shot("config-mensagens", "Configurações › Mensagens.", "Mensagens: os textos do bot e as mensagens aprovadas pela Meta.")],
  "config-whatsapp": [shot("config-whatsapp", "Configurações › WhatsApp, com a conexão e a situação das mensagens automáticas.", "WhatsApp: a situação da conexão, das mensagens na Meta e da forma de pagamento.")],
  "config-nota-fiscal": [shot("config-nota-fiscal", "Configurações › Nota fiscal, com o bloco Dados fiscais da clínica destacado.", "Nota fiscal: dados fiscais, certificado A1 e código por serviço.")],
  "equipe-convidar": [shot("equipe", "Configurações › Equipe, com o botão Convidar pessoa destacado.", "Equipe: cada pessoa com os papéis e o acesso às agendas.")],
};
