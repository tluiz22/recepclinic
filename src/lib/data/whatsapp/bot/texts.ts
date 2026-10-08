import type { ClinicProfile } from "../../../vocabulary";
import { formatCentsBRL } from "../../../money";
import type { ListRow, ListSection, ReplyButton } from "../send";
import { BACK_TO_MENU_ID } from "./input";

// Textos do bot (F6.3), aprovados pelo cliente em 07/out/2026: os do piloto,
// sem citar a Dra., com o nome da clínica e o vocabulário do perfil (D4b):
// Pediátrica "criança/responsável", Adultos "paciente/contato", Mista
// "paciente/responsável". Listas e botões nos limites da Meta (título da
// linha até 24 caracteres, descrição até 72, até 10 linhas; botão até 20).

export type Words = {
  /** "criança" / "paciente". */
  patient: string;
  /** Gênero da palavra, para os artigos ("da criança", "do paciente"). */
  feminine: boolean;
};

export function wordsFor(profile: ClinicProfile): Words {
  return profile === "pediatric" ? { patient: "criança", feminine: true } : { patient: "paciente", feminine: false };
}

const of = (w: Words) => `${w.feminine ? "da" : "do"} ${w.patient}`;
const other = (w: Words) => `${w.feminine ? "Outra" : "Outro"} ${w.patient}`;

export const LIST_BUTTON = "Escolher opção";
export const MAX_LIST_ROWS = 10;
const MAX_ROW_TITLE = 24;
const MAX_ROW_DESCRIPTION = 72;
const MAX_BUTTON_TITLE = 20;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Linha numerada ("1. Consulta"); nome comprido vai inteiro na descrição. */
export function row(index: number, id: string, label: string, description?: string | null): ListRow {
  const prefix = `${index + 1}. `;
  const title = `${prefix}${cut(label, MAX_ROW_TITLE - prefix.length)}`;
  const full = title.endsWith(label) ? null : label;
  const text = [full, description].filter(Boolean).join(" · ");
  return { id, title, ...(text ? { description: cut(text, MAX_ROW_DESCRIPTION) } : {}) };
}

/** Lista numerada com "Voltar ao menu" no fim (cabe em 10 linhas). */
export function numberedList(items: { id: string; label: string; description?: string | null }[], withBack = true): ListSection[] {
  const limit = withBack ? MAX_LIST_ROWS - 1 : MAX_LIST_ROWS;
  const rows = items.slice(0, limit).map((item, index) => row(index, item.id, item.label, item.description));
  if (withBack) rows.push(row(rows.length, BACK_TO_MENU_ID, "Voltar ao menu"));
  return [{ rows }];
}

export function button(id: string, title: string): ReplyButton {
  return { id, title: cut(title, MAX_BUTTON_TITLE) };
}

export const YES_NO_IDS = { yes: "yes", no: "no" } as const;
export const YES_NO_BUTTONS = [button(YES_NO_IDS.yes, "Sim"), button(YES_NO_IDS.no, "Não")];

export const price = (cents: number | null | undefined) => (cents == null ? null : formatCentsBRL(cents));

// ---------------------------------------------------------------------------
// Início e menus
// ---------------------------------------------------------------------------

export const welcome = (clinicLabel: string) => `Olá! 👋 Aqui é ${clinicLabel}.`;
export const MENU_BODY = "Como podemos ajudar? Escolha uma opção abaixo (ou digite o número).";
export const CONSULTATIONS_BODY = "O que você precisa sobre consultas?";
export const EXAMS_BODY = "O que você precisa sobre exames?";
export const INFO_BODY = "O que você gostaria de saber?";

export function notUnderstood(isMainMenu = false): string {
  return isMainMenu
    ? "Não entendi sua resposta 🙏 Escolha uma das opções abaixo."
    : "Não entendi sua resposta 🙏 Escolha uma das opções abaixo (ou digite 0 para voltar ao menu principal).";
}
export const NOT_UNDERSTOOD_YES_NO = "Não entendi 🙏 Responda apenas Sim ou Não.";

/** Conversa parada há 15 minutos (cliente, 07/out). */
export const IDLE_CLOSED =
  "Como não tivemos resposta nos últimos minutos, encerramos este atendimento. Quando quiser, é só mandar uma mensagem que começamos de novo. 😊";

