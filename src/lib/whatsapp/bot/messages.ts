// Textos e menus do bot de WhatsApp (Fase 3b). Mantido separado do roteador
// (`./router.ts`) para deixar o conteúdo das mensagens fácil de revisar e
// ajustar sem mexer na lógica de estados.

import type { ListSection } from "../client";
import { formatWhen } from "../formatDateTime";
import { formatCentsBRL } from "../../money";
import { BACK_TO_MENU_LIST_ID, type AppointmentCategory } from "./shared";

const DOCTOR_NAME = "Dra. Ana Karina Fernandes";

// A Meta rejeita a mensagem inteira (erro 131009 "Parameter value is not
// valid") se o título de uma linha de lista passar de 24 caracteres — já
// aconteceu com "1. Instituto Andre Camurça" (26) e pode acontecer de novo
// com nome de paciente comprido. Central pra nunca mais estourar o limite.
const MAX_LIST_ROW_TITLE = 24;

function listRowTitle(index: number, label: string): string {
  const prefix = `${index + 1}. `;
  const maxLabelLength = MAX_LIST_ROW_TITLE - prefix.length;
  const truncated = label.length > maxLabelLength ? `${label.slice(0, maxLabelLength - 1)}…` : label;
  return `${prefix}${truncated}`;
}

// Menu principal reorganizado (set/2026) — as 7 opções soltas de antes
// (Agendar consulta/retorno, Cancelar, Remarcar, Informações, Secretária,
// Marcar exame) viraram 4 grupos, pra não afogar o responsável de opções
// numa lista só. Cancelar e Remarcar são, por baixo dos panos, o mesmo
// fluxo de sempre (o responsável só pode ter um agendamento futuro ativo
// por vez, seja consulta, retorno ou exame) — aparecem tanto em Consultas
// quanto em Exames porque é o caminho que o responsável espera encontrar,
// mesmo sendo a mesma lógica nos dois casos.
export const MENU_LIST_ID = {
  consultas: "menu_consultas",
  exames: "menu_exames",
  informacoes: "menu_informacoes",
  secretaria: "menu_secretaria",
} as const;

export const CONSULTAS_LIST_ID = {
  agendarConsulta: "consultas_agendar_consulta",
  agendarRetorno: "consultas_agendar_retorno",
  cancelar: "consultas_cancelar",
  remarcar: "consultas_remarcar",
} as const;

export const EXAMES_LIST_ID = {
  marcar: "exames_marcar",
  cancelar: "exames_cancelar",
  remarcar: "exames_remarcar",
} as const;

export const INFO_LIST_ID = {
  valores: "info_valores",
  convenios: "info_convenios",
  endereco: "info_endereco",
  preparo: "info_preparo",
} as const;

// Decisão de negócio #1 do plano: o aviso de atendimento particular vem
// junto com o nome da clínica, na própria mensagem de boas-vindas — antes
// de qualquer pergunta de agendamento.
export function welcomeText(): string {
  return `Olá! 👋 Você está falando com o consultório da ${DOCTOR_NAME} (atendimento particular, sem convênio).`;
}

export function menuBodyText(): string {
  return "Como podemos ajudar hoje? Escolha uma opção abaixo (ou digite o número).";
}

export function menuSections(): ListSection[] {
  return [
    {
      rows: [
        { id: MENU_LIST_ID.consultas, title: listRowTitle(0, "Consultas") },
        { id: MENU_LIST_ID.exames, title: listRowTitle(1, "Exames") },
        { id: MENU_LIST_ID.informacoes, title: listRowTitle(2, "Informações gerais") },
        { id: MENU_LIST_ID.secretaria, title: listRowTitle(3, "Falar com secretária") },
      ],
    },
  ];
}

export function consultasMenuBodyText(): string {
  return "O que você precisa sobre consultas?";
}

