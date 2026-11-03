import type { ClinicProfile } from "../../../vocabulary";
import { designationText, designationTitle, type Designation } from "../../../designation";
import { formatCentsBRL } from "../../../money";
import type { ListRow, ListSection, ReplyButton } from "../send";
import type { BotService } from "./catalog";
import { BACK_TO_MENU_ID, TALK_TO_RECEPTION_ID } from "./input";

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

// Saída de uma pergunta sem resposta válida (cliente, 30/out/2026): da 2ª resposta não entendida seguida em diante,
// a data de nascimento vem com "Voltar ao menu" e "Falar com a recepção"; o Sim/Não, com Sim, Não e "Voltar ao menu".
const BACK_TO_MENU_BUTTON = button(BACK_TO_MENU_ID, "Voltar ao menu");
export const YES_NO_BACK_BUTTONS = [...YES_NO_BUTTONS, BACK_TO_MENU_BUTTON];
export const wayOutButtons = (receptionAvailable: boolean) => [
  BACK_TO_MENU_BUTTON,
  ...(receptionAvailable ? [button(TALK_TO_RECEPTION_ID, "Falar com a recepção")] : []),
];

export const price = (cents: number | null | undefined) => (cents == null ? null : formatCentsBRL(cents));

// ---------------------------------------------------------------------------
// Início e menus
// ---------------------------------------------------------------------------

/**
 * Boas-vindas (EA, cliente, 02/nov/2026): com a base de conhecimento ligada, convida a escrever o que precisa;
 * sem ela, o texto de antes (o texto livre não seria entendido).
 */
export const welcome = (clinicLabel: string, invite = true) =>
  invite
    ? `Olá! 👋 Aqui é ${clinicLabel}.\n\nSou a assistente virtual e estou aqui para ajudar.\nVocê pode escrever o que precisa ou escolher uma das opções abaixo.`
    : `Olá! 👋 Aqui é ${clinicLabel}.`;
export const MENU_BODY = "Escolha uma opção abaixo (ou digite o número).";

// Entrada com atendimento marcado no número (cliente, 23/out/2026): pergunta
// antes do menu; os detalhes só depois da data de nascimento.
export const ENTRY_IDS = { yes: "entry_yes", no: "entry_no" } as const;
export const ENTRY_ONE = "Identificamos um agendamento associado a este número. Você deseja tratar desse agendamento?";
export const ENTRY_MANY = "Encontramos mais de um agendamento associado a este número. Você deseja consultar ou alterar algum deles?";
export const ENTRY_ONE_BUTTONS = [button(ENTRY_IDS.yes, "Sim, quero"), button(ENTRY_IDS.no, "Não, outro assunto")];
export const ENTRY_MANY_BUTTONS = [button(ENTRY_IDS.yes, "Sim, consultar"), button(ENTRY_IDS.no, "Não, outro assunto")];
export const ENTRY_NOT_UNDERSTOOD = "Não entendi 🙏 Toque em uma das opções abaixo.";
// "do paciente" em qualquer perfil (cliente, 31/out/2026).
export const ENTRY_ASK_BIRTHDATE =
  "Para sua segurança, antes de mostrar o agendamento precisamos confirmar a identidade.\n\nQual a data de nascimento do paciente? (formato dd/mm/aaaa)";