export const NOTHING_TO_BOOK = "No momento não há horários para marcar por aqui. Por favor, fale com a clínica.";
export const LINK_ERROR = "Tivemos um problema para gerar o link de agendamento. Por favor, tente de novo em alguns minutos ou fale com a clínica.";

// ---------------------------------------------------------------------------
// Marcar
// ---------------------------------------------------------------------------

export const serviceQuestion = (category: "consultation" | "exam") =>
  category === "exam" ? "Qual exame você quer marcar?" : "Qual consulta você quer marcar?";

export const AGENDA_QUESTION = "Com qual profissional?";
/** "Primeiro horário disponível" não cabe no título da linha (24 caracteres): o resto vai na descrição. */
export const FIRST_AVAILABLE = "Primeiro horário";
export const FIRST_AVAILABLE_DESCRIPTION = "Disponível, com qualquer profissional";

export const LOCATION_QUESTION = "Prefere consultório ou atendimento domiciliar?";
export const LOCATION_LABELS = { clinic: "Consultório", home_visit: "Atendimento domiciliar" } as const;

export const HOME_ADDRESS_ASK =
  "Qual é o endereço para o atendimento domiciliar? (rua, número, bairro, complemento e um ponto de referência, se tiver)\n\n" +
  "Esse endereço é usado só para a nossa equipe chegar até vocês nesse atendimento.";
export const homeAddressConfirmDefault = (address: string) =>
  `A última visita domiciliar foi feita neste endereço: *${address}*. Ainda é esse? Responda Sim ou Não.`;
export const homeAddressConfirmNew = (address: string) => `Confirma que o endereço é esse? *${address}*\nResponda Sim ou Não.`;

export const FOR_WHOM_QUESTION = "É para você ou para outra pessoa?";
export const FOR_WHOM_IDS = { self: "for_self", other: "for_other" } as const;
export const FOR_WHOM_BUTTONS = [button(FOR_WHOM_IDS.self, "Para mim"), button(FOR_WHOM_IDS.other, "Outra pessoa")];

export const patientChoice = (w: Words) => `Para qual ${w.patient} é o agendamento?`;
export const PATIENT_NEW_ID = "patient_new";
export const otherPatientLabel = other;

export const askBirthdate = (w: Words) => `Qual a data de nascimento ${of(w)}? (formato dd/mm/aaaa)`;
export const SELF_BIRTHDATE = "Qual é a sua data de nascimento? (formato dd/mm/aaaa)";
export const INVALID_BIRTHDATE = "Não consegui entender essa data. Por favor, digite no formato dd/mm/aaaa (ex.: 10/03/2020).";
export const birthdateMatches = (w: Words) =>
  `Encontramos ${w.feminine ? "crianças" : "pacientes"} já ${w.feminine ? "cadastradas" : "cadastrados"} com essa data de nascimento nesse telefone. É ${w.feminine ? "uma delas" : "um deles"}?`;
export const confirmPatient = (w: Words, name: string, birthdate: string) =>
  `Encontramos *${name}*, nascido(a) em ${birthdate}: ${w.feminine ? "é essa a" : "é esse o"} ${w.patient}? Responda Sim ou Não.`;

export const ASK_CONTACT_NAME = "Antes de continuar, qual é o seu nome completo?";
export const confirmContactName = (name: string) => `Confira o seu nome: *${name}*\n\nEstá correto? Responda Sim ou Não.`;
export const askPatientName = (w: Words) => `Qual é o nome completo ${of(w)}?`;
export const ASK_SELF_NAME = "Qual é o seu nome completo?";
export const confirmNewPatient = (w: Words, name: string, birthdate: string) =>
  `Confira os dados ${of(w)}:\nNome: *${name}*\nData de nascimento: *${birthdate}*\n\nEstá tudo certo? Responda Sim ou Não.`;
export const confirmSelf = (name: string, birthdate: string) =>
  `Confira os seus dados:\nNome: *${name}*\nData de nascimento: *${birthdate}*\n\nEstá tudo certo? Responda Sim ou Não.`;