export function consultasMenuSections(): ListSection[] {
  return [
    {
      rows: [
        { id: CONSULTAS_LIST_ID.agendarConsulta, title: listRowTitle(0, "Agendar consulta") },
        { id: CONSULTAS_LIST_ID.agendarRetorno, title: listRowTitle(1, "Agendar retorno") },
        { id: CONSULTAS_LIST_ID.cancelar, title: listRowTitle(2, "Cancelar") },
        { id: CONSULTAS_LIST_ID.remarcar, title: listRowTitle(3, "Remarcar") },
        { id: BACK_TO_MENU_LIST_ID, title: listRowTitle(4, "Voltar ao menu") },
      ],
    },
  ];
}

export function examesMenuBodyText(): string {
  return "O que você precisa sobre exames?";
}

export function examesMenuSections(): ListSection[] {
  return [
    {
      rows: [
        { id: EXAMES_LIST_ID.marcar, title: listRowTitle(0, "Marcar exame") },
        { id: EXAMES_LIST_ID.cancelar, title: listRowTitle(1, "Cancelar") },
        { id: EXAMES_LIST_ID.remarcar, title: listRowTitle(2, "Remarcar") },
        { id: BACK_TO_MENU_LIST_ID, title: listRowTitle(3, "Voltar ao menu") },
      ],
    },
  ];
}

// `isMainMenu` omite a dica "digite 0 para voltar ao menu principal" —
// não faz sentido oferecer para quem já está no menu principal (só
// `handleMenu()` em router.ts passa `true`; os demais pontos de chamada,
// dentro de sub-fluxos, continuam mostrando a dica normalmente).
export function notUnderstoodText(isMainMenu?: boolean): string {
  if (isMainMenu) return "Não entendi sua resposta 🙏 Escolha uma das opções abaixo.";
  return "Não entendi sua resposta 🙏 Escolha uma das opções abaixo (ou digite 0 para voltar ao menu principal).";
}

export function infoMenuBodyText(): string {
  return "O que você gostaria de saber?";
}

export function infoMenuSections(): ListSection[] {
  return [
    {
      rows: [
        { id: INFO_LIST_ID.valores, title: listRowTitle(0, "Valores") },
        { id: INFO_LIST_ID.convenios, title: listRowTitle(1, "Convênios") },
        { id: INFO_LIST_ID.endereco, title: listRowTitle(2, "Endereço") },
        { id: INFO_LIST_ID.preparo, title: listRowTitle(3, "Preparo para exames") },
        { id: BACK_TO_MENU_LIST_ID, title: listRowTitle(4, "Voltar ao menu") },
      ],
    },
  ];
}

// --- Informações gerais > Preparo para exames (Fase 18) -------------------

interface PreparationExamOption {
  id: string;
  name: string;
}

// A lista interativa da Meta aceita no máximo 10 linhas — 9 exames + "Voltar
// ao menu".
export const MAX_PREPARATION_EXAMS = 9;

export function preparationChoiceBodyText(): string {
  return "De qual exame você quer ver o preparo?";
}

// Nome completo na descrição da linha (até 72 caracteres): o título corta em
// 24 (ex.: "FeNO - Fração exalada de óxido nítrico").
export function preparationExamSections(exams: PreparationExamOption[]): ListSection[] {
  const rows: ListSection["rows"] = exams.map((exam, index) => {
    const title = listRowTitle(index, exam.name);
    const truncated = !title.endsWith(exam.name);
    return {
      id: `prep_exam_${exam.id}`,
      title,
      ...(truncated ? { description: exam.name.slice(0, 72) } : {}),
    };
  });
  rows.push({ id: BACK_TO_MENU_LIST_ID, title: listRowTitle(exams.length, "Voltar ao menu") });
  return [{ rows }];
}

export function noPreparationExamsText(): string {
  return "No momento nenhum exame tem orientações de preparo cadastradas. Se tiver dúvida, fale com a secretária pelo menu principal.";
}

// Preparo como a médica escreveu (já no formato do WhatsApp) + o link da
// página, para guardar ou compartilhar.
export function preparationText(preparation: string, url: string): string {
  return `${preparation}\n\n🔗 Para guardar ou compartilhar estas orientações:\n${url}`;
}

