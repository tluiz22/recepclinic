import { bookingPath } from "../../../publicId";
import { BOT_LINK_TTL_MS } from "../../agenda/links";
import type { DbClient } from "../../clients";
import { unwrap } from "../../errors";
import { openConversation, WELCOME, type Conversation } from "../conversations";
import { formatAppointmentWhen } from "../templates";
import type { ClinicSender } from "../send";
import { createBot, go, say, sendButtons, type Bot } from "./engine";
import type { Selection } from "./input";
import { askCancel, handoff, loadActive, type ManageContext } from "./manage";
import * as t from "./texts";
import { logError } from "../../../log";

// Pedido não concluído (PN2; cliente, 03/nov/2026; docs/pedido-nao-concluido.md): link do bot vencido sem uso, ou
// cancelamento sem resposta ao "Tem certeza?", recebe uma vez "Não concluímos a {marcação | remarcação |
// cancelamento} de {paciente}. Como prefere seguir?" com Novo link (no cancelamento, "Cancelar agora"), Falar com a
// recepção e Desistir. Sem resposta, a conversa fecha como sempre (15 minutos, "encerramos este atendimento").
// Mudou o caminho do paciente: atualizar o fluxograma em src/components/admin/tecnologia/botJourney.ts.

export const NOT_COMPLETED = "NOT_COMPLETED";

/** Só links vencidos há pouco: a rotina roda de minuto em minuto e nunca volta ao passado (ex.: no primeiro deploy). */
export const NOT_COMPLETED_LOOKBACK_MS = 60 * 60_000;
/** A mensagem é texto livre: só dentro da janela de 24h da Meta (com folga). */
const WINDOW_MS = 24 * 60 * 60_000 - 10 * 60_000;

type NotCompletedContext = {
  kind: t.NotCompletedKind;
  patientName: string;
  /** Link vencido (marcação ou remarcação): o novo link copia dele. */
  linkId?: string;
  /** Remarcação e cancelamento: o atendimento que segue marcado. */
  appointmentId?: string;
};

const ACTIVE = ["scheduled", "confirmed"];

type ExpiredLink = {
  id: string;
  mode: "create" | "reschedule";
  contact_phone: string;
  contact_id: string;
  patient_id: string;
  appointment_id: string | null;
  canceled_appointment_id: string | null;
  created_at: string;
  patients: { full_name: string } | null;
};

/** O link vencido já não pede nada: o pedido foi resolvido de outro jeito, ou há outra conversa em andamento. */
async function skipReason(db: DbClient, clinicId: string, link: ExpiredLink, convo: Conversation, now: Date): Promise<string | null> {
  if (convo.humanHandoff) return "paused";
  if (convo.state !== WELCOME) return "in_conversation";
  const newer = unwrap(
    await db
      .from("booking_links")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("contact_phone", link.contact_phone)
      .gt("created_at", link.created_at)
      .limit(1),
    "Links de agendamento",
  );
  if (newer.length) return "newer_link";
  if (link.mode === "reschedule" && link.appointment_id) {
    const appointment = unwrap(
      await db.from("appointments").select("status, rescheduled_at").eq("clinic_id", clinicId).eq("id", link.appointment_id).maybeSingle(),
      "Atendimento",
    );
    if (!appointment || !ACTIVE.includes(appointment.status)) return "inactive";
    if (appointment.rescheduled_at && appointment.rescheduled_at >= link.created_at) return "done";
  } else {
    // Marcado depois do link (pela recepção ou por outro caminho).
    const booked = unwrap(
      await db.from("appointments").select("id").eq("clinic_id", clinicId).eq("patient_id", link.patient_id).gte("created_at", link.created_at).limit(1),
      "Atendimentos",
    );
    if (booked.length) return "done";
  }
  const last = unwrap(
    await db
      .from("whatsapp_messages")
      .select("created_at")
      .eq("clinic_id", clinicId)
      .eq("contact_phone", link.contact_phone)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1),
    "Mensagens do WhatsApp",
  );
  if (!last.length || now.getTime() - new Date(last[0].created_at).getTime() > WINDOW_MS) return "window_closed";
  return null;
}

/**
 * Rotina (junto da conversa parada): link do bot vencido sem uso recebe a mensagem, uma vez. O link é marcado antes
 * do envio (`not_completed_prompted_at`), mesmo quando a mensagem é pulada. Devolve quantas mensagens saíram.
 */
