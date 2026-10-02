import type { SupabaseClient } from "@supabase/supabase-js";

// Funil de agendamento via WhatsApp (Fase 15) — grava em `bot_funnel_events`
// (append-only, ver migração 0021). Melhor esforço: uma falha aqui nunca pode
// travar a conversa do bot nem a página de agendar, só loga.

export type FunnelFlow = "booking" | "return_booking" | "exam" | "cancel" | "reschedule" | "handoff";

export interface FunnelEvent {
  sessionId: string;
  flow: FunnelFlow;
  step: string;
  guardianPhone: string;
  guardianId: string | null;
  source?: "bot" | "web";
  metadata?: Record<string, unknown>;
}

export async function logFunnelEvent(supabase: SupabaseClient, event: FunnelEvent): Promise<void> {
  const { error } = await supabase.from("bot_funnel_events").insert({
    session_id: event.sessionId,
    flow: event.flow,
    step: event.step,
    source: event.source ?? "bot",
    guardian_phone: event.guardianPhone,
    guardian_id: event.guardianId,
    metadata: event.metadata ?? {},
  });
  if (error) {
    console.error("[funnel] erro ao gravar evento:", event.flow, event.step, error.message);
  }
}

// Abre uma tentativa nova na conversa: guarda o id em `conversation_state`
// (lido por `updateConversationState` a cada troca de estado) e grava
// 'started'. Chamado pelo menu, antes do start* de cada fluxo.
export async function startFunnel(
  supabase: SupabaseClient,
  guardianPhone: string,
  guardianId: string | null,
  flow: FunnelFlow,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const sessionId = crypto.randomUUID();
  const { error } = await supabase
    .from("conversation_state")
    .update({ funnel_session_id: sessionId, funnel_flow: flow })
    .eq("guardian_phone", guardianPhone);
  if (error) {
    console.error("[funnel] erro ao abrir tentativa:", error.message);
    return;
  }
  await logFunnelEvent(supabase, { sessionId, flow, step: "started", guardianPhone, guardianId, metadata });
}

// Tentativa aberta pelo "Encaixe ou antecipar" sem nada marcado (Fase 25):
// o link gerado leva `join_waitlist` e o atendimento entra na lista ao ser
// confirmado pela página.
export async function funnelStartedFromWaitlist(supabase: SupabaseClient, sessionId: string): Promise<boolean> {
  const { data } = await supabase
    .from("bot_funnel_events")
    .select("metadata")
    .eq("session_id", sessionId)
    .eq("step", "started")
    .limit(1)
    .maybeSingle();
  return (data?.metadata as Record<string, unknown> | null)?.waitlist === true;
}

// Passos na página /agendar/[token] (Fase 15 · etapa 3), ligados à tentativa
// do bot que gerou o link. Link sem tentativa (ex.: gerado pelo cancelamento
// em massa, ou anterior à Fase 15) não entra no funil.
export interface FunnelLink {
  funnel_session_id?: string | null;
  guardian_phone?: string | null;
  guardian_id?: string | null;
  mode?: string | null;
  appointment_type?: string | null;
}

export async function logWebFunnelEvent(
  supabase: SupabaseClient,
  link: FunnelLink,
  step: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  if (!link.funnel_session_id || !link.guardian_phone) return;
  const flow: FunnelFlow =
    link.mode === "reschedule"
      ? "reschedule"
      : link.appointment_type === "exam"
        ? "exam"
        : link.appointment_type === "return_visit"
          ? "return_booking"
          : "booking";
  await logFunnelEvent(supabase, {
    sessionId: link.funnel_session_id,
    flow,
    step,
    source: "web",
    guardianPhone: link.guardian_phone,
    guardianId: link.guardian_id ?? null,
    metadata,
  });
}
