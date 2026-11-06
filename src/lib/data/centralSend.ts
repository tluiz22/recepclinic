import type { ClinicRole } from "../clinicAccess";
import type { DbClient } from "./clients";
import type { Json } from "../supabase/database.types";
import { DataError, unwrap } from "./errors";
import { logError } from "../log";
import { getApprovedTemplate, type ApprovedTemplate } from "./whatsapp/connection";
import type { SendOutcome } from "./whatsapp/messages";
import type { ClinicSender } from "./whatsapp/send";
import { pauseForHuman } from "./whatsapp/conversations";
import { defaultTemplate } from "./whatsapp/templates";

// Responder, assumir e transferir pela Central (CN4a; plano em docs/planejamento-central-atendimento.md, decisões 5
// e 7 e R2, cliente, 05/nov/2026) e o "Retomar conversa" fora das 24 h (CN4b). O banco confere quem pode, a janela de
// 24 h e o responsável que a tela mostrou, e grava a mensagem antes de enviar (com a chave da tela: o mesmo envio não
// sai duas vezes). Enviar e gravar o resultado é com a credencial da clínica, a única que lê o token do WhatsApp.

export type SendResult =
  | { kind: "sent" }
  | { kind: "failed"; reason: string }
  /** A mesma chave já foi: nada sai de novo. */
  | { kind: "duplicate" }
  /** Outra pessoa assumiu desde que a tela abriu ("Ana assumiu agora"): a mensagem não sai. */
  | { kind: "changed"; name: string | null }
  | { kind: "window_closed" }
  /** "Retomar conversa" com o paciente escrevendo nas últimas 24 h: responder por texto. */
  | { kind: "window_open" }
  /** Já foi um "Retomar conversa" depois da última mensagem do paciente: aguardar a resposta. */
  | { kind: "pending" }
  /** O modelo "Retomar conversa" ainda não está aprovado na conta da clínica. */
  | { kind: "no_template" };

export type SendDeps = {
  /** Login de quem envia (confere o acesso e o responsável). */
  db: DbClient;
  /** Credencial da clínica: pausa o bot e grava o resultado. */
  serviceDb: DbClient;
  /** null = WhatsApp da clínica não conectado. */
  sender: ClinicSender | null;
};

type Prepared = { outcome: string; message_id: string | null; assigned_to: string | null; assigned_name: string | null };

export type SendInput = { phone: string; clientKey: string; body: string; expectedAssigned: string | null };

/** Envia (`send`), grava "enviada" ou "não enviada" e devolve o que aconteceu. Falhou: guarda o pedido para "Tentar de novo". */
async function deliver(
  deps: SendDeps,
  clinicId: string,
  messageId: string,
  send: (sender: ClinicSender) => Promise<SendOutcome>,
): Promise<SendResult> {
  const outcome: SendOutcome = deps.sender ? await send(deps.sender) : { sent: false, reason: "WhatsApp da clínica não conectado" };
  const update = outcome.sent
    ? { status: "sent", wa_message_id: outcome.messageId, retry_payload: null }
    : {
        status: "failed",
        failure_reason: outcome.reason.slice(0, 300),
        failure_code: outcome.failure?.code ?? null,
        ...(outcome.request ? { retry_payload: { request: outcome.request, context: {} } as unknown as Json } : {}),
      };
  const { error } = await deps.serviceDb.from("whatsapp_messages").update(update).eq("clinic_id", clinicId).eq("id", messageId);
  if (error) logError("central: resultado do envio não gravado", error, { clinica: clinicId, mensagem: messageId });
  return outcome.sent ? { kind: "sent" } : { kind: "failed", reason: outcome.reason };
}

/** Conversa com o bot (Finalizadas): pausa o bot antes, como a resposta pelo app, e prepara de novo. */
async function prepareWithPause(deps: SendDeps, clinicId: string, phone: string, run: (expected: string | null | undefined) => Promise<Prepared>): Promise<Prepared> {
  const prepared = await run(undefined);
  if (prepared.outcome !== "bot") return prepared;
  await pauseForHuman(deps.serviceDb, clinicId, phone, { contactId: null, reason: "agent_took_over" });
  return run(null);
}

function outcomeOf(prepared: Prepared): SendResult | null {
  switch (prepared.outcome) {
    case "ok":
      return null;
    case "duplicate":
      return { kind: "duplicate" };
    case "changed":
      return { kind: "changed", name: prepared.assigned_name };
    case "window_closed":
    case "window_open":
    case "pending":
      return { kind: prepared.outcome };
    default:
      throw new DataError("unexpected", `Conversas: resposta inesperada do envio (${prepared.outcome})`);
  }
}

/** Resposta pela Central: quem responde vira o responsável (decisão 5). */
export async function sendFromCentral(deps: SendDeps, clinicId: string, input: SendInput): Promise<SendResult> {
  const body = input.body.trim();
  const prepared = await prepareWithPause(deps, clinicId, input.phone, async (expected) =>
    unwrap(
      await deps.db.rpc("central_send_prepare", {
        p_clinic_id: clinicId,
        p_contact_phone: input.phone,
        p_client_key: input.clientKey,
        p_body: input.body,
        p_expected_assigned: expected === undefined ? input.expectedAssigned : expected,
      }),
      "Conversas",
    )[0],
  );
  return outcomeOf(prepared) ?? deliver(deps, clinicId, prepared.message_id!, (sender) => sender.text(input.phone, body));
}

export type ResumeInput = { phone: string; clientKey: string; expectedAssigned: string | null };

/** Texto que o paciente vê no "Retomar conversa" (o aprovado na conta da clínica ou o padrão; sem variáveis). */
export function resumeText(template: Pick<ApprovedTemplate, "body"> | null): string {
  return template?.body ?? defaultTemplate("conversation_resume")!.body;
}

