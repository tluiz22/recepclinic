import type { AgendaAttendance } from "../../config/agendas";
import { BOOKING_HORIZON_DEFAULT } from "../../config/clinic";
import type { BotCatalog } from "./catalog";

// Clínica com mais de um profissional (MB, cliente, 07/nov/2026; plano
// multiprofissional, seção 5): o paciente escolhe a especialidade e o
// profissional antes do menu, e a conversa segue no contexto dele (serviços,
// valores e as informações que o bot responde). Clínica de um profissional
// (como a piloto): nada muda. "Exames" (agenda sem profissional, M8) leva
// direto aos exames da equipe (MS, S3), sem profissional.
//
// A escolha fica no contexto da conversa (PROFESSIONAL_KEY) até a conversa
// recomeçar. Remarcar, cancelar e "meus atendimentos" continuam mostrando
// todos os atendimentos do paciente na clínica.

export const PROFESSIONAL_KEY = "_professional";
export const EXAMS_CHOICE = "exams";
/** Profissional sem especialidade (cadastro pendente, M2) entra num grupo próprio. */
export const NO_SPECIALTY = "none";

export type ScopeProfessional = { id: string; name: string; specialties: { id: string; name: string }[] };

export type ProfessionalScope = {
  /** Profissionais com algum serviço para marcar no bot, por nome. */
  professionals: ScopeProfessional[];
  /** Mais de um profissional: a escolha vem antes do menu. */
  multi: boolean;
  /** Escolha guardada na conversa: o id do profissional, EXAMS_CHOICE ou null (ainda não escolheu). */
  choice: string | null;
  /** O profissional em uso: o escolhido ou, na clínica de um só, ele. */
  current: ScopeProfessional | null;
  /** Há exame em agenda sem profissional (a opção "Exames" na pergunta da especialidade). */
  examsOption: boolean;
};

export function buildScope(catalog: BotCatalog, context: unknown): ProfessionalScope {
  const byId = new Map<string, ScopeProfessional>();
  for (const service of catalog.services) {
    for (const agenda of service.agendas) {
      // Profissional desativado (sem nome no catálogo) não entra na escolha.
      if (!agenda.professionalId || !agenda.professionalName || byId.has(agenda.professionalId)) continue;
      byId.set(agenda.professionalId, { id: agenda.professionalId, name: agenda.professionalName, specialties: agenda.specialties });
    }
  }
  const professionals = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const multi = professionals.length > 1;
  const examsOption = catalog.services.some((s) => s.category === "exam" && s.agendas.some((a) => !a.professionalId));
  const saved = ((context ?? {}) as Record<string, unknown>)[PROFESSIONAL_KEY];
  const choice = typeof saved === "string" && (saved === EXAMS_CHOICE || byId.has(saved)) ? saved : null;
  const current = multi ? (choice && choice !== EXAMS_CHOICE ? (byId.get(choice) ?? null) : null) : (professionals[0] ?? null);
  return { professionals, multi, choice: multi ? choice : null, current, examsOption };
}

/** O catálogo no contexto da escolha: os serviços do profissional (e os de agenda sem profissional); em "Exames", só os exames. */
export function scopeCatalog(catalog: BotCatalog, scope: ProfessionalScope): BotCatalog {
  if (!scope.multi || !scope.choice) return catalog;
  if (scope.choice === EXAMS_CHOICE) {
    // Serviços da equipe (MS, S3; cliente, 07/nov/2026): em "Exames", só os exames da agenda sem profissional.
    const team = (list: BotCatalog["services"]) =>
      list
        .filter((s) => s.category === "exam")
        .map((s) => ({ ...s, agendas: s.agendas.filter((a) => !a.professionalId) }))
        .filter((s) => s.agendas.length > 0);
    const services = team(catalog.services).map((s) => {
      const copy = s.agendas[0].serviceId !== s.id ? catalog.copies.find((c) => c.id === s.agendas[0].serviceId) : undefined;
      return copy ? { ...copy, agendas: s.agendas } : s;
    });
    return { ...catalog, services, copies: team(catalog.copies) };
  }
  const id = scope.choice;
  const mine = (list: BotCatalog["services"]) =>
    list
      .map((s) => ({ ...s, agendas: s.agendas.filter((a) => a.professionalId === id || !a.professionalId) }))
      .filter((s) => s.agendas.some((a) => a.professionalId === id) || (s.category === "exam" && s.agendas.length > 0));
  // Serviços por profissional (MS): a opção do menu usa os dados da cópia dele (valor, preparo).
  const services = mine(catalog.services).map((s) => {
    const own = s.agendas.find((a) => a.professionalId === id);
    const copy = own && own.serviceId !== s.id ? catalog.copies.find((c) => c.id === own.serviceId) : undefined;
    return copy ? { ...copy, agendas: s.agendas } : s;
  });
  return { ...catalog, services, copies: mine(catalog.copies) };
}

export type SpecialtyOption = { id: string; name: string };

/** Especialidades com algum profissional, em ordem alfabética; quem está sem especialidade vai em "Outros profissionais". */
export function specialtyOptions(scope: ProfessionalScope, othersLabel: string): SpecialtyOption[] {
  const byId = new Map<string, string>();
  for (const p of scope.professionals) for (const s of p.specialties) byId.set(s.id, s.name);
  const options = [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (scope.professionals.some((p) => !p.specialties.length)) options.push({ id: NO_SPECIALTY, name: othersLabel });
  return options;
}

export function professionalsOf(scope: ProfessionalScope, specialtyId: string): ScopeProfessional[] {
  return scope.professionals.filter((p) => (specialtyId === NO_SPECIALTY ? !p.specialties.length : p.specialties.some((s) => s.id === specialtyId)));
}

/**
 * Perfil, prazo e idade limite da conversa (cliente, 08/nov/2026; antes, da clínica): os do profissional em uso; na
 * escolha "Exames", os da Equipe; sem escolha ainda, o perfil calculado da clínica, sem idade limite. Cada marcação usa
 * os da agenda escolhida (booking.ts); estes valem para as palavras do bot e as Informações gerais.
 */
export function scopeAttendance(
  catalog: Pick<BotCatalog, "services">,
  scope: Pick<ProfessionalScope, "current" | "choice">,
  clinicProfile: AgendaAttendance["profile"],
): { profile: AgendaAttendance["profile"]; ageLimitYears: number | null; horizonDays: number } {
  const agendas = catalog.services.flatMap((s) => s.agendas);
  const agenda = scope.current
    ? agendas.find((a) => a.professionalId === scope.current!.id)
    : scope.choice === EXAMS_CHOICE
      ? agendas.find((a) => !a.professionalId)
      : undefined;
  if (!agenda) return { profile: clinicProfile, ageLimitYears: null, horizonDays: BOOKING_HORIZON_DEFAULT };
  return { profile: agenda.attendance.profile, ageLimitYears: agenda.attendance.consultationAgeLimitYears, horizonDays: agenda.attendance.bookingHorizonDays };
}
