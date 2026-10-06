import { createHmac, timingSafeEqual } from "node:crypto";
import type { DbClient } from "../clients";
import type { WaMessage } from "./meta";
import { recordAgentEcho, recordInboundMessage, updateDeliveryStatus, type RecordResult } from "./messages";

// Webhook do WhatsApp por clínica (F6.1, D3a). Cada evento traz o número que
// recebeu (`metadata.phone_number_id`); a plataforma descobre a clínica dele
// e todo o resto roda com a credencial limitada àquela clínica (D1). Número
// desconhecido ou desconectado é ignorado (a Meta recebe 200 do mesmo jeito,
// senão reenvia). Nesta parte o webhook só registra: mensagens recebidas,
// situações de entrega e ecos da recepção. O bot volta a responder na F6.3; o
// preparo depois da entrega, na F6.2; a pausa pelo eco, na F6.4.

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
};

export type WebhookSummary = {
  inbound: number;
  echoes: number;
  statuses: number;
  duplicates: number;
  /** Eventos de números sem clínica (ou sem o número no evento). */
  unknownNumbers: number;
  errors: number;
};

/** Registra os eventos. Erro num evento não para os outros (vai para o log). */
export async function processWebhook(payload: unknown, deps: WebhookDeps, now: Date = new Date()): Promise<WebhookSummary> {
  const summary: WebhookSummary = { inbound: 0, echoes: 0, statuses: 0, duplicates: 0, unknownNumbers: 0, errors: 0 };
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
      await attempt("mensagem recebida", async () => count(await recordInboundMessage(db, clinicId, message, now), "inbound"));
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
        if (result.updated) summary.statuses += 1;
      });
    }
    for (const echo of change.message_echoes ?? []) {
      await attempt("eco da recepção", async () => count(await recordAgentEcho(db, clinicId, echo, now), "echoes"));
    }
  }
  return summary;
}
