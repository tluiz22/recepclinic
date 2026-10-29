import type { FeatureKey } from "../../features";
import type { DbClient } from "../clients";
import { unwrap } from "../errors";
import { listAgendas, type Agenda } from "./agendas";
import { listLocations, type Location } from "./locations";
import { listProfessionals, type Professional } from "./professionals";
import { listServices, type Service } from "./services";

// Jornada de configuração (F6.3b, cliente 07/out/2026): o que cada cadastro
// ainda precisa para funcionar, na ordem Clínica → Profissionais → Locais →
// Agendas → Serviços → Horários. A mesma conta alimenta o guia no topo de
// Configurações, os selos das listas e o "próximo passo" de cada cadastro.
// "Sem horário" segue a regra do bot (catálogo, F6.3): serviço sem horário
// ativo numa agenda e num local dele não aparece no bot nem no link de agendar
// (turma: só o horário do próprio serviço, com as vagas). Com horário do
// serviço que não vale (agenda ou local que o serviço não usa), o alerta diz o
// motivo (C5; cliente, 28/out/2026).
// Itens desligados na matriz (D11) não contam: exames sem "Exames e
// procedimentos", domiciliar sem "Atendimento domiciliar".

export type Issue = "no_agenda" | "no_location" | "no_hours" | "no_service" | "no_address";

export const ISSUE_LABELS: Record<Issue, string> = {
  no_agenda: "sem agenda",
  no_location: "sem local",
  no_hours: "sem horário",
  no_service: "sem serviço",
  no_address: "sem endereço",
};

/** Explicação do selo (título ao passar o mouse e texto do guia). */
export const ISSUE_HINTS: Record<Issue, string> = {
  no_agenda: "Sem agenda ativa: não recebe atendimentos.",
  no_location: "Sem local ativo: não dá para marcar.",
  no_hours: "Sem horário de atendimento: não aparece no bot nem no link de agendar.",
  no_service: "Nenhum serviço ativo usa este cadastro.",
  no_address: "Consultório sem endereço: o bot e as mensagens não mostram onde é.",
};

/** Na agenda, "sem horário" quer dizer outra coisa que no serviço. */
export const AGENDA_HINTS: Partial<Record<Issue, string>> = { no_hours: "Sem horário de atendimento: ninguém consegue marcar nela." };

export type SetupInput = {
  professionals: Pick<Professional, "id" | "displayName" | "isActive">[];
  agendas: Pick<Agenda, "id" | "name" | "professionalId" | "isActive">[];
  locations: Pick<Location, "id" | "name" | "type" | "address" | "isActive">[];
  services: Pick<Service, "id" | "name" | "category" | "schedulingMode" | "isActive" | "agendaIds" | "locations">[];
  windows: { agendaId: string; locationId: string; serviceId: string | null }[];
  features: readonly FeatureKey[];
};

export type StepKey = "clinic" | "professionals" | "locations" | "agendas" | "services" | "hours";
export type StepStatus = "done" | "attention" | "missing";

export type SetupStep = {
  key: StepKey;
  title: string;
  status: StepStatus;
  /** Uma linha por pendência ("Espirometria: sem horário…"), com o link de correção. */
  items: { text: string; href: string }[];
  href: string;
};

export type SetupStatus = {
  steps: SetupStep[];
  complete: boolean;
  /** Há local ativo? Sem ele, o próximo passo do profissional e da agenda é o Local (cliente, 21/out/2026). */
  hasLocations: boolean;
  /**
   * Agenda desativada de cada profissional sem agenda ativa: uma agenda por
   * profissional (cliente, 21/out/2026), então o próximo passo é reativá-la.
   */
  inactiveAgendaOf: Map<string, string>;
  /** Pendências de cada cadastro, para os selos e o próximo passo. */
  issues: {
    professionals: Map<string, Issue[]>;
    agendas: Map<string, Issue[]>;
    locations: Map<string, Issue[]>;
    services: Map<string, Issue[]>;
  };
  /** Serviço "sem horário" que tem horário que não vale: o motivo ("o horário dele está em …"). */
  hoursReasons: Map<string, string>;
};

const BASE = "/admin/configuracoes";
const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase("pt-BR") + text.slice(1);