// Data de nascimento sem atendimento, na entrada e em Cancelar, Remarcar e
// Encaixe (cliente, 24/out/2026): sem bloqueio por data errada; a pessoa
// escolhe outra data ou o menu (sem "Falar com a recepção": cliente, 31/out/2026).
export const IDENTITY_IDS = { retry: "identity_retry", menu: "identity_menu" } as const;
export type IdentityChoice = keyof typeof IDENTITY_IDS;
export const IDENTITY_CHOICES: IdentityChoice[] = ["retry", "menu"];
export const IDENTITY_NOT_FOUND = "Não encontramos agendamentos para essa data de nascimento.";
const IDENTITY_TITLES: Record<IdentityChoice, string> = { retry: "Tentar outra data", menu: "Voltar ao menu" };
export const IDENTITY_NOT_FOUND_BUTTONS = IDENTITY_CHOICES.map((k) => button(IDENTITY_IDS[k], IDENTITY_TITLES[k]));
export const ENTRY_LOOKUP_ERROR = "Não conseguimos consultar os agendamentos agora. Você pode seguir pelas opções do menu.";
export const ENTRY_CHOOSE = "Qual agendamento você quer consultar ou alterar?";
export const ENTRY_ACTION_ITEMS = {
  confirm: "Confirmar presença",
  reschedule: "Remarcar",
  cancel: "Cancelar",
  waitlist: "Encaixe ou antecipar",
  reception: "Falar com a recepção",
} as const;
export const ENTRY_WAITLIST_DESCRIPTION = "Lista de espera para um horário mais cedo";
/** "A consulta de *Ana* está marcada para segunda, 10/03 às 08:00." */
export function entryAppointmentDetails(phrase: string, ending: "a" | "o", patientName: string, when: string, confirmed: boolean): string {
  const presence = confirmed ? "\nPresença confirmada ✓" : "";
  return `${capital(phrase)} de *${patientName}* está marcad${ending} para ${when}.${presence}\n\nO que você deseja fazer?`;
}

export const CONSULTATIONS_BODY = "O que você precisa sobre consultas?";
export const EXAMS_BODY = "O que você precisa sobre exames?";
export const INFO_BODY = "O que você gostaria de saber?";

export function notUnderstood(isMainMenu = false): string {
  return isMainMenu
    ? "Não entendi sua resposta 🙏 Escolha uma das opções abaixo."
    : "Não entendi sua resposta 🙏 Escolha uma das opções abaixo (ou digite 0 para voltar ao menu principal).";
}
export const NOT_UNDERSTOOD_YES_NO = "Não entendi 🙏 Responda apenas Sim ou Não.";

// Mídia no lugar de uma resposta (F8.5d, cliente, 27/out/2026): o bot só lê texto e toques.
export const MEDIA_AUDIO = "Ainda não consigo ouvir áudios 🙏 Toque em uma das opções abaixo ou escreva.";
export const MEDIA_OTHER = "Ainda não consigo ver fotos, vídeos, figurinhas ou arquivos 🙏 Toque em uma das opções abaixo ou escreva.";

/**
 * 4ª mensagem seguida que o bot não entende (F8.5d): a conversa vai para a
 * clínica. `when`: quando a recepção abre ("amanhã, às 8h"); null = aberta
 * agora; undefined = sem horário conhecido.
 */
export function notUnderstoodHandoff(when: string | null | undefined): string {
  const first = "Vou pedir para alguém da clínica te atender por aqui.";
  if (when === null) return `${first} Aguarde, por favor.`;
  if (when === undefined) return `${first} A clínica responde assim que possível.`;
  return `${first} A clínica responde a partir de ${when}.`;
}

/** Conversa parada há 15 minutos (cliente, 07/out). */
export const IDLE_CLOSED =
  "Como não tivemos resposta nos últimos minutos, encerramos este atendimento. Quando quiser, é só mandar uma mensagem que começamos de novo. 😊";

/**
 * Nada para o bot marcar (clínica sem serviço ou serviço sem horário livre no
 * prazo): a recepção assume a conversa (cliente, 11/out/2026).
 */
export const willReply = (d: Designation) => `${designationTitle(d)} responderá sua mensagem em breve.`;
export const linkError = (d: Designation) =>
  `Tivemos um problema para gerar o link de agendamento. Por favor, tente de novo em alguns minutos ou fale com ${designationText(d)}.`;

// ---------------------------------------------------------------------------
// Marcar
// ---------------------------------------------------------------------------

export const serviceQuestion = (category: "consultation" | "exam") =>
  category === "exam" ? "Qual exame você quer marcar?" : "Qual consulta você quer marcar?";

export const serviceAuto = (serviceName: string) => `Vamos marcar *${serviceName}*.`;

