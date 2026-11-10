import { portalLinkUrl } from "../../../portal";
import { shortId } from "../../../publicId";
import { logError } from "../../../log";
import { unwrap } from "../../errors";
import { createPortalLink, type PortalLinkPurpose } from "../../portal/links";
import { loadPortal } from "../../portal/portal";
import type { BotService } from "./catalog";
import { end, say, textFor, type Bot } from "./engine";
import * as t from "./texts";

// F3b da recepção digital (plano, seção 15; regra 1.1 "uma jornada só"): Marcar consulta, Marcar retorno, Marcar
// exame e o "Encaixe ou antecipar" sem nada marcado (F3-2) mandam o link do portal (/s/{token}, 30 min, só para este
// número; F3a), sem as perguntas no chat.
//
// O bot segue com a marcação no chat (como antes) só onde o portal ainda não marca, para nenhuma clínica perder o
// que tem hoje: clínica sem o endereço do portal (o Suporte define) ou com o Portal desligado; profissional fora do
// portal ("Mostrar no portal" desmarcado); atendimento domiciliar ou em turma (entram no portal na F3e, F3-1); exame
// que o portal não mostra (de agenda de profissional).

type Route = { purpose: PortalLinkPurpose; what: string; professionalId: string | null; serviceId: string | null };

const portalCovers = (service: BotService) => !service.isGroup && service.agendas.every((a) => !a.locationTypes.includes("home_visit"));

/** Para onde o link leva; null = o portal ainda não cobre (o bot marca no chat, como antes). */
async function routeOf(b: Bot, category: "consultation" | "exam" | "return_visit"): Promise<Route | null> {
  const clinic = unwrap(await b.db.from("clinics").select("portal_slug").eq("id", b.clinicId).maybeSingle(), "Clínica") as { portal_slug: string | null } | null;
  if (!clinic?.portal_slug) return null;
  const portal = await loadPortal(b.db, b.clinicId, clinic.portal_slug);
  if (portal.status !== "open") return null;
  const catalog = await b.catalog();
  const services = catalog.copies.filter((s) => s.category === category);
  if (!services.length || !services.every(portalCovers)) return null;

  if (category === "return_visit") return { purpose: "return", what: "retorno", professionalId: null, serviceId: null };
  if (category === "exam") {
    if (!services.every((s) => portal.exams.some((e) => e.serviceId === s.id))) return null;
    const names = [...new Set(services.map((s) => s.name))];
    return { purpose: "exam", what: names.length === 1 ? names[0] : "exame", professionalId: null, serviceId: services.length === 1 ? services[0].id : null };
  }
  const professional = b.scope.current;
  if (!professional || !portal.professionals.some((p) => p.id === professional.id)) return null;
  return { purpose: "book", what: `consulta com ${professional.name}`, professionalId: professional.id, serviceId: null };
}

/**
 * Manda o link do portal e encerra a tentativa no funil ("link_sent", como o link de hoje). false = o portal não
 * cobre: quem chamou segue com a marcação no chat.
 */
export async function offerPortalLink(b: Bot, category: "consultation" | "exam" | "return_visit", { joinWaitlist = false } = {}): Promise<boolean> {
  let route: Route | null;
  try {
    route = await routeOf(b, category);
  } catch (error) {
    logError("bot: portal para o link", error, { clinica: b.clinicId });
    route = null;
  }
  if (!route) return false;
  try {
    const link = await createPortalLink(
      b.db,
      b.clinicId,
      {
        phone: b.phone,
        contactId: b.convo.contactId,
        purpose: route.purpose,
        professionalId: route.professionalId,
        serviceId: route.serviceId,
        joinWaitlist,
        funnelSessionId: b.convo.funnelSessionId,
      },
      b.now,
    );
    const url = portalLinkUrl(b.sender.baseUrl, shortId(link.id));
    const body = textFor(b, "booking_link", t.portalLink(route.what, url, joinWaitlist), { servico: route.what, paciente: "", link: url });
    await say(b, "bot_portal_link", body);
    await end(b, "link_sent", { portal_link_id: link.id, purpose: route.purpose, professional_id: route.professionalId, service_id: route.serviceId });
  } catch (error) {
    logError("bot: link do portal", error, { clinica: b.clinicId });
    await say(b, "bot_book_link_error", t.linkError(b.clinic.designation));
    await end(b, "error", { reason: "link_error" });
  }
  return true;
}

/** O portal está aberto para a clínica (endereço definido, Portal ligado, clínica ativa). */
async function portalOpen(b: Bot): Promise<boolean> {
  const clinic = unwrap(await b.db.from("clinics").select("portal_slug").eq("id", b.clinicId).maybeSingle(), "Clínica") as { portal_slug: string | null } | null;
  if (!clinic?.portal_slug) return false;
  return (await loadPortal(b.db, b.clinicId, clinic.portal_slug)).status === "open";
}

/**
 * Remarcar (F3c; I7): o link do portal com os dias e horários do mesmo profissional, sem a antecedência (F3-4). Turma
 * e domiciliar seguem no chat (F3e). false = o portal não cobre: quem chamou segue com o link de hoje.
 */
export async function offerPortalReschedule(
  b: Bot,
  appointment: { id: string; serviceId: string; locationType: string; category: string; serviceName: string; patientName: string },
): Promise<boolean> {
  try {
    if (appointment.locationType !== "clinic" || !(await portalOpen(b))) return false;
    const service = unwrap(await b.db.from("services").select("scheduling_mode").eq("clinic_id", b.clinicId).eq("id", appointment.serviceId).maybeSingle(), "Serviço");
    if (!service || service.scheduling_mode === "group") return false;
  } catch (error) {
    logError("bot: portal para remarcar", error, { clinica: b.clinicId });
    return false;
  }
  try {
    const link = await createPortalLink(
      b.db,
      b.clinicId,
      { phone: b.phone, contactId: b.convo.contactId, purpose: "reschedule", appointmentId: appointment.id, funnelSessionId: b.convo.funnelSessionId },
      b.now,
    );
    const { phrase } = t.appointmentWords(appointment.category as "consultation" | "return_visit" | "exam", appointment.serviceName);
    await say(b, "bot_reschedule_link", t.portalRescheduleLink(phrase, appointment.patientName, portalLinkUrl(b.sender.baseUrl, shortId(link.id))));
    await end(b, "link_sent", { portal_link_id: link.id, purpose: "reschedule", appointment_id: appointment.id });
  } catch (error) {
    logError("bot: link do portal (remarcar)", error, { clinica: b.clinicId });
    await say(b, "bot_reschedule_link_error", t.linkError(b.clinic.designation));
    await end(b, "error", { reason: "link_error" });
  }
  return true;
}