export const SELF_MINOR = "Para menores de 18 anos, o agendamento precisa ser feito pelo responsável.";

export const bookingLink = (serviceName: string, patientName: string, url: string) =>
  `Prontinho! Escolha o melhor dia e horário para *${serviceName}* de ${patientName} neste link:\n${url}\n\nO link vale por 30 minutos.`;

export const ageLimit = (serviceName: string, limitYears: number, w: Words) =>
  `${serviceName} é para pacientes até ${limitYears - 1} anos.\n\nDeseja agendar para ${w.feminine ? "outra criança" : "outra pessoa"}?`;

export const alreadyScheduled = (patientName: string, serviceName: string, when: string) =>
  `*${patientName}* já tem ${serviceName} marcado(a) para ${when}. Para mudar o dia ou horário, fale com a clínica.`;

// ---------------------------------------------------------------------------
// Retorno
// ---------------------------------------------------------------------------

export function returnPriceLine(cents: number): string {
  return cents === 0 ? "O retorno não tem custo." : `Valor do retorno: ${formatCentsBRL(cents)}.`;
}
export const returnChoice = (w: Words, priceLine: string, deadlineDays: number | null) =>
  `${priceLine}\n\n${deadlineDays !== null ? `O retorno deve ser feito em até ${deadlineDays} dias após a consulta. ` : ""}Para qual ${w.patient} é o retorno?`;
export const returnNoRecent = (deadlineDays: number | null) =>
  deadlineDays !== null
    ? `Não encontramos consulta nos últimos ${deadlineDays} dias. O retorno deve ser feito em até ${deadlineDays} dias após a consulta; passado esse prazo, é preciso marcar uma nova consulta em Consultas › Marcar consulta.`
    : "Não encontramos consulta anterior para marcar o retorno. Para um novo atendimento, escolha Consultas › Marcar consulta.";
export const RETURN_HOME_VISIT =
  "A última consulta foi um atendimento domiciliar, e consulta domiciliar não dá direito a retorno. Para um novo atendimento, escolha Consultas › Marcar consulta.";
export const returnUsed = (patientName: string) =>
  `O retorno da última consulta de *${patientName}* já foi marcado: cada consulta dá direito a um retorno. Para um novo atendimento, escolha Consultas › Marcar consulta.`;

// ---------------------------------------------------------------------------
// Informações
// ---------------------------------------------------------------------------

export const INFO_ITEMS = {
  prices: "Valores",
  insurance: "Convênios",
  address: "Endereço",
  preparation: "Preparo para exames",
  notes: "Outras informações",
} as const;

export type PriceLine = { name: string; lines: string[] };

export function pricesText(groups: PriceLine[], paymentInfo: string | null): string {
  const blocks = groups.map((g) => `*${g.name}*\n${g.lines.join("\n")}`);
  if (paymentInfo) blocks.push(`*Formas de pagamento*\n${paymentInfo}`);
  return blocks.join("\n\n");
}

export function addressText(locations: { name: string; address: string }[]): string {
  const blocks = locations.map(
    (l) => `*${l.name}*\n${l.address}\nhttps://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.address)}`,
  );
  const outro = locations.length > 1 ? "\n\nO local do seu atendimento vai na mensagem de confirmação, de acordo com o horário escolhido." : "";
  return blocks.join("\n\n") + outro;
}

export const PREPARATION_QUESTION = "De qual exame você quer ver o preparo?";
export const preparationText = (instructions: string, url: string) => `${instructions}\n\n🔗 Para guardar ou compartilhar estas orientações:\n${url}`;

// ---------------------------------------------------------------------------
// Cancelar, remarcar, lembrete, encaixe e recepção (F6.4), aprovados pelo
// cliente em 07/out: os do piloto, com "fale com a clínica" no lugar de
// "Falar com a secretária" enquanto a recepção não atende pelo bot (F8).
// ---------------------------------------------------------------------------

export type Group = "consultation" | "exam";

/** Palavra do grupo do menu ("consulta"/"exame"), com a concordância. */
const groupWords = (group: Group) =>
  group === "exam" ? { noun: "exame", none: "nenhum", future: "futuro" } : { noun: "consulta", none: "nenhuma", future: "futura" };

