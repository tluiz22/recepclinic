import { createHmac, timingSafeEqual } from "node:crypto";
import type { DbClient } from "../clients";
import { echoChange, toE164, type WaMessage } from "./meta";
import { hasFeature } from "../features";
import { handleAgentEcho, isLikelyAutomaticEcho, markAutomaticEcho } from "./conversations";
import { applyEchoChange, recordAgentEcho, saveProfileName, recordInboundMessage, updateDeliveryStatus, type RecordResult } from "./messages";
import { sendPreparationAfterDelivery } from "./preparation";
import { sendGuidanceAfterDelivery } from "./guidance";
import { scheduleRetryAfterLateFailure } from "./retries";
import { guidanceSender, preparationSender, type ClinicSender } from "./send";
import { applyTemplateStatusEvent, type TemplateStatusEvent } from "./templateSync";
import { markWhatsappDisconnectedByMeta } from "./connection";
import { notifyWaitingConversation, type PushContext } from "./attentionPush";
import { handleIncomingMessage } from "./bot/router";
import { getSupportWhatsapp, isSupportPhone } from "../platformSettings";
import { logError, logWarn } from "../../log";
import { unwrap } from "../errors";
import type { Json } from "../../supabase/database.types";

// Webhook do WhatsApp por clínica (F6.1, D3a). Cada evento traz o número que
// recebeu (`metadata.phone_number_id`); a plataforma descobre a clínica dele
// e todo o resto roda com a credencial limitada àquela clínica (D1). Número
// desconhecido ou desconectado é ignorado (a Meta recebe 200 do mesmo jeito,
// senão reenvia). O webhook registra mensagens recebidas, situações de
// entrega e ecos da recepção; F6.2: envia o preparo do exame quando a
// confirmação chega ao celular e guarda a situação dos templates (evento da
// conta, WABA, não do número). F6.3: o bot responde cada mensagem recebida
// (repetida pela Meta não é respondida de novo). F6.4: o eco da recepção
// pausa o bot naquela conversa ("#bot" devolve).

/** Confere o X-Hub-Signature-256 ("sha256=<hex>") contra o HMAC do corpo cru, em tempo constante. */
export function isValidMetaSignature(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export type WaStatus = {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string }[];
};

export type WebhookChange = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  messages?: WaMessage[];
  statuses?: WaStatus[];
  message_echoes?: WaMessage[];
  /** Quem escreveu (`profile.name`: o nome no perfil do WhatsApp). */
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
};

type TemplateStatusValue = {
  event?: string;
  message_template_id?: number | string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string | null;
};

/** Mudanças de situação de template (field `message_template_status_update`), com a conta de cada uma. */
export function templateStatusChanges(payload: unknown): ({ wabaId: string } & TemplateStatusEvent)[] {
  const entries = (payload as { entry?: { id?: string; changes?: { field?: string; value?: TemplateStatusValue }[] }[] } | null)?.entry;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) =>
    (Array.isArray(entry?.changes) ? entry.changes : [])
      .filter((change) => change?.field === "message_template_status_update" && change.value)
      .map((change) => {
        const value = change.value!;
        return {
          wabaId: String(entry.id ?? ""),
          name: value.message_template_name ?? "",
          language: value.message_template_language ?? "",
          event: value.event ?? "",
          reason: value.reason ?? null,
          metaTemplateId: value.message_template_id != null ? String(value.message_template_id) : null,
        };
      })
      .filter((event) => event.wabaId && event.name && event.language && event.event),
  );
}

/**
 * Fim da conexão avisado pela Meta (field `account_update`, F8.3): a clínica
 * desconectou pelo app WhatsApp Business ou tirou o RecepClinic da conta
 * (PARTNER_REMOVED), ou a conta saiu (ACCOUNT_OFFBOARDED, ACCOUNT_DELETED).
 * A conta vem em `waba_info.waba_id` (no PARTNER_REMOVED, `entry.id` é outra
 * coisa); sem ela, `entry.id`.
 */