// Particular ou convênio e valor (cliente, 31/out/2026).
export const COVERAGE_QUESTION = "O atendimento será particular ou por convênio?";
export const COVERAGE_IDS = { private: "coverage_private", insurance: "coverage_insurance" } as const;
export const COVERAGE_BUTTONS = [button(COVERAGE_IDS.private, "Particular"), button(COVERAGE_IDS.insurance, "Convênio")];
export const PLAN_LIST_QUESTION = "Qual é o seu convênio?";
export const PLAN_TEXT_QUESTION = "Qual é o seu convênio? Escreva o nome do plano.";
export const PLAN_OTHER_ID = "plan_other";
export const PLAN_OTHER_LABEL = "Outro convênio";
export const planAccepted = (planName: string) => `Atendemos pelo convênio *${planName}*.`;
/** Plano fora da lista, não encontrado ou não atendido pelo(s) profissional(is) do caminho escolhido. */
export const planNotAccepted = (planName: string | null, d: Designation, forThisService: boolean) =>
  `Infelizmente ${designationText(d)} não atende ${planName ? `pelo convênio *${planName}*` : "por esse convênio"}${forThisService ? " neste atendimento" : ""}.\n\nQuer seguir com o atendimento particular?`;
export function priceInfo(category: "consultation" | "exam", cents: number, paymentInfo: string | null): string {
  const value = `O valor ${category === "exam" ? "do exame" : "da consulta"} é ${formatCentsBRL(cents)}.`;
  return paymentInfo ? `${value}\n\nFormas de pagamento: ${paymentInfo}` : value;
}

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
  `A última visita domiciliar foi feita neste endereço: *${address}*. Ainda é esse?`;
export const homeAddressConfirmNew = (address: string) => `Confirma que o endereço é esse? *${address}*`;

export const FOR_WHOM_QUESTION = "É para você ou para outra pessoa?";
export const FOR_WHOM_IDS = { self: "for_self", other: "for_other" } as const;
export const FOR_WHOM_BUTTONS = [button(FOR_WHOM_IDS.self, "Para mim"), button(FOR_WHOM_IDS.other, "Outra pessoa")];

export const patientChoice = (w: Words) => `Para qual ${w.patient} é o agendamento?`;
export const PATIENT_NEW_ID = "patient_new";
export const otherPatientLabel = other;

export const askBirthdate = (w: Words) => `Qual a data de nascimento ${of(w)}? (formato dd/mm/aaaa)`;
export const SELF_BIRTHDATE = "Qual é a sua data de nascimento? (formato dd/mm/aaaa)";
/** Depois de responder uma pergunta da base no meio do pedido da data (BC, Etapa 4). */
export const ASK_BIRTHDATE_AGAIN = "Qual a data de nascimento do paciente? (formato dd/mm/aaaa)";
/** Data digitada sem as barras (cliente, 02/nov/2026): confirma com as barras antes de seguir. */
export const confirmTypedDate = (date: string) => `Você quis dizer a data *${date}*?`;
export const TYPED_DATE_RETRY = "Tudo bem. Digite a data novamente, no formato dd/mm/aaaa (ex.: 10/03/2020).";
export const INVALID_BIRTHDATE = "Não consegui entender essa data. Por favor, digite no formato dd/mm/aaaa (ex.: 10/03/2020).";
export const INVALID_BIRTHDATE_AGAIN = `${INVALID_BIRTHDATE}\n\nSe não souber a data, escolha uma opção abaixo.`;
export const birthdateMatches = (w: Words) =>
  `Encontramos ${w.feminine ? "crianças" : "pacientes"} já ${w.feminine ? "cadastradas" : "cadastrados"} com essa data de nascimento nesse telefone. É ${w.feminine ? "uma delas" : "um deles"}?`;
export const confirmPatient = (w: Words, name: string, birthdate: string) =>
  `Encontramos *${name}*, nascido(a) em ${birthdate}: ${w.feminine ? "é essa a" : "é esse o"} ${w.patient}?`;

export const confirmContactName = (name: string) => `Confira o seu nome: *${name}*\n\nEstá correto?`;
// Número novo marcando para outra pessoa (cliente, 31/out/2026): o paciente primeiro, depois quem escreve; menor de 18, o responsável.
export const ASK_GUARDIAN_NAME = "Qual é o nome completo do responsável?";
export const confirmGuardianName = (name: string) => `Confira o nome do responsável: *${name}*\n\nEstá correto?`;
/** Idade limite da clínica (consulta), com o profissional escolhido ou, no "Primeiro horário", a clínica. */
export const ageLimitNotice = (professionalName: string | null, d: Designation, limitYears: number) =>
  `${professionalName ?? designationTitle(d)} atende pacientes até ${limitYears - 1} anos.`;
