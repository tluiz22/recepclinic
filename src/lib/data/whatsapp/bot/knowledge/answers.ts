import type { Designation } from "../../../../designation";
import type { CompiledKb, ClinicTerms, DetectedTerms, KbEntry } from "../../../../knowledge/match";
import { normalizeText, STOPWORDS, tokensOf } from "../../../../knowledge/normalize";
import type { KbFlow } from "../../../../knowledge/lists";
import { renderTemplate } from "../../../../knowledge/template";
import type { ReceptionHours } from "../../../../receptionHours";
import type { ClinicProfile } from "../../../../vocabulary";
import type { LocationType } from "../../../config/locations";
import { professionalRegistry, type Professional } from "../../../config/professionals";
import type { ServiceCategory } from "../../../config/services";
import type { BotCatalog, BotService } from "../catalog";
import * as t from "../texts";

// Respostas da base de conhecimento (BC 3.2): as fontes da clínica montam o
// texto a partir do cadastro dela, e só dele (KbClinicData vem da credencial
// da clínica). Sem o dado, a entrada não responde (null) e o bot segue como
// hoje: nunca inventa nem completa com valor genérico. Funções puras; quem lê
// o banco é clinicData.ts.

export type KbClinicData = {
  /** "da Clínica Sorriso". */
  label: string;
  designation: Designation;
  receptionAvailable: boolean;
  profile: ClinicProfile;
  ageLimitYears: number | null;
  paymentInfo: string | null;
  insuranceInfo: string | null;
  catalog: BotCatalog;
  /** Profissionais ativos com agenda no catálogo do bot. */
  professionals: Professional[];
  insurance: { enabled: boolean; plans: { id: string; name: string; alternativeNames: string[] }[]; exclusions: { professionalId: string; planId: string }[] };
  /** null = sem nenhum dia com horário. */
  receptionHours: ReceptionHours | null;
  /** Nome do feriado de hoje (nacional ou da clínica). */
  holidayToday: string | null;
  website: string | null;
  /** null = lembrete desligado (item da matriz ou configuração). */
  reminder: { timing: "eve" | "same_day"; hour: number } | null;
};

/** Marcação em andamento (decisão 10: o valor do serviço já escolhido). */
export type KbContext = { serviceId?: string; locationType?: LocationType };

export type KbAnswer =
  | { kind: "text"; text: string; offerReception: boolean; book?: { category: ServiceCategory; serviceId?: string } }
  | { kind: "flow"; flow: KbFlow; serviceId?: string }
  | { kind: "reception"; text: string }
  | { kind: "preparation"; serviceIds: string[] };

/** Pergunta clínica (decisão 9); a pergunta da recepção vem depois. */
export const CLINICAL_NOTICE = "Por aqui não conseguimos dar orientação de saúde.";

export function clinicTermsOf(data: KbClinicData): ClinicTerms {
  return {
    services: data.catalog.services.map((s) => ({ id: s.id, name: s.name })),
    professionals: data.professionals.map((p) => ({ id: p.id, name: p.displayName })),
    plans: data.insurance.enabled ? data.insurance.plans.map((p) => ({ id: p.id, names: [p.name, ...p.alternativeNames] })) : [],
  };
}

// ---------------------------------------------------------------------------
// Variáveis dos modelos
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const hourText = (time: string) => {
  const [h, m] = time.split(":");
  return `${Number(h)}h${m === "00" ? "" : m}`;
};

/** "Segunda a sexta: 8h às 18h\nSábado: 8h às 12h\nDomingo: fechado"; null = nenhum dia aberto. */
export function weeklyHoursText(hours: ReceptionHours | null): string | null {
  if (!hours || hours.every((day) => !day)) return null;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const label = (day: ReceptionHours[number]) => (day ? `${hourText(day.open)} às ${hourText(day.close)}` : "fechado");
  const lines: string[] = [];
  let i = 0;
  while (i < order.length) {
    const text = label(hours[order[i]]);
    let j = i;
    while (j + 1 < order.length && label(hours[order[j + 1]]) === text) j++;
    const span = j > i ? `${DAY_NAMES[order[i]]} a ${DAY_NAMES[order[j]].toLowerCase()}` : DAY_NAMES[order[i]];
    lines.push(`${span}: ${text}`);
    i = j + 1;
  }
  return lines.join("\n");
}