const DISCONNECTION_EVENTS = new Set(["PARTNER_REMOVED", "ACCOUNT_OFFBOARDED", "ACCOUNT_DELETED"]);

export function accountDisconnections(payload: unknown): { wabaId: string; event: string }[] {
  type Value = { event?: string; waba_info?: { waba_id?: string | number } };
  const entries = (payload as { entry?: { id?: string; changes?: { field?: string; value?: Value }[] }[] } | null)?.entry;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) =>
    (Array.isArray(entry?.changes) ? entry.changes : [])
      .filter((change) => change?.field === "account_update" && DISCONNECTION_EVENTS.has(change.value?.event ?? ""))
      .map((change) => ({ wabaId: String(change.value!.waba_info?.waba_id ?? entry.id ?? ""), event: change.value!.event! }))
      .filter((item) => item.wabaId),
  );
}

/** O fim da conexão foi desfeito: a clínica voltou a ligar a conta ao RecepClinic (ACCOUNT_RECONNECTED, CN8). */
export function accountReconnections(payload: unknown): string[] {
  type Value = { event?: string; waba_info?: { waba_id?: string | number } };
  const entries = (payload as { entry?: { id?: string; changes?: { field?: string; value?: Value }[] }[] } | null)?.entry;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) =>
    (Array.isArray(entry?.changes) ? entry.changes : [])
      .filter((change) => change?.field === "account_update" && change.value?.event === "ACCOUNT_RECONNECTED")
      .map((change) => String(change.value!.waba_info?.waba_id ?? entry.id ?? ""))
      .filter(Boolean),
  );
}

/**
 * As mudanças do corpo do webhook (entry[].changes[].value), em ordem. O histórico do app (field `history`, CN8)
 * fica fora: os anexos dele chegam em `messages`, mas são do passado (nem gravados como novos nem respondidos).
 */
export function webhookChanges(payload: unknown): WebhookChange[] {
  const entries = (payload as { entry?: { changes?: { field?: string; value?: WebhookChange }[] }[] } | null)?.entry;
  if (!Array.isArray(entries)) return [];
  return entries
    .flatMap((entry) => (Array.isArray(entry?.changes) ? entry.changes : []).filter((change) => change?.field !== "history").map((change) => change?.value))
    .filter((value): value is WebhookChange => Boolean(value));
}

export type HistoryEvent =
  | { kind: "chunk"; phase: number | null; chunkOrder: number | null; progress: number | null; payload: Record<string, unknown> }
  | { kind: "declined"; payload: Record<string, unknown> }
  | { kind: "media"; payload: { messages: unknown[] } };

const intOrNull = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null);

/**
 * Histórico do app na conexão (field `history`, decisão 10): cada bloco (`history[]`, com fase, ordem e progresso),
 * a recusa da clínica (erro 2593109) e os anexos que a Meta manda depois (`messages`), com o número que recebeu.
 * A recusa às vezes vem sem o envelope `entry` (exemplo da Meta): aceita os dois.
 */
export function historyChanges(payload: unknown): { phoneNumberId: string; events: HistoryEvent[] }[] {
  type Value = { metadata?: { phone_number_id?: string }; history?: Record<string, unknown>[]; messages?: unknown[] };
  const root = payload as { entry?: { changes?: { field?: string; value?: Value }[] }[] } & Value;
  const values: Value[] = Array.isArray(root?.entry)
    ? root.entry.flatMap((entry) => (Array.isArray(entry?.changes) ? entry.changes : []).filter((c) => c?.field === "history" && c.value).map((c) => c.value!))
    : root && Array.isArray(root.history)
      ? [root]
      : [];
  return values
    .map((value) => {
      const events: HistoryEvent[] = [];
      for (const item of Array.isArray(value.history) ? value.history : []) {
        if (!item || typeof item !== "object") continue;
        if (Array.isArray(item.errors) && item.errors.length) {
          events.push({ kind: "declined", payload: { errors: item.errors } });
          continue;
        }
        const meta = (item.metadata ?? {}) as Record<string, unknown>;
        const progress = intOrNull(meta.progress);
        events.push({
          kind: "chunk",
          phase: intOrNull(meta.phase),
          chunkOrder: intOrNull(meta.chunk_order),
          progress: progress === null ? null : Math.min(100, Math.max(0, progress)),
          payload: { threads: Array.isArray(item.threads) ? item.threads : [] },
        });
      }
      if (Array.isArray(value.messages) && value.messages.length) events.push({ kind: "media", payload: { messages: value.messages } });
      return { phoneNumberId: String(value.metadata?.phone_number_id ?? ""), events };
    })
    .filter((item) => item.events.length);
}

