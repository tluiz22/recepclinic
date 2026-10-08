import { createHmac, timingSafeEqual } from "node:crypto";
import type { DbClient } from "../clients";
import type { WaMessage } from "./meta";
import { hasFeature } from "../features";
import { handleAgentEcho } from "./conversations";
import { recordAgentEcho, recordInboundMessage, updateDeliveryStatus, type RecordResult } from "./messages";
import { sendPreparationAfterDelivery } from "./preparation";
import { sendGuidanceAfterDelivery } from "./guidance";
import { guidanceSender, preparationSender, type ClinicSender } from "./send";
import { applyTemplateStatusEvent, type TemplateStatusEvent } from "./templateSync";
import { handleIncomingMessage } from "./bot/router";

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

/** As mudanças do corpo do webhook (entry[].changes[].value), em ordem. */
export function webhookChanges(payload: unknown): WebhookChange[] {
  const entries = (payload as { entry?: { changes?: { value?: WebhookChange }[] }[] } | null)?.entry;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => (Array.isArray(entry?.changes) ? entry.changes : []).map((change) => change?.value)).filter(
    (value): value is WebhookChange => Boolean(value),
  );
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
  /** Mensagens respondidas pelo bot. */
  botReplies: number;
  errors: number;
};

/** Registra os eventos. Erro num evento não para os outros (vai para o log). */
export async function processWebhook(payload: unknown, deps: WebhookDeps, now: Date = new Date()): Promise<WebhookSummary> {
  const summary: WebhookSummary = { inbound: 0, echoes: 0, statuses: 0, duplicates: 0, unknownNumbers: 0, preparations: 0, templates: 0, botReplies: 0, errors: 0 };
  const count = (result: RecordResult, kind: "inbound" | "echoes") => {
    if (result.recorded) summary[kind] += 1;
    else if (result.reason === "duplicate") summary.duplicates += 1;
  };
  const attempt = async (what: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      summary.errors += 1;
      console.error(`[whatsapp webhook] ${what}:`, error instanceof Error ? error.message : String(error));
    }
  };

  for (const change of webhookChanges(payload)) {
    const phoneNumberId = change.metadata?.phone_number_id ?? "";
    const events = (change.messages?.length ?? 0) + (change.statuses?.length ?? 0) + (change.message_echoes?.length ?? 0);
    if (!events) continue;
    const clinicId = phoneNumberId ? await deps.resolveClinic(phoneNumberId) : null;
    if (!clinicId) {
      summary.unknownNumbers += events;
      console.warn(`[whatsapp webhook] número sem clínica conectada: ${phoneNumberId || "(sem phone_number_id)"}`);
      continue;
    }
    const db = deps.clientFor(clinicId);

    for (const message of change.messages ?? []) {
      let recorded = false;
      await attempt("mensagem recebida", async () => {
        const result = await recordInboundMessage(db, clinicId, message, now);
        count(result, "inbound");
        recorded = result.recorded;
      });
      if (!recorded || !deps.senderFor) continue;
      await attempt("bot", async () => {
        const sender = await deps.senderFor!(clinicId);
        if (sender && (await handleIncomingMessage({ db, clinicId, sender, now }, message)) === "handled") summary.botReplies += 1;
      });
    }
    for (const status of change.statuses ?? []) {
      if (status.status === "failed" && status.errors?.length) {
        console.error(
          `[whatsapp webhook] entrega falhou (${status.id}):`,
          status.errors.map((e) => `${e.code} ${e.title ?? e.message}`).join("; "),
        );
      }
      await attempt("situação de entrega", async () => {
        if (!status.id || !status.status) return;
        const result = await updateDeliveryStatus(db, clinicId, status.id, status.status);
        if (!result.updated) return;
        summary.statuses += 1;
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
    for (const echo of change.message_echoes ?? []) {
      await attempt("eco da recepção", async () => {
        const result = await recordAgentEcho(db, clinicId, echo, now);
        count(result, "echoes");
        // A recepção respondeu pelo app (coexistência): pausa o bot naquela conversa; "#bot" devolve (F6.4).
        if (result.recorded && (await hasFeature(db, clinicId, "whatsapp_bot"))) await handleAgentEcho(db, clinicId, echo, result.contactId, now);
      });
    }
  }

  for (const { wabaId, ...event } of templateStatusChanges(payload)) {
    if (!deps.resolveClinicsByWaba) break;
    await attempt("situação do template", async () => {
      for (const clinicId of await deps.resolveClinicsByWaba!(wabaId)) {
        if (await applyTemplateStatusEvent(deps.clientFor(clinicId), clinicId, event)) summary.templates += 1;
      }
    });
  }
  return summary;
}