export const askPatientName = (w: Words) => `Qual é o nome completo ${of(w)}?`;
export const ASK_SELF_NAME = "Qual é o seu nome completo?";
export const confirmNewPatient = (w: Words, name: string, birthdate: string) =>
  `Confira os dados ${of(w)}:\nNome: *${name}*\nData de nascimento: *${birthdate}*\n\nEstá tudo certo?`;
export const confirmSelf = (name: string, birthdate: string) =>
  `Confira os seus dados:\nNome: *${name}*\nData de nascimento: *${birthdate}*\n\nEstá tudo certo?`;
export const SELF_MINOR = "Para menores de 18 anos, o agendamento precisa ser feito pelo responsável.";

export const bookingLink = (serviceName: string, patientName: string, url: string) =>
  `Prontinho! Escolha o melhor dia e horário para *${serviceName}* de ${patientName} neste link:\n${url}\n\nO link vale por 30 minutos.`;

/** Acima da idade limite, com o profissional escolhido ou a clínica (cliente, 31/out/2026). */
export const ageLimit = (professionalName: string | null, d: Designation, limitYears: number, w: Words) =>
  `${ageLimitNotice(professionalName, d, limitYears)}\n\nDeseja agendar para ${w.feminine ? "outra criança" : "outra pessoa"}?`;

/** Já tem marcado: aponta o Remarcar do próprio bot, com o caminho (cliente, 11/out/2026). */
export const alreadyScheduled = (patientName: string, serviceName: string, when: string, group: "consultation" | "exam") =>
  `*${patientName}* já tem ${serviceName} marcado(a) para ${when}. Para mudar o dia ou horário, escolha *${group === "exam" ? "Exames" : "Consultas"} › Remarcar*.`;

// ---------------------------------------------------------------------------
// Retorno
// ---------------------------------------------------------------------------

export const returnChoice = (w: Words, deadlineDays: number | null) =>
  `${deadlineDays !== null ? `O retorno deve ser feito em até ${deadlineDays} dias após a consulta. ` : ""}Para qual ${w.patient} é o retorno?`;
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

/** Valor do serviço por tipo de local (Informações › Valores e perguntas frequentes); zero = "Sem custo". */
export function servicePriceLines(service: Pick<BotService, "locationPrices" | "priceCents">): string[] {
  const types = Object.keys(service.locationPrices) as (keyof typeof LOCATION_LABELS)[];
  const value = (cents: number) => (cents === 0 ? "Sem custo" : price(cents)!);
  if (types.length <= 1) return [value(types.length ? service.locationPrices[types[0]]! : service.priceCents)];
  return types.map((type) => `${LOCATION_LABELS[type]}: ${value(service.locationPrices[type]!)}`);
}

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

// ---------------------------------------------------------------------------
// Cancelar, remarcar, lembrete, encaixe e recepção (F6.4), aprovados pelo
// cliente em 07/out: os do piloto. Revisão de 11/out/2026: o que o bot não
// acha neste número aponta o "Falar com a recepção" do menu inicial (sem
// recepção no número, escrever pelo outro número) e mostra o menu de novo.
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

/** Final dos textos de "não achamos neste número" (cliente, 11/out/2026). */
export const otherNumber = (receptionAvailable: boolean) =>
  receptionAvailable
    ? "Se o agendamento foi feito por outro número, escolha a opção *Falar com a recepção* no menu inicial."
    : "Se o agendamento foi feito por outro número, escreva por aquele número.";

export const noRegistration = (receptionAvailable: boolean) =>
  `Não encontramos agendamento marcado para esse número de telefone. ${otherNumber(receptionAvailable)}`;

export const chooseAppointment = (action: "cancelar" | "remarcar" | "antecipar", group: Group) => `Qual ${groupWords(group).noun} você quer ${action}?`;

export function noAppointments(action: "cancelar" | "remarcar", group: Group, receptionAvailable: boolean): string {
  const w = groupWords(group);
  return `Não encontramos ${w.none} ${w.noun} ${w.future} para ${action} neste número. ${otherNumber(receptionAvailable)}`;
}