interface ClinicLocationRow {
  name: string;
  type: string;
  price_first_visit_cents: number;
}

interface ExamTypePriceRow {
  name: string;
  price_cents: number;
}

// Decisão de negócio #2/#3 do plano: o bot sempre informa o valor e reforça
// que o pagamento é 100% presencial, sem sinal antecipado. `locations` já
// vem sem o local "Exames" (chamador filtra por type != 'exam' — o valor de
// exame vive em exam_types, mostrado separado). Para o tipo "clinic", o
// nome próprio do local (ex. "Instituto Andre Camurça") não aparece — só
// "Consulta" — pedido do cliente; "Atendimento domiciliar" continua com o
// rótulo de sempre.
export function valoresText(locations: ClinicLocationRow[], examTypes: ExamTypePriceRow[]): string {
  if (locations.length === 0 && examTypes.length === 0) {
    return "No momento não temos valores cadastrados por aqui — escolha [4] Falar com a secretária para confirmar.";
  }

  // Pode haver mais de um local type='clinic' (2 consultórios físicos, set/2026)
  // — o valor da consulta é o mesmo em todos, então mostra uma única linha
  // "Consulta" em vez de uma por consultório (o endereço específico só é
  // decidido pela data escolhida, não faz sentido listar aqui).
  const clinicRow = locations.find((loc) => loc.type === "clinic");
  const homeVisitRows = locations.filter((loc) => loc.type === "home_visit");

  const locationLines = [
    ...(clinicRow ? [`*Consulta*\n${formatCentsBRL(clinicRow.price_first_visit_cents)}`] : []),
    ...homeVisitRows.map(
      (loc) => `*Atendimento domiciliar*\nConsulta: ${formatCentsBRL(loc.price_first_visit_cents)}`
    ),
  ];

  const examLines =
    examTypes.length > 0
      ? [
          `*Exames*\n${examTypes
            .map((exam) => `${exam.name}: ${formatCentsBRL(exam.price_cents)}`)
            .join("\n")}`,
        ]
      : [];

  return (
    `${[...locationLines, ...examLines].join("\n\n")}\n\n` +
    "O retorno está incluso no valor da consulta.\n\n" +
    "Pagamento no dia da consulta (dinheiro, transferência bancária ou PIX) — sem cobrança antecipada."
  );
}

// Decisão de negócio #1 do plano: atendimento particular + recibo para
// reembolso junto ao convênio, quando aplicável.
export function conveniosText(): string {
  return (
    "Atendemos apenas de forma particular, sem convênio. " +
    "Emitimos recibo para você solicitar reembolso junto ao seu convênio, quando aplicável."
  );
}

interface ClinicAddressRow {
  name: string;
  address: string | null;
}

