import { addDays, formatInstant, localDateOf, todayIn } from "./clinicTime";
import { formatCentsBRL } from "./money";
import { capitalize } from "./vocabulary";

// Regras sem banco do portal de agendamento (recepção digital, F2a; especificação P1 a P13 e PP):
// endereços, passos, busca, particular ou convênio e os textos curtos das telas.

// ---------------------------------------------------------------------------
// Endereços

/** As páginas do portal ficam em /portal/{clínica}; no endereço do portal, sem o /portal. */
export const PORTAL_PREFIX = "/portal";

/** agendar.recepclinic.com.br (produção) e agendar-teste.recepclinic.com.br (staging, I2). */
export function isPortalHost(hostname: string): boolean {
  return /^agendar(-teste)?\./i.test(hostname);
}

/**
 * No endereço do portal, o caminho interno da página: "/vila-serena/especialidade" → "/portal/vila-serena/especialidade".
 * null = serve como está (arquivos do site, como /_astro/…, /favicon.ico, ou o caminho que já começa com /portal).
 * Tudo o mais (inclusive /admin e /api) vira portal: o endereço do portal não abre o painel.
 */
export function portalRewrite(pathname: string): string | null {
  if (pathname.startsWith("/_") || /\.[a-z0-9]{2,5}$/i.test(pathname)) return null;
  if (pathname === PORTAL_PREFIX || pathname.startsWith(`${PORTAL_PREFIX}/`)) return null;
  return pathname === "/" ? PORTAL_PREFIX : `${PORTAL_PREFIX}${pathname.replace(/\/+$/, "")}`;
}

/** Começo dos links de uma clínica: "/vila-serena" no endereço do portal, "/portal/vila-serena" nos outros. */
export function portalBase(clinicSlug: string, hostname: string): string {
  return isPortalHost(hostname) ? `/${clinicSlug}` : `${PORTAL_PREFIX}/${clinicSlug}`;
}

/** "Minhas consultas" (F3c, P12) nas ações do início da clínica e do profissional. */
export const MY_APPOINTMENTS = (base: string) => ({
  href: `${base}/minhas-consultas`,
  label: "Minhas consultas",
  detail: "Remarcar ou cancelar o que já está marcado",
  icon: "mine" as const,
});

/** Link com os parâmetros preenchidos (os vazios ficam de fora). */
export function portalHref(path: string, params: Record<string, string | null | undefined> = {}): string {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => !!entry[1]));
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/**
 * Link público da clínica para o Suporte copiar: o painel do staging (teste.) leva ao agendar-teste. e o da produção
 * (app.), ao agendar.; no computador local, ao /portal do próprio servidor.
 */
export function portalPublicUrl(appUrl: URL, clinicSlug: string): string {
  return `${portalPublicRoot(appUrl)}/${clinicSlug}`;
}

/** Começo do endereço público do portal: "https://agendar.…", "https://agendar-teste.…" ou "{local}/portal". */
export function portalPublicRoot(appUrl: URL): string {
  const match = appUrl.hostname.match(/^(teste|app)\.(.+)$/);
  if (match) return `https://${match[1] === "teste" ? "agendar-teste" : "agendar"}.${match[2]}`;
  return `${appUrl.origin}${PORTAL_PREFIX}`;
}

/** Link público do profissional (PP): "https://agendar.…/{clínica}/{profissional}". */
export const professionalPublicUrl = (appUrl: URL, clinicSlug: string, professionalSlug: string) => `${portalPublicUrl(appUrl, clinicSlug)}/${professionalSlug}`;

/** O link marcado com o lugar onde vai ser posto (F3d; R7): "…?de=instagram". */
export const linkForPlace = (url: string, place: PortalPlaceParam) => `${url}?de=${place}`;

/** Link do bot (F3a): "https://agendar.…/s/{token}", com o token em 22 caracteres (`shortId`). */
export const portalLinkUrl = (appBaseUrl: string, token: string): string => `${portalPublicRoot(new URL(appBaseUrl))}/s/${token}`;

