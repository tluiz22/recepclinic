import webpush from "web-push";
import { addDays, formatInstant, localDateOf } from "../../clinicTime";
import type { WebPushEnv } from "../../env";
import { logError } from "../../log";
import { formatPhoneBR } from "../../phone";
import { isReceptionOpen, type ReceptionHours } from "../../receptionHours";
import type { DbClient } from "../clients";
import { DataError, unwrap, unwrapOne } from "../errors";
import { loadClinicHolidays } from "../agenda/slots";
import { getReceptionHours } from "../config/receptionHours";
import { handoffReasonLabel, listHumanAttention, type AttentionItem } from "./attention";

// Notificações do atendimento humano no celular (F8.5c, cliente, 27/out/2026),
// pelo Web Push do navegador, para quem ativou no próprio aparelho:
// - "Fulano quer falar com a clínica" quando a conversa passa a aguardar (uma
//   vez por vez que ela passa a aguardar), só no horário da recepção;
// - lembrete do "#bot" quando a conversa fica 1 hora sem mensagens em
//   atendimento (uma vez por período sem mensagens);
// - ao abrir o horário da recepção, um resumo do que chegou fora dele.
// Um toque abre a conversa no WhatsApp (o resumo abre a tela Atendimento).

export const REMINDER_AFTER_MINUTES = 60;

export type PushMessage = { title: string; body: string; url: string; tag: string };

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

/** Avisar que a conversa aguarda a clínica: aguardando, recepção aberta, e ainda não avisado desde que passou a aguardar. */
export function shouldNotifyWaiting(item: AttentionItem, receptionOpen: boolean): boolean {
  if (item.status !== "waiting" || !receptionOpen || !item.waitingSince) return false;
  return !item.notifiedAt || item.notifiedAt.getTime() < item.waitingSince.getTime();
}

/** Lembrar do "#bot": em atendimento, 1 hora sem mensagens, recepção aberta, e ainda não lembrado desde a última mensagem. */
export function shouldRemind(item: AttentionItem, receptionOpen: boolean, now: Date): boolean {
  if (item.status !== "in_progress" || !receptionOpen) return false;
  if (now.getTime() - item.lastActivityAt.getTime() < REMINDER_AFTER_MINUTES * 60_000) return false;
  return !item.remindedAt || item.remindedAt.getTime() < item.lastActivityAt.getTime();
}

/**
 * O toque abre a tela Atendimento com a conversa em destaque (e, no celular,
 * o WhatsApp em seguida): um endereço do próprio RecepClinic, para o app da
 * Tela de Início continuar nele ao voltar do WhatsApp (cliente, 27/out/2026).
 */
const conversationUrl = (phone: string) => `/admin/atendimento?conversa=${encodeURIComponent(phone)}`;

const who = (item: AttentionItem) => item.name ?? formatPhoneBR(item.phone);
const excerpt = (text: string | null | undefined, max = 90) => (!text ? null : text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function waitingMessage(item: AttentionItem): PushMessage {
  const title = item.reason === "requested" ? `${who(item)} quer falar com a clínica` : `${who(item)} aguarda atendimento humano`;
  const quote = excerpt(item.lastPatientMessage?.body);
  return {
    title,
    body: [handoffReasonLabel(item.reason), quote ? `“${quote}”` : null, "Toque para abrir a conversa."].filter(Boolean).join(" · "),
    url: conversationUrl(item.phone),
    tag: `atendimento-${item.phone}`,
  };
}

export function reminderMessage(item: AttentionItem): PushMessage {
  return {
    title: `${who(item)} segue com a clínica`,
    body: "Se já terminou, escreva #bot na conversa para o bot voltar a atender.",
    url: conversationUrl(item.phone),
    tag: `atendimento-${item.phone}`,
  };
}

export function summaryMessage(waiting: AttentionItem[], timeZone: string): PushMessage {
  const count = waiting.length;
  const oldest = waiting.reduce((min, item) => (item.waitingSince! < min ? item.waitingSince! : min), waiting[0].waitingSince!);
  return {
    title: `${count} ${count === 1 ? "conversa aguardando" : "conversas aguardando"} atendimento humano`,
    body: `Chegaram fora do horário da recepção; a mais antiga desde ${formatInstant(oldest, timeZone, "dd/MM 'às' HH:mm")}. Toque para ver.`,
    url: "/admin/atendimento",
    tag: "atendimento-resumo",
  };
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

export type PushContext = { webPush: WebPushEnv; subject: string };

type StoredSubscription = { id: string; endpoint: string; p256dh: string; auth: string };

/** Manda a todos os aparelhos inscritos na clínica; tira os vencidos. Devolve quantos receberam. */
export async function sendToClinic(db: DbClient, clinicId: string, message: PushMessage, push: PushContext, now: Date = new Date()): Promise<number> {
  const subscriptions = unwrap(
    await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("clinic_id", clinicId),
    "Notificações",
  );
  return sendTo(db, clinicId, subscriptions, message, push, now);
}

async function sendTo(db: DbClient, clinicId: string, subscriptions: StoredSubscription[], message: PushMessage, push: PushContext, now: Date): Promise<number> {
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(message),
        { vapidDetails: { subject: push.subject, publicKey: push.webPush.publicKey, privateKey: push.webPush.privateKey }, TTL: 4 * 60 * 60, urgency: "high" },
      );
      sent++;
      await db.from("push_subscriptions").update({ last_sent_at: now.toISOString() }).eq("id", subscription.id);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      // 404/410: o aparelho desinstalou, trocou de navegador ou desativou.
      if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("id", subscription.id);
      else logError("notificações: envio", error, { clinica: clinicId, status });
    }
  }
  return sent;
}

