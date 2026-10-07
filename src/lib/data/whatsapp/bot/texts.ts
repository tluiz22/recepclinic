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