/** Sugestão de apelido pelo nome da clínica, como o dos profissionais: "Clínica Vila Serena" → "clinica-vila-serena". */
export function suggestPortalSlug(name: string): string {
  return plainText(name).replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Busca (P2 e P3): sem acento e sem maiúsculas.

export function plainText(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** Especialidade pelo nome ou por um dos termos do cadastro ("coração" acha Cardiologia). */
export function matchesSpecialty(specialty: { name: string; terms: readonly string[] }, query: string): boolean {
  const q = plainText(query);
  if (!q) return true;
  return [specialty.name, ...specialty.terms].some((text) => plainText(text).includes(q));
}

/** Nome do profissional, palavra por palavra ("ana lima" acha "Dra. Ana Lima"). */
export function matchesName(name: string, query: string): boolean {
  const words = plainText(query).split(/\s+/).filter(Boolean);
  const target = plainText(name);
  return words.every((word) => target.includes(word));
}

// ---------------------------------------------------------------------------
// Passos ("Passo 3 de 6", com os pulados descontados)

export type PortalStep = "specialty" | "professional" | "modality" | "time" | "phone" | "patient" | "address" | "review";

/**
 * Passos do caminho: pela clínica, especialidade e médico (pulados com uma opção só); pelo link do profissional,
 * nenhum dos dois. Particular ou convênio some com uma opção só. Depois do horário, o celular, quem será atendido e a
 * revisão (F2c).
 */
export function portalSteps(flags: { specialty: boolean; professional: boolean; modality: boolean; phone?: boolean; address?: boolean }): PortalStep[] {
  return [
    ...(flags.specialty ? (["specialty"] as const) : []),
    ...(flags.professional ? (["professional"] as const) : []),
    ...(flags.modality ? (["modality"] as const) : []),
    "time",
    // Pelo link do bot (F3a), o celular já vem comprovado da conversa: sem o passo.
    ...(flags.phone === false ? [] : (["phone"] as const)),
    "patient",
    // Atendimento em casa (F3e-1, D5): o endereço depois do paciente.
    ...(flags.address ? (["address"] as const) : []),
    "review",
  ];
}

export function stepPosition(steps: readonly PortalStep[], step: PortalStep): { current: number; total: number } {
  return { current: steps.indexOf(step) + 1, total: steps.length };
}

// ---------------------------------------------------------------------------
// Particular ou convênio (P5): sempre depois do médico.

export const PRIVATE_MODALITY = "particular";

export type PortalPlan = { id: string; name: string; note: string | null };

export type ModalityOption = { value: string; label: string; detail: string | null };

export type PriceInfo = { acceptsPrivate: boolean; privatePriceCents: number | null; privatePriceVaries: boolean };

/** "R$ 350,00" sem os centavos zerados: "R$ 350", com o espaço que não quebra a linha entre "R$" e o número. */
export function formatPrice(cents: number): string {
  return formatCentsBRL(cents).replace(/,00$/, "").replace(/\s/g, "\u00a0");
}

/** "Particular, R$ 350", "Particular, a partir de R$ 300" ou só "Particular" sem valor cadastrado. */
export function privateLabel(price: PriceInfo, separator = ", "): string {
  if (!price.privatePriceCents) return "Particular";
  return `Particular${separator}${price.privatePriceVaries ? "a partir de " : ""}${formatPrice(price.privatePriceCents)}`;
}

/**
 * "Ver valores e convênios aceitos" da lista de exames (cliente, 11/nov/2026): o texto de um exame, como na tela de
 * dias e horários ("Particular, R$ 250. Unimed, Bradesco.").
 */
export function examValuesText(exam: { priceCents: number | null; priceVaries: boolean; acceptsPrivate: boolean; plans: readonly { name: string }[] }): string {
  const own = exam.acceptsPrivate
    ? `${privateLabel({ acceptsPrivate: true, privatePriceCents: exam.priceCents, privatePriceVaries: exam.priceVaries })}.`
    : "Não aceita particular.";
  return exam.plans.length ? `${own} ${exam.plans.map((p) => p.name).join(", ")}.` : own;
}

/** Opções da P5: particular (se atende) e os convênios atendidos, com a observação de cada um. */
export function modalityOptions(professional: PriceInfo & { plans: readonly PortalPlan[] }): ModalityOption[] {
  return [
    ...(professional.acceptsPrivate ? [{ value: PRIVATE_MODALITY, label: privateLabel(professional), detail: null }] : []),
    ...professional.plans.map((plan) => ({ value: plan.id, label: plan.name, detail: plan.note })),
  ];
}

/**
 * O atendimento escolhido no lugar do atendimento (F3e-1): no particular, o valor de lá ("Particular, R$ 450, em
 * casa") no lugar do "a partir de"; convênio como está.
 */
export function modalityLabelAt(option: ModalityOption | null, priceCents: number | null | undefined, atHome = false): string | null {
  if (!option) return null;
  const label = option.value === PRIVATE_MODALITY && priceCents ? `Particular, ${formatPrice(priceCents)}` : option.label;
  return atHome ? `${label}, em casa` : label;
}

/** A escolha do endereço, se ainda vale para o profissional (o convênio pode ter deixado de ser atendido). */
export function chosenModality(options: readonly ModalityOption[], value: string | null | undefined): ModalityOption | null {
  return options.find((option) => option.value === value) ?? null;
}

/** Selos do cartão do médico (P3): o particular e até dois convênios; o resto em "+n". */
export function priceTags(professional: PriceInfo & { plans: readonly PortalPlan[] }, max = 2): { label: string; strong: boolean }[] {
  const first = professional.acceptsPrivate
    ? { label: privateLabel(professional, " "), strong: true }
    : { label: "Não atende particular", strong: false };
  const plans = professional.plans.slice(0, max).map((plan) => ({ label: plan.name, strong: false }));
  const more = professional.plans.length - max;
  return [first, ...plans, ...(more > 0 ? [{ label: `+${more}`, strong: false }] : [])];
}

/** Linha da lista compacta (P3, 6 médicos ou mais): "Particular R$ 280, Unimed, Amil" ou "Só convênios: Unimed, Hapvida". */
export function priceLine(professional: PriceInfo & { plans: readonly PortalPlan[] }, max = 2): string {
  const names = professional.plans.slice(0, max).map((plan) => plan.name);
  const more = professional.plans.length - max;
  const plans = names.length ? `${names.join(", ")}${more > 0 ? ` +${more}` : ""}` : "";
  if (!professional.acceptsPrivate) return plans ? `Só convênios: ${plans}` : "Só convênios";
  return [privateLabel(professional, " "), plans].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// Textos

/** "Amanhã, 14:00", "Hoje, 09:30", "Qui, 12/11, 09:30" (cartão) ou sem as vírgulas (lista compacta). */
export function nextSlotLabel(start: Date, timeZone: string, now: Date = new Date(), compact = false): string {
  const today = todayIn(timeZone, now);
  const date = localDateOf(start, timeZone);
  const time = formatInstant(start, timeZone, "HH:mm");
  const sep = compact ? " " : ", ";
  if (date === today) return `Hoje${sep}${time}`;
  if (date === addDays(today, 1)) return `Amanhã${sep}${time}`;
  return `${capitalize(formatInstant(start, timeZone, "EEE").slice(0, 3))}${sep}${formatInstant(start, timeZone, "dd/MM")}${sep}${time}`;
}

/** Iniciais para o lugar da foto: "Dra. Ana Lima" → "AL". */
export function initialsOf(name: string): string {
  const words = name.replace(/^(dra?|prof(a)?|sr(a)?)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`;
  return letters.toUpperCase();
}

/** "Dra. Ana Lima" → "Dra. Ana" (botão "Agendar consulta com a Dra. Ana", orientações). */
export function shortName(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return /^(dra?|prof(a)?)\.?$/i.test(words[0] ?? "") && words.length > 1 ? `${words[0]} ${words[1]}` : (words[0] ?? name);
}

/** O artigo pelo título do nome ("a" para Dra./Profa., "o" para Dr./Prof.; sem título, nenhum). */
function titleArticle(short: string): "a" | "o" | null {
  if (/^(dra|profa)\.?\s/i.test(short)) return "a";
  if (/^(dr|prof)\.?\s/i.test(short)) return "o";
  return null;
}

/** "com a Dra. Ana", "com o Dr. Bruno", "com Ana" (sem título, sem artigo). */
export function withName(name: string): string {
  const short = shortName(name);
  const article = titleArticle(short);
  return article ? `com ${article} ${short}` : `com ${short}`;
}

/** "à Dra. Ana", "ao Dr. Bruno", "a Ana" ("Para voltar ao Dr. André…", retorno). */
export function toName(name: string): string {
  const short = shortName(name);
  const article = titleArticle(short);
  return article === "a" ? `à ${short}` : article === "o" ? `ao ${short}` : `a ${short}`;
}

export const HELP_MESSAGE = "Olá! Estou no portal e preciso de ajuda para agendar.";

/** Conversa com a recepção no WhatsApp, com o texto pronto (P11). `phoneDigits`: só os dígitos, com o país. */
export function receptionWhatsappHref(phoneDigits: string, text: string = HELP_MESSAGE): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`;
}

/** "Ver no mapa" do endereço. */
export function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** "1 médico", "4 médicos". */
export const doctorsCount = (n: number) => `${n} ${n === 1 ? "médico" : "médicos"}`;

// ---------------------------------------------------------------------------
// Caminho (o que veio antes fica no endereço: Voltar do navegador e o da tela funcionam igual)

/**
 * De onde o paciente chegou ao médico: da lista de médicos (P3), direto da especialidade (P2, com um médico só nela)
 * ou do link do profissional (nenhum dos dois). `esp`: especialidade escolhida ("todos" = a lista inteira, pela
 * busca do nome); `conv`: o filtro "Atende meu convênio" da lista; `nome`: o nome digitado na busca da lista.
 */
/**
 * Onde o link foi posto (F3d; R7 "Copiar link para…"): o endereço leva `?de=instagram` (ou `origem=`, nas telas
 * seguintes) e a marcação grava `appointments.portal_place`. Sem marca: "origem não informada".
 */
export const PORTAL_PLACES = { instagram: "instagram", site: "site", google: "google", mensagem: "message", cartaz: "poster", outro: "other" } as const;
export type PortalPlaceParam = keyof typeof PORTAL_PLACES;
export const PORTAL_PLACE_LABELS: Record<PortalPlaceParam, string> = {
  instagram: "Instagram",
  site: "Site",
  google: "Google",
  mensagem: "Mensagem",
  cartaz: "Cartaz",
  outro: "Outro lugar",
};

/** A origem do endereço (`origem`, ou o `de` do link copiado). */
export function readPlace(params: URLSearchParams): PortalPlaceParam | null {
  const value = params.get("origem") ?? params.get("de");
  return value && Object.hasOwn(PORTAL_PLACES, value) ? (value as PortalPlaceParam) : null;
}

/** Onde é o atendimento (F3e-1, D5): em casa (domiciliar) ou no consultório; null = o profissional atende num só. */
export type PortalWhere = "home" | "clinic";
export const WHERE_PARAM: Record<PortalWhere, string> = { home: "casa", clinic: "consultorio" };

export type PortalFlow = {
  from: "medicos" | "especialidade" | "exames" | null;
  specialty: string | null;
  plan: string | null;
  name: string | null;
  place: PortalPlaceParam | null;
  where: PortalWhere | null;
  /** Veio da página "Profissionais e valores" (sem a barra de passos). */
  directory: boolean;
};

const ID = /^[a-z0-9-]{1,64}$/i;
const idParam = (value: string | null) => (value && ID.test(value) ? value : null);

export function readFlow(params: URLSearchParams): PortalFlow {
  const from = params.get("de");
  return {
    from: from === "medicos" || from === "especialidade" || from === "exames" ? from : null,
    specialty: idParam(params.get("esp")),
    plan: idParam(params.get("conv")),
    name: params.get("nome")?.trim().slice(0, 60) || null,
    place: readPlace(params),
    where: params.get("onde") === WHERE_PARAM.home ? "home" : params.get("onde") === WHERE_PARAM.clinic ? "clinic" : null,
    directory: params.get("lista") === "1",
  };
}

export const flowParams = (flow: PortalFlow) => ({
  de: flow.from,
  esp: flow.specialty,
  conv: flow.plan,
  nome: flow.name,
  origem: flow.place,
  onde: flow.where ? WHERE_PARAM[flow.where] : null,
  lista: flow.directory ? "1" : null,
});

/** A lista de médicos com a especialidade, o filtro e o nome de antes. */
export const doctorsHref = (base: string, flow: Pick<PortalFlow, "specialty" | "plan" | "name"> & { place?: PortalPlaceParam | null; directory?: boolean }) =>
  portalHref(`${base}/medicos`, { esp: flow.specialty, conv: flow.plan, nome: flow.name, origem: flow.place, lista: flow.directory ? "1" : null });

/**
 * Voltar da primeira tela do médico (P5, ou P6 quando a P5 é pulada): a lista de médicos, a especialidade ou o
 * início do profissional (na clínica de um só profissional, o início da clínica é o dele).
 */
export function backFromProfessional(base: string, professionalSlug: string, flow: PortalFlow, singleProfessional: boolean): string {
  const origem = { origem: flow.place };
  if (flow.from === "medicos") return doctorsHref(base, flow);
  if (flow.from === "especialidade") return portalHref(`${base}/especialidade`, origem);
  if (flow.from === "exames") return portalHref(`${base}/exames`, origem);
  return portalHref(singleProfessional ? base : `${base}/${professionalSlug}`, origem);
}

/** "Trocar" o médico (ou o exame, F2d): só pela clínica (o link do profissional não mostra outros médicos). */
export function changeProfessionalHref(base: string, flow: PortalFlow): string | null {
  if (flow.from === "medicos") return doctorsHref(base, flow);
  if (flow.from === "especialidade") return portalHref(`${base}/especialidade`, { origem: flow.place });
  if (flow.from === "exames") return portalHref(`${base}/exames`, { origem: flow.place });
  return null;
}

/** Passos do caminho pelo médico: especialidade e lista só se o paciente passou por elas. */
export const professionalSteps = (flow: PortalFlow, modality: boolean, viaBotLink = false, home = false) =>
  portalSteps({
    specialty: flow.from !== null && flow.specialty !== null && !flow.directory,
    professional: flow.from === "medicos" || flow.from === "exames",
    modality,
    phone: !viaBotLink,
    address: home,
  });

/** "Médico" ou "Exame" (F2d: o exame passa pelas mesmas telas da consulta). */
export const whoLabel = (p: { exam?: unknown }) => (p.exam ? "Exame" : "Médico");

/** As palavras da consulta ou do exame nas telas (F2d: o exame passa pelas telas da consulta). */
export function visitWords(p: { exam?: unknown } | null) {
  return p?.exam
    ? { noun: "Exame", the: "o exame", ofThe: "do exame", marked: "Exame marcado", canceled: "Exame cancelado", thisCanceled: "Este exame foi cancelado", a: "um exame", file: "exame" }
    : { noun: "Consulta", the: "a consulta", ofThe: "da consulta", marked: "Consulta marcada", canceled: "Consulta cancelada", thisCanceled: "Esta consulta foi cancelada", a: "uma consulta", file: "consulta" };
}

/** "a consulta" ou "o exame" ("Para quem é o exame?"). */
export const theVisit = (p: { exam?: unknown } | null) => visitWords(p).the;

/** Texto com a formatação do WhatsApp, sem os marcadores: só *negrito* e _itálico_ de palavras inteiras. */
export function whatsappPlain(text: string): string {
  return text.replace(/(^|[\s(])([*_])([^*_\n]+?)\2(?=$|[\s.,;:!?)])/g, "$1$3");
}

/** De quem é a recepção na folha de ajuda: do médico; no exame, da clínica (null). */
export const helpForOf = (p: { name: string; exam?: unknown }) => (p.exam ? null : ofName(p.name));

/** "consulta" ou "exame", nos avisos do que impede marcar (portalBooking.blockMessage). */
export const bookingKind = (p: { exam?: unknown }) => (p.exam ? ("exame" as const) : ("consulta" as const));

/** "da Dra. Ana Lima", "do Dr. Bruno", "de Ana Lima" (folha da recepção). */
export function ofName(name: string): string {
  if (/^(dra|profa)\.?\s/i.test(name)) return `da ${name}`;
  if (/^(dr|prof)\.?\s/i.test(name)) return `do ${name}`;
  return `de ${name}`;
}
