import type { KbAnswerType, KbFlow, KbRequiredTerm, KbSource, KbStatus } from "./lists";

// Nomes da Base de Conhecimento nas telas do Suporte (BC 3.3).

export const ANSWER_TYPE_LABELS: Record<KbAnswerType, string> = {
  template: "Modelo com dados",
  source: "Montada pela fonte",
  flow: "Abre um fluxo",
  fixed: "Texto fixo",
  reception: "Oferece a recepção",
};

export const SOURCE_LABELS: Record<KbSource, string> = {
  clinic: "Nome da clínica e recepção",
  reception_hours: "Horário da recepção",
  holiday_today: "Feriado de hoje",
  addresses: "Endereços dos locais",
  website: "Site",
  services: "Serviços com horário",
  professionals: "Profissionais com agenda",
  council_registration: "Registro no conselho",
  prices: "Valores",
  payment: "Formas de pagamento",
  insurance: "Convênios",
  return_visit: "Retorno (prazo e valor)",
  preparation: "Preparo de exames",
  home_visit: "Atendimento domiciliar",
  age_profile: "Perfil e idade limite",
  reminder: "Lembrete automático",
};

export const FLOW_LABELS: Record<KbFlow, string> = {
  book_consultation: "Marcar consulta",
  book_exam: "Marcar exame",
  book_return: "Marcar retorno",
  reschedule: "Remarcar",
  cancel: "Cancelar",
  confirm: "Confirmar presença",
  my_appointments: "Meus atendimentos",
  waitlist: "Encaixe ou antecipar",
};

export const REQUIRED_TERM_LABELS: Record<KbRequiredTerm, string> = {
  service: "Nome de um serviço da clínica",
  professional: "Nome de um profissional da clínica",
  specialty: "Especialidade do dicionário",
};

export const STATUS_BADGE: Record<KbStatus, "neutral" | "info" | "success" | "warning"> = {
  draft: "neutral",
  approved: "info",
  active: "success",
  inactive: "warning",
};