async function hasSubscriptions(db: DbClient, clinicId: string): Promise<boolean> {
  const { count, error } = await db.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

type Reception = { hours: ReceptionHours; timeZone: string; holidays: Set<string>; summarySentOn: string | null };

async function loadReception(db: DbClient, clinicId: string, now: Date): Promise<Reception> {
  const settings = unwrapOne(
    await db.from("clinic_settings").select("timezone, reception_summary_sent_on").eq("clinic_id", clinicId).maybeSingle(),
    "Notificações",
  );
  const today = localDateOf(now, settings.timezone);
  const [{ hours }, holidays] = await Promise.all([getReceptionHours(db, clinicId), loadClinicHolidays(db, clinicId, today, addDays(today, 1))]);
  return { hours, timeZone: settings.timezone, holidays, summarySentOn: settings.reception_summary_sent_on };
}

const markConversation = (db: DbClient, clinicId: string, phone: string, column: "handoff_notified_at" | "handoff_reminded_at", now: Date) =>
  db
    .from("conversation_state")
    .update(column === "handoff_notified_at" ? { handoff_notified_at: now.toISOString() } : { handoff_reminded_at: now.toISOString() })
    .eq("clinic_id", clinicId)
    .eq("contact_phone", phone);

/**
 * Depois de cada mensagem do paciente (credencial da clínica): se a conversa
 * passou a aguardar a clínica, avisa. Nunca lança (o erro vai para o log).
 */
export async function notifyWaitingConversation(db: DbClient, clinicId: string, phone: string, push: PushContext | null, now: Date = new Date()): Promise<boolean> {
  if (!push) return false;
  try {
    if (!(await hasSubscriptions(db, clinicId))) return false;
    const reception = await loadReception(db, clinicId, now);
    const [item] = await listHumanAttention(db, clinicId, reception.timeZone, now, phone);
    if (!item || !shouldNotifyWaiting(item, isReceptionOpen(reception.hours, now, reception.timeZone, reception.holidays))) return false;
    await sendToClinic(db, clinicId, waitingMessage(item), push, now);
    await markConversation(db, clinicId, phone, "handoff_notified_at", now);
    return true;
  } catch (error) {
    logError("notificações: aviso de conversa aguardando", error, { clinica: clinicId });
    return false;
  }
}

/** Rotina a cada 5 minutos: lembretes do "#bot" e o resumo ao abrir o horário da recepção. */
export async function runAttentionRoutine(
  db: DbClient,
  clinicId: string,
  push: PushContext | null,
  now: Date = new Date(),
): Promise<{ reminders: number; summary: boolean }> {
  if (!push || !(await hasSubscriptions(db, clinicId))) return { reminders: 0, summary: false };
  const reception = await loadReception(db, clinicId, now);
  if (!isReceptionOpen(reception.hours, now, reception.timeZone, reception.holidays)) return { reminders: 0, summary: false };
  const items = await listHumanAttention(db, clinicId, reception.timeZone, now);

  // Primeira passada no horário aberto do dia: o resumo do que chegou fora dele.
  let summary = false;
  const today = localDateOf(now, reception.timeZone);
  if (reception.summarySentOn !== today) {
    const waiting = items.filter((item) => item.status === "waiting" && !(item.notifiedAt && item.notifiedAt >= item.waitingSince!));
    if (waiting.length > 0) {
      await sendToClinic(db, clinicId, summaryMessage(waiting, reception.timeZone), push, now);
      for (const item of waiting) await markConversation(db, clinicId, item.phone, "handoff_notified_at", now);
      summary = true;
    }
    unwrap(await db.rpc("mark_reception_summary_sent", { p_date: today }), "Notificações");
  }

  let reminders = 0;
  for (const item of items) {
    if (!shouldRemind(item, true, now)) continue;
    await sendToClinic(db, clinicId, reminderMessage(item), push, now);
    await markConversation(db, clinicId, item.phone, "handoff_reminded_at", now);
    reminders++;
  }
  return { reminders, summary };
}

// ---------------------------------------------------------------------------
// Aparelhos de quem está usando o painel (login da pessoa)
// ---------------------------------------------------------------------------

export type SubscriptionInput = { endpoint: string; p256dh: string; auth: string };

/** Nome curto do aparelho para a tela, pelo navegador que ativou. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const system = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Aparelho";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) && !/Edg\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  return browser && system !== "iPhone" && system !== "iPad" ? `${browser} no ${system}` : system;
}

/** Ativa as notificações neste aparelho (substitui uma inscrição antiga do mesmo endereço). */
export async function saveMySubscription(db: DbClient, clinicId: string, userId: string, input: SubscriptionInput, device: string): Promise<void> {
  if (!/^https:\/\//.test(input.endpoint) || !input.p256dh || !input.auth) throw new DataError("invalid", "Notificações: inscrição do aparelho incompleta");
  await db.from("push_subscriptions").delete().eq("clinic_id", clinicId).eq("endpoint", input.endpoint);
  unwrap(
    await db.from("push_subscriptions").insert({ clinic_id: clinicId, user_id: userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, device }),
    "Notificações",
  );
}

/** Desativa neste aparelho. */
export async function removeMySubscription(db: DbClient, clinicId: string, endpoint: string): Promise<void> {
  unwrap(await db.from("push_subscriptions").delete().eq("clinic_id", clinicId).eq("endpoint", endpoint), "Notificações");
}

/** Os aparelhos da pessoa na clínica. */
export async function listMyDevices(db: DbClient, clinicId: string, userId: string): Promise<{ endpoint: string; device: string | null; createdAt: Date }[]> {
  const rows = unwrap(
    await db.from("push_subscriptions").select("endpoint, device, created_at").eq("clinic_id", clinicId).eq("user_id", userId).order("created_at"),
    "Notificações",
  );
  return rows.map((row) => ({ endpoint: row.endpoint, device: row.device, createdAt: new Date(row.created_at) }));
}

/** "Enviar teste": só para os aparelhos da pessoa. Devolve quantos receberam. */
export async function sendTestToMe(db: DbClient, clinicId: string, userId: string, push: PushContext, now: Date = new Date()): Promise<number> {
  const subscriptions = unwrap(
    await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("clinic_id", clinicId).eq("user_id", userId),
    "Notificações",
  );
  return sendTo(
    db,
    clinicId,
    subscriptions,
    { title: "Notificações do RecepClinic ligadas", body: "É assim que chega o aviso de uma conversa aguardando atendimento humano.", url: "/admin/atendimento", tag: "atendimento-teste" },
    push,
    now,
  );
}

/** Contexto do envio a partir das variáveis do ambiente; null = notificações desligadas. */
export function pushContextFrom(webPush: WebPushEnv | null, siteUrl: string | null): PushContext | null {
  // O serviço de notificações exige https (ou mailto) para identificar quem envia; no local, o site da marca.
  return webPush ? { webPush, subject: siteUrl?.startsWith("https://") ? siteUrl : "https://www.recepclinic.com.br" } : null;
}