export const confirmCancel = (phrase: string, patientName: string, when: string) =>
  `Confirma o cancelamento ${phrase.replace(/^a /, "da ").replace(/^o /, "do ")} de *${patientName}* em ${when}?`;

export const cancelDone = (phrase: string, end: "a" | "o", patientName: string, when: string, group: Group) =>
  `Prontinho, cancelamos ${phrase} de ${patientName} que estava marcad${end} para ${when}. Se precisar marcar ${group === "exam" ? "um novo exame" : "uma nova consulta"}, é só me chamar de novo.`;

/** "Ok, mantivemos sua consulta marcada." / "seu exame Espirometria marcado". */
export const cancelKept = (phrase: string, end: "a" | "o") => `Ok, mantivemos ${phrase.replace(/^a /, "sua ").replace(/^o /, "seu ")} marcad${end}.`;
export const keptAskPresence = (phrase: string, end: "a" | "o") => `${cancelKept(phrase, end)}\n\nDeseja confirmar sua presença?`;
export const PRESENCE_NOT_UNDERSTOOD = "Não entendi. Deseja confirmar sua presença? Toque em Sim ou Não.";
export const KEPT_PRESENCE_DECLINED = 'Tudo bem! Se quiser confirmar depois, é só tocar em "Confirmar presença" no lembrete.';

export const rescheduleLink = (phrase: string, patientName: string, url: string) =>
  `Prontinho! Escolha o novo dia e horário para ${phrase} de ${patientName} neste link:\n${url}\n\nO link vale por 30 minutos.`;
export const returnDeadlinePassed = (patientName: string, lastDate: string, receptionAvailable: boolean, d: Designation) =>
  `O prazo para o retorno de *${patientName}* terminou em ${lastDate}, então não é possível remarcar por aqui. ${
    receptionAvailable ? `Para falar com ${designationText(d)}, escolha a opção *Falar com a recepção* no menu inicial.` : `Por favor, fale com ${designationText(d)}.`
  }`;
export const homeAddressConfirmCurrent = (address: string) =>
  `O endereço gravado para esse atendimento domiciliar é: *${address}*. Ainda é esse?`;

export function presenceConfirmed(patientName: string, when: string, isExam: boolean): string {
  return (
    "Presença confirmada ✓\n\n" +
    `👤 Paciente: ${patientName}\n📅 ${when}\n\n` +
    (isExam ? "Lembre-se de seguir as orientações de preparo do exame que enviamos anteriormente.\n\n" : "") +
    "Obrigado! Qualquer dúvida, é só chamar por aqui."
  );
}
/** Local da consulta depois da presença confirmada (cliente, 02/nov/2026): nome, endereço e o mapa. */
export const mapsLink = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
export const locationAfterConfirm = (name: string, address: string) => `📍 *${name}*\n${address}\n\nComo chegar: ${mapsLink(address)}`;
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
export function waitlistNoAppointment(group: Group, category?: "consultation" | "return_visit" | "exam"): string {
  const what = category === "return_visit" ? "um retorno marcado" : group === "exam" ? "um exame marcado" : "uma consulta marcada";
  return (
    `A lista de espera serve para antecipar um horário já marcado, e não encontramos ${what} neste número. ` +
    "Quer marcar agora? Depois de confirmar pela página, o atendimento entra na lista de espera e eu aviso por aqui se abrir uma vaga antes."
  );
}
// Encaixe pedido pela base sem dizer o tipo (cliente, 01/nov/2026): primeiro o tipo, depois o serviço.
export const WAITLIST_TYPE_QUESTION = "O encaixe é para qual tipo de atendimento?";
export const WAITLIST_TYPE_IDS = { consultation: "waitlist_type_consultation", return_visit: "waitlist_type_return", exam: "waitlist_type_exam" } as const;
export const WAITLIST_TYPE_LABELS = { consultation: "Consulta", return_visit: "Retorno", exam: "Exame" } as const;
export const WAITLIST_SERVICE_QUESTION = "Para qual serviço é o encaixe?";

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