// Lista todos os consultórios cadastrados (não só um) — preparado para
// quando houver mais de um endereço físico de consultório (ver "Backlog
// futuro" no plano). Como a data escolhida decide para qual consultório a
// consulta vai, o texto deixa claro que o endereço definitivo só é
// confirmado depois, na mensagem de confirmação.
export function enderecoText(clinicLocations: ClinicAddressRow[]): string {
  const withAddress = clinicLocations.filter(
    (loc): loc is ClinicAddressRow & { address: string } => !!loc.address
  );

  if (withAddress.length === 0) {
    return "O endereço do consultório ainda não está cadastrado por aqui — escolha [4] Falar com a secretária para confirmar.";
  }

  const linhas = withAddress.map((loc) => {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}`;
    return `*${loc.name}*\n${loc.address}\n${mapsUrl}`;
  });

  const intro = withAddress.length > 1 ? "Temos os seguintes consultórios:" : null;
  const outro =
    "O endereço da sua consulta será confirmado na mensagem de confirmação, de acordo com a data escolhida.";

  return [intro, ...linhas, outro].filter(Boolean).join("\n\n");
}

export function handoffText(): string {
  return (
    "Combinado! Vou te transferir para a secretária, que responde por aqui assim que possível. " +
    "O atendimento automático fica pausado até lá."
  );
}

// Usado enquanto SECRETARIA_HANDOFF_DISABLED (router.ts) está true, durante
// os testes do sistema — ver comentário ao lado da flag.
export function handoffDisabledText(): string {
  return "Em testes, opção temporariamente desabilitada 🙏 Escolha outra opção no menu abaixo.";
}

// --- case 1 · Agendar -------------------------------------------------

export interface LocationOption {
  id: string;
  label: string;
}

export function locationBodyText(): string {
  return "Prefere consultório ou atendimento domiciliar?";
}

export function locationSections(options: LocationOption[]): ListSection[] {
  const rows = options.map((opt, index) => ({
    id: `book_location_${opt.id}`,
    title: listRowTitle(index, opt.label),
  }));
  rows.push({ id: BACK_TO_MENU_LIST_ID, title: listRowTitle(options.length, "Voltar ao menu") });
  return [{ rows }];
}

export function noLocationAvailableText(): string {
  return "No momento não temos nenhum local de atendimento configurado — escolha [4] Falar com a secretária no menu principal.";
}

// --- endereço do atendimento domiciliar (Fase 16) ----------------------

export function homeAddressAskText(): string {
  return (
    "Qual é o endereço para o atendimento domiciliar? (rua, número, bairro, complemento e um ponto de referência, se tiver)\n\n" +
    "Esse endereço é usado só para a nossa equipe chegar até vocês nessa consulta."
  );
}

export function homeAddressConfirmDefaultText(address: string): string {
  return `A última visita domiciliar foi feita neste endereço: *${address}*. Ainda é esse? Responda Sim ou Não.`;
}

// Reconfirmação ao remarcar (Fase 16) — mesma ideia do texto acima, mas
// falando da consulta específica sendo remarcada, não de um "padrão" salvo.
export function homeAddressConfirmCurrentText(address: string): string {
  return `O endereço gravado para esse atendimento domiciliar é: *${address}*. Ainda é esse? Responda Sim ou Não.`;
}

export function homeAddressConfirmNewText(address: string): string {
  return `Confirma que o endereço é esse? *${address}*\nResponda Sim ou Não.`;
}

interface PatientCandidate {
  id: string;
  full_name: string;
}

// Fase 21: no exame o paciente pode ser adulto — os textos da identificação
// do paciente dizem "paciente" quando `isExam`; consulta/retorno continuam
// dizendo "criança".
export function patientChoiceBodyText(isExam = false): string {
  return isExam
    ? "Encontramos exames futuros para estes pacientes. Para qual deles é o exame?"
    : "Encontramos consultas futuras para estas crianças. Para qual delas é o agendamento?";
}

export const PATIENT_NEW_LIST_ID = "book_patient_new";

export function patientChoiceSections(candidates: PatientCandidate[], isExam = false): ListSection[] {
  const rows = candidates.map((c, index) => ({
    id: `book_patient_${c.id}`,
    title: listRowTitle(index, c.full_name),
  }));
  rows.push({ id: PATIENT_NEW_LIST_ID, title: listRowTitle(candidates.length, isExam ? "Outro paciente" : "Outra criança") });
  rows.push({ id: BACK_TO_MENU_LIST_ID, title: listRowTitle(candidates.length + 1, "Voltar ao menu") });
  return [{ rows }];
}

export function askBirthdateText(isExam = false): string {
  return isExam
    ? "Encontramos vários pacientes cadastrados nesse telefone. " +
        "Qual a data de nascimento do paciente? (formato dd/mm/aaaa)"
    : "Encontramos várias crianças cadastradas nesse telefone. " +
        "Qual a data de nascimento da criança? (formato dd/mm/aaaa)";
}

// Usado ao cadastrar uma criança nova, antes de pedir o nome — evita
// duplicar o cadastro de uma criança já existente (sem consulta futura)
// com o nome digitado de um jeito ligeiramente diferente.
export function askBirthdateForDuplicateCheckText(isExam = false): string {
  return `Informe a data de nascimento ${isExam ? "do paciente" : "da criança"} (formato dd/mm/aaaa)`;
}

export function birthdateMatchChoiceBodyText(isExam = false): string {
  return isExam
    ? "Encontramos pacientes já cadastrados com essa data de nascimento nesse telefone. É um deles?"
    : "Encontramos crianças já cadastradas com essa data de nascimento nesse telefone. É uma delas?";
}

export function invalidBirthdateText(): string {
  return "Não consegui entender essa data. Por favor, digite no formato dd/mm/aaaa (ex.: 10/03/2020).";
}

export function confirmPatientText(fullName: string, birthdateLabel: string, isExam = false): string {
  const question = isExam ? "é esse o paciente?" : "é essa a criança?";
  return `Encontramos *${fullName}*, nascido(a) em ${birthdateLabel} — ${question} Responda Sim ou Não.`;
}

export function notUnderstoodYesNoText(): string {
  return "Não entendi 🙏 Responda apenas Sim ou Não.";
}

export function askGuardianNameText(isExam = false): string {
  return `Antes de continuar, qual é o seu nome completo (responsável ${isExam ? "pelo paciente" : "pela criança"})?`;
}

// Confirmação do nome do responsável (telefone novo) antes de pedir os
// dados da criança — Não pede o nome de novo (ver handlePatientNew em
// booking.ts).
export function confirmGuardianNameText(fullName: string): string {
  return (
    "Confira o seu nome:\n" +
    `Nome do responsável: *${fullName}*\n\n` +
    "Está correto? Responda Sim ou Não."
  );
}

export function askNewPatientNameText(isExam = false): string {
  return `Qual é o nome completo ${isExam ? "do paciente" : "da criança"}?`;
}

export function askNewPatientBirthdateText(isExam = false): string {
  return `Qual a data de nascimento ${isExam ? "do paciente" : "da criança"}? (formato dd/mm/aaaa)`;
}

// Confirmação antes de cadastrar a criança nova — se o responsável
// responder Não, volta a pedir os dados (ver handlePatientNew em booking.ts).
export function confirmNewPatientText(fullName: string, birthdateLabel: string, isExam = false): string {
  return (
    `Confira os dados ${isExam ? "do paciente" : "da criança"}:\n` +
    `Nome: *${fullName}*\n` +
    `Data de nascimento: *${birthdateLabel}*\n\n` +
    "Está tudo certo? Responda Sim ou Não."
  );
}

export function bookingLinkText(patientName: string, url: string): string {
  return (
    `Prontinho! Escolha o melhor dia e horário para a consulta de ${patientName} neste link:\n${url}\n\n` +
    "O link expira em 30 minutos."
  );
}

export function bookingLinkErrorText(): string {
  return "Tivemos um problema para gerar o link de agendamento. Por favor, escolha [4] Falar com a secretária no menu principal.";
}

export function patientAlreadyScheduledText(patientName: string, whenLabel: string, isExam: boolean): string {
  const menuPath = isExam ? "Exames > Remarcar" : "Consultas > Remarcar";
  return (
    `*${patientName}* já tem ${isExam ? "um exame marcado" : "uma consulta marcada"} para ${whenLabel}. ` +
    `Se quiser mudar o dia ou horário, escolha ${menuPath} no menu principal.`
  );
}

// --- Agendar retorno (Fase 17) --------------------------------------------
//
// Só crianças com direito a retorno (ver returnVisitEligibility.ts) — sem
// pergunta de local (retorno é sempre no consultório) e sem "Outra criança"
// (criança nova nunca tem direito).

export function returnVisitChoiceBodyText(deadlineDays: number): string {
  return `O retorno deve ser realizado em até ${deadlineDays} dias após a consulta. Para qual criança é o retorno?`;
}

export function returnVisitChoiceSections(candidates: PatientCandidate[]): ListSection[] {
  const rows = candidates.map((c, index) => ({
    id: `book_return_patient_${c.id}`,
    title: listRowTitle(index, c.full_name),
  }));
  rows.push({ id: BACK_TO_MENU_LIST_ID, title: listRowTitle(candidates.length, "Voltar ao menu") });
  return [{ rows }];
}

export function returnVisitAskBirthdateText(deadlineDays: number): string {
  return (
    `O retorno deve ser realizado em até ${deadlineDays} dias após a consulta. ` +
    "Qual a data de nascimento da criança? (formato dd/mm/aaaa)"
  );
}

export function returnVisitBirthdateNotFoundText(): string {
  return (
    "Não encontramos nenhuma criança com essa data de nascimento com direito a retorno. " +
    "Confira a data e envie de novo (formato dd/mm/aaaa), ou digite 0 para voltar ao menu."
  );
}

export function returnVisitNoRecentConsultationText(deadlineDays: number): string {
  return (
    `A última consulta tem mais de ${deadlineDays} dias. O retorno deve ser realizado em até ${deadlineDays} dias ` +
    "após a consulta — passado esse prazo, é preciso marcar uma nova consulta em Consultas > Agendar consulta."
  );
}

export function returnVisitHomeVisitText(): string {
  return (
    "A última consulta foi um atendimento domiciliar, e consulta domiciliar não dá direito a retorno. " +
    "Para um novo atendimento, escolha Consultas > Agendar consulta."
  );
}

export function returnVisitAlreadyUsedText(patientName: string): string {
  return (
    `O retorno da última consulta de *${patientName}* já foi agendado — cada consulta dá direito a um retorno. ` +
    "Para um novo atendimento, escolha Consultas > Agendar consulta."
  );
}

// --- limites de idade (Fase 21) --------------------------------------------

// Consulta: pode marcar até completar a idade limite (Configurações > Duração).
export function consultationAgeLimitText(limitYears: number): string {
  return `A Dra. Ana Karina atende consultas de pacientes até ${limitYears - 1} anos.`;
}

// Retorno: paciente 18+ nunca entra (consulta e retorno são só para crianças).
export function returnVisitAdultText(): string {
  return "A Dra. Ana Karina atende retornos somente de pacientes menores de 18 anos.";
}

// --- case 6 · Marcar exame (Fase 6) ---------------------------------------
//
// Reaproveita a identificação de paciente do case 1 (BOOK_PATIENT_SELECT/
// BOOK_PATIENT_NEW, em booking.ts) — só a escolha do tipo de exame é
// exclusiva daqui, já que não existe pergunta de local (todo exame usa o
// único local "Exames").

interface ExamTypeOption {
  id: string;
  name: string;
}

export function examTypeChoiceBodyText(): string {
  return "Qual exame você quer marcar?";
}

export function examTypeSections(examTypes: ExamTypeOption[]): ListSection[] {
  const rows = examTypes.map((exam, index) => ({
    id: `exam_type_${exam.id}`,
    title: listRowTitle(index, exam.name),
  }));
  rows.push({ id: BACK_TO_MENU_LIST_ID, title: listRowTitle(examTypes.length, "Voltar ao menu") });
  return [{ rows }];
}

// "Para quem é o exame?" (Fase 21) — botões de resposta.
export const EXAM_FOR_WHOM_ID = {
  self: "exam_for_self",
  other: "exam_for_other",
} as const;

export function examForWhomBodyText(): string {
  return "O exame é para você ou para outra pessoa?";
}

export function examForWhomButtons(): { id: string; title: string }[] {
  return [
    { id: EXAM_FOR_WHOM_ID.self, title: "Para mim" },
    { id: EXAM_FOR_WHOM_ID.other, title: "Outra pessoa" },
  ];
}

export function examSelfAskBirthdateText(): string {
  return "Qual é a sua data de nascimento? (formato dd/mm/aaaa)";
}

export function examSelfMinorText(): string {
  return "Para menores de 18 anos, o exame precisa ser marcado pelo responsável.";
}

export function examSelfAskNameText(): string {
  return "Qual é o seu nome completo?";
}

export function confirmSelfPatientText(fullName: string, birthdateLabel: string): string {
  return (
    "Confira os seus dados:\n" +
    `Nome: *${fullName}*\n` +
    `Data de nascimento: *${birthdateLabel}*\n\n` +
    "Está tudo certo? Responda Sim ou Não."
  );
}

export function noExamTypesAvailableText(): string {
  return "No momento não temos nenhum exame configurado para marcação — escolha [4] Falar com a secretária no menu principal.";
}

export function examBookingLinkText(patientName: string, examName: string, url: string): string {
  return (
    `Prontinho! Escolha o melhor dia e horário para o exame (${examName}) de ${patientName} neste link:\n${url}\n\n` +
    "O link expira em 30 minutos."
  );
}

// --- identificação de consulta futura (compartilhada pelos cases 2 e 3) --
//
// Mesmo princípio anti-convênio do case 1 · Agendar: nunca listar às cegas
// todas as consultas de um responsável (ver "Identificação da criança" no
// plano). Usado tanto por Cancelar (bot/cancel.ts) quanto por Remarcar
// (bot/reschedule.ts).

interface AppointmentCandidate {
  id: string;
  patient_name: string;
  scheduled_at: string;
}

// "consulta" e "exame" são jornadas separadas (pedido do cliente, set/2026)
// — Cancelar/Remarcar precisam dizer a palavra certa dependendo de onde o
// responsável entrou (Consultas ou Exames), inclusive concordância de
// gênero ("a consulta"/"o exame", "nenhuma"/"nenhum", "marcada"/"marcado").
interface CategoryWords {
  noun: string;
  article: string;
  ofArticle: string;
  none: string;
  adjEnd: "a" | "o";
  demonstrative: string;
  possessive: string;
}

function categoryWords(category: AppointmentCategory): CategoryWords {
  if (category === "exame") {
    return {
      noun: "exame",
      article: "o",
      ofArticle: "do",
      none: "nenhum",
      adjEnd: "o",
      demonstrative: "esse",
      possessive: "seu",
    };
  }
  return {
    noun: "consulta",
    article: "a",
    ofArticle: "da",
    none: "nenhuma",
    adjEnd: "a",
    demonstrative: "essa",
    possessive: "sua",
  };
}

export function appointmentChoiceBodyText(action: "remarcar" | "cancelar", category: AppointmentCategory): string {
  return `Qual ${categoryWords(category).noun} você quer ${action}?`;
}

export function appointmentListSections(candidates: AppointmentCandidate[], idPrefix: string): ListSection[] {
  const rows = candidates.map((c, index) => ({
    id: `${idPrefix}_${c.id}`,
    title: listRowTitle(index, c.patient_name),
    description: formatWhen(new Date(c.scheduled_at)),
  }));
  rows.push({ id: BACK_TO_MENU_LIST_ID, title: listRowTitle(candidates.length, "Voltar ao menu"), description: "" });
  return [{ rows }];
}

export function noMatchingAppointmentText(category: AppointmentCategory): string {
  const w = categoryWords(category);
  return `Não encontramos ${w.noun} futur${w.adjEnd} para essa data de nascimento. Escolha [4] Falar com a secretária no menu principal se precisar de ajuda.`;
}

export function couldNotIdentifyAppointmentText(category: AppointmentCategory): string {
  return `Não conseguimos confirmar qual ${categoryWords(category).noun} é. Escolha [4] Falar com a secretária no menu principal.`;
}

// --- case 3 · Remarcar --------------------------------------------------

export function rescheduleNoGuardianText(): string {
  return "Não encontramos nenhum cadastro associado a este número. Se você já é paciente, escolha [4] Falar com a secretária no menu principal.";
}

export function rescheduleNoAppointmentsText(category: AppointmentCategory): string {
  const w = categoryWords(category);
  return `Não encontramos ${w.none} ${w.noun} futur${w.adjEnd} para remarcar neste número. Escolha [4] Falar com a secretária no menu principal se precisar de ajuda.`;
}

export function confirmAppointmentText(patientName: string, whenLabel: string, category: AppointmentCategory): string {
  const w = categoryWords(category);
  return `Encontramos ${w.article} ${w.noun} de *${patientName}* em ${whenLabel} — é ${w.demonstrative} que você quer remarcar? Responda Sim ou Não.`;
}

export function rescheduleLinkText(patientName: string, url: string, category: AppointmentCategory): string {
  const w = categoryWords(category);
  return (
    `Prontinho! Escolha o novo dia e horário para ${w.article} ${w.noun} de ${patientName} neste link:\n${url}\n\n` +
    "O link expira em 30 minutos."
  );
}

// Remarcar retorno depois do fim do prazo da Consulta de origem (Fase 17):
// não gera link (a página não teria datas) — a secretária pode abrir
// exceção pela tela (decisão do cliente).
export function rescheduleReturnDeadlinePassedText(patientName: string, lastDateLabel: string): string {
  return (
    `O prazo para o retorno de *${patientName}* terminou em ${lastDateLabel}, então não é possível remarcar por aqui. ` +
    "Por favor, escolha [4] Falar com a secretária no menu principal."
  );
}

export function rescheduleLinkErrorText(): string {
  return "Tivemos um problema para gerar o link de remarcação. Por favor, escolha [4] Falar com a secretária no menu principal.";
}

// --- case 2 · Cancelar ----------------------------------------------------

export function cancelNoGuardianText(): string {
  return "Não encontramos nenhum cadastro associado a este número. Se você já é paciente, escolha [4] Falar com a secretária no menu principal.";
}

export function cancelNoAppointmentsText(category: AppointmentCategory): string {
  const w = categoryWords(category);
  return `Não encontramos ${w.none} ${w.noun} futur${w.adjEnd} para cancelar neste número. Escolha [4] Falar com a secretária no menu principal se precisar de ajuda.`;
}

export function confirmCancelText(patientName: string, whenLabel: string, category: AppointmentCategory): string {
  const w = categoryWords(category);
  return `Confirma o cancelamento ${w.ofArticle} ${w.noun} de *${patientName}* em ${whenLabel}? Responda Sim ou Não.`;
}

export function cancelAbortedText(category: AppointmentCategory): string {
  const w = categoryWords(category);
  return `Ok, mantivemos ${w.possessive} ${w.noun} marcad${w.adjEnd}.`;
}

export function cancelSuccessText(patientName: string, whenLabel: string, category: AppointmentCategory): string {
  const w = categoryWords(category);
  return (
    `Prontinho, cancelamos ${w.article} ${w.noun} de ${patientName} que estava marcad${w.adjEnd} para ${whenLabel}. ` +
    `Se precisar marcar ${w.noun === "exame" ? "um novo exame" : "uma nova consulta"}, é só me chamar de novo.`
  );
}

export function cancelErrorText(): string {
  return "Tivemos um problema para cancelar a consulta. Por favor, escolha [4] Falar com a secretária no menu principal.";
}

// --- botões do lembrete (Fase 19) -------------------------------------------

export function reminderPresenceConfirmedText(patientName: string, whenLabel: string): string {
  return (
    "Presença confirmada ✓\n\n" +
    `👶 Paciente: ${patientName}\n` +
    `📅 Data: ${whenLabel}\n\n` +
    "Obrigado! Qualquer dúvida, é só chamar por aqui."
  );
}

export function reminderPresenceAlreadyConfirmedText(patientName: string, whenLabel: string): string {
  return `A presença de ${patientName} em ${whenLabel} já estava confirmada ✓`;
}

// Toque atrasado/inválido: o atendimento do lembrete foi cancelado,
// remarcado, já passou ou não é deste responsável.
export function reminderInactiveText(): string {
  return "Esse agendamento não está mais ativo.";
}