function reminderText(reminder: KbClinicData["reminder"]): string | null {
  if (!reminder) return null;
  return `${reminder.timing === "eve" ? "na véspera" : "no dia do atendimento"}, por volta das ${reminder.hour}h`;
}

export function templateValues(data: KbClinicData): Record<string, string | null> {
  return {
    da_clinica: data.label,
    dica_recepcao: data.receptionAvailable ? " Se quiser falar com a recepção, é só escrever *atendente*." : "",
    horario_semana: weeklyHoursText(data.receptionHours),
    aviso_feriado: data.holidayToday ? `\n\nHoje (${data.holidayToday}) não há atendimento.` : "",
    site: data.website,
    pagamento: data.paymentInfo,
    quando_lembrete: reminderText(data.reminder),
  };
}

// ---------------------------------------------------------------------------
// Fontes
// ---------------------------------------------------------------------------

type Input = { entry: KbEntry; terms: DetectedTerms; tokens: string[]; data: KbClinicData; kb: CompiledKb; context: KbContext };

const bold = (text: string) => `*${text}*`;
const joinNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`);
const servicesById = (data: KbClinicData, ids: string[]) => data.catalog.services.filter((s) => ids.includes(s.id));
const CATEGORY_TITLES: Record<ServiceCategory, string> = { consultation: "Consultas", return_visit: "Retornos", exam: "Exames" };

function addresses({ data }: Input): KbAnswer | null {
  const places = data.catalog.locations.filter((l): l is typeof l & { address: string } => l.type === "clinic" && !!l.address);
  return places.length ? text(t.addressText(places)) : null;
}

function services({ data, terms }: Input): KbAnswer | null {
  const named = servicesById(data, terms.serviceIds);
  if (named.length) {
    return { kind: "text", text: `Sim, fazemos ${joinNames(named.map((s) => bold(s.name)))}.`, offerReception: false, book: { category: named[0].category, serviceId: named.length === 1 ? named[0].id : undefined } };
  }
  const blocks = (["consultation", "return_visit", "exam"] as ServiceCategory[])
    .map((category) => ({ category, names: data.catalog.services.filter((s) => s.category === category).map((s) => `• ${s.name}`) }))
    .filter((g) => g.names.length)
    .map((g) => `${bold(CATEGORY_TITLES[g.category])}\n${g.names.join("\n")}`);
  return blocks.length ? text(`Atendemos:\n\n${blocks.join("\n\n")}\n\nPara marcar, escolha no menu.`) : null;
}

const professionalLine = (p: Professional) => `• ${bold(p.displayName)}: ${p.specialty || p.profession}`;
const offersConsultation = (data: KbClinicData, professionalId: string) =>
  data.catalog.services.some((s) => s.category === "consultation" && s.agendas.some((a) => a.professionalId === professionalId));

function professionals({ data, terms, kb }: Input): KbAnswer | null {
  if (!data.professionals.length) return null;
  const named = data.professionals.filter((p) => terms.professionalIds.includes(p.id));
  if (named.length) {
    const lines = named.map((p) => `${bold(p.displayName)} (${[p.profession, p.specialty].filter(Boolean).join(", ")})`);
    const book = named.some((p) => offersConsultation(data, p.id)) ? { category: "consultation" as const } : undefined;
    return { kind: "text", text: `Sim, ${joinNames(lines)} ${named.length > 1 ? "atendem" : "atende"} por aqui.`, offerReception: false, book };
  }
  if (terms.specialties.length) {
    const phrases = kb.specialties.filter((s) => terms.specialties.includes(s.name)).flatMap((s) => s.phrases);
    const found = data.professionals.filter((p) => {
      // Especialidade da lista do Suporte ligada ao profissional (ME, 07/nov/2026); senão, o texto.
      if (p.specialties.some((s) => terms.specialties.includes(s.name))) return true;
      const own = ` ${normalizeText(`${p.specialty ?? ""} ${p.profession}`)} `;
      return phrases.some((phrase) => own.includes(` ${phrase} `));
    });
    if (found.length) {
      const book = found.some((p) => offersConsultation(data, p.id)) ? { category: "consultation" as const } : undefined;
      return { kind: "text", text: `Sim! Atende${found.length > 1 ? "m" : ""} por aqui:\n${found.map(professionalLine).join("\n")}`, offerReception: false, book };
    }
  }
  // Lista (e especialidade não encontrada: nunca "não temos", decisão 11).
  return text(`Atendemos por aqui:\n${data.professionals.map(professionalLine).join("\n")}`);
}

function councilRegistration({ data, terms }: Input): KbAnswer | null {
  const named = data.professionals.filter((p) => terms.professionalIds.includes(p.id));
  const lines = (named.length ? named : data.professionals)
    .map((p) => ({ p, registry: professionalRegistry(p) }))
    .filter((r) => r.registry)
    .map((r) => `${bold(r.p.displayName)}: ${r.registry}`);
  return lines.length ? text(lines.join("\n")) : null;
}

const INSURANCE_WORDS = ["convenio", "convenios", "plano", "planos"];

function prices({ data, terms, tokens, context }: Input): KbAnswer | null {
  // Valor pelo convênio: não há esse dado (decisão 10).
  if (terms.planIds.length || tokens.some((token) => INSURANCE_WORDS.includes(token))) return null;
  let chosen: BotService[];
  let only: LocationType | undefined;
  const current = context.serviceId ? data.catalog.services.find((s) => s.id === context.serviceId) : undefined;
  if (current) {
    chosen = [current];
    only = context.locationType && context.locationType in current.locationPrices ? context.locationType : undefined;
  } else if (terms.serviceIds.length) chosen = servicesById(data, terms.serviceIds);
  else if (terms.professionalIds.length) {
    chosen = data.catalog.services.filter((s) => s.agendas.some((a) => a.professionalId && terms.professionalIds.includes(a.professionalId)));
    if (!chosen.length) chosen = data.catalog.services;
  } else chosen = data.catalog.services;
  if (!chosen.length) return null;
  const groups = chosen.map((s) => ({
    name: s.name,
    lines: only ? t.servicePriceLines({ locationPrices: { [only]: s.locationPrices[only] }, priceCents: s.priceCents }) : t.servicePriceLines(s),
  }));
  return text(t.pricesText(groups, data.paymentInfo));
}

/** Palavras da pergunta que não são o nome do plano ("aceitam amil?" → "amil"). */
const INSURANCE_INTENT = new Set([
  ...INSURANCE_WORDS, "saude", "aceita", "aceitam", "aceito", "atende", "atendem", "trabalham", "trabalha", "pelo", "pela",
  "particular", "tem", "voces", "plano", "meu", "minha", "e", "ou",
]);

function insurance({ data, terms, tokens }: Input): KbAnswer | null {
  const plans = data.insurance.enabled ? data.insurance.plans : [];
  if (!plans.length) return data.insuranceInfo ? text(data.insuranceInfo) : null;
  const all = plans.map((p) => p.name);
  const named = plans.filter((p) => terms.planIds.includes(p.id));
  if (named.length) {
    const professionals = data.professionals.filter((p) => terms.professionalIds.includes(p.id));
    const excluded = (professionalId: string, planId: string) => data.insurance.exclusions.some((x) => x.professionalId === professionalId && x.planId === planId);
    const notAccepted = professionals.flatMap((p) => named.filter((plan) => excluded(p.id, plan.id)).map((plan) => ({ p, plan })));
    if (notAccepted.length) {
      const { p, plan } = notAccepted[0];
      const others = data.professionals.filter((o) => o.id !== p.id && !excluded(o.id, plan.id)).map((o) => bold(o.displayName));
      return text(`${bold(p.displayName)} não atende ${bold(plan.name)}.${others.length ? ` Atende${others.length > 1 ? "m" : ""} ${bold(plan.name)} por aqui: ${joinNames(others)}.` : ""}`);
    }
    return text(`Sim, atendemos ${joinNames(named.map((p) => bold(p.name)))}.`);
  }
  // Plano citado que não está no cadastro (Q3): sem afirmar "não atendemos".
  const asked = tokens.filter((token) => !INSURANCE_INTENT.has(token) && !STOPWORDS.has(token));
  if (asked.length && asked.length <= 3) {
    const name = asked.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
    return text(`Não encontrei ${bold(name)} entre os convênios que atendemos: ${joinNames(all)}.`);
  }
  return text(`Atendemos os convênios: ${joinNames(all)}.`);
}

function returnVisit({ data }: Input): KbAnswer | null {
  const returns = data.catalog.services.filter((s) => s.category === "return_visit");
  if (!returns.length) return null;
  const deadline = returns.find((s) => s.returnDeadlineDays)?.returnDeadlineDays ?? null;
  const lines = t.servicePriceLines(returns[0]);
  const parts = [
    deadline ? `O retorno pode ser marcado em até ${deadline} dias depois da consulta.` : null,
    lines.every((line) => line.endsWith("Sem custo")) ? "O retorno não tem custo." : `Valor do retorno: ${lines.join("; ")}.`,
  ].filter(Boolean);
  return text(parts.join(" "));
}

function preparation({ data, terms }: Input): KbAnswer | null {
  const exams = data.catalog.services.filter((s) => s.category === "exam" && (s.preparation || s.preparationFile));
  if (!exams.length) return null;
  const named = exams.filter((s) => terms.serviceIds.includes(s.id));
  return { kind: "preparation", serviceIds: (named.length ? named : exams).map((s) => s.id) };
}

function homeVisit({ data }: Input): KbAnswer | null {
  const offered = data.catalog.services.filter((s) => s.locationPrices.home_visit !== undefined);
  if (!offered.length) return text("No momento não fazemos atendimento domiciliar.");
  const lines = offered.map((s) => {
    const cents = s.locationPrices.home_visit!;
    return `• ${s.name}: ${cents === 0 ? "Sem custo" : t.price(cents)}`;
  });
  return { kind: "text", text: `Sim, fazemos atendimento domiciliar:\n${lines.join("\n")}`, offerReception: false, book: { category: offered[0].category } };
}

const CHILD_WORDS = ["crianca", "criancas", "bebe", "bebes", "recem", "nascido", "adolescente", "adolescentes", "infantil", "filho", "filha"];

function ageProfile({ data, tokens }: Input): KbAnswer | null {
  const limit = data.ageLimitYears ? ` Consultas para menores de ${data.ageLimitYears} anos; a partir dessa idade, só retorno e exames.` : "";
  if (data.profile === "pediatric") return text(`Atendemos crianças e adolescentes.${limit}`);
  if (data.profile === "mixed") return text(`Atendemos crianças e adultos.${limit}`);
  // Clínica de adultos: sobre criança não há dado (idade mínima).
  return tokens.some((token) => CHILD_WORDS.includes(token)) ? null : text("Atendemos adultos.");
}

const text = (body: string): KbAnswer => ({ kind: "text", text: body, offerReception: false });

const SOURCE_ANSWERS: Partial<Record<string, (input: Input) => KbAnswer | null>> = {
  addresses,
  services,
  professionals,
  council_registration: councilRegistration,
  prices,
  insurance,
  return_visit: returnVisit,
  preparation,
  home_visit: homeVisit,
  age_profile: ageProfile,
};

// ---------------------------------------------------------------------------
// Resposta da entrada
// ---------------------------------------------------------------------------

const FLOW_CATEGORY: Partial<Record<KbFlow, ServiceCategory>> = { book_consultation: "consultation", book_exam: "exam", book_return: "return_visit" };

export function composeAnswer(
  kb: CompiledKb,
  entry: KbEntry,
  terms: DetectedTerms,
  message: string,
  data: KbClinicData,
  context: KbContext = {},
): KbAnswer | null {
  const input: Input = { entry, terms, tokens: tokensOf(normalizeText(message)), data, kb, context };
  switch (entry.answerType) {
    case "fixed":
      return entry.template ? { kind: "text", text: entry.template, offerReception: entry.offersReception && data.receptionAvailable } : null;
    case "reception":
      return entry.template ? { kind: "reception", text: entry.template } : null;
    case "template": {
      const body = entry.template ? renderTemplate(entry.template, templateValues(data)) : null;
      return body ? { kind: "text", text: body, offerReception: entry.offersReception && data.receptionAvailable } : null;
    }
    case "flow": {
      if (!entry.flow) return null;
      const category = FLOW_CATEGORY[entry.flow];
      if (!category) return { kind: "flow", flow: entry.flow };
      const offered = data.catalog.services.filter((s) => s.category === category);
      if (!offered.length) return null;
      const named = offered.filter((s) => terms.serviceIds.includes(s.id));
      return { kind: "flow", flow: entry.flow, serviceId: named.length === 1 ? named[0].id : undefined };
    }
    case "source": {
      const answer = SOURCE_ANSWERS[entry.sources[0]]?.(input) ?? null;
      if (answer?.kind === "text" && entry.offersReception && data.receptionAvailable) return { ...answer, offerReception: true };
      return answer;
    }
  }
}
