import type { ClinicProfile } from "../../../vocabulary";
import { designationText, designationTitle, type Designation } from "../../../designation";
import { formatCentsBRL } from "../../../money";
import type { ListRow, ListSection, ReplyButton } from "../send";
import type { BotService } from "./catalog";
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

/** Botão das listas (cliente, 04/nov/2026: era "Escolher opção"). */
export const LIST_BUTTON = "Ver opções";
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

export const price = (cents: number | null | undefined) => (cents == null ? null : formatCentsBRL(cents));

// ---------------------------------------------------------------------------
// Início e menus
// ---------------------------------------------------------------------------

/**
 * Boas-vindas (EA, cliente, 02/nov/2026): com a base de conhecimento ligada, convida a escrever o que precisa;
 * sem ela, o texto de antes (o texto livre não seria entendido).
 */
export const welcome = (clinicLabel: string, invite = true, name: string | null = null) => {
  // Número cadastrado: com o primeiro nome do contato (cliente, 08/nov/2026).
  const hello = name ? `Olá, ${name}! 👋` : "Olá! 👋";
  return invite
    ? `${hello} Aqui é ${clinicLabel}.\n\nSou a assistente virtual e estou aqui para ajudar.\nVocê pode escrever o que precisa ou escolher uma das opções abaixo.`
    : `${hello} Aqui é ${clinicLabel}.`;
};
export const MENU_BODY = "Escolha uma das opções abaixo.";
/** Menu com a base de conhecimento ligada: convida a perguntar (cliente, 04/nov/2026). */
export const MENU_BODY_ASK = "Escolha uma opção abaixo ou faça uma pergunta.";

/** Descrições das opções do menu principal (cliente, 04/nov/2026; até 72 caracteres, limite da Meta). */
// ---------------------------------------------------------------------------
// Bot enxuto (F3f, seção 15.6; canvas aprovado pelo cliente em 11/nov/2026)
// ---------------------------------------------------------------------------

/** BE-2: o menu principal; a lista do WhatsApp não aceita ícone, o emoji é o símbolo (cliente). */
export const LEAN_MENU = [
  { id: "menu_book", label: "📅 Agendar", description: "Consulta, retorno ou exame" },
  { id: "menu_mine", label: "🗓 Minhas consultas", description: "Consultar, remarcar ou cancelar" },
  { id: "menu_professionals", label: "👥 Profissionais", description: "Especialidades, valores e convênios" },
  { id: "menu_reception", label: "🎧 Falar com a recepção", description: "Atendimento com a nossa equipe" },
] as const;
/** A descrição de Agendar sem exame na clínica (exame desligado nos recursos): só consulta ou retorno (cliente, 12/nov/2026). */
export const LEAN_BOOK_DESCRIPTION_NO_EXAM = "Consulta ou retorno";
export type LeanMenuId = (typeof LEAN_MENU)[number]["id"];

/**
 * Boas-vindas do menu principal (cliente, 12/nov/2026): diz que é o contato oficial de agendamento e o que cada opção
 * do menu faz. `clinicLabel` já vem com o artigo ("da Clínica X"); o nome da clínica sai em negrito do WhatsApp.
 * "Exame" só com exame na clínica; "Falar com a recepção" só quando a recepção atende pelo app.
 */
export const leanWelcome = (name: string | null, clinicLabel: string, clinicName: string, { exams = true, reception = true } = {}) =>
  [
    `Olá${name ? `, ${name}` : ""}! 👋`,
    `Este é o contato oficial para agendamento ${clinicLabel.replace(clinicName.trim(), `*${clinicName.trim()}*`)}.`,
    "Estamos aqui para ajudar você! 😊",
    "Por aqui, você pode:",
    exams ? "📅 Agendar consulta, retorno ou exame." : "📅 Agendar consulta ou retorno.",
    exams ? "🗓 Remarcar ou cancelar sua consulta ou exame." : "🗓 Remarcar ou cancelar sua consulta.",
    "👥 Consultar informações sobre profissionais, especialidades, valores e convênios.",
    ...(reception ? ["🎧 Falar diretamente com a recepção: atendimento com a nossa equipe."] : []),
    "Escolha uma das opções abaixo.",
  ].join("\n\n");
export const leanMenuHeader = (clinicName: string) => clinicName;

/** BE-3: uma mensagem com o botão do link. */
export const LEAN_LINKS = {
  book: { body: "Para agendar sua consulta ou exame, toque no botão abaixo. Você escolhe o profissional, o dia e o horário.", button: "Agendar no portal" },
  my_appointments: { body: "Para ver, remarcar ou cancelar suas consultas, toque no botão abaixo.", button: "Minhas consultas" },
  return: { body: "Para marcar seu retorno, toque no botão abaixo.", button: "Marcar retorno" },
  exam: { body: "Para marcar seu exame, toque no botão abaixo. Você escolhe o dia e o horário.", button: "Marcar exame" },
  professionals: { body: "Veja os profissionais, valores e convênios aceitos. Se quiser, já agenda por lá.", button: "Ver profissionais" },
} as const;

/** Botões Remarcar e Cancelar do lembrete atual (rc_lembrete_v1), até o lembrete novo (BE-10): o portal já na ação. */
export const reminderRescheduleLink = (phrase: string, patientName: string) => `Para remarcar ${phrase} de *${patientName}*, toque no botão abaixo.`;
export const reminderCancelLink = (phrase: string, patientName: string) => `Para cancelar ${phrase} de *${patientName}*, toque no botão abaixo.`;
export const REMINDER_RESCHEDULE_BUTTON = "Remarcar";
export const REMINDER_CANCEL_BUTTON = "Cancelar";

