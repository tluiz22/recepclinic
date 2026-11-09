import type { AstroGlobal } from "astro";
import { capitalize } from "../../vocabulary";
import { formatInstant } from "../../clinicTime";
import { chosenModality, flowParams, modalityOptions, PRIVATE_MODALITY, portalHref, professionalSteps, readFlow, stepPosition, type ModalityOption, type PortalFlow, type PortalStep } from "../../portal";
import type { BlockText } from "../../portalBooking";
import { loadHold, type BlockReason, type PortalHold } from "./booking";
import { readSession, type PortalSession } from "./identity";
import { openPortalPage, professionalOf, singleProfessional, type PortalPage } from "./page";
import type { PortalConsultation, PortalLocation, PortalProfessional } from "./portal";

// Telas depois da reserva (F2c: P8, P8b, P9, P10): a clínica, o profissional do endereço, o caminho de antes (no
// endereço, para o Voltar) e a reserva desta sessão. A reserva de outro profissional (endereço trocado à mão) não vale.

export type HoldScreen = "reserva" | "cadastro" | "revisao" | "marcada";

export type HoldPage = {
  page: PortalPage;
  professional: PortalProfessional | null;
  flow: PortalFlow;
  options: ModalityOption[];
  modality: ModalityOption | null;
  base: string;
  timeZone: string;
  session: PortalSession | null;
  hold: PortalHold | null;
  consultation: PortalConsultation | null;
  location: PortalLocation | null;
  /** "Quinta, 12 de novembro às 09:00". */
  when: string;
  /** Endereço de outra tela da reserva, com o caminho de antes. */
  href: (screen: HoldScreen, extra?: Record<string, string | null>) => string;
  /** Os horários do mesmo dia (`soltar`: solta a reserva). */
  timesHref: (release?: boolean) => string;
  step: (s: PortalStep) => { current: number; total: number };
  /** Plano escolhido na P5 (null = particular). */
  planId: string | null;
  entry: "clinic_link" | "professional_link";
};

export async function openHoldPage(Astro: AstroGlobal): Promise<HoldPage> {
  const page = await openPortalPage(Astro);
  const professional = page.kind === "open" ? professionalOf(page.portal, Astro.params.profissional) : null;
  if (!professional && page.kind !== "unavailable") Astro.response.status = 404;
  const params = Astro.url.searchParams;
  const flow = readFlow(params);
  const base = page.kind === "open" ? page.base : "";
  const options = professional ? modalityOptions(professional) : [];
  const modality = chosenModality(options, params.get("mod"));
  const keep = { ...flowParams(flow), mod: modality?.value ?? null, tipo: params.get("tipo"), date: params.get("date") };
  const timeZone = page.kind === "open" ? page.portal.timeZone : "America/Fortaleza";
  const holdId = params.get("reserva") ?? "";

  let session: PortalSession | null = null;
  let hold: PortalHold | null = null;
  if (page.kind === "open" && professional) {
    session = await readSession(page.db, page.portal.clinicId, Astro.cookies);
    if (session) hold = await loadHold(page.db, page.portal.clinicId, session.id, holdId);
    // A de outro profissional ou a de um retorno (F2d, telas próprias) não vale aqui.
    if (hold && (hold.agendaId !== professional.agendaId || hold.returnOriginId)) hold = null;
  }
  const consultation = professional && hold ? (professional.consultations.find((c) => c.serviceId === hold.serviceId) ?? null) : null;
  const location = professional && hold ? (professional.locations.find((l) => l.id === hold.locationId) ?? null) : null;
  const slug = professional?.slug ?? "";
  const planId = modality && modality.value !== PRIVATE_MODALITY && professional?.plans.some((p) => p.id === modality.value) ? modality.value : null;
  return {
    page,
    professional,
    flow,
    options,
    modality,
    base,
    timeZone,
    session,
    hold,
    consultation,
    location,
    when: hold ? capitalize(formatInstant(hold.start, timeZone, "EEEE, d 'de' MMMM 'às' HH:mm")) : "",
    href: (screen, extra = {}) => portalHref(`${base}/${slug}/${screen}`, { ...keep, reserva: hold?.id ?? holdId, ...extra }),
    timesHref: (release = false) => portalHref(`${base}/${slug}/horarios`, { ...keep, soltar: release ? "1" : null }),
    step: (s) => stepPosition(professionalSteps(flow, options.length > 1), s),
    planId,
    // Pela clínica (lista, especialidade ou a clínica de um profissional só) ou pelo link do profissional.
    entry: flow.from || (page.kind === "open" && singleProfessional(page.portal)) ? "clinic_link" : "professional_link",
  };
}

/** O impedimento (booking.ts) no aviso da tela (portalBooking.ts). */
export function toBlockText(reason: BlockReason, timeZone: string): BlockText {
  if (reason.kind === "already") return { kind: "already", when: `em ${formatInstant(reason.scheduledAt, timeZone, "dd/MM 'às' HH:mm")}` };
  if (reason.kind === "limit") return { kind: "limit", reason: reason.hit.reason, current: reason.hit.current };
  return reason;
}