// Pedido de recepção digitado: confirma antes de transferir; "Não" volta ao menu (cliente, 30/out/2026).
// Assunto da transferência (cliente, 31/out/2026): perguntado uma vez, depois do aviso de transferência.
export const HANDOFF_SUBJECT_QUESTION = "Para agilizar, poderia me contar brevemente qual assunto deseja tratar com a secretária?";
export const HANDOFF_SUBJECT_THANKS = "Obrigado! Já repassamos para a nossa equipe.";

export const RECEPTION_CONFIRM = "Você quer falar com a recepção? A conversa passa para a nossa equipe.";
export const RECEPTION_CONFIRM_IDS = { yes: "reception_yes", no: "reception_no" } as const;
export const RECEPTION_CONFIRM_BUTTONS = [button(RECEPTION_CONFIRM_IDS.yes, "Sim"), button(RECEPTION_CONFIRM_IDS.no, "Não")];
export const RECEPTION_DECLINED = "Tudo bem, seguimos por aqui.";
/** Sem a recepção no app: a pergunta da transferência (cliente, 31/out/2026). */
export const receptionContactOffer = (d: Designation) => `Você quer que ${designationText(d)} entre em contato por aqui?`;
/** "Não" à transferência na clínica sem nada para marcar: não há menu (cliente, 31/out/2026). */
export const RECEPTION_DECLINED_NO_MENU = "Tudo bem. Se precisar, é só mandar mensagem por aqui.";
export const NOT_UNDERSTOOD_OFFER = "Não consegui entender sua mensagem.";
export const NOTHING_TO_BOOK = "No momento não há horários para marcar por aqui.";
export const noFreeTimesOffer = (serviceName: string) => `No momento não há horários livres para *${serviceName}*.`;

/** Fora do horário da recepção (cliente, 01/nov/2026). `when` null = aberta; undefined = sem previsão. */
export const outsideHoursNotice = (when: string | undefined): string =>
  when === undefined ? "No momento a recepção está fora do horário de atendimento; responderemos assim que possível." : `No momento a recepção está fora do horário de atendimento; responderemos a partir de ${when}.`;

export const HANDOFF =
  "Combinado! Vou te transferir para a recepção, que responde por aqui assim que possível. O atendimento automático fica pausado até lá.";

// Limite do contato atingido (F9.6a): neutro, sem revelar a regra (cliente, 10/out).
export const LIMIT_HANDOFF = "Para esse agendamento, vou passar sua conversa para a recepção, que responde por aqui assim que possível.";
/** Número sem coexistência: ninguém responderia por aqui. */
export const LIMIT_RECEPTION_WILL_CONTACT = "Para esse agendamento, a recepção vai entrar em contato com você.";

// Número bloqueado pela clínica (F9.6b): neutro, uma vez por dia, sem revelar o bloqueio.
export const BLOCKED_HANDOFF = "Sua conversa está com a recepção, que responde por aqui assim que possível.";
/** Número sem coexistência. */
export const BLOCKED_RECEPTION_WILL_CONTACT = "Sua conversa está com a recepção, que vai entrar em contato com você.";

// ---------------------------------------------------------------------------
// Base de conhecimento (BC, Etapa 4)
// ---------------------------------------------------------------------------

export const KB_DID_YOU_MEAN = "Você quis dizer…?";
export const KB_NONE_OF_THESE = "Nenhuma destas";
/** Botão de agendar depois de uma resposta da base (cliente, 02/nov/2026: "Agendar Atendimento", no lugar de "Marcar"). */
export const KB_BOOK = "Agendar Atendimento";
/** Encaixe pela base sem o item Lista de espera (cliente, 31/out/2026). */
export const KB_WAITLIST_RECEPTION = "O encaixe é combinado com a recepção. Você quer falar com a recepção?";
export const KB_NO_APPOINTMENTS = "Não encontramos atendimento marcado para este número.";

// ---------------------------------------------------------------------------
// Evolução do assistente (EA, cliente, 02/nov/2026)
// ---------------------------------------------------------------------------

/** Pedido de recepção sem motivo: o bot pergunta o motivo, com a recepção a um toque. */
export const RECEPTION_REASON_QUESTION =
  "Claro! 😊 Poderia me contar brevemente o que você precisa?\n\nAssim, talvez eu consiga ajudar você agora. Se preferir, toque abaixo e passo para a recepção.";