/** O atendimento pelo serviço: "a consulta", "o retorno", "o exame Espirometria". */
export function appointmentWords(category: "consultation" | "return_visit" | "exam", serviceName: string): { phrase: string; end: "a" | "o" } {
  if (category === "consultation") return { phrase: "a consulta", end: "a" };
  if (category === "return_visit") return { phrase: "o retorno", end: "o" };
  return { phrase: `o exame ${serviceName}`, end: "o" };
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const NO_REGISTRATION = "Não encontramos nenhum cadastro associado a este número. Se você já é paciente, fale com a clínica.";

export const chooseAppointment = (action: "cancelar" | "remarcar" | "antecipar", group: Group) => `Qual ${groupWords(group).noun} você quer ${action}?`;

export function noAppointments(action: "cancelar" | "remarcar", group: Group): string {
  const w = groupWords(group);
  return `Não encontramos ${w.none} ${w.noun} ${w.future} para ${action} neste número. Se precisar de ajuda, fale com a clínica.`;
}

export function noMatchingAppointment(group: Group): string {
  const w = groupWords(group);
  return `Não encontramos ${w.noun} ${w.future} para essa data de nascimento. Se precisar de ajuda, fale com a clínica.`;
}

export const couldNotIdentify = (group: Group) => `Não conseguimos confirmar qual ${groupWords(group).noun} é. Se precisar de ajuda, fale com a clínica.`;

export const askAppointmentBirthdate = (w: Words) => askBirthdate(w);

export const confirmCancel = (phrase: string, patientName: string, when: string) =>
  `Confirma o cancelamento ${phrase.replace(/^a /, "da ").replace(/^o /, "do ")} de *${patientName}* em ${when}? Responda Sim ou Não.`;

export const cancelDone = (phrase: string, end: "a" | "o", patientName: string, when: string, group: Group) =>
  `Prontinho, cancelamos ${phrase} de ${patientName} que estava marcad${end} para ${when}. Se precisar marcar ${group === "exam" ? "um novo exame" : "uma nova consulta"}, é só me chamar de novo.`;

/** "Ok, mantivemos sua consulta marcada." / "seu exame Espirometria marcado". */
export const cancelKept = (phrase: string, end: "a" | "o") => `Ok, mantivemos ${phrase.replace(/^a /, "sua ").replace(/^o /, "seu ")} marcad${end}.`;
export const keptAskPresence = (phrase: string, end: "a" | "o") => `${cancelKept(phrase, end)}\n\nDeseja confirmar sua presença?`;
export const PRESENCE_NOT_UNDERSTOOD = "Não entendi. Deseja confirmar sua presença? Toque em Sim ou Não.";
export const KEPT_PRESENCE_DECLINED = 'Tudo bem! Se quiser confirmar depois, é só tocar em "Confirmar presença" no lembrete.';

export const confirmReschedule = (phrase: string, patientName: string, when: string) =>
  `Encontramos ${phrase} de *${patientName}* em ${when}: é ${phrase.startsWith("a ") ? "essa" : "esse"} que você quer remarcar? Responda Sim ou Não.`;
export const rescheduleLink = (phrase: string, patientName: string, url: string) =>
  `Prontinho! Escolha o novo dia e horário para ${phrase} de ${patientName} neste link:\n${url}\n\nO link vale por 30 minutos.`;
export const returnDeadlinePassed = (patientName: string, lastDate: string) =>
  `O prazo para o retorno de *${patientName}* terminou em ${lastDate}, então não é possível remarcar por aqui. Por favor, fale com a clínica.`;
export const homeAddressConfirmCurrent = (address: string) =>
  `O endereço gravado para esse atendimento domiciliar é: *${address}*. Ainda é esse? Responda Sim ou Não.`;

export function presenceConfirmed(patientName: string, when: string, isExam: boolean): string {
  return (
    "Presença confirmada ✓\n\n" +
    `👤 Paciente: ${patientName}\n📅 ${when}\n\n` +
    (isExam ? "Lembre-se de seguir as orientações de preparo do exame que enviamos anteriormente.\n\n" : "") +
    "Obrigado! Qualquer dúvida, é só chamar por aqui."
  );
}
export const presenceAlreadyConfirmed = (patientName: string, when: string) => `A presença de ${patientName} em ${when} já estava confirmada ✓`;
export const APPOINTMENT_INACTIVE = "Esse agendamento não está mais ativo.";

export const WAITLIST_IDS = {
  leave: "waitlist_leave",
  stay: "waitlist_stay",
  bookConsultation: "waitlist_book_consultation",
  bookReturn: "waitlist_book_return",
  bookExam: "waitlist_book_exam",
  noneOfThese: "waitlist_none",
} as const;

// Antes de entrar na lista, os horários livres antes do atendimento (cliente,
// textos aprovados em 08/out/2026).
export const waitlistEarlier = (patientName: string, phrase: string, end: "a" | "o", when: string) =>
  `Encontramos horários livres antes d${phrase} de *${patientName}*, marcad${end} para ${when}. Quer antecipar para um destes?`;
export const NONE_OF_THESE = "Nenhum desses";
export const confirmAdvance = (phrase: string, patientName: string, from: string, to: string) =>
  `Confirma antecipar ${phrase} de *${patientName}* de ${from} para ${to}?`;
export const SLOT_TAKEN = "Que pena, esse horário acabou de ser ocupado.";
export const askJoinWaitlist = (when: string) => `Quer entrar na lista de espera? Se abrir outra vaga antes de ${when}, eu aviso por aqui.`;

export const waitlistJoined = (patientName: string, phrase: string, end: "a" | "o", when: string) =>
  `Pronto! *${patientName}* está na lista de espera para antecipar ${phrase} marcad${end} para ${when}.`;
export const waitlistAlreadyIn = (patientName: string, phrase: string, end: "a" | "o", when: string) =>
  `*${patientName}* já está na lista de espera para antecipar ${phrase} marcad${end} para ${when}. Quer sair da lista?`;
export const WAITLIST_ALREADY_BUTTONS = [button(WAITLIST_IDS.leave, "Sair da lista"), button(WAITLIST_IDS.stay, "Continuar na lista")];
export const waitlistLeft = (patientName: string, phrase: string, end: "a" | "o", when: string) =>
  `Pronto, *${patientName}* saiu da lista de espera. ${capital(phrase)} continua marcad${end} para ${when}.`;
export const waitlistStay = (patientName: string) => `Ok, *${patientName}* continua na lista de espera. Se abrir uma vaga antes, eu aviso por aqui.`;
export function waitlistNoAppointment(group: Group): string {
  const what = group === "exam" ? "um exame marcado" : "uma consulta marcada";
  return (
    `A lista de espera serve para antecipar um horário já marcado, e não encontramos ${what} neste número. ` +
    "Quer marcar agora? Depois de confirmar pela página, o atendimento entra na lista de espera e eu aviso por aqui se abrir uma vaga antes."
  );
}
export const WAITLIST_ERROR = "Tivemos um problema com a lista de espera. Por favor, tente de novo em instantes.";

const STILL_IN_LIST = " Você continua na lista de espera: se abrir outra vaga, eu aviso por aqui.";
export const offerAccepted = (patientName: string, when: string) =>
  `Pronto! ✓ O atendimento de *${patientName}* foi antecipado para ${when}. Os detalhes seguem na mensagem de remarcação.`;
export const offerDeclined = (patientName: string, when: string, stillInList: boolean) =>
  `Ok, mantivemos o horário de *${patientName}* (${when}).${stillInList ? STILL_IN_LIST : ""}`;
export const offerLate = (stillInList: boolean) => `Essa vaga já foi oferecida a outra pessoa.${stillInList ? STILL_IN_LIST : ""}`;
export const offerTaken = (stillInList: boolean) => `Que pena, essa vaga acabou de ser ocupada.${stillInList ? STILL_IN_LIST : ""}`;
export const OFFER_ALREADY_ACCEPTED = "Essa vaga já está confirmada para você ✓";
export const OFFER_NOT_FOUND = "Essa oferta não está mais ativa.";

export const HANDOFF =
  "Combinado! Vou te transferir para a recepção, que responde por aqui assim que possível. O atendimento automático fica pausado até lá.";