/** BE-4: a transferência pedida, numa mensagem; fora do horário, com o horário da recepção. */
export const LEAN_HANDOFF = "Certo! A recepção vai te atender por aqui. Escreva sua dúvida, por favor.";
export const leanOutsideHours = (hours: string) => `A recepção atende de ${hours}, e responde assim que abrir.`;
export const LEAN_OUTSIDE_HOURS_NO_HOURS = "A recepção está fora do horário de atendimento e responde assim que abrir.";

export function notUnderstood(isMainMenu = false): string {
  return isMainMenu
    ? "Não entendi sua resposta 🙏 Escolha uma das opções abaixo."
    : "Não entendi sua resposta 🙏 Escolha uma das opções abaixo (ou digite 0 para voltar ao menu principal).";
}
export const NOT_UNDERSTOOD_YES_NO = "Não entendi 🙏 Responda apenas Sim ou Não.";

// Mídia no lugar de uma resposta (F8.5d, cliente, 27/out/2026): o bot só lê texto e toques.
export const MEDIA_AUDIO = "Ainda não consigo ouvir áudios 🙏 Escolha uma das opções abaixo.";
export const MEDIA_OTHER = "Ainda não consigo ver fotos, vídeos, figurinhas ou arquivos 🙏 Escolha uma das opções abaixo.";

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
export const LOCATION_LABELS = { clinic: "Consultório", home_visit: "Atendimento domiciliar" } as const;
export const otherPatientLabel = other;

export const askBirthdate = (w: Words) => `Qual a data de nascimento ${of(w)}? (formato dd/mm/aaaa)`;
export const confirmPatient = (w: Words, name: string, birthdate: string) =>
  `Encontramos *${name}*, nascido(a) em ${birthdate}: ${w.feminine ? "é essa a" : "é esse o"} ${w.patient}?`;
/** Idade limite da clínica (consulta), com o profissional escolhido ou, no "Primeiro horário", a clínica. */
export const ageLimitNotice = (professionalName: string | null, d: Designation, limitYears: number) =>
  `${professionalName ?? designationTitle(d)} atende pacientes até ${limitYears - 1} anos.`;

/**
 * Link do portal (F3b; proposta 3.4): o que vai marcar, a validade e que é só deste número. Do "Encaixe ou antecipar"
 * sem nada marcado (F3-2): ao marcar, entra na lista de espera.
 */
export const portalLink = (what: string, url: string, joinWaitlist = false) =>
  `Para escolher o dia e o horário ${what === "retorno" ? "do" : "de"} *${what}*, toque no link abaixo. Ele vale por 30 minutos e é só para este número:\n${url}` +
  (joinWaitlist ? "\n\nAo marcar, você entra na lista de espera: se vagar um horário mais cedo, avisamos aqui." : "");

/** Acima da idade limite, com o profissional escolhido ou a clínica (cliente, 31/out/2026). */
export const ageLimit = (professionalName: string | null, d: Designation, limitYears: number, w: Words) =>
  `${ageLimitNotice(professionalName, d, limitYears)}\n\nDeseja agendar para ${w.feminine ? "outra criança" : "outra pessoa"}?`;

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

/** O atendimento pelo serviço: "a consulta", "o retorno", "o exame Espirometria". */
export function appointmentWords(category: "consultation" | "return_visit" | "exam", serviceName: string): { phrase: string; end: "a" | "o" } {
  if (category === "consultation") return { phrase: "a consulta", end: "a" };
  if (category === "return_visit") return { phrase: "o retorno", end: "o" };
  return { phrase: `o exame ${serviceName}`, end: "o" };
}

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

export const RECEPTION_CONFIRM = "Você quer falar com a recepção? A conversa passa para a nossa equipe.";
export const RECEPTION_CONFIRM_IDS = { yes: "reception_yes", no: "reception_no" } as const;
export const RECEPTION_CONFIRM_BUTTONS = [button(RECEPTION_CONFIRM_IDS.yes, "Sim"), button(RECEPTION_CONFIRM_IDS.no, "Não")];
export const RECEPTION_DECLINED = "Tudo bem, seguimos por aqui.";
/** Sem a recepção no app: a pergunta da transferência (cliente, 31/out/2026). */
export const receptionContactOffer = (d: Designation) => `Você quer que ${designationText(d)} entre em contato por aqui?`;
/** "Não" à transferência na clínica sem nada para marcar: não há menu (cliente, 31/out/2026). */
export const RECEPTION_DECLINED_NO_MENU = "Tudo bem. Se precisar, é só mandar mensagem por aqui.";
export const NOT_UNDERSTOOD_OFFER = "Não consegui entender sua mensagem.";

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

// ---------------------------------------------------------------------------
// Evolução do assistente (EA, cliente, 02/nov/2026)
// ---------------------------------------------------------------------------

export const RECEPTION_NOW_ID = "reception_now";
/** Motivo sem resposta segura na base (situação B). */
export const KB_NO_SAFE_ANSWER = "Não encontrei uma informação segura para responder sua dúvida. Vou encaminhar sua solicitação para a recepção, que poderá ajudar você.";

/**
 * Confirmação depois da resposta da base, só no motivo de um pedido de recepção. Fora de um fluxo, o menu (ou o
 * submenu) de novo, sem o "Isso resolve sua dúvida?" (cliente, 04/nov/2026).
 */
export const KB_CONFIRM_AFTER_RECEPTION = "Espero ter ajudado! 😊 Conseguiu resolver ou ainda quer falar com a recepção?";
export const KB_RESOLVED_THANKS = "Que bom! Se precisar, é só escrever por aqui.";
export const KB_CONFIRM_IDS = { resolved: "kb_resolved", reception: "kb_reception", menu: "kb_menu" } as const;
export const KB_RESOLVED_LABEL = "Resolvido";
export const KB_RECEPTION_LABEL = "Falar com a recepção";