/**
 * "Retomar conversa" (decisão 7): fora das 24 h, envia o modelo de utilidade aprovado pela Meta (pago por envio, na
 * conta da clínica). Quem retoma assume. Um por vez: enquanto o paciente não responde, não sai outro.
 */
export async function resumeFromCentral(deps: SendDeps, clinicId: string, input: ResumeInput): Promise<SendResult> {
  const template = await getApprovedTemplate(deps.serviceDb, clinicId, "conversation_resume");
  if (!template) return { kind: "no_template" };
  const body = resumeText(template);
  const prepared = await prepareWithPause(deps, clinicId, input.phone, async (expected) =>
    unwrap(
      await deps.db.rpc("central_resume_prepare", {
        p_clinic_id: clinicId,
        p_contact_phone: input.phone,
        p_client_key: input.clientKey,
        p_body: body,
        p_template_name: template.name,
        p_expected_assigned: expected === undefined ? input.expectedAssigned : expected,
      }),
      "Conversas",
    )[0],
  );
  return outcomeOf(prepared) ?? deliver(deps, clinicId, prepared.message_id!, (sender) => sender.template(input.phone, "conversation_resume", template, []));
}

/** "Tentar de novo" numa mensagem que não saiu (texto ou "Retomar conversa", com o mesmo pedido à Meta). */
export async function retryFromCentral(deps: SendDeps, clinicId: string, messageId: string): Promise<SendResult | { kind: "already" }> {
  const row = unwrap(await deps.db.rpc("central_send_retry", { p_clinic_id: clinicId, p_message_id: messageId }), "Conversas")[0];
  if (row.outcome === "already") return { kind: "already" };
  if (row.outcome === "window_closed") return { kind: "window_closed" };
  if (row.outcome === "resume") {
    const saved = unwrap(
      await deps.serviceDb.from("whatsapp_messages").select("retry_payload").eq("clinic_id", clinicId).eq("id", messageId).maybeSingle(),
      "Conversas",
    );
    const request = (saved?.retry_payload as { request?: Record<string, unknown> } | null)?.request;
    if (!request) {
      await deps.serviceDb.from("whatsapp_messages").update({ status: "failed" }).eq("clinic_id", clinicId).eq("id", messageId);
      return { kind: "failed", reason: "pedido do envio não guardado" };
    }
    return deliver(deps, clinicId, messageId, (sender) =>
      sender.resend ? sender.resend(request, row.body ?? "") : Promise.resolve({ sent: false, reason: "reenvio indisponível" }),
    );
  }
  return deliver(deps, clinicId, messageId, (sender) => sender.text(row.contact_phone, row.body ?? ""));
}

export type AssignResult = { kind: "ok" | "same" | "closed" | "changed"; name: string | null };

/** Assumir (`to` null) ou transferir. `expected`: o responsável que a tela mostrou. */
export async function assignConversation(
  db: DbClient,
  clinicId: string,
  phone: string,
  { expected, to = null }: { expected: string | null; to?: string | null },
): Promise<AssignResult> {
  const rows = unwrap(
    await db.rpc("central_assign", { p_clinic_id: clinicId, p_contact_phone: phone, p_expected_assigned: expected, p_to: to }),
    "Conversas",
  );
  return { kind: rows[0].outcome as AssignResult["kind"], name: rows[0].assigned_name };
}

export type TeamOption = { userId: string; name: string; roles: ClinicRole[] };

/** Para quem transferir: Administrador, Recepção e Profissional da clínica. */
export async function listCentralTeam(db: DbClient, clinicId: string): Promise<TeamOption[]> {
  const rows = unwrap(await db.rpc("central_team", { p_clinic_id: clinicId }), "Equipe");
  return rows.map((row) => ({ userId: row.user_id, name: row.name, roles: row.roles as ClinicRole[] }));
}

/** Rotina de 5 em 5 minutos: o paciente esperando 30 min (no horário da clínica) volta para "Sem responsável". */
export async function releaseIdleConversations(serviceDb: DbClient, clinicId: string): Promise<number> {
  return unwrap(await serviceDb.rpc("central_release_idle", { p_clinic_id: clinicId }), "Conversas") ?? 0;
}

/** Aviso da tela depois de enviar. */
export function sendMessageText(result: SendResult | { kind: "already" }): { tone: "success" | "error"; text: string } {
  switch (result.kind) {
    case "sent":
      return { tone: "success", text: "Mensagem enviada." };
    case "duplicate":
    case "already":
      return { tone: "success", text: "Essa mensagem já tinha sido enviada." };
    case "failed":
      return { tone: "error", text: 'A mensagem não saiu pelo WhatsApp. Confira a conexão e use "Tentar de novo" na mensagem.' };
    case "changed":
      return {
        tone: "error",
        text: `${result.name ?? "Outra pessoa"} assumiu a conversa agora. A sua mensagem não foi enviada: confira a conversa antes de responder.`,
      };
    case "window_closed":
      return { tone: "error", text: "Passaram 24 horas desde a última mensagem do paciente. Pelo WhatsApp, a mensagem não pode mais sair como texto livre." };
    case "window_open":
      return { tone: "error", text: "O paciente escreveu nas últimas 24 horas: responda pela caixa de mensagem, sem o modelo." };
    case "pending":
      return { tone: "success", text: "O \"Retomar conversa\" já foi enviado. Quando o paciente responder, a conversa volta a aceitar texto." };
    case "no_template":
      return {
        tone: "error",
        text: 'O modelo "Retomar conversa" ainda não foi aprovado pela Meta para esta clínica. Peça ao suporte do RecepClinic para criar o modelo.',
      };
  }
}