export const RECEPTION_NOW_ID = "reception_now";
export const RECEPTION_NOW_BUTTONS = [button(RECEPTION_NOW_ID, "Falar com a recepção")];
/** Motivo sem resposta segura na base (situação B). */
export const KB_NO_SAFE_ANSWER = "Não encontrei uma informação segura para responder sua dúvida. Vou encaminhar sua solicitação para a recepção, que poderá ajudar você.";

/** Confirmação depois da resposta da base: no pedido de recepção e fora de um fluxo. */
export const KB_CONFIRM_AFTER_RECEPTION = "Espero ter ajudado! 😊 Conseguiu resolver ou ainda quer falar com a recepção?";
export const KB_CONFIRM_QUESTION = "Isso resolve sua dúvida?";
export const KB_RESOLVED_THANKS = "Que bom! Se precisar, é só escrever por aqui.";
export const KB_CONFIRM_IDS = { resolved: "kb_resolved", reception: "kb_reception", menu: "kb_menu" } as const;
export const KB_RESOLVED_LABEL = "Resolvido";
export const KB_RECEPTION_LABEL = "Falar com a recepção";
export const KB_MENU_LABEL = "Voltar ao menu";
/** "Agendar Atendimento" sem serviço na resposta: o tipo, só entre o que a clínica marca pelo bot (cliente, 02/nov/2026). */
export const KB_BOOK_TYPE_QUESTION = "O que você quer agendar?";
export const KB_BOOK_TYPE_LABELS = { consultation: "Consulta", return_visit: "Retorno", exam: "Exame" } as const;

// ---------------------------------------------------------------------------
// Pedido não concluído (PN2; cliente, 03/nov/2026)
// ---------------------------------------------------------------------------

export type NotCompletedKind = "booking" | "reschedule" | "cancel";

const NOT_COMPLETED_WHAT: Record<NotCompletedKind, string> = {
  booking: "a marcação",
  reschedule: "a remarcação",
  cancel: "o cancelamento",
};

export const NOT_COMPLETED_IDS = { retry: "nc_retry", reception: "nc_reception", giveUp: "nc_give_up" } as const;

/** Link vencido sem uso ou cancelamento sem resposta: a mensagem padrão (decisão 1 do plano). */
export const notCompleted = (kind: NotCompletedKind, patientName: string) =>
  `Não concluímos ${NOT_COMPLETED_WHAT[kind]} de *${patientName}*. Como prefere seguir?`;

/** Novo link (no cancelamento, "Cancelar agora"); "Falar com a recepção" só com a recepção no app. */
export const notCompletedButtons = (kind: NotCompletedKind, receptionAvailable: boolean): ReplyButton[] => [
  button(NOT_COMPLETED_IDS.retry, kind === "cancel" ? "Cancelar agora" : "Novo link"),
  ...(receptionAvailable ? [button(NOT_COMPLETED_IDS.reception, "Falar com a recepção")] : []),
  button(NOT_COMPLETED_IDS.giveUp, "Desistir"),
];

/** Novo link do pedido não concluído. */
export const notCompletedNewLink = (kind: NotCompletedKind, patientName: string, url: string) =>
  `Aqui está um novo link para ${kind === "reschedule" ? "remarcar" : "marcar"} o atendimento de ${patientName}:\n${url}\n\nO link vale por 30 minutos.`;

/** Assunto da transferência (aparece em Atendimento humano). */
export const notCompletedSubject = (kind: NotCompletedKind, patientName: string) =>
  `Não concluiu ${NOT_COMPLETED_WHAT[kind]} de ${patientName} pelo WhatsApp.`;

/** Desistir na remarcação ou no cancelamento: o atendimento segue marcado. */
export const notCompletedKept = (phrase: string, end: "a" | "o", patientName: string, when: string) =>
  `Tudo bem, ${phrase} de ${patientName} continua marcad${end} para ${when}.`;

/** Desistir na marcação (ou quando não há atendimento marcado). */
export const NOT_COMPLETED_GIVE_UP = "Tudo bem. Quando quiser, é só mandar uma mensagem.";