export type WebhookDeps = {
  /** Plataforma: clínica do número (null = desconhecido ou desconectado). */
  resolveClinic: (phoneNumberId: string) => Promise<string | null>;
  /** Credencial limitada à clínica. */
  clientFor: (clinicId: string) => DbClient;
  /** Plataforma: clínicas conectadas da conta (WABA), para a situação dos templates. */
  resolveClinicsByWaba?: (wabaId: string) => Promise<string[]>;
  /** Quem envia pela clínica (preparo depois da entrega); null = não conectado. */
  senderFor?: (clinicId: string) => Promise<ClinicSender | null>;
  /** Notificações do atendimento humano (F8.5c); null ou ausente = desligadas. */
  push?: PushContext | null;
};

export type WebhookSummary = {
  inbound: number;
  echoes: number;
  statuses: number;
  duplicates: number;
  /** Eventos de números sem clínica (ou sem o número no evento). */
  unknownNumbers: number;
  /** Preparos do exame enviados depois da entrega da confirmação. */
  preparations: number;
  /** Templates com a situação atualizada. */
  templates: number;
  /** Clínicas desconectadas pelo aviso da Meta (F8.3). */
  disconnections: number;
  /** Blocos do histórico do app guardados para a rotina (CN8). */
  history: number;
  /** Mensagens respondidas pelo bot. */
  botReplies: number;
  /** Mensagens e ecos ignorados: clínica em implantação. */
  onboarding: number;
  errors: number;
};

