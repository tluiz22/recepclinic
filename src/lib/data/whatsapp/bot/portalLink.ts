import { portalLinkUrl } from "../../../portal";
import { shortId } from "../../../publicId";
import { logError } from "../../../log";
import { unwrap } from "../../errors";
import { createPortalLink } from "../../portal/links";
import { end, go, say, sendLink, type Bot } from "./engine";
import { startFunnel, WELCOME } from "../conversations";
import * as t from "./texts";

// Bot enxuto (F3f, seção 15.6; cliente, 11/nov/2026): o bot leva ao portal (/s/{token}, 30 min, só para este número,
// celular já comprovado). Sem o portal (endereço não definido, item Portal desligado, clínica suspensa), a recepção.

/**
 * O endereço do portal, se ele está aberto para a clínica (endereço definido pelo Suporte, item Portal ligado,
 * clínica ativa); null = fechado. Consulta leve: o catálogo do portal só é lido quando o link depende dele.
 */
async function openPortalSlug(b: Bot): Promise<string | null> {
  if (!b.features.includes("portal")) return null;
  const clinic = unwrap(await b.db.from("clinics").select("portal_slug, status").eq("id", b.clinicId).maybeSingle(), "Clínica") as {
    portal_slug: string | null;
    status: string;
  } | null;
  return clinic?.portal_slug && clinic.status !== "suspended" ? clinic.portal_slug : null;
}

// ---------------------------------------------------------------------------
// Bot enxuto (F3f, seção 15.6): o menu leva ao portal numa mensagem, com o botão do link (BE-3)
// ---------------------------------------------------------------------------

export type ShortcutPurpose = keyof typeof t.LEAN_LINKS;

/**
 * Agendar, Minhas consultas ou Profissionais: o link do portal (30 min, só para este número, celular já comprovado).
 * false = portal fechado para a clínica: quem chamou passa para a recepção (F3-5/F3-7).
 */
export async function sendPortalShortcut(b: Bot, purpose: ShortcutPurpose): Promise<boolean> {
  try {
    if (!(await openPortalSlug(b))) return false;
  } catch (error) {
    logError("bot: portal para o atalho", error, { clinica: b.clinicId });
    return false;
  }
  // Agendar conta como tentativa de marcação nas Métricas (o funil fecha com "link_sent", como o link de antes).
  if (purpose === "book") {
    b.now = new Date(b.now.getTime() + 1);
    const sessionId = await startFunnel(b.db, b.clinicId, b.phone, "booking", { lean: true }, b.now);
    b.convo = { ...b.convo, funnelSessionId: sessionId, funnelFlow: "booking" };
  }
  try {
    const link = await createPortalLink(
      b.db,
      b.clinicId,
      { phone: b.phone, contactId: b.convo.contactId, purpose, funnelSessionId: b.convo.funnelSessionId },
      b.now,
    );
    const url = portalLinkUrl(b.sender.baseUrl, shortId(link.id));
    const text = t.LEAN_LINKS[purpose];
    await sendLink(b, `bot_portal_${purpose}`, text.body, { text: text.button, url });
    if (purpose === "book") await end(b, "link_sent", { portal_link_id: link.id, purpose });
    else await go(b, WELCOME);
  } catch (error) {
    logError("bot: link do portal (atalho)", error, { clinica: b.clinicId });
    await say(b, "bot_book_link_error", t.linkError(b.clinic.designation));
    if (purpose === "book") await end(b, "error", { reason: "link_error" });
    else await go(b, WELCOME);
  }
  return true;
}

/**
 * Remarcar ou Cancelar do lembrete atual (rc_lembrete_v1): o portal já na ação, numa mensagem com o botão. false = o
 * portal não cobre (fechado, ou turma ao remarcar): quem chamou segue como antes.
 */
export async function sendReminderPortalLink(
  b: Bot,
  action: "reschedule" | "cancel",
  appointment: { id: string; serviceId: string; locationType: string; category: string; serviceName: string; patientName: string },
): Promise<boolean> {
  try {
    if (!(await openPortalSlug(b))) return false;
    if (action === "reschedule") {
      if (appointment.locationType !== "clinic" && appointment.locationType !== "home_visit") return false;
      const service = unwrap(await b.db.from("services").select("scheduling_mode").eq("clinic_id", b.clinicId).eq("id", appointment.serviceId).maybeSingle(), "Serviço");
      if (!service || service.scheduling_mode === "group") return false;
    }
  } catch (error) {
    logError("bot: portal para o lembrete", error, { clinica: b.clinicId });
    return false;
  }
  try {
    const link = await createPortalLink(
      b.db,
      b.clinicId,
      { phone: b.phone, contactId: b.convo.contactId, purpose: action, appointmentId: appointment.id, funnelSessionId: b.convo.funnelSessionId },
      b.now,
    );
    const url = portalLinkUrl(b.sender.baseUrl, shortId(link.id));
    const { phrase } = t.appointmentWords(appointment.category as "consultation" | "return_visit" | "exam", appointment.serviceName);
    const body = action === "reschedule" ? t.reminderRescheduleLink(phrase, appointment.patientName) : t.reminderCancelLink(phrase, appointment.patientName);
    await sendLink(b, `bot_reminder_${action}_link`, body, { text: action === "reschedule" ? t.REMINDER_RESCHEDULE_BUTTON : t.REMINDER_CANCEL_BUTTON, url });
    await end(b, "link_sent", { portal_link_id: link.id, purpose: action, appointment_id: appointment.id });
  } catch (error) {
    logError("bot: link do portal (lembrete)", error, { clinica: b.clinicId });
    await say(b, "bot_reschedule_link_error", t.linkError(b.clinic.designation));
    await end(b, "error", { reason: "link_error" });
  }
  return true;
}