export async function promptExpiredLinks(db: DbClient, clinicId: string, sender: ClinicSender, now: Date = new Date()): Promise<number> {
  const links = unwrap(
    await db
      .from("booking_links")
      .select("id, mode, contact_phone, contact_id, patient_id, appointment_id, canceled_appointment_id, created_at, patients ( full_name )")
      .eq("clinic_id", clinicId)
      .is("used_at", null)
      .is("not_completed_prompted_at", null)
      .lte("expires_at", now.toISOString())
      .gt("expires_at", new Date(now.getTime() - NOT_COMPLETED_LOOKBACK_MS).toISOString())
      .order("expires_at"),
    "Links vencidos",
  ) as unknown as ExpiredLink[];
  let sent = 0;
  for (const link of links) {
    try {
      // Marca primeiro: duas rotinas ao mesmo tempo não mandam duas vezes.
      const claimed = unwrap(
        await db
          .from("booking_links")
          .update({ not_completed_prompted_at: now.toISOString() })
          .eq("clinic_id", clinicId)
          .eq("id", link.id)
          .is("not_completed_prompted_at", null)
          .select("id"),
        "Link de agendamento",
      );
      if (!claimed.length) continue;
      const convo = await openConversation(db, clinicId, link.contact_phone, link.contact_id);
      if (await skipReason(db, clinicId, link, convo, now)) continue;
      const kind: t.NotCompletedKind = link.mode === "reschedule" || link.canceled_appointment_id ? "reschedule" : "booking";
      const b = await createBot({ db, clinicId, sender, now }, convo);
      const patientName = link.patients?.full_name ?? "o paciente";
      await sendButtons(b, "bot_not_completed", t.notCompleted(kind, patientName), t.notCompletedButtons(kind, b.receptionAvailable));
      await go(b, NOT_COMPLETED, { kind, patientName, linkId: link.id, appointmentId: link.appointment_id ?? undefined } satisfies NotCompletedContext);
      sent++;
    } catch (error) {
      logError("bot: pedido não concluído (link)", error, { clinica: clinicId, link: link.id });
    }
  }
  return sent;
}

/**
 * Cancelamento parado no "Tem certeza?" (rotina da conversa parada): a mensagem no lugar do "encerramos". false = o
 * atendimento não está mais ativo (a rotina encerra como sempre).
 */
export async function promptPendingCancel(b: Bot): Promise<boolean> {
  const pendingId = (b.convo.context as ManageContext).pendingId;
  const appointment = pendingId ? await loadActive(b, pendingId) : null;
  if (!appointment) return false;
  await sendButtons(b, "bot_not_completed", t.notCompleted("cancel", appointment.patientName), t.notCompletedButtons("cancel", b.receptionAvailable));
  await go(b, NOT_COMPLETED, { kind: "cancel", patientName: appointment.patientName, appointmentId: appointment.id } satisfies NotCompletedContext);
  return true;
}

/** Copia o link vencido (mesmo serviço, agenda, paciente, atendimento), com 30 minutos de validade. */
async function renewLink(b: Bot, linkId: string): Promise<string> {
  const old = unwrap(await b.db.from("booking_links").select("*").eq("clinic_id", b.clinicId).eq("id", linkId).single(), "Link de agendamento");
  const { id: _id, created_at: _created, expires_at: _expires, used_at: _used, not_completed_prompted_at: _prompted, ...rest } = old;
  const row = unwrap(
    await b.db
      .from("booking_links")
      .insert({ ...rest, expires_at: new Date(b.now.getTime() + BOT_LINK_TTL_MS).toISOString() })
      .select("id")
      .single(),
    "Link de agendamento",
  );
  return `${b.sender.baseUrl}${bookingPath(row.id)}`;
}

/** Resposta à mensagem. false = não é um dos botões (a conversa recomeça como qualquer mensagem). */
export async function handleNotCompleted(b: Bot, selection: Selection): Promise<boolean> {
  const ctx = b.convo.context as unknown as NotCompletedContext;
  const id = selection.id;
  if (id !== t.NOT_COMPLETED_IDS.retry && id !== t.NOT_COMPLETED_IDS.reception && id !== t.NOT_COMPLETED_IDS.giveUp) return false;

  const appointment = ctx.appointmentId ? await loadActive(b, ctx.appointmentId) : null;
  if (id === t.NOT_COMPLETED_IDS.reception && b.receptionAvailable) {
    await handoff(b, "not_completed", { subject: t.notCompletedSubject(ctx.kind, ctx.patientName) });
    return true;
  }
  if (id === t.NOT_COMPLETED_IDS.retry) {
    if ((ctx.kind === "cancel" || (ctx.kind === "reschedule" && ctx.appointmentId)) && !appointment) {
      await say(b, "bot_appointment_inactive", t.APPOINTMENT_INACTIVE);
      await go(b, WELCOME);
      return true;
    }
    if (ctx.kind === "cancel") {
      await askCancel(b, {} as ManageContext, appointment!);
      return true;
    }
    try {
      const url = await renewLink(b, ctx.linkId!);
      await say(b, "bot_not_completed_new_link", t.notCompletedNewLink(ctx.kind, ctx.patientName, url));
    } catch (error) {
      logError("bot: novo link do pedido não concluído", error, { clinica: b.clinicId });
      await say(b, "bot_book_link_error", t.linkError(b.clinic.designation));
    }
    await go(b, WELCOME);
    return true;
  }
  // Desistir (ou a recepção sem coexistência): o atendimento segue marcado, quando há um.
  if (appointment) {
    const { phrase, end } = t.appointmentWords(appointment.category, appointment.serviceName);
    await say(b, "bot_not_completed_give_up", t.notCompletedKept(phrase, end, appointment.patientName, formatAppointmentWhen(appointment.scheduledAt, b.clinic.timeZone)));
  } else {
    await say(b, "bot_not_completed_give_up", t.NOT_COMPLETED_GIVE_UP);
  }
  await go(b, WELCOME);
  return true;
}