export function computeSetup(input: SetupInput): SetupStatus {
  const examsOn = input.features.includes("exams");
  const homeOn = input.features.includes("home_visit");
  const professionals = input.professionals.filter((p) => p.isActive);
  const agendas = input.agendas.filter((a) => a.isActive);
  const locations = input.locations.filter((l) => l.isActive && (homeOn || l.type !== "home_visit"));
  const services = input.services.filter((s) => s.isActive && (examsOn || s.category !== "exam"));
  const agendaIds = new Set(agendas.map((a) => a.id));
  const locationIds = new Set(locations.map((l) => l.id));
  const windows = input.windows.filter((w) => agendaIds.has(w.agendaId) && locationIds.has(w.locationId));

  const serviceAgendas = (s: SetupInput["services"][number]) => s.agendaIds.filter((id) => agendaIds.has(id));
  const serviceLocations = (s: SetupInput["services"][number]) => s.locations.map((l) => l.locationId).filter((id) => locationIds.has(id));
  const isGroup = (s: SetupInput["services"][number]) => s.schedulingMode === "group";
  // A regra do bot (slots.ts, loadSchedulingPlan): turma só com o horário dela; individual, geral ou dele.
  const fits = (s: SetupInput["services"][number], w: SetupInput["windows"][number]) =>
    isGroup(s) ? w.serviceId === s.id : w.serviceId === null || w.serviceId === s.id;
  const hasHours = (s: SetupInput["services"][number]) => {
    const own = new Set(serviceAgendas(s));
    const where = new Set(serviceLocations(s));
    return windows.some((w) => own.has(w.agendaId) && where.has(w.locationId) && fits(s, w));
  };
  const agendaName = new Map(agendas.map((a) => [a.id, a.name]));
  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const hoursReason = (s: SetupInput["services"][number]): string | null => {
    const own = new Set(serviceAgendas(s));
    const where = new Set(serviceLocations(s));
    const mine = windows.filter((w) => w.serviceId === s.id);
    const otherAgenda = mine.find((w) => !own.has(w.agendaId));
    if (otherAgenda) return `o horário dele está na agenda ${agendaName.get(otherAgenda.agendaId)}, que não atende o serviço. Marque a agenda no serviço.`;
    const otherPlace = mine.find((w) => !where.has(w.locationId));
    if (otherPlace) return `o horário dele está em ${locationName.get(otherPlace.locationId)}, mas o serviço não é feito lá. Marque o local no serviço.`;
    if (isGroup(s) && windows.some((w) => w.serviceId === null && own.has(w.agendaId) && where.has(w.locationId))) {
      return "turma precisa de horário próprio, com as vagas: os horários gerais da agenda não valem para ela.";
    }
    return null;
  };

  const issues: SetupStatus["issues"] = { professionals: new Map(), agendas: new Map(), locations: new Map(), services: new Map() };
  const add = (map: Map<string, Issue[]>, id: string, issue: Issue) => map.set(id, [...(map.get(id) ?? []), issue]);
  const hoursReasons = new Map<string, string>();

  for (const p of professionals) if (!agendas.some((a) => a.professionalId === p.id)) add(issues.professionals, p.id, "no_agenda");
  for (const l of locations) {
    if (l.type === "clinic" && !l.address?.trim()) add(issues.locations, l.id, "no_address");
    if (!services.some((s) => s.locations.some((sl) => sl.locationId === l.id))) add(issues.locations, l.id, "no_service");
  }
  for (const a of agendas) {
    if (!services.some((s) => s.agendaIds.includes(a.id))) add(issues.agendas, a.id, "no_service");
    if (!windows.some((w) => w.agendaId === a.id)) add(issues.agendas, a.id, "no_hours");
  }
  for (const s of services) {
    if (!serviceAgendas(s).length) add(issues.services, s.id, "no_agenda");
    if (!serviceLocations(s).length) add(issues.services, s.id, "no_location");
    if (!hasHours(s)) {
      add(issues.services, s.id, "no_hours");
      const reason = hoursReason(s);
      if (reason) hoursReasons.set(s.id, reason);
    }
  }

  const lines = <T extends { id: string }>(
    list: T[],
    map: Map<string, Issue[]>,
    name: (item: T) => string,
    href: (item: T, issue: Issue) => string,
    only?: Issue[],
    hints: Partial<Record<Issue, string>> = {},
    hintFor: (item: T, issue: Issue) => string | undefined = () => undefined,
  ) =>
    list.flatMap((item) =>
      (map.get(item.id) ?? [])
        .filter((issue) => !only || only.includes(issue))
        .map((issue) => ({ text: `${name(item)}: ${lowerFirst(hintFor(item, issue) ?? hints[issue] ?? ISSUE_HINTS[issue])}`, href: href(item, issue) })),
    );
  const firstAgenda = (s: SetupInput["services"][number]) => serviceAgendas(s)[0] ?? "";

  const step = (key: StepKey, title: string, href: string, count: number, items: SetupStep["items"]): SetupStep => ({
    key,
    title,
    href,
    status: count === 0 ? "missing" : items.length ? "attention" : "done",
    items,
  });

  // Jornada revista (cliente, 21/out/2026): sem local, o profissional e a
  // agenda vão primeiro ao Local; a agenda e o local sem serviço vão ao novo
  // serviço, já com eles marcados.
  const hasLocations = locations.length > 0;
  const inactiveAgendaOf = new Map<string, string>();
  for (const a of input.agendas) if (!a.isActive && a.professionalId && issues.professionals.has(a.professionalId)) inactiveAgendaOf.set(a.professionalId, a.id);
  const professionalHref = (p: { id: string }) => {
    const inactive = inactiveAgendaOf.get(p.id);
    if (inactive) return `${BASE}/agendas/${inactive}?todos=1`;
    return hasLocations ? `${BASE}/agendas/novo?profissional=${p.id}` : `${BASE}/locais/novo?profissional=${p.id}`;
  };
  const agendaHref = (a: { id: string }, issue: Issue) =>
    issue === "no_hours" ? `${BASE}/horarios?agenda=${a.id}` : hasLocations ? `${BASE}/servicos/novo?agenda=${a.id}` : `${BASE}/locais/novo?agenda=${a.id}`;

  const steps: SetupStep[] = [
    { key: "clinic", title: "Clínica", status: "done", items: [], href: BASE },
    step("professionals", "Profissionais", `${BASE}/profissionais`, professionals.length, lines(professionals, issues.professionals, (p) => p.displayName, professionalHref)),
    step("locations", "Locais", `${BASE}/locais`, locations.length, lines(locations, issues.locations, (l) => l.name, (l, issue) => (issue === "no_address" ? `${BASE}/locais/${l.id}` : `${BASE}/servicos/novo?local=${l.id}`))),
    step("agendas", "Agendas", `${BASE}/agendas`, agendas.length, lines(agendas, issues.agendas, (a) => a.name, agendaHref, undefined, AGENDA_HINTS)),
    // O serviço sem horário é pendência do passo Serviços (cliente, 21/out/2026),
    // com o link já para Horários; Horários só fica pendente sem nenhum horário.
    step(
      "services",
      "Serviços",
      `${BASE}/servicos`,
      services.length,
      // Sem agenda ou sem local, o "sem horário" vem junto e não conta à parte.
      lines(
        services,
        new Map([...issues.services].map(([id, list]) => [id, list.some((i) => i === "no_agenda" || i === "no_location") ? list.filter((i) => i !== "no_hours") : list])),
        (s) => s.name,
        // Com o motivo, a correção é no próprio serviço (marcar a agenda ou o local).
        (s, issue) =>
          issue === "no_hours" && firstAgenda(s) && !hoursReasons.has(s.id) ? `${BASE}/horarios?agenda=${firstAgenda(s)}&servico=${s.id}` : `${BASE}/servicos/${s.id}`,
        undefined,
        {},
        (s, issue) => (issue === "no_hours" && hoursReasons.has(s.id) ? `Sem horário que valha: ${hoursReasons.get(s.id)}` : undefined),
      ),
    ),
    step("hours", "Horários", `${BASE}/horarios`, windows.length, []),
  ];
  return { steps, complete: steps.every((s) => s.status === "done"), hasLocations, inactiveAgendaOf, issues, hoursReasons };
}

export async function loadSetupStatus(db: DbClient, clinicId: string, features: readonly FeatureKey[]): Promise<SetupStatus> {
  const [professionals, agendas, locations, services, windows] = await Promise.all([
    listProfessionals(db, clinicId),
    // As desativadas também, para o próximo passo do profissional (reativar).
    listAgendas(db, clinicId, { includeInactive: true }),
    listLocations(db, clinicId),
    listServices(db, clinicId),
    db
      .from("availability_windows")
      .select("agenda_id, location_id, service_id")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .then((r) => unwrap(r, "Horários de atendimento")),
  ]);
  return computeSetup({
    professionals,
    agendas,
    locations,
    services,
    windows: windows.map((w) => ({ agendaId: w.agenda_id, locationId: w.location_id, serviceId: w.service_id })),
    features,
  });
}
