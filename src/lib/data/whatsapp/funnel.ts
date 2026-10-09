import type { Json } from "../../supabase/database.types";
import type { DbClient } from "../clients";
import { logError } from "../../log";

// Funil do bot (Fase 15 do piloto), F3.9a: cada tentativa (agendar, retorno,
// exame, cancelar, remarcar) é uma sessão com os passos que alcançou; o
// atendimento humano (pedido e recepção que assume) é registrado como fluxo
// próprio. Só o bot e a página de agendar gravam (credencial da clínica), e
// só com o bot liberado (D11). Melhor esforço, como no piloto: uma falha
// aqui nunca trava a conversa nem a página, só fica no log.

export type FunnelFlow = "booking" | "return_booking" | "exam" | "cancel" | "reschedule" | "handoff";

export type FunnelEvent = {
  sessionId: string;
  flow: FunnelFlow;
  step: string;
  phone: string;
  contactId: string | null;
  source?: "bot" | "web";
  metadata?: Record<string, unknown>;
};

export async function logFunnelEvent(db: DbClient, clinicId: string, event: FunnelEvent, now: Date = new Date()): Promise<void> {
  const { error } = await db.from("bot_funnel_events").insert({
    clinic_id: clinicId,
    session_id: event.sessionId,
    flow: event.flow,
    step: event.step,
    source: event.source ?? "bot",
    contact_phone: event.phone,
    contact_id: event.contactId,
    metadata: (event.metadata ?? {}) as NonNullable<Json>,
    occurred_at: now.toISOString(),
  });
  if (error) logError("funil: erro ao gravar evento", error, { clinica: clinicId, fluxo: event.flow, etapa: event.step });
}

/** Dados gravados no início da tentativa (ex.: veio do "Encaixe ou antecipar", Fase 25 do piloto). */
export async function funnelStartMetadata(db: DbClient, clinicId: string, sessionId: string): Promise<Record<string, unknown> | null> {
  const { data } = await db
    .from("bot_funnel_events")
    .select("metadata")
    .eq("clinic_id", clinicId)
    .eq("session_id", sessionId)
    .eq("step", "started")
    .limit(1)
    .maybeSingle();
  return (data?.metadata as Record<string, unknown> | null) ?? null;
}

/** Link de agendar/remarcar ligado à tentativa do bot que o gerou. */
export type FunnelLink = {
  funnelSessionId: string | null;
  contactPhone: string | null;
  contactId: string | null;
  mode: "create" | "reschedule";
  serviceCategory: "consultation" | "return_visit" | "exam";
};

/**
 * Passo na página de agendar (Fase 15, etapa 3). Link sem tentativa (ex.:
 * gerado pelo cancelamento da clínica) não entra no funil.
 */
export async function logWebFunnelEvent(
  db: DbClient,
  clinicId: string,
  link: FunnelLink,
  step: string,
  metadata: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<void> {
  if (!link.funnelSessionId || !link.contactPhone) return;
  const flow: FunnelFlow =
    link.mode === "reschedule"
      ? "reschedule"
      : link.serviceCategory === "exam"
        ? "exam"
        : link.serviceCategory === "return_visit"
          ? "return_booking"
          : "booking";
  await logFunnelEvent(
    db,
    clinicId,
    { sessionId: link.funnelSessionId, flow, step, source: "web", phone: link.contactPhone, contactId: link.contactId, metadata },
    now,
  );
}