/** Registra os eventos. Erro num evento não para os outros (vai para o log). */
export async function processWebhook(payload: unknown, deps: WebhookDeps, now: Date = new Date()): Promise<WebhookSummary> {
  const summary: WebhookSummary = { inbound: 0, echoes: 0, statuses: 0, duplicates: 0, unknownNumbers: 0, preparations: 0, templates: 0, disconnections: 0, history: 0, botReplies: 0, onboarding: 0, errors: 0 };
  const count = (result: RecordResult, kind: "inbound" | "echoes") => {
    if (result.recorded) summary[kind] += 1;
    else if (result.reason === "duplicate") summary.duplicates += 1;
  };
  const attempt = async (what: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      summary.errors += 1;
      logError(`whatsapp webhook: ${what}`, error);
    }
  };

  for (const change of webhookChanges(payload)) {
    const phoneNumberId = change.metadata?.phone_number_id ?? "";
    const events = (change.messages?.length ?? 0) + (change.statuses?.length ?? 0) + (change.message_echoes?.length ?? 0);
    if (!events) continue;
    const clinicId = phoneNumberId ? await deps.resolveClinic(phoneNumberId) : null;
    if (!clinicId) {
      summary.unknownNumbers += events;
      logWarn("whatsapp webhook: número sem clínica conectada", { phone_number_id: phoneNumberId || "(vazio)" });
      continue;
    }
    const db = deps.clientFor(clinicId);

    // Em implantação (cliente, 29/out/2026), as conversas não são gravadas nem pausam o bot:
    // o Atendimento e a leitura das mensagens começam do zero ao ativar a clínica.
    const conversations = (change.messages?.length ?? 0) + (change.message_echoes?.length ?? 0);
    let onboarding = false;
    if (conversations) {
      await attempt("situação da clínica", async () => {
        const clinic = unwrap(await db.from("clinics").select("status").eq("id", clinicId).maybeSingle(), "Clínica");
        onboarding = clinic?.status === "onboarding";
      });
    }
    if (onboarding) summary.onboarding += conversations;

    // O número do suporte do RecepClinic conversa com a clínica sem bot e sem Atendimento (cliente, 01/nov/2026):
    // a mensagem é gravada no histórico, mas não chama o bot, não pausa a conversa e não avisa a equipe.
    const support: { phone: string | null } = { phone: null };
    if (conversations && !onboarding) {
      await attempt("número do suporte", async () => {
        support.phone = await getSupportWhatsapp(db);
      });
    }

    for (const message of onboarding ? [] : (change.messages ?? [])) {
      let recorded = false;
      await attempt("mensagem recebida", async () => {
        const result = await recordInboundMessage(db, clinicId, message, now);
        count(result, "inbound");
        recorded = result.recorded;
      });
      if (!recorded) continue;
      if (isSupportPhone(toE164(message.from), support.phone)) continue;
      if (deps.senderFor) {
        await attempt("bot", async () => {
          const sender = await deps.senderFor!(clinicId);
          if (sender && (await handleIncomingMessage({ db, clinicId, sender, now }, message)) === "handled") summary.botReplies += 1;
        });
      }
      // Nome no perfil do WhatsApp (CN2/T4): o banco só guarda com a Central ligada; depois do bot, a conversa já existe.
      const profile = change.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? change.contacts?.[0]?.profile?.name;
      if (profile) await attempt("nome do perfil", () => saveProfileName(db, clinicId, toE164(message.from), profile));
      // Conversa que passou a aguardar a clínica (pedido, sem horário, limite ou o paciente escreveu de novo): avisa (F8.5c).
      const phone = toE164(message.from);
      if (deps.push && phone) await notifyWaitingConversation(db, clinicId, phone, deps.push, now);
    }
    for (const status of change.statuses ?? []) {
      if (status.status === "failed" && status.errors?.length) {
        logError("whatsapp webhook: entrega falhou", status.errors.map((e) => `${e.code} ${e.title ?? e.message}`).join("; "), {
          clinica: clinicId,
          mensagem: status.id,
        });
      }
      await attempt("situação de entrega", async () => {
        if (!status.id || !status.status) return;
        const result = await updateDeliveryStatus(db, clinicId, status.id, status.status);
        if (!result.updated) return;
        summary.statuses += 1;
        if (status.status === "failed") {
          // Falha técnica avisada depois: nova tentativa, como na falha na hora (cliente, 23/out).
          const error = status.errors?.[0];
          await scheduleRetryAfterLateFailure(db, clinicId, result.message.id, { code: error?.code ?? null, title: error?.title ?? error?.message ?? null }, now);
          return;
        }
        if (!result.reachedPhone || !deps.senderFor) return;
        // Confirmação de exame entregue: o preparo sai uma vez (F3.9b).
        await attempt("preparo do exame", async () => {
          const sender = await deps.senderFor!(clinicId);
          if (!sender) return;
          const sent = await sendPreparationAfterDelivery(db, clinicId, result, preparationSender(sender), now);
          if (sent) summary.preparations += 1;
        });
        // Confirmação de consulta entregue: as orientações gerais saem uma vez (cliente, 08/out).
        await attempt("orientações gerais", async () => {
          const sender = await deps.senderFor!(clinicId);
          if (sender) await sendGuidanceAfterDelivery(db, clinicId, result, guidanceSender(sender), now);
        });
      });
    }
    for (const echo of onboarding ? [] : (change.message_echoes ?? [])) {
      await attempt("eco da recepção", async () => {
        // Editada ou apagada no app (CN2): muda a original; não é resposta nova, não pausa o bot.
        const change = echoChange(echo);
        if (change) {
          await applyEchoChange(db, clinicId, change, now);
          return;
        }
        if (echo.type === "edit" || echo.type === "revoke") return;
        const result = await recordAgentEcho(db, clinicId, echo, now);
        count(result, "echoes");
        if (isSupportPhone(toE164(echo.to), support.phone)) return;
        if (!result.recorded || !(await hasFeature(db, clinicId, "whatsapp_bot"))) return;
        // Mensagem automática do app (IS4, cliente, 03/nov/2026): segundos depois do paciente ou do bot, não pausa; avisa.
        if (await isLikelyAutomaticEcho(db, clinicId, echo, result.id)) {
          await markAutomaticEcho(db, clinicId, result.id);
          logWarn("whatsapp: mensagem automática do app (não pausou o bot)", { clinica: clinicId });
          return;
        }
        // A recepção respondeu pelo app (coexistência): pausa o bot naquela conversa; "#bot" devolve (F6.4).
        await handleAgentEcho(db, clinicId, echo, result.contactId, now);
      });
    }
  }

  // Histórico do app (CN8): só guarda o evento bruto; a rotina de cada minuto grava as mensagens. O banco descarta
  // com a Central desligada (D12 revista).
  for (const { phoneNumberId, events } of historyChanges(payload)) {
    await attempt("histórico do app", async () => {
      const clinicId = phoneNumberId ? await deps.resolveClinic(phoneNumberId) : null;
      if (!clinicId) {
        summary.unknownNumbers += events.length;
        return;
      }
      const rows = events.map((event) => ({
        clinic_id: clinicId,
        kind: event.kind,
        payload: event.payload as unknown as NonNullable<Json>,
        ...(event.kind === "chunk" ? { phase: event.phase, chunk_order: event.chunkOrder, progress: event.progress } : {}),
      }));
      unwrap(await deps.clientFor(clinicId).from("whatsapp_history_events").insert(rows), "Histórico do app");
      summary.history += events.filter((event) => event.kind !== "declined").length;
      if (events.some((event) => event.kind === "declined")) {
        logWarn("whatsapp: a clínica não compartilhou o histórico do app (2593109)", { clinica: clinicId });
      }
    });
  }

  for (const { wabaId, ...event } of templateStatusChanges(payload)) {
    if (!deps.resolveClinicsByWaba) break;
    await attempt("situação do template", async () => {
      for (const clinicId of await deps.resolveClinicsByWaba!(wabaId)) {
        if (await applyTemplateStatusEvent(deps.clientFor(clinicId), clinicId, event)) summary.templates += 1;
      }
    });
  }

  // A Meta avisou o fim da conexão: "Desconectado", e o Suporte fica sabendo por Sistema › Erros.
  for (const { wabaId, event } of accountDisconnections(payload)) {
    if (!deps.resolveClinicsByWaba) break;
    await attempt("desconexão avisada pela Meta", async () => {
      for (const clinicId of await deps.resolveClinicsByWaba!(wabaId)) {
        if (!(await markWhatsappDisconnectedByMeta(deps.clientFor(clinicId)))) continue;
        summary.disconnections += 1;
        logError("whatsapp: desconectado pela Meta", new Error(`A Meta avisou ${event}: o WhatsApp da clínica foi marcado como desconectado.`), {
          clinica: clinicId,
          waba_id: wabaId,
        });
      }
    });
  }
  // A clínica voltou a ligar a conta (CN8): a conexão no RecepClinic é refeita pela tela (o token antigo não vale).
  for (const wabaId of accountReconnections(payload)) {
    logWarn("whatsapp: a Meta avisou ACCOUNT_RECONNECTED; se a clínica está desconectada, conectar de novo em Configurações › WhatsApp", { waba_id: wabaId });
  }
  return summary;
}
